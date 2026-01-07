const path = require("node:path");
const { envString } = require("../config/env");
const { ROOT_DIR } = require("../config/paths");
const { buildPrompt, resolveCodexPath, runCodexExec, runCodexLoginStatus } = require("./codex");
const { buildOpenAiSystemText, runOpenAiChat } = require("./openai");
const { runVertexChat } = require("./vertex");

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

async function runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode }) {
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
    model: envString("CODEX_MODEL", ""),
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

async function runOpenAiWithPrefs({ context, chat, prefs }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const chatMessages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  const result = await runOpenAiChat({
    messages: [{ role: "system", content: system }, ...chatMessages],
    model: prefs?.openai?.model || "",
    baseUrl: prefs?.openai?.baseUrl || "",
  });
  return { runner: "openai", content: result.content, usage: result.usage };
}

async function runVertex({ context, chat, prefs, googleAccounts }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const messages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  const result = await runVertexChat({
    system,
    messages,
    model: prefs?.vertex?.model || "",
    projectId: envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod"),
    location: envString("VERTEX_LOCATION", "europe-west2"),
    authMode: prefs?.vertex?.authMode || "",
    googleAccountKey: prefs?.vertex?.googleAccountKey || "",
    googleAccounts,
  });
  return { runner: "vertex", content: result.content, usage: result.usage };
}

function resolveRunner({ getAssistantRunnerPrefs }) {
  const envRunner = String(envString("FRIDAY_RUNNER", "")).trim().toLowerCase();
  if (envRunner && envRunner !== "settings") return { runner: envRunner, source: "env", prefs: null };
  const prefs = typeof getAssistantRunnerPrefs === "function" ? getAssistantRunnerPrefs() : null;
  const runner = String(prefs?.runner || "").trim().toLowerCase() || "codex";
  return { runner, source: "settings", prefs };
}

async function runAssistant({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, getAssistantRunnerPrefs, googleAccounts, onEvent, mode }) {
  const resolved = resolveRunner({ getAssistantRunnerPrefs });
  const runner = resolved.runner;
  if (runner === "codex") return runCodex({ context, chat, getActiveCodexProfile, getCodexRunnerPrefs, onEvent, mode });
  if (runner === "openai" || runner === "api" || runner === "metered") return runOpenAiWithPrefs({ context, chat, prefs: resolved.prefs });
  if (runner === "vertex") return runVertex({ context, chat, prefs: resolved.prefs, googleAccounts });
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
