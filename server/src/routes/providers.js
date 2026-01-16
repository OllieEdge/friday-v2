const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function validateServiceAccountJson(text) {
  const raw = normalizeText(text);
  if (!raw) return { ok: false, error: "service_account_json_required" };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "service_account_json_invalid" };
  }
  const clientEmail = normalizeText(parsed?.client_email);
  const privateKey = normalizeText(parsed?.private_key);
  if (!clientEmail || !privateKey) return { ok: false, error: "service_account_json_missing_fields" };
  return { ok: true };
}

function registerProviders(router, { settings }) {
  router.add("GET", "/api/providers", (_req, res) => {
    const openaiKey = normalizeText(settings.get("openai_api_key"));
    const vertexJson = normalizeText(settings.get("vertex_service_account_json"));
    return sendJson(res, 200, {
      ok: true,
      providers: {
        openai: { connected: Boolean(openaiKey) },
        vertex: { connected: Boolean(vertexJson) },
      },
    });
  });

  router.add("POST", "/api/providers/openai", async (req, res) => {
    const body = (await readJson(req)) || {};
    const apiKey = normalizeText(body?.apiKey);
    if (!apiKey) return sendJson(res, 400, { ok: false, error: "api_key_required" });
    settings.set("openai_api_key", apiKey);
    return sendJson(res, 200, { ok: true });
  });

  router.add("DELETE", "/api/providers/openai", (_req, res) => {
    settings.set("openai_api_key", "");
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/providers/vertex/service-account", async (req, res) => {
    const body = (await readJson(req)) || {};
    const jsonText = normalizeText(body?.json);
    const validation = validateServiceAccountJson(jsonText);
    if (!validation.ok) return sendJson(res, 400, { ok: false, error: validation.error });
    settings.set("vertex_service_account_json", jsonText);
    return sendJson(res, 200, { ok: true });
  });

  router.add("DELETE", "/api/providers/vertex/service-account", (_req, res) => {
    settings.set("vertex_service_account_json", "");
    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerProviders };
