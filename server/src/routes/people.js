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

async function fetchChatSpaces({ spaceIds, googleAccounts, accountKey = "work" }) {
  const accessToken = await getAccessToken({ googleAccounts, accountKey });
  const out = [];
  for (const spaceId of spaceIds) {
    const url = `https://chat.googleapis.com/v1/${spaceId}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const txt = await res.text();
    let json = null;
    try {
      json = JSON.parse(txt);
    } catch {
      json = null;
    }
    if (!res.ok) {
      out.push({ spaceId, error: json?.error?.message || txt || `HTTP ${res.status}` });
      continue;
    }
    out.push({
      spaceId,
      displayName: json?.displayName || "",
      spaceType: json?.spaceType || "",
      type: json?.type || "",
    });
  }
  return out;
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

  router.add("POST", "/api/people/bootstrap-me", async (req, res) => {
    const body = (await readJson(req)) || {};
    const displayName = body?.displayName == null ? null : String(body.displayName).trim();
    const accounts = googleAccounts?.list ? googleAccounts.list() : [];
    const emails = accounts.map((a) => String(a.email || "").trim()).filter(Boolean);
    if (emails.length === 0) return sendJson(res, 400, { ok: false, error: "no_accounts" });

    const existingMe = people.listPeople().find((p) => p.isMe);
    let personId = existingMe?.id || null;
    const baseName = displayName || (emails[0].split("@")[0] || "Me");

    if (!personId) {
      const created = people.upsertIdentity({
        personId: null,
        displayName: baseName,
        provider: "email",
        providerUserId: emails[0],
        label: "work",
      });
      personId = created?.id || null;
    } else {
      people.updatePerson({ personId, displayName: baseName });
    }

    if (!personId) return sendJson(res, 500, { ok: false, error: "create_failed" });

    for (const email of emails) {
      people.upsertIdentity({
        personId,
        displayName: baseName,
        provider: "email",
        providerUserId: email,
        label: "work",
      });
    }
    const person = people.updatePerson({ personId, isMe: true, displayName: baseName });
    return sendJson(res, 200, { ok: true, person });
  });

  router.add("PATCH", "/api/people/:personId", async (req, res, _url, params) => {
    const body = (await readJson(req)) || {};
    const personId = String(params.personId || "").trim();
    if (!personId) return sendJson(res, 400, { ok: false, error: "missing_person" });
    const displayName = body?.displayName == null ? null : String(body.displayName);
    const notes = body?.notes == null ? null : String(body.notes);
    const isMe = body?.isMe == null ? null : Boolean(body.isMe);
    const person = people.updatePerson({ personId, displayName, notes, isMe });
    if (!person) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, person });
  });

  router.add("DELETE", "/api/people/:personId", async (_req, res, _url, params) => {
    const personId = String(params.personId || "").trim();
    if (!personId) return sendJson(res, 400, { ok: false, error: "missing_person" });
    const ok = people.deletePerson({ personId });
    return sendJson(res, 200, { ok });
  });

  router.add("DELETE", "/api/people/identities/:identityId", async (_req, res, _url, params) => {
    const identityId = String(params.identityId || "").trim();
    if (!identityId) return sendJson(res, 400, { ok: false, error: "missing_identity" });
    const ok = people.deleteIdentity({ identityId });
    return sendJson(res, 200, { ok });
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

  router.add("POST", "/api/people/gchat/spaces", async (req, res) => {
    if (!googleAccounts) return sendJson(res, 400, { ok: false, error: "google_unavailable" });
    const body = (await readJson(req)) || {};
    const accountKey = String(body?.accountKey || "work").trim() || "work";
    const spaceIds = Array.isArray(body?.spaceIds) ? body.spaceIds.map((s) => String(s || "").trim()).filter(Boolean) : [];
    if (spaceIds.length === 0) return sendJson(res, 400, { ok: false, error: "missing_space_ids" });
    try {
      const spaces = await fetchChatSpaces({ spaceIds, googleAccounts, accountKey });
      return sendJson(res, 200, { ok: true, spaces });
    } catch (e) {
      return sendJson(res, e.statusCode || 500, { ok: false, error: "spaces_lookup_failed", message: String(e?.message || e) });
    }
  });
}

module.exports = { registerPeople };
