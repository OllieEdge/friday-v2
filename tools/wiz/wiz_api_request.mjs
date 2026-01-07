#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(code = 0) {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  node tools/wiz/wiz_api_request.mjs --query "query { issues { totalCount }}"
  node tools/wiz/wiz_api_request.mjs --query-file ./query.graphql --variables '{"key":"value"}'

Notes:
  - Reads WIZ_CLIENT_ID, WIZ_CLIENT_SECRET, WIZ_API_ENDPOINT from friday-v2/.env
  - Optional: WIZ_TOKEN_URL (default https://auth.app.wiz.io/oauth/token), WIZ_AUDIENCE (default wiz-api)
  - Prints response body to stdout; non-2xx exits non-zero
`);
  process.exit(code);
}

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadRootEnv(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const vars = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
  }
}

function argValue(args, key) {
  const idx = args.indexOf(key);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage(0);

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
loadRootEnv(rootDir);

const queryArg = argValue(args, "--query");
const queryFile = argValue(args, "--query-file");
const variablesArg = argValue(args, "--variables");
const operationName = argValue(args, "--operation-name");

let query = "";
if (queryArg) {
  query = String(queryArg).trim();
} else if (queryFile) {
  const filePath = path.resolve(process.cwd(), String(queryFile));
  if (!fs.existsSync(filePath)) {
    // eslint-disable-next-line no-console
    console.error(`Query file not found: ${filePath}`);
    process.exit(2);
  }
  query = fs.readFileSync(filePath, "utf8").trim();
}

if (!query) usage(2);

let variables = undefined;
if (variablesArg) {
  try {
    variables = JSON.parse(String(variablesArg));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Invalid JSON for --variables: ${err?.message || err}`);
    process.exit(2);
  }
}

const clientId = String(process.env.WIZ_CLIENT_ID || "").trim();
const clientSecret = String(process.env.WIZ_CLIENT_SECRET || "").trim();
const apiEndpoint = String(process.env.WIZ_API_ENDPOINT || "").trim();
const tokenUrl = String(process.env.WIZ_TOKEN_URL || "https://auth.app.wiz.io/oauth/token").trim();
const audience = String(process.env.WIZ_AUDIENCE || "wiz-api").trim();

if (!clientId || !clientSecret || !apiEndpoint) {
  // eslint-disable-next-line no-console
  console.error("Missing WIZ_CLIENT_ID/WIZ_CLIENT_SECRET/WIZ_API_ENDPOINT (set them in friday-v2/.env).");
  process.exit(2);
}

async function fetchToken() {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(json?.error_description || json?.error || txt || `HTTP ${res.status}`);
  }
  return json;
}

const token = await fetchToken();
const accessToken = String(token?.access_token || "");
if (!accessToken) {
  // eslint-disable-next-line no-console
  console.error("Failed to obtain access token.");
  process.exit(2);
}

const payload = { query };
if (variables != null) payload.variables = variables;
if (operationName) payload.operationName = String(operationName);

const resp = await fetch(apiEndpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

const out = await resp.text();
if (!resp.ok) {
  // eslint-disable-next-line no-console
  console.error(out);
  process.exit(1);
}
process.stdout.write(out);
