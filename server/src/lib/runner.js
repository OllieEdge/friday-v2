const path = require("node:path");
const { envString } = require("../config/env");
const { ROOT_DIR } = require("../config/paths");
const { buildPrompt, resolveCodexPath, runCodexExec, runCodexLoginStatus } = require("./codex");
const { buildOpenAiSystemText, runOpenAiChat } = require("./openai");
const { execCommand } = require("./tool-exec");
const { runVertexChat } = require("./vertex");
const { loadModelRegistry } = require("./model-registry");

function buildContextText(contextItems) {
  return (contextItems || [])
    .map((i) => `# ${i.filename}\n\n${String(i.content || "").trim()}\n`)
    .join("\n\n---\n\n");
}

function toOpenAiRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "assistant") return "assistant";
  return "user";
}

function latestUserMessageContent(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (String(m?.role || "").toLowerCase() === "user" && String(m?.content || "").trim()) {
      return String(m.content);
    }
  }
  return "";
}

function chooseHybridFallbackRunner(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "codex" || v === "openai" || v === "vertex") return v;
  return "vertex";
}

function safePositiveInt(value, fallback, min = 1, max = 1_000_000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function shouldRouteToLocal({ chat, mode, prefs }) {
  if (mode === "runbook") return false;
  const lastUser = latestUserMessageContent(chat).toLowerCase();
  if (!lastUser) return true;

  const maxChars = safePositiveInt(prefs?.hybrid?.localOnlyMaxChars, 1200, 200, 10000);
  if (lastUser.length > maxChars) return false;

  const remoteSignals = [
    "runbook",
    "triage",
    "gmail",
    "google chat",
    "calendar",
    "slack",
    "whatsapp",
    "imessage",
    "ops",
    "dashboard",
    "deploy",
    "restart",
    "ssh",
    "shell",
    "terminal",
    "tool",
    "command",
    "cron",
    "api",
    "database",
    "sql",
  ];
  if (remoteSignals.some((kw) => lastUser.includes(kw))) return false;
  return true;
}

async function runNoop({ context }) {
  return (
    "Runner not connected yet.\n\n" +
    "Loaded context files:\n" +
    (context?.files || []).map((f) => `- ${f}`).join("\n") +
    "\n\nTo enable the Codex runner:\n- add a Codex account in Settings → Accounts\n- set it as active\n- ensure Codex is logged in"
  );
}

function normalizeSandboxMode(value) {
  const v = String(value || "").trim();
  if (v === "workspace-write" || v === "danger-full-access") return v;
  return "read-only";
}

function normalizeReasoningEffort(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "none" || v === "low" || v === "medium" || v === "high") return v;
  return "";
}

function normalizeLane(value, fallback = "planning") {
  const v = String(value || "")
    .trim()
    .replace(/[-\s]+/g, "")
    .toLowerCase();
  if (v === "triage") return "triage";
  if (v === "planning" || v === "plan") return "planning";
  if (v === "coding" || v === "code") return "coding";
  if (v === "highrisk" || v === "risk") return "highRisk";
  if (v === "ops" || v === "operations") return "ops";
  return fallback;
}

function normalizePersonaId(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "";
}

function latestUserMeta(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (String(m?.role || "").toLowerCase() !== "user") continue;
    if (m?.meta && typeof m.meta === "object") return m.meta;
  }
  return null;
}

function resolveModelSelection({ chat, mode, routingHint }) {
  try {
    const store = loadModelRegistry();
    const meta = latestUserMeta(chat) || {};
    const lane = normalizeLane(routingHint?.lane || meta?.lane || "", mode === "runbook" ? "triage" : "planning");
    const personaId = normalizePersonaId(routingHint?.personaId || meta?.personaId || meta?.persona || "");
    const laneDefaults = store?.routing?.laneDefaults && typeof store.routing.laneDefaults === "object" ? store.routing.laneDefaults : {};
    const personaOverrides = store?.routing?.personaOverrides && typeof store.routing.personaOverrides === "object" ? store.routing.personaOverrides : {};
    const personaLaneMap = personaId && personaOverrides[personaId] && typeof personaOverrides[personaId] === "object" ? personaOverrides[personaId] : null;
    const source = personaLaneMap && personaLaneMap[lane] ? "persona_override" : "lane_default";
    const modelId = String((personaLaneMap && personaLaneMap[lane]) || laneDefaults[lane] || "").trim();
    if (!modelId) return null;
    const model = Array.isArray(store.models) ? store.models.find((m) => String(m?.id || "") === modelId) : null;
    if (!model || !model.enabled) return null;
    return {
      lane,
      personaId: personaId || null,
      source,
      model,
    };
  } catch {
    return null;
  }
}

