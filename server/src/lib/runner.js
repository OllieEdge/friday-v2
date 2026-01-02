const path = require("node:path");
const { envString } = require("../config/env");
const { ROOT_DIR } = require("../config/paths");
const { buildPrompt, resolveCodexPath, runCodexExec, runCodexLoginStatus } = require("./codex");

function buildContextText(contextItems) {
  return (contextItems || [])
    .map((i) => `# ${i.filename}\n\n${String(i.content || "").trim()}\n`)
    .join("\n\n---\n\n");
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
  });
}

async function runAssistant({ context, chat, getActiveCodexProfile }) {
  const runner = envString("FRIDAY_RUNNER", "noop").toLowerCase();
  if (runner === "codex") return runCodex({ context, chat, getActiveCodexProfile });
  return runNoop({ context });
}

module.exports = { runAssistant };
