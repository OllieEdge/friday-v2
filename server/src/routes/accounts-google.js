const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { baseUrlFromReq, buildAuthUrl, buildRedirectUri, decodeState, encodeState, newNonce, normalizeAccountKey, requireGoogleConfig, exchangeCodeForTokens, fetchUserInfo } = require("../lib/google");

const ALLOWED_KEYS = new Set(["work", "personal"]);

function safeReturnTo(value) {
  const v = String(value || "").trim();
  if (!v) return "/";
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/";
  return v;
}

function keyOrThrow(raw) {
  const key = normalizeAccountKey(raw);
  if (!ALLOWED_KEYS.has(key)) {
    const err = new Error("invalid_account_key");
    err.statusCode = 400;
    throw err;
  }
  return key;
}

function registerGoogleAccounts(router, { googleAccounts }) {
  router.add("GET", "/api/accounts/google", (req, res) => {
    const rows = googleAccounts.list();
    const byKey = new Map(rows.map((r) => [r.accountKey, r]));
    const keys = ["work", "personal"];
    const accounts = keys.map((k) => {
      const r = byKey.get(k);
      return r
        ? { accountKey: k, connected: true, email: r.email, scopes: r.scopes, connectedAt: r.connectedAt, updatedAt: r.updatedAt }
        : { accountKey: k, connected: false };
    });
    return sendJson(res, 200, { ok: true, accounts });
  });

  router.add("POST", "/api/accounts/google/:accountKey/connect/start", async (req, res, _url, params) => {
    const accountKey = keyOrThrow(params.accountKey);
    const cfg = requireGoogleConfig();
    const body = await readJson(req);
    const returnTo = safeReturnTo(body?.returnTo);

    const redirectUri = buildRedirectUri(req);
    const nonce = newNonce();
    googleAccounts.createState({ nonce, accountKey, redirectUri });

    const state = encodeState({ nonce, accountKey, returnTo });
    const authUrl = buildAuthUrl({ clientId: cfg.clientId, redirectUri, scopes: cfg.scopes, state });
    return sendJson(res, 200, { ok: true, authUrl });
  });

  router.add("POST", "/api/accounts/google/:accountKey/disconnect", (req, res, _url, params) => {
    const accountKey = keyOrThrow(params.accountKey);
    googleAccounts.remove(accountKey);
    return sendJson(res, 200, { ok: true });
  });

  router.add("GET", "/oauth/google/callback", async (req, res, url) => {
    const code = String(url.searchParams.get("code") || "");
    const stateStr = String(url.searchParams.get("state") || "");
    if (!code || !stateStr) return sendJson(res, 400, { ok: false, error: "missing_code_or_state" });

    let decoded = null;
    try {
      decoded = decodeState(stateStr);
    } catch {
      decoded = null;
    }
    const nonce = String(decoded?.nonce || "");
    const accountKey = keyOrThrow(decoded?.accountKey);
    const returnTo = safeReturnTo(decoded?.returnTo);

    const stateRow = googleAccounts.consumeState(nonce);
    if (!stateRow) return sendJson(res, 400, { ok: false, error: "invalid_state" });
    if (stateRow.accountKey !== accountKey) return sendJson(res, 400, { ok: false, error: "invalid_state" });

    const cfg = requireGoogleConfig();
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: stateRow.redirectUri,
    });

    const accessToken = String(tokens.access_token || "");
    const refreshToken = String(tokens.refresh_token || "");
    if (!accessToken) return sendJson(res, 400, { ok: false, error: "missing_access_token" });

    const user = await fetchUserInfo(accessToken);
    const email = String(user?.email || "").trim() || "(unknown)";

    let finalRefresh = refreshToken;
    if (!finalRefresh) {
      const existing = googleAccounts.get(accountKey);
      finalRefresh = String(existing?.refreshToken || "");
    }
    if (!finalRefresh) return sendJson(res, 400, { ok: false, error: "missing_refresh_token" });

    googleAccounts.upsert({ accountKey, email, refreshToken: finalRefresh, scopes: cfg.scopes });

    const origin = baseUrlFromReq(req).replace(/\/+$/, "");
    const target = new URL(returnTo, origin);
    target.searchParams.set("settings", "accounts");
    target.searchParams.set("google", "connected");
    target.searchParams.set("key", accountKey);
    res.writeHead(302, { location: target.toString() });
    res.end();
  });
}

module.exports = { registerGoogleAccounts };
