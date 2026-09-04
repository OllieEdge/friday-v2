const fs = require("node:fs");
const path = require("node:path");

const { ROOT_DIR, CONTEXT_DIR } = require("../config/paths");

const PERSONAS_JSON = path.join(ROOT_DIR, "data", "ops", "personas.json");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath, fallback = "") {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
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

function toSlug(value, fallback = "persona") {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || fallback;
}

function toList(value, limit = 24) {
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, limit);
  }
  return [];
}

function briefSourceSnippet() {
  const agentsText = readText(path.join(ROOT_DIR, "AGENTS.md"), "");
  const behaviorText = readText(path.join(CONTEXT_DIR, "10_BEHAVIOUR.md"), "");
  const assistantText = readText(path.join(CONTEXT_DIR, "12_ASSISTANT_BEHAVIOR.md"), "");
  return [agentsText, behaviorText, assistantText]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function defaultTemplate() {
  return {
    version: 1,
    title: "Friday Persona Template",
    description: "Define traits, responsibilities, tone, and tool boundaries for each agent persona.",
    fields: [
      { key: "id", type: "slug", required: true, description: "Stable ID used by flow/API (e.g. friday-core)." },
      { key: "label", type: "string", required: true, description: "Human readable name." },
      { key: "description", type: "string", required: false, description: "Short intent statement." },
      { key: "traits", type: "string[]", required: false, description: "Behavior traits." },
      { key: "responsibilities", type: "string[]", required: false, description: "Primary responsibilities." },
      { key: "tone", type: "object", required: false, description: "Tone controls (voice, formality, verbosity)." },
      { key: "boundaries", type: "string[]", required: false, description: "Safety and refusal rules." },
      { key: "toolPolicy", type: "object", required: false, description: "Allowlist/denylist of tools/capabilities." },
      { key: "channels", type: "string[]", required: false, description: "Preferred channels and contexts." },
      { key: "promptAddendum", type: "string", required: false, description: "Extra system guidance injected at runtime." },
    ],
    example: {
      id: "friday-core",
      label: "Friday Core",
      description: "Primary orchestrator persona for life/work automation.",
      traits: ["calm", "direct", "context-first", "risk-aware"],
      responsibilities: ["triage communications", "propose next actions", "prepare drafts"],
      tone: { voice: "professional", formality: "medium", verbosity: "concise" },
      boundaries: ["do not send without confirmation", "default English in outbound messages"],
      toolPolicy: { mode: "allowlist", allow: ["gmail", "calendar", "runbooks", "ops"] },
      channels: ["dashboard", "imessage", "whatsapp", "slack"],
      promptAddendum: "Prioritise high-confidence recommendations and explicit approval gates for side effects.",
    },
  };
}

function normalizePersona(raw) {
  const id = toSlug(raw?.id || raw?.label || "persona");
  const label = String(raw?.label || id).trim() || id;
  const description = String(raw?.description || "").trim();
  const traits = toList(raw?.traits, 24);
  const responsibilities = toList(raw?.responsibilities, 32);
  const boundaries = toList(raw?.boundaries, 32);
  const channels = toList(raw?.channels, 16);
  const toneObj = raw?.tone && typeof raw.tone === "object" ? raw.tone : {};
  const toolObj = raw?.toolPolicy && typeof raw.toolPolicy === "object" ? raw.toolPolicy : {};
  const promptAddendum = String(raw?.promptAddendum || "").trim();
  const source = raw?.source && typeof raw.source === "object" ? raw.source : {};

  return {
    id,
    label,
    description,
    traits,
    responsibilities,
    tone: {
      voice: String(toneObj.voice || "").trim(),
      formality: String(toneObj.formality || "").trim(),
      verbosity: String(toneObj.verbosity || "").trim(),
    },
    boundaries,
    toolPolicy: {
      mode: String(toolObj.mode || "allowlist").trim() || "allowlist",
      allow: toList(toolObj.allow, 64),
      deny: toList(toolObj.deny, 64),
    },
    channels,
    promptAddendum,
    source,
    updatedAt: String(raw?.updatedAt || nowIso()),
  };
}

function defaultFridayPersona() {
  return normalizePersona({
    id: "friday-core",
    label: "Friday Core",
    description: "Baseline Friday persona derived from AGENTS/context files.",
    traits: ["pragmatic", "clear", "rigorous", "context-first"],
    responsibilities: ["triage inbound signals", "draft responses", "manage runbooks", "coordinate next actions"],
    tone: { voice: "professional", formality: "medium", verbosity: "concise" },
    boundaries: [
      "Never auto-send without explicit confirmation.",
      "Use English for outbound channel replies.",
      "Avoid hidden side effects in discovery flows.",
    ],
    toolPolicy: {
      mode: "allowlist",
      allow: ["gmail", "google", "runbooks", "ops", "triage", "actions", "calendar", "slack", "imessage", "whatsapp"],
      deny: [],
    },
    channels: ["dashboard", "imessage", "whatsapp", "slack"],
    promptAddendum:
      "When confidence is low, ask for confirmation or place an action in approval queue. Keep responses short and actionable.",
    source: {
      references: ["AGENTS.md", "ai-context/10_BEHAVIOUR.md", "ai-context/12_ASSISTANT_BEHAVIOR.md"],
      snippet: briefSourceSnippet(),
    },
  });
}

function normalizeStore(raw) {
  const template = raw?.template && typeof raw.template === "object" ? raw.template : defaultTemplate();
  const personas = Array.isArray(raw?.personas) ? raw.personas.map(normalizePersona).filter(Boolean) : [defaultFridayPersona()];
  const deduped = [];
  const seen = new Set();
  for (const p of personas) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    deduped.push(p);
  }
  if (!deduped.length) deduped.push(defaultFridayPersona());

  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || nowIso()),
    template,
    personas: deduped,
  };
}