async function runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode, model }) {
  const profile = getActiveCodexProfile();
  if (!profile) return { runner: "codex", content: "No active Codex account. Go to Settings → Accounts and set one active." };
  const codexPath = resolveCodexPath();
  const status = await runCodexLoginStatus({ codexPath, codexHomePath: profile.codexHomePath });
  if (!status.loggedIn) {
    return { runner: "codex", content: "Active Codex account is not logged in. Go to Settings → Accounts → Login with code." };
  }
  const contextText = buildContextText(context?.items || []);
  const promptText = buildPrompt({ contextText, chatMessages: chat?.messages || [] }, { mode });
  const prefs = (typeof getCodexRunnerPrefs === "function" ? getCodexRunnerPrefs() : null) || {};
  const sandboxMode = normalizeSandboxMode(prefs.sandboxMode);
  const reasoningEffort = normalizeReasoningEffort(prefs.reasoningEffort);

  const configOverrides = ['approval_policy="never"', 'network_access="enabled"'];
  if (reasoningEffort) configOverrides.push(`model_reasoning_effort="${reasoningEffort}"`);

  const result = await runCodexExec({
    codexPath,
    codexHomePath: profile.codexHomePath,
    repoRoot: path.resolve(ROOT_DIR),
    promptText,
    model: String(model || envString("CODEX_MODEL", "")).trim(),
    sandboxMode,
    configOverrides,
    onJsonEvent: typeof onEvent === "function" ? (ev) => onEvent({ type: "codex", event: ev }) : undefined,
  });
  return { runner: "codex", content: result.content, usage: result.usage, profileId: profile.id };
}

async function runOpenAi({ context, chat }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const chatMessages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  const result = await runOpenAiChat({
    messages: [{ role: "system", content: system }, ...chatMessages],
  });
  return { runner: "openai", content: result.content, usage: result.usage };
}

async function runOpenAiWithPrefs({ context, chat, prefs, model }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const chatMessages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  const result = await runOpenAiChat({
    messages: [{ role: "system", content: system }, ...chatMessages],
    model: model || prefs?.openai?.model || "",
    baseUrl: prefs?.openai?.baseUrl || "",
    apiKey: prefs?.openai?.apiKey || "",
  });
  return { runner: "openai", content: result.content, usage: result.usage };
}

async function runLocalOpenAiCompatible({ context, chat, prefs }) {
  const contextText = buildContextText(context?.items || []);
  const maxContextChars = safePositiveInt(prefs?.hybrid?.maxContextChars, 24000, 4000, 120000);
  const boundedContext = contextText.length > maxContextChars ? contextText.slice(0, maxContextChars) : contextText;
  const system = buildOpenAiSystemText({ contextText: boundedContext });
  const chatMessages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  const localBaseUrl = prefs?.hybrid?.baseUrl || envString("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434");
  const localModel = prefs?.hybrid?.model || envString("LOCAL_LLM_MODEL", "qwen2.5:7b-instruct");
  const localApiKey = prefs?.hybrid?.apiKey || envString("LOCAL_LLM_API_KEY", "ollama");

  const result = await runOpenAiChat({
    messages: [{ role: "system", content: system }, ...chatMessages],
    model: localModel,
    baseUrl: localBaseUrl,
    apiKey: localApiKey,
  });
  return { runner: "local", content: result.content, usage: result.usage };
}

async function runVertex({ context, chat, prefs, googleAccounts, mode, model }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const messages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));
  const runbookMaxOutputTokens = Number(envString("RUNBOOK_MAX_OUTPUT_TOKENS", "8192")) || 8192;
  const maxOutputTokens = mode === "runbook" ? Math.max(1024, runbookMaxOutputTokens) : null;

  const toolHandler = async (call) => {
    if (!call || call.name !== "exec_command") {
      return { ok: false, error: "unknown_tool" };
    }
    const args = call.args || {};
    return execCommand({
      command: args.command,
      args: args.args,
      cwd: args.cwd,
      timeoutMs: args.timeoutMs,
      confirm: args.confirm,
    });
  };

  const result = await runVertexChat({
    system,
    messages,
    model: model || prefs?.vertex?.model || "",
    projectId: envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod"),
    location: envString("VERTEX_LOCATION", "europe-west2"),
    authMode: prefs?.vertex?.authMode || "",
    googleAccountKey: prefs?.vertex?.googleAccountKey || "",
    googleAccounts,
    toolHandler,
    maxOutputTokens,
  });
  return { runner: "vertex", content: result.content, usage: result.usage };
}

