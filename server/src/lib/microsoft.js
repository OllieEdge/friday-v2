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

function requireMicrosoftConfig() {
  const clientId = envString("MICROSOFT_CLIENT_ID", "");
  const clientSecret = envString("MICROSOFT_CLIENT_SECRET", "");
  const tenant = envString("MICROSOFT_TENANT", "common");
  const scopes = envString("MICROSOFT_SCOPES", "openid profile email offline_access User.Read");
  if (!clientId) {
    const err = new Error("Microsoft OAuth not configured (set MICROSOFT_CLIENT_ID)");
    err.statusCode = 400;
    throw err;
  }
  return { clientId, clientSecret, tenant, scopes };
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
  return `${baseUrlFromReq(req)}/api/accounts/microsoft/callback`;
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

function base64Url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function newPkceVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function pkceChallenge(verifier) {
  const digest = crypto.createHash("sha256").update(String(verifier)).digest();
  return base64Url(digest);
}

function buildAuthUrl({ tenant, clientId, redirectUri, scopes, state, pkceChallengeValue }) {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(String(tenant || "common"))}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", String(scopes || "").trim().split(/\s+/).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallengeValue);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function exchangeCodeForTokens({ tenant, code, clientId, clientSecret, redirectUri, pkceVerifier }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: String(pkceVerifier),
  });
  if (clientSecret) body.set("client_secret", String(clientSecret));

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(String(tenant || "common"))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
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

async function fetchMe(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { authorization: `Bearer ${accessToken}` } });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error?.message || txt || `HTTP ${res.status}`);
  return json;
}

module.exports = {
  normalizeAccountKey,
  requireMicrosoftConfig,
  buildRedirectUri,
  buildAuthUrl,
  newNonce,
  encodeState,
  decodeState,
  newPkceVerifier,
  pkceChallenge,
  exchangeCodeForTokens,
  fetchMe,
  baseUrlFromReq,
};
