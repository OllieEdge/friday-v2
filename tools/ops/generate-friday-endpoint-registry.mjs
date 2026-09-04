#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const ROUTES_DIR = path.join(ROOT, "server", "src", "routes");
const SERVER_INDEX = path.join(ROOT, "server", "src", "index.js");
const OUT_DIR = path.join(ROOT, "capabilities");
const OUT_FILE = path.join(OUT_DIR, "friday-endpoints.json");

const CHECK_MODE = process.argv.includes("--check");

function fail(message) {
  console.error(`[capabilities] ${message}`);
  process.exit(1);
}

function parsePublicRules(indexText) {
  const exact = new Set();
  const startsWith = [];

  for (const m of indexText.matchAll(/url\.pathname\s*===\s*"([^"]+)"/g)) exact.add(m[1]);
  for (const m of indexText.matchAll(/url\.pathname\.startsWith\("([^"]+)"\)/g)) startsWith.push(m[1]);

  return { exact, startsWith };
}

function endpointAuth(pathname, publicRules) {
  if (publicRules.exact.has(pathname)) return "public";
  if (publicRules.startsWith.some((prefix) => pathname.startsWith(prefix))) return "public";
  return "auth_required";
}

function readRouteEndpoints() {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));

  const indexText = fs.readFileSync(SERVER_INDEX, "utf8");
  const publicRules = parsePublicRules(indexText);

  const endpoints = [];
  for (const file of files) {
    const full = path.join(ROUTES_DIR, file);
    const text = fs.readFileSync(full, "utf8");
    const matches = [...text.matchAll(/router\.add\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g)];
    for (const match of matches) {
      const method = match[1];
      const route = match[2];
      endpoints.push({
        method,
        path: route,
        routeFile: `server/src/routes/${file}`,
        auth: endpointAuth(route, publicRules),
      });
    }
  }

  return endpoints.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    const byMethod = a.method.localeCompare(b.method);
    if (byMethod !== 0) return byMethod;
    return a.routeFile.localeCompare(b.routeFile);
  });
}

const endpoints = readRouteEndpoints();
const routeFileCounts = endpoints.reduce((acc, endpoint) => {
  acc.set(endpoint.routeFile, (acc.get(endpoint.routeFile) ?? 0) + 1);
  return acc;
}, new Map());
const authCounts = endpoints.reduce((acc, endpoint) => {
  acc.set(endpoint.auth, (acc.get(endpoint.auth) ?? 0) + 1);
  return acc;
}, new Map());

const registry = {
  schemaVersion: 1,
  source: "server/src/routes/*.js",
  totalEndpoints: endpoints.length,
  routeFileCount: routeFileCounts.size,
  authSummary: Array.from(authCounts.entries())
    .map(([auth, count]) => ({ auth, count }))
    .sort((a, b) => a.auth.localeCompare(b.auth)),
  routeSummary: Array.from(routeFileCounts.entries())
    .map(([routeFile, count]) => ({ routeFile, count }))
    .sort((a, b) => (b.count - a.count) || a.routeFile.localeCompare(b.routeFile)),
  endpoints,
};

const next = `${JSON.stringify(registry, null, 2)}\n`;

if (CHECK_MODE) {
  if (!fs.existsSync(OUT_FILE)) fail(`Missing generated file: ${path.relative(ROOT, OUT_FILE)}`);
  const current = fs.readFileSync(OUT_FILE, "utf8");
  if (current !== next) fail(`Drift detected in ${path.relative(ROOT, OUT_FILE)}. Run: npm run capabilities:build`);
  console.log(`[capabilities] OK ${path.relative(ROOT, OUT_FILE)}`);
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, next, "utf8");
  console.log(`[capabilities] Wrote ${path.relative(ROOT, OUT_FILE)}`);
}
