const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const {
  baseUrlFromReq,
  buildAuthUrl,
  buildRedirectUri,
  decodeState,
  encodeState,
  newNonce,
  normalizeAccountKey,
  requireMicrosoftConfig,
  exchangeCodeForTokens,
  fetchMe,
  newPkceVerifier,
  pkceChallenge,
} = require("../lib/microsoft");

function safeReturnTo(value) {
  const v = String(value || "").trim();
  if (!v) return "/";
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/";
  return v;
}

function kindOrDefault(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "personal";
  return v.slice(0, 40);
}

function tenantOrNull(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  return v.slice(0, 80);
}

function registerMicrosoftAccounts(router, { microsoftAccounts }) {
  router.add("GET", "/api/accounts/microsoft", (_req, res) => {
    const accounts = (microsoftAccounts.list() || []).map((a) => ({
      accountKey: a.accountKey,
      connected: true,
      label: a.label,
      kind: a.kind,
      tenantId: a.tenantId,
      email: a.email,
      displayName: a.displayName,
      scopes: a.scopes,
      connectedAt: a.connectedAt,
      updatedAt: a.updatedAt,
    }));
    return sendJson(res, 200, { ok: true, accounts });
  });

  router.add("POST", "/api/accounts/microsoft/connect/start", async (req, res) => {
    const cfg = requireMicrosoftConfig();
    const body = await readJson(req);
    const returnTo = safeReturnTo(body?.returnTo);

    const label = String(body?.label || "").trim().slice(0, 80);
    if (!label) return sendJson(res, 400, { ok: false, error: "missing_label" });

    const providedKey = normalizeAccountKey(body?.accountKey || "");
    const accountKey = providedKey || normalizeAccountKey(label) || normalizeAccountKey(newNonce());
    const kind = kindOrDefault(body?.kind);
    const tenantId = tenantOrNull(body?.tenantId);

    const redirectUri = buildRedirectUri(req);
    const nonce = newNonce();
    const pkceVerifier = newPkceVerifier();
    const pkceChallengeValue = pkceChallenge(pkceVerifier);

    microsoftAccounts.createState({ nonce, accountKey, label, kind, tenantId, redirectUri, pkceVerifier });

    const state = encodeState({ nonce, accountKey, returnTo });
    const authUrl = buildAuthUrl({
      tenant: cfg.tenant,
      clientId: cfg.clientId,
      redirectUri,
      scopes: cfg.scopes,
      state,
      pkceChallengeValue,
    });
    return sendJson(res, 200, { ok: true, authUrl, accountKey });
  });

  router.add("POST", "/api/accounts/microsoft/:accountKey/disconnect", (_req, res, _url, params) => {
    const accountKey = normalizeAccountKey(params.accountKey);
    if (!accountKey) return sendJson(res, 400, { ok: false, error: "invalid_account_key" });
    microsoftAccounts.remove(accountKey);
    return sendJson(res, 200, { ok: true });
  });

  const handleCallback = async (req, res, url) => {
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
    const accountKey = normalizeAccountKey(decoded?.accountKey);
    const returnTo = safeReturnTo(decoded?.returnTo);
    if (!nonce || !accountKey) return sendJson(res, 400, { ok: false, error: "invalid_state" });

    const stateRow = microsoftAccounts.consumeState(nonce);
    if (!stateRow) return sendJson(res, 400, { ok: false, error: "invalid_state" });
    if (stateRow.accountKey !== accountKey) return sendJson(res, 400, { ok: false, error: "invalid_state" });

    const cfg = requireMicrosoftConfig();
    const tokens = await exchangeCodeForTokens({
      tenant: cfg.tenant,
      code,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: stateRow.redirectUri,
      pkceVerifier: stateRow.pkceVerifier,
    });

    const accessToken = String(tokens.access_token || "");
    const refreshToken = String(tokens.refresh_token || "");
    if (!accessToken) return sendJson(res, 400, { ok: false, error: "missing_access_token" });

    const me = await fetchMe(accessToken);
    const email = String(me?.mail || me?.userPrincipalName || "").trim() || "(unknown)";
    const displayName = String(me?.displayName || "").trim() || "(unknown)";

    let finalRefresh = refreshToken;
    if (!finalRefresh) {
      const existing = microsoftAccounts.get(accountKey);
      finalRefresh = String(existing?.refreshToken || "");
    }
    if (!finalRefresh) return sendJson(res, 400, { ok: false, error: "missing_refresh_token" });

    microsoftAccounts.upsert({
      accountKey,
      label: stateRow.label,
      kind: stateRow.kind,
      tenantId: stateRow.tenantId,
      email,
      displayName,
      refreshToken: finalRefresh,
      scopes: cfg.scopes,
    });

    const origin = baseUrlFromReq(req).replace(/\/+$/, "");
    const target = new URL(returnTo, origin);
    target.searchParams.set("settings", "accounts");
    target.searchParams.set("microsoft", "connected");
    target.searchParams.set("key", accountKey);
    res.writeHead(302, { location: target.toString() });
    res.end();
  };

  // Preferred callback (matches the API namespace used elsewhere).
  router.add("GET", "/api/accounts/microsoft/callback", handleCallback);

  // Back-compat for older redirect URIs.
  router.add("GET", "/oauth/microsoft/callback", handleCallback);
}

module.exports = { registerMicrosoftAccounts };
