const { sendJson } = require("../http/respond");
const { envString } = require("../config/env");
const { vertexProbeModelIds } = require("../lib/vertex");
const { readAssistantRunnerPrefs } = require("./runner-settings");

const DEFAULT_VERTEX_PROJECT_ID = "tmg-product-innovation-prod";
const DEFAULT_VERTEX_LOCATION = "europe-west2";

const VERTEX_MODEL_CANDIDATES = [
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "gemini-1.5-flash",
  "gemini-1.5-flash-001",
  "gemini-1.5-flash-002",
  "gemini-1.5-pro",
  "gemini-1.5-pro-001",
  "gemini-1.0-pro",
];

let cachedVertexModels = null; // { fetchedAtMs, ttlMs, data }
const vertexModelsInFlightByKey = new Map(); // key => Promise

function modelsCacheKey({ projectId, location, authMode, googleAccountKey }) {
  const mode = String(authMode || "").trim().toLowerCase() || "aws_secret";
  const acct = mode === "google_oauth" ? String(googleAccountKey || "").trim().toLowerCase() || "work" : "";
  return `${String(projectId || "")}|${String(location || "")}|${mode}|${acct}`;
}

async function getVertexModels({ projectId, location, authMode, googleAccounts, googleAccountKey }) {
  const now = Date.now();
  const ttlMs = 10 * 60 * 1000;
  const key = modelsCacheKey({ projectId, location, authMode, googleAccountKey });
  if (cachedVertexModels && cachedVertexModels.key === key && now - cachedVertexModels.fetchedAtMs < ttlMs) return cachedVertexModels.data;

  const existing = vertexModelsInFlightByKey.get(key);
  if (existing) return existing;

  const inFlight = (async () => {
    const probed = await vertexProbeModelIds({
      projectId,
      location,
      modelIds: VERTEX_MODEL_CANDIDATES,
      authMode,
      googleAccountKey,
      googleAccounts: authMode === "google_oauth" ? googleAccounts : undefined,
    });
    const data = {
      projectId: probed.projectId,
      location: probed.location,
      candidates: VERTEX_MODEL_CANDIDATES,
      results: probed.results,
      available: probed.results.filter((r) => r.ok).map((r) => r.id),
    };
    cachedVertexModels = { key, fetchedAtMs: Date.now(), ttlMs, data };
    return data;
  })();

  try {
    vertexModelsInFlightByKey.set(key, inFlight);
    return await inFlight;
  } finally {
    vertexModelsInFlightByKey.delete(key);
  }
}

function registerModelsWithDeps(router, { settings, googleAccounts } = {}) {
  router.add("GET", "/api/models/vertex", async (_req, res) => {
    const prefs = settings ? readAssistantRunnerPrefs({ settings }) : null;
    const projectId = envString("VERTEX_PROJECT_ID", prefs?.vertex?.projectId || DEFAULT_VERTEX_PROJECT_ID);
    const location = envString("VERTEX_LOCATION", prefs?.vertex?.location || DEFAULT_VERTEX_LOCATION);
    const authMode = prefs?.vertex?.authMode || envString("VERTEX_AUTH_MODE", "") || "aws_secret";
    const googleAccountKey = prefs?.vertex?.googleAccountKey || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work") || "work";

    try {
      const data = await getVertexModels({ projectId, location, authMode, googleAccounts, googleAccountKey });
      return sendJson(res, 200, { ok: true, ...data });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: String(e?.message || e) });
    }
  });
}

module.exports = { registerModels: registerModelsWithDeps };
