const fs = require("node:fs");
const path = require("node:path");

function listRunbookFiles(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b, "en"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function loadRunbooksFromDir(dir) {
  const files = listRunbookFiles(dir);
  const out = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseRunbookMarkdown(raw);
    const fileId = path.basename(filePath).replace(/\.md$/i, "");
    const id = String(parsed.meta.id || fileId).trim() || fileId;
    out.push({
      id,
      path: filePath,
      meta: normalizeMeta(parsed.meta),
      body: parsed.body,
      raw,
    });
  }
  return out;
}

function normalizeMeta(meta) {
  const m = meta || {};
  const enabled = normalizeBool(m.enabled, true);
  const everyMinutes = normalizeInt(m.every_minutes ?? m.everyMinutes ?? m.every, null);
  const timezone = String(m.timezone || "Europe/London").trim() || "Europe/London";
  const accounts = normalizeAccounts(m.accounts ?? m.account ?? null);
  const cursorStrategy = String(m.cursor_strategy || "gmail_history_id").trim() || "gmail_history_id";
  const title = String(m.title || "").trim();
  return { ...m, enabled, everyMinutes, timezone, accounts, cursorStrategy, title };
}

function updateRunbookFrontmatter(raw, patch) {
  const parsed = parseRunbookMarkdown(raw);
  const nextMeta = { ...(parsed.meta || {}), ...(patch || {}) };
  const head = formatFrontmatter(nextMeta);
  return head + parsed.body;
}

module.exports = { loadRunbooksFromDir, parseRunbookMarkdown, updateRunbookFrontmatter };

function parseRunbookMarkdown(text) {
  const s = String(text || "");
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return { meta: {}, body: s };
  const end = s.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: s };
  const after = s.indexOf("\n", end + 1);
  if (after === -1) return { meta: {}, body: "" };
  const fmText = s.slice(4, end).trim();
  const body = s.slice(after + 1);
  return { meta: parseFrontmatter(fmText), body };
}

function parseFrontmatter(text) {
  const lines = String(text || "").split(/\r?\n/);
  const meta = {};
  let currentKey = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const keyMatch = raw.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = String(keyMatch[1] || "").trim().replace(/\s+/g, "_");
      const valuePart = String(keyMatch[2] || "").trim();
      meta[currentKey] = parseScalar(valuePart);
      continue;
    }
    const listMatch = raw.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentKey) {
      const arr = Array.isArray(meta[currentKey]) ? meta[currentKey] : meta[currentKey] == null ? [] : [meta[currentKey]];
      arr.push(parseScalar(String(listMatch[1] || "").trim()));
      meta[currentKey] = arr;
    }
  }
  return meta;
}

function formatFrontmatter(meta) {
  const lines = ["---"];
  const keys = Object.keys(meta || {}).sort((a, b) => a.localeCompare(b, "en"));
  for (const k of keys) {
    const v = meta[k];
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`- ${formatScalar(item)}`);
      continue;
    }
    lines.push(`${k}: ${formatScalar(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function parseScalar(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return v;
}

function formatScalar(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return String(v);
}

function normalizeBool(v, fallback) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return fallback;
}

function normalizeInt(v, fallback) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeAccounts(v) {
  if (v == null || v === "") return ["work", "personal"];
  const arr = Array.isArray(v) ? v : [v];
  const out = [];
  for (const a of arr) {
    const s = String(a || "").trim().toLowerCase();
    if (s === "work" || s === "personal") out.push(s);
    if (s === "both" || s === "all") {
      out.push("work", "personal");
    }
  }
  const uniq = Array.from(new Set(out));
  return uniq.length ? uniq : ["work", "personal"];
}

