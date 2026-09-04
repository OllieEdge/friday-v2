const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { PERSONAS_JSON, loadPersonasStore, upsertPersona, deletePersona, getPersonaById, defaultTemplate, savePersonasStore } = require("../lib/personas");

function registerPersonas(router) {
  router.add("GET", "/api/personas", (_req, res) => {
    const store = loadPersonasStore();
    return sendJson(res, 200, {
      ok: true,
      updatedAt: store.updatedAt,
      template: store.template,
      personas: store.personas,
      file: PERSONAS_JSON,
    });
  });

  router.add("GET", "/api/personas/:personaId", (_req, res, _url, params) => {
    const { persona } = getPersonaById(String(params.personaId || ""));
    if (!persona) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, persona });
  });

  router.add("POST", "/api/personas", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }
    const persona = body?.persona || body;
    if (!persona || typeof persona !== "object") return sendJson(res, 400, { ok: false, error: "missing_persona" });

    const out = upsertPersona(persona);
    return sendJson(res, 200, {
      ok: true,
      persona: out.persona,
      personas: out.store.personas,
      updatedAt: out.store.updatedAt,
      file: PERSONAS_JSON,
    });
  });

  router.add("DELETE", "/api/personas/:personaId", (_req, res, _url, params) => {
    const out = deletePersona(String(params.personaId || ""));
    if (!out.ok) return sendJson(res, 404, { ok: false, error: out.error || "not_found" });
    return sendJson(res, 200, { ok: true, personas: out.store.personas, updatedAt: out.store.updatedAt, file: PERSONAS_JSON });
  });

  router.add("POST", "/api/personas/template/reset", (_req, res) => {
    const store = loadPersonasStore();
    store.template = defaultTemplate();
    const saved = savePersonasStore(store);
    return sendJson(res, 200, { ok: true, template: saved.template, updatedAt: saved.updatedAt, file: PERSONAS_JSON });
  });
}

module.exports = { registerPersonas };
