const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { requireGoogleConfig, exchangeRefreshTokenForAccessToken } = require("../lib/google");

async function fetchChatSender({ messageName, googleAccounts, accountKey = "work" }) {
  const acct = googleAccounts.get(accountKey);
  if (!acct?.refreshToken) {
    const err = new Error(`Google account not connected: ${accountKey}`);
    err.statusCode = 400;
    throw err;
  }
  const { clientId, clientSecret } = requireGoogleConfig({ accountKey });
  const tok = await exchangeRefreshTokenForAccessToken({
    refreshToken: acct.refreshToken,
    clientId,
    clientSecret,
  });
  const accessToken = String(tok.access_token || "");
  if (!accessToken) {
    const err = new Error("Failed to obtain access token.");
    err.statusCode = 400;
    throw err;
  }
  const url = `https://chat.googleapis.com/v1/${messageName}?readMask=sender`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || txt || `HTTP ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  const sender = json?.sender || {};
  return {
    senderUserId: sender?.name || null,
    senderDisplayName: sender?.displayName || null,
  };
}

function registerPeople(router, { people, googleAccounts }) {
  router.add("POST", "/api/people/aliases/resolve", async (req, res) => {
    const body = (await readJson(req)) || {};
    const provider = String(body?.provider || "").trim();
    const spaceIds = Array.isArray(body?.spaceIds) ? body.spaceIds : [];
    if (!provider) return sendJson(res, 400, { ok: false, error: "missing_provider" });
    const aliases = people.listSpaceAliases({ provider, spaceIds });
    return sendJson(res, 200, { ok: true, aliases });
  });

  router.add("POST", "/api/people/aliases", async (req, res) => {
    const body = (await readJson(req)) || {};
    const provider = String(body?.provider || "").trim();
    const spaceId = String(body?.spaceId || "").trim();
    const displayName = String(body?.displayName || "").trim();
    const providerUserId = body?.providerUserId == null ? null : String(body.providerUserId).trim();
    const identityLabel = body?.identityLabel == null ? null : String(body.identityLabel).trim();

    if (!provider || !spaceId || !displayName) {
      return sendJson(res, 400, { ok: false, error: "missing_fields" });
    }

    const alias = people.upsertSpaceAlias({ provider, spaceId, displayName, providerUserId, identityLabel });
    if (!alias) return sendJson(res, 400, { ok: false, error: "invalid_alias" });
    return sendJson(res, 200, { ok: true, alias });
  });

  router.add("POST", "/api/people/gchat/sender", async (req, res) => {
    if (!googleAccounts) return sendJson(res, 400, { ok: false, error: "google_unavailable" });
    const body = (await readJson(req)) || {};
    const message = String(body?.message || "").trim();
    const accountKey = String(body?.accountKey || "work").trim() || "work";
    if (!message) return sendJson(res, 400, { ok: false, error: "missing_message" });
    try {
      const sender = await fetchChatSender({ messageName: message, googleAccounts, accountKey });
      return sendJson(res, 200, { ok: true, sender });
    } catch (e) {
      return sendJson(res, e.statusCode || 500, { ok: false, error: "sender_lookup_failed", message: String(e?.message || e) });
    }
  });
}

module.exports = { registerPeople };
