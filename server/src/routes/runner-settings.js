const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { envString } = require("../config/env");

const RUNNERS = new Set(["noop", "auto", "codex", "openai", "metered", "api", "vertex"]);
const VERTEX_AUTH_MODES = new Set(["aws_secret", "google_oauth"]);
const GOOGLE_ACCOUNT_KEYS = new Set(["work", "personal"]);

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
      model: safeText(settings.get("vertex_model")),
      projectId: safeText(vertexProjectId),
      location: safeText(vertexLocation),
      authMode: safeVertexAuthMode(settings.get("vertex_auth_mode") || envString("VERTEX_AUTH_MODE", "")),
      googleAccountKey: safeGoogleAccountKey(settings.get("vertex_google_account_key") || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work")),
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
    return sendJson(res, 200, { ok: true, prefs, effective, env: { FRIDAY_RUNNER: envString("FRIDAY_RUNNER", "") || null } });
  });

  router.add("POST", "/api/settings/runner", async (req, res) => {
    const body = await readJson(req);

    const runner = safeRunner(body?.runner);
    const openaiModel = safeText(body?.openai?.model);
    const openaiBaseUrl = safeText(body?.openai?.baseUrl);
    const vertexModel = safeText(body?.vertex?.model);
    const vertexAuthMode = safeVertexAuthMode(body?.vertex?.authMode);
    const vertexGoogleAccountKey = safeGoogleAccountKey(body?.vertex?.googleAccountKey);

    settings.set("assistant_runner", runner);
    settings.set("openai_model", openaiModel);
    settings.set("openai_base_url", openaiBaseUrl);
    settings.set("vertex_model", vertexModel);
    settings.set("vertex_auth_mode", vertexAuthMode);
    settings.set("vertex_google_account_key", vertexGoogleAccountKey);
    // Project/location are environment-scoped for this deployment; keep DB keys empty to avoid drift.
    settings.set("vertex_project_id", "");
    settings.set("vertex_location", "");

    const prefs = readAssistantRunnerPrefs({ settings });
    const effective = resolveEffectiveRunner({ settings });
    return sendJson(res, 200, { ok: true, prefs, effective });
  });
}

module.exports = { registerRunnerSettings, readAssistantRunnerPrefs };
