#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function usage(code = 0) {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  node tools/google/google_http_request.mjs --account work|personal --method GET --url <https://...> [--body <json|string>] [--header 'k:v']...

Notes:
  - Reads refresh token from Friday v2 SQLite (data/friday.sqlite)
  - Uses GOOGLE_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID_WORK/SECRET_WORK, GOOGLE_CLIENT_ID_PERSONAL/SECRET_PERSONAL
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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
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

function argValues(args, key) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== key) continue;
    out.push(args[i + 1]);
    i++;
  }
  return out.filter(Boolean);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage(0);

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
loadRootEnv(rootDir);

const accountKey = String(argValue(args, "--account") || "").trim();
const method = String(argValue(args, "--method") || "GET").trim().toUpperCase();
const url = String(argValue(args, "--url") || "").trim();
const bodyArg = argValue(args, "--body");
const headerArgs = argValues(args, "--header");

if (!accountKey || !url) usage(2);

function resolveClient(accountKey) {
  const key = String(accountKey || "").trim().toLowerCase();
  if (key === "work") {
    return {
      clientId: String(process.env.GOOGLE_CLIENT_ID_WORK || process.env.GOOGLE_CLIENT_ID || "").trim(),
      clientSecret: String(process.env.GOOGLE_CLIENT_SECRET_WORK || process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    };
  }
  if (key === "personal") {
    return {
      clientId: String(process.env.GOOGLE_CLIENT_ID_PERSONAL || process.env.GOOGLE_CLIENT_ID || "").trim(),
      clientSecret: String(process.env.GOOGLE_CLIENT_SECRET_PERSONAL || process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    };
  }
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  };
}

const { clientId, clientSecret } = resolveClient(accountKey);
if (!clientId || !clientSecret) {
  // eslint-disable-next-line no-console
  console.error("Missing Google OAuth client (set GOOGLE_CLIENT_ID/SECRET or per-account variants in friday-v2/.env).");
  process.exit(2);
}

const dbPath = path.join(rootDir, "data", "friday.sqlite");
if (!fs.existsSync(dbPath)) {
  // eslint-disable-next-line no-console
  console.error(`DB not found: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
const row = db
  .prepare("SELECT refresh_token AS refreshToken FROM google_accounts WHERE account_key = ?;")
  .get(accountKey);
if (!row?.refreshToken) {
  // eslint-disable-next-line no-console
  console.error(`Google account not connected: ${accountKey}`);
  process.exit(2);
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error_description || json?.error || txt || `HTTP ${res.status}`);
  return json;
}

const tok = await refreshAccessToken(String(row.refreshToken));
const accessToken = String(tok.access_token || "");
if (!accessToken) {
  // eslint-disable-next-line no-console
  console.error("Failed to obtain access token.");
  process.exit(2);
}

const headers = { authorization: `Bearer ${accessToken}` };
for (const h of headerArgs) {
  const idx = String(h).indexOf(":");
  if (idx === -1) continue;
  const k = String(h).slice(0, idx).trim().toLowerCase();
  const v = String(h).slice(idx + 1).trim();
  if (k) headers[k] = v;
}

let body = undefined;
if (bodyArg != null) {
  const raw = String(bodyArg);
  try {
    body = JSON.stringify(JSON.parse(raw));
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  } catch {
    body = raw;
  }
}

const resp = await fetch(url, { method, headers, body });
const out = await resp.text();
if (!resp.ok) {
  // eslint-disable-next-line no-console
  console.error(out);
  process.exit(1);
}
process.stdout.write(out);
