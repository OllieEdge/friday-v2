const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { requireGoogleConfig, exchangeRefreshTokenForAccessToken } = require("../lib/google");

async function getAccessToken({ googleAccounts, accountKey = "work" }) {
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
  return accessToken;
}

async function fetchChatSender({ messageName, googleAccounts, accountKey = "work" }) {
  const accessToken = await getAccessToken({ googleAccounts, accountKey });
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

async function fetchChatThread({ spaceId, googleAccounts, accountKey = "work", months = 3 }) {
  const accessToken = await getAccessToken({ googleAccounts, accountKey });
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - Number(months || 3));
  const cutoffMs = cutoff.getTime();
  const messages = [];
  let pageToken = null;
  let keepGoing = true;

  while (keepGoing) {
    const qs = new URLSearchParams({
      pageSize: "100",
      orderBy: "createTime desc",
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://chat.googleapis.com/v1/${spaceId}/messages?${qs.toString()}`;
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
    const batch = Array.isArray(json?.messages) ? json.messages : [];
    for (const msg of batch) {
      const t = Date.parse(msg?.createTime || "");
      if (!t || t < cutoffMs) {
        keepGoing = false;
        break;
      }
      messages.push(msg);
    }
    pageToken = json?.nextPageToken || null;
    if (!pageToken) break;
  }

  messages.reverse();
  return messages.map((msg) => ({
    name: msg?.name || null,
    createTime: msg?.createTime || null,
    text: msg?.text || "",
    sender: {
      name: msg?.sender?.name || null,
      displayName: msg?.sender?.displayName || null,
    },
    thread: msg?.thread?.name || null,
  }));
}

function registerPeople(router, { people, googleAccounts }) {
  router.add("GET", "/api/people", async (_req, res) => {
    const list = people.listPeople();
    return sendJson(res, 200, { ok: true, people: list });
  });

  router.add("POST", "/api/people/identify", async (req, res) => {
    const body = (await readJson(req)) || {};
    const personId = body?.personId == null ? null : String(body.personId).trim();
    const displayName = String(body?.displayName || "").trim();
    const provider = String(body?.provider || "").trim();
    const providerUserId = String(body?.providerUserId || "").trim();
    const label = body?.label == null ? null : String(body.label).trim();
    if (!displayName || !provider || !providerUserId) {
      return sendJson(res, 400, { ok: false, error: "missing_fields" });
    }
    const person = people.upsertIdentity({ personId, displayName, provider, providerUserId, label });
    if (!person) return sendJson(res, 400, { ok: false, error: "invalid_identity" });
    return sendJson(res, 200, { ok: true, person });
  });

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

  router.add("POST", "/api/people/gchat/thread", async (req, res) => {
    if (!googleAccounts) return sendJson(res, 400, { ok: false, error: "google_unavailable" });
    const body = (await readJson(req)) || {};
    const space = String(body?.space || "").trim();
    const accountKey = String(body?.accountKey || "work").trim() || "work";
    const months = Number(body?.months || 3);
    if (!space) return sendJson(res, 400, { ok: false, error: "missing_space" });
    try {
      const messages = await fetchChatThread({ spaceId: space, googleAccounts, accountKey, months });
      return sendJson(res, 200, { ok: true, messages });
    } catch (e) {
      return sendJson(res, e.statusCode || 500, { ok: false, error: "thread_lookup_failed", message: String(e?.message || e) });
    }
  });
}

module.exports = { registerPeople };
