const fs = require("node:fs");
const path = require("node:path");

const { ROOT_DIR } = require("../config/paths");

const MODEL_REGISTRY_JSON = path.join(ROOT_DIR, "data", "ops", "model-registry.json");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toSlug(value, fallback = "model") {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const v = String(value || "").trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function toText(value, maxLen = 240) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function cleanTier(value, fallback = "medium") {
  const v = String(value || "").trim().toLowerCase();
  if (v === "low" || v === "high") return v;
  return fallback;
}

function normalizeCert(raw) {
  const checks = Array.isArray(raw?.checks)
    ? raw.checks
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: toText(x.id, 80),
          ok: toBool(x.ok, false),
          detail: toText(x.detail, 600),
        }))
        .filter((x) => x.id)
    : [];
  const status = String(raw?.status || "").trim().toLowerCase();
  return {
    status: status === "ok" || status === "failed" ? status : "unknown",
    lastRunAt: raw?.lastRunAt ? String(raw.lastRunAt) : null,
    lastOk: toBool(raw?.lastOk, false),
    checks,
  };
}

function normalizeLaneMapping(value) {
  const out = {};
  const src = value && typeof value === "object" ? value : {};
  const allowed = ["triage", "planning", "coding", "highRisk", "ops"];
  for (const key of allowed) {
    const id = toSlug(src[key] || "", "");
    if (id) out[key] = id;
  }
  return out;
}

function normalizePersonaOverrides(value) {
  const out = {};
  const src = value && typeof value === "object" ? value : {};
  for (const [personaId, mapping] of Object.entries(src)) {
    const pid = toSlug(personaId, "");
    if (!pid) continue;
    const next = normalizeLaneMapping(mapping);
    if (Object.keys(next).length) out[pid] = next;
  }
  return out;
}

function normalizeModel(raw) {
  const provider = String(raw?.provider || "").trim().toLowerCase();
  const safeProvider = provider || "vertex";
  const model = toText(raw?.model, 160);
  const id = toSlug(raw?.id || `${safeProvider}-${model || "model"}`);
  const cap = raw?.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {};
  return {
    id,
    label: toText(raw?.label || model || id, 120) || id,
    provider: safeProvider,
    model,
    enabled: toBool(raw?.enabled, true),
    capabilities: {
      planning: toBool(cap.planning, true),
      coding: toBool(cap.coding, false),
      toolCalling: toBool(cap.toolCalling, false),
      longContext: toBool(cap.longContext, false),
      maxContextTokens: Math.max(1024, Math.min(1_000_000, Number(cap.maxContextTokens) || 32768)),
    },
    costTier: cleanTier(raw?.costTier, "medium"),
    latencyTier: cleanTier(raw?.latencyTier, "medium"),
    notes: toText(raw?.notes, 2000),
    certification: normalizeCert(raw?.certification),
    updatedAt: String(raw?.updatedAt || nowIso()),
  };
}

function defaultTemplate() {
  return {
    version: 1,
    title: "Model Registry Template",
    description: "Declare model capabilities and certify tool execution before assigning to personas.",
    laneKeys: ["triage", "planning", "coding", "highRisk", "ops"],
  };
}

function defaultModels() {
  return [
    normalizeModel({
      id: "vertex-gemini-2-5-flash",
      label: "Vertex Gemini 2.5 Flash",
      provider: "vertex",
      model: "gemini-2.5-flash",
      capabilities: { planning: true, coding: false, toolCalling: true, longContext: true, maxContextTokens: 131072 },
      costTier: "low",
      latencyTier: "low",
      notes: "Primary low-cost planner/triage model.",
    }),
    normalizeModel({
      id: "vertex-gemini-2-5-pro",
      label: "Vertex Gemini 2.5 Pro",
      provider: "vertex",
      model: "gemini-2.5-pro",
      capabilities: { planning: true, coding: true, toolCalling: true, longContext: true, maxContextTokens: 131072 },
      costTier: "high",
      latencyTier: "medium",
      notes: "High-reasoning fallback for complex/high-risk decisions.",
    }),
    normalizeModel({
      id: "codex-default",
      label: "Codex CLI",
      provider: "codex",
      model: "",
      capabilities: { planning: true, coding: true, toolCalling: true, longContext: true, maxContextTokens: 200000 },
      costTier: "medium",
      latencyTier: "medium",
      notes: "Code-building runner with host execution ability.",
    }),
  ];
}

