const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function randomId() {
  return crypto.randomUUID();
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || "");
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function isSecureRequest(req) {
  const xfProto = String(req.headers?.["x-forwarded-proto"] || "").toLowerCase();
  if (xfProto === "https") return true;
  // WebAuthn allows localhost over http; cookies can still be non-secure in dev.
  return false;
}

function setCookie(res, { name, value, maxAgeSeconds, secure, httpOnly = true, sameSite = "Lax", path = "/" }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  // Note: no Domain attribute; host-only cookie is safer.
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, { name }) {
  setCookie(res, { name, value: "", maxAgeSeconds: 0, secure: true });
  // Also clear non-secure variant (dev/localhost).
  setCookie(res, { name, value: "", maxAgeSeconds: 0, secure: false });
}

module.exports = {
  nowIso,
  addDaysIso,
  randomId,
  parseCookies,
  isSecureRequest,
  setCookie,
  clearCookie,
};

