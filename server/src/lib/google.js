const crypto = require("node:crypto");
const { envString } = require("../config/env");

function normalizeAccountKey(key) {
  const v = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 50);
  return v;
}

function requireGoogleConfig() {
  const clientId = envString("GOOGLE_CLIENT_ID", "");
  const clientSecret = envString("GOOGLE_CLIENT_SECRET", "");
  const scopes = envString(
    "GOOGLE_SCOPES",
    "openid email profile https://www.googleapis.com/auth/gmail.readonly",
  );
  if (!clientId || !clientSecret) {
    const err = new Error("Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)");
    err.statusCode = 400;
    throw err;
  }
  return { clientId, clientSecret, scopes };
}

function baseUrlFromReq(req) {
  const envBase = envString("FRIDAY_BASE_URL", "").replace(/\/+$/, "");
  if (envBase) return envBase;
  const proto =
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase() || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function buildRedirectUri(req) {
  return `${baseUrlFromReq(req)}/oauth/google/callback`;
}

function buildAuthUrl({ clientId, redirectUri, scopes, state }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", String(scopes || "").trim().split(/\s+/).join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function newNonce() {
  return crypto.randomBytes(18).toString("base64url");
}

function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64url");
}

function decodeState(state) {
  const raw = Buffer.from(String(state || ""), "base64url").toString("utf8");
  return JSON.parse(raw);
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
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
    const err = new Error(json?.error_description || json?.error || txt || `HTTP ${res.status}`);
    err.statusCode = 400;
    throw err;
  }
  return json;
}

async function fetchUserInfo(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
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

module.exports = {
  normalizeAccountKey,
  requireGoogleConfig,
  buildRedirectUri,
  buildAuthUrl,
  newNonce,
  encodeState,
  decodeState,
  exchangeCodeForTokens,
  fetchUserInfo,
  baseUrlFromReq,
};