function loadPersonasStore() {
  const parsed = readJson(PERSONAS_JSON, null);
  if (!parsed || typeof parsed !== "object") {
    const seeded = normalizeStore({});
    writeJson(PERSONAS_JSON, seeded);
    return seeded;
  }
  const normalized = normalizeStore(parsed);
  return normalized;
}

function savePersonasStore(store) {
  const normalized = normalizeStore(store);
  normalized.updatedAt = nowIso();
  writeJson(PERSONAS_JSON, normalized);
  return normalized;
}

function upsertPersona(rawPersona) {
  const store = loadPersonasStore();
  const next = normalizePersona(rawPersona || {});
  const idx = store.personas.findIndex((p) => p.id === next.id);
  if (idx >= 0) store.personas[idx] = { ...store.personas[idx], ...next, updatedAt: nowIso() };
  else store.personas.push({ ...next, updatedAt: nowIso() });
  const saved = savePersonasStore(store);
  const persona = saved.personas.find((p) => p.id === next.id) || null;
  return { store: saved, persona };
}

function deletePersona(id) {
  const personaId = toSlug(id || "", "");
  if (!personaId) return { ok: false, error: "missing_persona_id", store: loadPersonasStore() };
  const store = loadPersonasStore();
  const before = store.personas.length;
  store.personas = store.personas.filter((p) => p.id !== personaId);
  if (!store.personas.length) store.personas = [defaultFridayPersona()];
  const saved = savePersonasStore(store);
  return { ok: saved.personas.length < before, store: saved };
}

function getPersonaById(id) {
  const personaId = toSlug(id || "", "");
  const store = loadPersonasStore();
  const persona = store.personas.find((p) => p.id === personaId) || null;
  return { persona, store };
}

module.exports = {
  PERSONAS_JSON,
  defaultTemplate,
  defaultFridayPersona,
  loadPersonasStore,
  savePersonasStore,
  upsertPersona,
  deletePersona,
  getPersonaById,
};
