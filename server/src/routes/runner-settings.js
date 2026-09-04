const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { envString } = require("../config/env");

const RUNNERS = new Set(["noop", "auto", "codex", "openai", "metered", "api", "vertex", "hybrid"]);
const VERTEX_AUTH_MODES = new Set(["aws_secret", "google_oauth"]);
const GOOGLE_ACCOUNT_KEYS = new Set(["work", "personal"]);
const HYBRID_FALLBACK_RUNNERS = new Set(["vertex", "openai", "codex"]);

function safeRunner(value) {
  const v = String(value || "").trim().toLowerCase();
  return RUNNERS.has(v) ? v : "codex";
}

function safeText(value, maxLen = 200) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeVertexAuthMode(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "aws_secret";
  if (v === "oauth" || v === "google") return "google_oauth";
  return VERTEX_AUTH_MODES.has(v) ? v : "aws_secret";
}

function safeGoogleAccountKey(value) {
  const v = String(value || "").trim().toLowerCase();
  return GOOGLE_ACCOUNT_KEYS.has(v) ? v : "work";
}

function safeHybridFallbackRunner(value) {
  const v = String(value || "").trim().toLowerCase();
  return HYBRID_FALLBACK_RUNNERS.has(v) ? v : "vertex";
}

function safeInt(value, fallback, min = 1, max = 1_000_000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isTruthy(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function readAssistantRunnerPrefs({ settings }) {
  const vertexProjectId = envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod");
  const vertexLocation = envString("VERTEX_LOCATION", "europe-west2");
  return {
    runner: safeRunner(settings.get("assistant_runner") || "codex"),
    openai: {
      model: safeText(settings.get("openai_model")),
      baseUrl: safeText(settings.get("openai_base_url")),
    },
    vertex: {
      model: safeText(settings.get("vertex_model") || envString("VERTEX_MODEL", "")),
      projectId: safeText(vertexProjectId),
      location: safeText(vertexLocation),
      authMode: safeVertexAuthMode(settings.get("vertex_auth_mode") || envString("VERTEX_AUTH_MODE", "")),
      googleAccountKey: safeGoogleAccountKey(settings.get("vertex_google_account_key") || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work")),
    },
    hybrid: {
      model: safeText(settings.get("hybrid_model") || envString("LOCAL_LLM_MODEL", "qwen2.5:7b-instruct")),
      baseUrl: safeText(settings.get("hybrid_base_url") || envString("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434"), 400),
      apiKey: safeText(settings.get("hybrid_api_key") || envString("LOCAL_LLM_API_KEY", "ollama"), 300),
      fallbackRunner: safeHybridFallbackRunner(settings.get("hybrid_fallback_runner") || envString("HYBRID_FALLBACK_RUNNER", "vertex")),
      localOnlyMaxChars: safeInt(settings.get("hybrid_local_only_max_chars"), 1200, 200, 10000),
      maxContextChars: safeInt(settings.get("hybrid_max_context_chars"), 24000, 4000, 120000),
    },
  };
}

function resolveEffectiveRunner({ settings }) {
  const envRunner = String(envString("FRIDAY_RUNNER", "")).trim().toLowerCase();
  if (envRunner && envRunner !== "settings") return { runner: envRunner, source: "env" };
  const prefs = readAssistantRunnerPrefs({ settings });
  return { runner: prefs.runner || "codex", source: "settings" };
}

function registerRunnerSettings(router, { settings }) {
  router.add("GET", "/api/settings/runner", async (_req, res) => {
    const prefs = readAssistantRunnerPrefs({ settings });
    const effective = resolveEffectiveRunner({ settings });
    const caps = {
      vertexCodeExecution: isTruthy(envString("VERTEX_CODE_EXECUTION", "")),
      vertexToolExec: isTruthy(envString("VERTEX_TOOL_EXEC", "")),
    };
    return sendJson(res, 200, { ok: true, prefs, effective, env: { FRIDAY_RUNNER: envString("FRIDAY_RUNNER", "") || null }, caps });
  });

  router.add("POST", "/api/settings/runner", async (req, res) => {
    const body = await readJson(req);

    const runner = safeRunner(body?.runner);
    const openaiModel = safeText(body?.openai?.model);
    const openaiBaseUrl = safeText(body?.openai?.baseUrl);
    const vertexModel = safeText(body?.vertex?.model);
    const vertexAuthMode = safeVertexAuthMode(body?.vertex?.authMode);
    const vertexGoogleAccountKey = safeGoogleAccountKey(body?.vertex?.googleAccountKey);
    const hybridModel = safeText(body?.hybrid?.model || envString("LOCAL_LLM_MODEL", "qwen2.5:7b-instruct"));
    const hybridBaseUrl = safeText(body?.hybrid?.baseUrl || envString("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434"), 400);
    const hybridApiKey = safeText(body?.hybrid?.apiKey || envString("LOCAL_LLM_API_KEY", "ollama"), 300);
    const hybridFallbackRunner = safeHybridFallbackRunner(body?.hybrid?.fallbackRunner || envString("HYBRID_FALLBACK_RUNNER", "vertex"));
    const hybridLocalOnlyMaxChars = safeInt(body?.hybrid?.localOnlyMaxChars, 1200, 200, 10000);
    const hybridMaxContextChars = safeInt(body?.hybrid?.maxContextChars, 24000, 4000, 120000);

    settings.set("assistant_runner", runner);
    settings.set("openai_model", openaiModel);
    settings.set("openai_base_url", openaiBaseUrl);
    settings.set("vertex_model", vertexModel);
    settings.set("vertex_auth_mode", vertexAuthMode);
    settings.set("vertex_google_account_key", vertexGoogleAccountKey);
    settings.set("hybrid_model", hybridModel);
    settings.set("hybrid_base_url", hybridBaseUrl);
    settings.set("hybrid_api_key", hybridApiKey);
    settings.set("hybrid_fallback_runner", hybridFallbackRunner);
    settings.set("hybrid_local_only_max_chars", String(hybridLocalOnlyMaxChars));
    settings.set("hybrid_max_context_chars", String(hybridMaxContextChars));
    // Project/location are environment-scoped for this deployment; keep DB keys empty to avoid drift.
    settings.set("vertex_project_id", "");
    settings.set("vertex_location", "");

    const prefs = readAssistantRunnerPrefs({ settings });
    const effective = resolveEffectiveRunner({ settings });
    return sendJson(res, 200, { ok: true, prefs, effective });
  });
}

module.exports = { registerRunnerSettings, readAssistantRunnerPrefs };
