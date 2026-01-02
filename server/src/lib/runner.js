const path = require("node:path");
const { envString } = require("../config/env");
const { ROOT_DIR } = require("../config/paths");
const { buildPrompt, resolveCodexPath, runCodexExec, runCodexLoginStatus } = require("./codex");
const { buildOpenAiSystemText, runOpenAiChat } = require("./openai");

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

async function runCodex({ context, chat, getActiveCodexProfile }) {
  const profile = getActiveCodexProfile();
  if (!profile) return "No active Codex account. Go to Settings → Accounts and set one active.";
  const codexPath = resolveCodexPath();
  const status = await runCodexLoginStatus({ codexPath, codexHomePath: profile.codexHomePath });
  if (!status.loggedIn) {
    return "Active Codex account is not logged in. Go to Settings → Accounts → Login with code.";
  }
  const contextText = buildContextText(context?.items || []);
  const promptText = buildPrompt({ contextText, chatMessages: chat?.messages || [] });
  return runCodexExec({
    codexPath,
    codexHomePath: profile.codexHomePath,
    repoRoot: path.resolve(ROOT_DIR),
    promptText,
    model: envString("CODEX_MODEL", ""),
  });
}

async function runOpenAi({ context, chat }) {
  const contextText = buildContextText(context?.items || []);
  const system = buildOpenAiSystemText({ contextText });
  const chatMessages = (chat?.messages || [])
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({ role: toOpenAiRole(m.role), content: String(m.content || "") }));

  return runOpenAiChat({
    messages: [{ role: "system", content: system }, ...chatMessages],
  });
}

async function runAssistant({ context, chat, getActiveCodexProfile }) {
  const runner = envString("FRIDAY_RUNNER", "noop").toLowerCase();
  if (runner === "codex") return runCodex({ context, chat, getActiveCodexProfile });
  if (runner === "openai" || runner === "api" || runner === "metered") return runOpenAi({ context, chat });
  if (runner === "auto") {
    try {
      return await runCodex({ context, chat, getActiveCodexProfile });
    } catch {
      // fall through
    }
    if (envString("OPENAI_API_KEY", "")) return runOpenAi({ context, chat });
  }
  return runNoop({ context });
}

module.exports = { runAssistant };
