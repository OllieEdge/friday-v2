const { loadRootEnv } = require("../config/env");
const { CONTEXT_DIR } = require("../config/paths");
const { openDb } = require("../db/db");
const { migrate } = require("../db/migrate");
const { createChatsQueries } = require("../db/queries/chats");
const { createSettingsQueries } = require("../db/queries/settings");
const { createCodexProfilesQueries } = require("../db/queries/codex-profiles");
const { createGoogleAccountsQueries } = require("../db/queries/google-accounts");
const { createTasksQueries } = require("../db/queries/tasks");
const { loadContextBundle } = require("../lib/context");
const { runAssistant } = require("../lib/runner");
const { estimateCostUsd } = require("../lib/cost");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function recordProfileUsage({ codexProfiles, profileId, usage, costUsd }) {
  if (!codexProfiles || typeof codexProfiles.addUsage !== "function") return;
  if (!profileId || !usage) return;
  codexProfiles.addUsage({
    id: profileId,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
  });
}

loadRootEnv();

const { db } = openDb();
migrate(db);

const chats = createChatsQueries(db);
const settings = createSettingsQueries(db);
const codexProfiles = createCodexProfilesQueries(db);
const googleAccounts = createGoogleAccountsQueries(db);
const tasks = createTasksQueries(db);

function loadContext() {
  return loadContextBundle({ contextDir: CONTEXT_DIR });
}

function getActiveCodexProfile() {
  const id = settings.get("active_codex_profile_id");
  if (!id) return null;
  return codexProfiles.get(id);
}

function getCodexRunnerPrefs() {
  return {
    sandboxMode: settings.get("codex_sandbox_mode") || "read-only",
    reasoningEffort: settings.get("codex_reasoning_effort") || "",
  };
}

function getAssistantRunnerPrefs() {
  return {
    runner: settings.get("assistant_runner") || "codex",
    openai: {
      model: settings.get("openai_model") || "",
      baseUrl: settings.get("openai_base_url") || "",
    },
    vertex: {
      model: settings.get("vertex_model") || "",
      projectId: process.env.VERTEX_PROJECT_ID || "tmg-product-innovation-prod",
      location: process.env.VERTEX_LOCATION || "europe-west2",
      authMode: settings.get("vertex_auth_mode") || process.env.VERTEX_AUTH_MODE || "aws_secret",
      googleAccountKey: settings.get("vertex_google_account_key") || process.env.VERTEX_GOOGLE_ACCOUNT_KEY || "work",
    },
  };
}

async function runChatTask({ task }) {
  const chatId = task?.input?.chatId;
  const assistantMessageId = task?.input?.assistantMessageId;
  if (!chatId || !assistantMessageId) {
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: "Invalid task input (missing chatId/assistantMessageId)." } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
    return;
  }

  const startedAt = new Date().toISOString();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "loading_context" } });
  chats.appendMessageEvent({ messageId: assistantMessageId, event: { type: "status", stage: "loading_context" } });
  const context = loadContext();

  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "running" } });
  chats.appendMessageEvent({ messageId: assistantMessageId, event: { type: "status", stage: "running" } });

  try {
    const chat = chats.getChat(chatId);
    const result = await runAssistant({
      context,
      chat,
      googleAccounts,
      onEvent: (ev) => {
        tasks.appendEvent({ taskId: task.id, event: ev });
        chats.appendMessageEvent({ messageId: assistantMessageId, event: ev });
      },
      getActiveCodexProfile,
      getCodexRunnerPrefs,
      getAssistantRunnerPrefs,
    });

    const assistantContent = String(result?.content || "");
    const doneMeta = {
      run: {
        taskId: task.id,
        status: "done",
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
    chats.updateMessage({ messageId: assistantMessageId, content: assistantContent, meta: doneMeta });
    tasks.appendEvent({ taskId: task.id, event: { type: "assistant_message", message: { id: assistantMessageId, role: "assistant", content: assistantContent, meta: doneMeta } } });

    const costUsd = result?.usage ? estimateCostUsd(result.usage) : null;
    recordProfileUsage({ codexProfiles, profileId: result?.profileId, usage: result?.usage, costUsd });
    if (result?.usage) {
      const evUsage = { type: "usage", usage: result.usage, costUsd };
      tasks.appendEvent({ taskId: task.id, event: evUsage });
      chats.appendMessageEvent({ messageId: assistantMessageId, event: evUsage });
    }

    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: true, exitCode: 0 } });
    tasks.setStatus({ taskId: task.id, status: "ok", completedAt: new Date().toISOString() });
  } catch (e) {
    const msg = `Runner error: ${String(e?.message || e)}`;
    const errorMeta = {
      run: {
        taskId: task.id,
        status: "error",
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
    chats.updateMessage({ messageId: assistantMessageId, content: msg, meta: errorMeta });
    tasks.appendEvent({ taskId: task.id, event: { type: "assistant_message", message: { id: assistantMessageId, role: "assistant", content: msg, meta: errorMeta } } });
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: msg } });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: null } });
    chats.appendMessageEvent({ messageId: assistantMessageId, event: { type: "error", message: msg } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
  }
}

async function tick() {
  const task = tasks.claimNextQueued({ kind: "chat_run" });
  if (!task) return false;
  await runChatTask({ task });
  return true;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log("[worker] started; polling for queued tasks");
  while (true) {
    try {
      const didWork = await tick();
      await sleep(didWork ? 50 : 300);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[worker] error", e);
      await sleep(1000);
    }
  }
}

void main();
