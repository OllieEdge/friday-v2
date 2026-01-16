const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");

function registerPeople(router, { people }) {
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
}

module.exports = { registerPeople };