function defaultStore() {
  return {
    version: 1,
    updatedAt: nowIso(),
    template: defaultTemplate(),
    models: defaultModels(),
    routing: {
      laneDefaults: {
        triage: "vertex-gemini-2-5-flash",
        planning: "vertex-gemini-2-5-flash",
        coding: "codex-default",
        highRisk: "vertex-gemini-2-5-pro",
        ops: "vertex-gemini-2-5-flash",
      },
      personaOverrides: {},
    },
  };
}

function normalizeStore(raw) {
  const template = raw?.template && typeof raw.template === "object" ? raw.template : defaultTemplate();
  const list = Array.isArray(raw?.models) ? raw.models : defaultModels();
  const deduped = [];
  const seen = new Set();
  for (const entry of list) {
    const next = normalizeModel(entry);
    if (!next.id || seen.has(next.id)) continue;
    seen.add(next.id);
    deduped.push(next);
  }
  if (!deduped.length) deduped.push(...defaultModels());

  const routing = raw?.routing && typeof raw.routing === "object" ? raw.routing : {};
  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || nowIso()),
    template,
    models: deduped,
    routing: {
      laneDefaults: normalizeLaneMapping(routing.laneDefaults || {}),
      personaOverrides: normalizePersonaOverrides(routing.personaOverrides || {}),
    },
  };
}

function loadModelRegistry() {
  const parsed = readJson(MODEL_REGISTRY_JSON, null);
  if (!parsed || typeof parsed !== "object") {
    const seeded = normalizeStore(defaultStore());
    writeJson(MODEL_REGISTRY_JSON, seeded);
    return seeded;
  }
  return normalizeStore(parsed);
}

function saveModelRegistry(store) {
  const normalized = normalizeStore(store);
  normalized.updatedAt = nowIso();
  writeJson(MODEL_REGISTRY_JSON, normalized);
  return normalized;
}

function upsertModel(rawModel) {
  const store = loadModelRegistry();
  const model = normalizeModel(rawModel || {});
  const idx = store.models.findIndex((m) => m.id === model.id);
  if (idx >= 0) store.models[idx] = { ...store.models[idx], ...model, updatedAt: nowIso() };
  else store.models.push({ ...model, updatedAt: nowIso() });
  const saved = saveModelRegistry(store);
  const current = saved.models.find((m) => m.id === model.id) || null;
  return { store: saved, model: current };
}

function deleteModel(modelId) {
  const id = toSlug(modelId || "", "");
  if (!id) return { ok: false, error: "missing_model_id", store: loadModelRegistry() };
  const store = loadModelRegistry();
  const before = store.models.length;
  store.models = store.models.filter((m) => m.id !== id);
  if (!store.models.length) store.models = defaultModels();
  const saved = saveModelRegistry(store);
  return { ok: saved.models.length < before, store: saved };
}

function updateRouting(rawRouting) {
  const store = loadModelRegistry();
  const routing = rawRouting && typeof rawRouting === "object" ? rawRouting : {};
  store.routing = {
    laneDefaults: normalizeLaneMapping(routing.laneDefaults || store.routing?.laneDefaults || {}),
    personaOverrides: normalizePersonaOverrides(routing.personaOverrides || store.routing?.personaOverrides || {}),
  };
  const saved = saveModelRegistry(store);
  return { store: saved, routing: saved.routing };
}

function getModelById(modelId) {
  const id = toSlug(modelId || "", "");
  const store = loadModelRegistry();
  const model = store.models.find((m) => m.id === id) || null;
  return { store, model };
}

module.exports = {
  MODEL_REGISTRY_JSON,
  defaultTemplate,
  defaultStore,
  loadModelRegistry,
  saveModelRegistry,
  upsertModel,
  deleteModel,
  updateRouting,
  getModelById,
};