async function runHybrid({
  context,
  chat,
  prefs,
  googleAccounts,
  getActiveCodexProfile,
  getCodexRunnerPrefs,
  onEvent,
  mode,
}) {
  const fallbackRunner = chooseHybridFallbackRunner(prefs?.hybrid?.fallbackRunner);
  const runLocalFirst = shouldRouteToLocal({ chat, mode, prefs });
  const errors = [];

  if (runLocalFirst) {
    try {
      const local = await runLocalOpenAiCompatible({ context, chat, prefs });
      if (String(local.content || "").trim()) {
        return {
          ...local,
          route: "local-first",
          selectedRunner: "local",
        };
      }
      errors.push("local_empty_response");
    } catch (e) {
      errors.push(`local_failed:${String(e?.message || e)}`);
    }
  }

  const fallbackOrder = [fallbackRunner, "vertex", "openai", "codex"]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter((v) => v !== "local");

  for (const runner of fallbackOrder) {
    try {
      if (runner === "vertex") {
        const vertex = await runVertex({ context, chat, prefs, googleAccounts, mode });
        return { ...vertex, runner: "hybrid", route: "local-first", selectedRunner: "vertex", notes: errors };
      }
      if (runner === "openai") {
        const openai = await runOpenAiWithPrefs({ context, chat, prefs });
        return { ...openai, runner: "hybrid", route: "local-first", selectedRunner: "openai", notes: errors };
      }
      if (runner === "codex") {
        const codex = await runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode });
        return { ...codex, runner: "hybrid", route: "local-first", selectedRunner: "codex", notes: errors };
      }
    } catch (e) {
      errors.push(`${runner}_failed:${String(e?.message || e)}`);
    }
  }

  return {
    runner: "hybrid",
    route: "local-first",
    selectedRunner: "none",
    content: `Hybrid routing failed.\n\n${errors.join("\n")}`,
  };
}

function resolveRunner({ getAssistantRunnerPrefs }) {
  const envRunner = String(envString("FRIDAY_RUNNER", "")).trim().toLowerCase();
  if (envRunner && envRunner !== "settings") return { runner: envRunner, source: "env", prefs: null };
  const prefs = typeof getAssistantRunnerPrefs === "function" ? getAssistantRunnerPrefs() : null;
  const runner = String(prefs?.runner || "").trim().toLowerCase() || "codex";
  return { runner, source: "settings", prefs };
}

async function runAssistant({
  context,
  chat,
  getActiveCodexProfile,
  getCodexRunnerPrefs,
  getAssistantRunnerPrefs,
  googleAccounts,
  onEvent,
  mode,
  routingHint,
}) {
  const selection = resolveModelSelection({ chat, mode, routingHint });
  const selectedModel = selection?.model || null;
  const selectedProvider = String(selectedModel?.provider || "").trim().toLowerCase();

  if (selectedModel && selectedProvider) {
    const prefs = typeof getAssistantRunnerPrefs === "function" ? getAssistantRunnerPrefs() : null;
    if (selectedProvider === "vertex") {
      return {
        ...(await runVertex({ context, chat, prefs, googleAccounts, mode, model: selectedModel.model || "" })),
        selectedModel: { id: selectedModel.id, provider: selectedProvider, lane: selection.lane, personaId: selection.personaId, source: selection.source },
      };
    }
    if (selectedProvider === "codex") {
      return {
        ...(await runCodex({
          context,
          chat,
          getActiveCodexProfile,
          getCodexRunnerPrefs,
          onEvent,
          mode,
          model: selectedModel.model || "",
        })),
        selectedModel: { id: selectedModel.id, provider: selectedProvider, lane: selection.lane, personaId: selection.personaId, source: selection.source },
      };
    }
    if (selectedProvider === "openai" || selectedProvider === "api" || selectedProvider === "metered") {
      return {
        ...(await runOpenAiWithPrefs({ context, chat, prefs, model: selectedModel.model || "" })),
        selectedModel: { id: selectedModel.id, provider: selectedProvider, lane: selection.lane, personaId: selection.personaId, source: selection.source },
      };
    }
    if (selectedProvider === "hybrid") {
      return {
        ...(await runHybrid({
          context,
          chat,
          prefs,
          googleAccounts,
          getActiveCodexProfile,
          getCodexRunnerPrefs,
          onEvent,
          mode,
        })),
        selectedModel: { id: selectedModel.id, provider: selectedProvider, lane: selection.lane, personaId: selection.personaId, source: selection.source },
      };
    }
  }

  const resolved = resolveRunner({ getAssistantRunnerPrefs });
  const runner = resolved.runner;
  if (runner === "codex") return runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode });
  if (runner === "openai" || runner === "api" || runner === "metered") return runOpenAiWithPrefs({ context, chat, prefs: resolved.prefs });
  if (runner === "vertex") return runVertex({ context, chat, prefs: resolved.prefs, googleAccounts, mode });
  if (runner === "hybrid") {
    return runHybrid({
      context,
      chat,
      prefs: resolved.prefs,
      googleAccounts,
      getActiveCodexProfile,
      getCodexRunnerPrefs,
      onEvent,
      mode,
    });
  }
  if (runner === "auto") {
    try {
      return await runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode });
    } catch {
      // fall through
    }
    if (envString("OPENAI_API_KEY", "")) return runOpenAiWithPrefs({ context, chat, prefs: resolved.prefs });
  }
  return { runner: "noop", content: await runNoop({ context }) };
}

module.exports = { runAssistant };
