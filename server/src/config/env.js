const fs = require("node:fs");
const path = require("node:path");
const { ROOT_DIR } = require("./paths");

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

function loadDotEnvIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { loaded: false, filePath };
    const vars = parseDotEnv(fs.readFileSync(filePath, "utf8"));
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
    }
    return { loaded: true, filePath, keys: Object.keys(vars) };
  } catch (e) {
    return { loaded: false, filePath, error: String(e?.message || e) };
  }
}

function loadRootEnv() {
  return loadDotEnvIfPresent(path.join(ROOT_DIR, ".env"));
}

function envString(key, fallback = "") {
  const v = process.env[key];
  if (v == null) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

function envNumber(key, fallback) {
  const s = envString(key, "");
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { loadRootEnv, envString, envNumber };

