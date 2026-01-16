const fs = require("node:fs");
const path = require("node:path");
const { loadRootEnv } = require("../config/env");
const { CONTEXT_DIR } = require("../config/paths");
const { openDb } = require("../db/db");
const { migrate } = require("../db/migrate");
const { createChatsQueries } = require("../db/queries/chats");
const { createSettingsQueries } = require("../db/queries/settings");
const { createCodexProfilesQueries } = require("../db/queries/codex-profiles");
const { createGoogleAccountsQueries } = require("../db/queries/google-accounts");
const { createTasksQueries } = require("../db/queries/tasks");
const { createPmProjectsQueries } = require("../db/queries/pm-projects");
const { loadContextBundle } = require("../lib/context");
const { runAssistant } = require("../lib/runner");
const { estimateCostUsd } = require("../lib/cost");
const { getSlackConfig, postSlackMessage } = require("../lib/slack");
const { createTrelloCard, commentOnCard, ensureChecklist, ensureChecklistItem, setChecklistItemState, getCard, updateCardDesc } = require("../lib/trello");
const { summarizeText } = require("../lib/summarizer");
const { mergeRelatedCards } = require("../lib/pm-utils");

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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function extractSlackReply(text) {
  const raw = String(text || "");
  const match = raw.match(/```slack_reply\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractPmActions(text) {
  const raw = String(text || "");
  const blocks = [];
  const regex = /```pm_actions\n([\s\S]*?)```/gi;
  let match = null;
  while ((match = regex.exec(raw))) {
    blocks.push(match[1]);
  }
  const actions = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) actions.push(...parsed);
      else if (parsed && typeof parsed === "object") actions.push(parsed);
    } catch {
      // ignore
    }
  }
  return actions.filter(Boolean);
}

async function applyPmActions({ project, actions, settings, googleAccounts, pmProjects }) {
  if (!project || !Array.isArray(actions) || actions.length === 0) return;

  for (const action of actions) {
    const type = normalizeText(action?.type);
    if (!type) continue;

    if (type === "activity") {
      const raw = normalizeText(action?.text || action?.raw);
      if (!raw) continue;
      const summary = await summarizeText({
        text: raw,
        purpose: "Summarize as a single bullet action/decision",
        settings,
        googleAccounts,
      });
      if (summary.ok && summary.summary) {
        pmProjects.appendSummary({ projectId: project.id, line: summary.summary });
      }
      continue;
    }

    if (type === "title_refresh") {
      const summary = await summarizeText({
        text: normalizeText(action?.text || ""),
        purpose: "Generate a short, human-friendly PM chat title",
        settings,
        googleAccounts,
      });
      if (summary.ok && summary.summary) {
        pmProjects.updateTitle({ projectId: project.id, title: summary.summary });
      }
      continue;
    }

    if (type === "trello_comment") {
      if (!project?.trelloCardId) continue;
      let text = normalizeText(action?.text || "");
      const raw = normalizeText(action?.raw || "");
      if (!text && raw) {
        const summary = await summarizeText({
          text: raw,
          purpose: "Summarize as a Trello comment",
          settings,
          googleAccounts,
        });
        if (summary.ok && summary.summary) {
          text = summary.summary;
        }
      }
      if (text) {
        await commentOnCard({ cardId: project.trelloCardId, text });
      }
      continue;
    }

    if (type === "checklist_update") {
      if (!project?.trelloCardId) continue;
      const checklistName = normalizeText(action?.checklist || "Development Tasks") || "Development Tasks";
      const items = Array.isArray(action?.items) ? action.items.map(normalizeText).filter(Boolean) : [];
      const completeItems = Array.isArray(action?.completeItems)
        ? action.completeItems.map(normalizeText).filter(Boolean)
        : [];

      const listRes = await ensureChecklist({ cardId: project.trelloCardId, name: checklistName });
      if (!listRes.ok) continue;
      const checklistId = listRes.data?.id;
      if (!checklistId) continue;

      for (const item of items) {
        await ensureChecklistItem({ cardId: project.trelloCardId, checklistId, name: item });
      }
      for (const item of completeItems) {
        const entry = await ensureChecklistItem({ cardId: project.trelloCardId, checklistId, name: item });
        if (entry.ok && entry.data?.id) {
          await setChecklistItemState({ cardId: project.trelloCardId, checkItemId: entry.data.id, state: "complete" });
        }
      }
      continue;
    }

    if (type === "related_cards") {
      if (!project?.trelloCardId) continue;
      const cards = Array.isArray(action?.cards) ? action.cards.map(normalizeText).filter(Boolean) : [];
      if (!cards.length) continue;
      const cardRes = await getCard(project.trelloCardId);
      if (!cardRes.ok) continue;
      const nextDesc = mergeRelatedCards({ desc: cardRes.data?.desc || "", cards });
      await updateCardDesc(project.trelloCardId, nextDesc);
      continue;
    }
  }
}

loadRootEnv();

const { db } = openDb();
migrate(db);

const chats = createChatsQueries(db);
const settings = createSettingsQueries(db);
const codexProfiles = createCodexProfilesQueries(db);
const googleAccounts = createGoogleAccountsQueries(db);
const tasks = createTasksQueries(db);
const pmProjects = createPmProjectsQueries(db);

function loadContext() {
  return loadContextBundle({ contextDir: CONTEXT_DIR });
}

function loadPmContext() {
  const pmPath = path.join(CONTEXT_DIR, "pm.md");
  if (!fs.existsSync(pmPath)) return loadContext();
  const content = fs.readFileSync(pmPath, "utf8");
  return { dir: CONTEXT_DIR, files: ["pm.md"], items: [{ filename: "pm.md", content }] };
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
      apiKey: settings.get("openai_api_key") || "",
    },
    vertex: {
      model: settings.get("vertex_model") || "",
      projectId: process.env.VERTEX_PROJECT_ID || "tmg-product-innovation-prod",
      location: process.env.VERTEX_LOCATION || "europe-west1",
      authMode: settings.get("vertex_auth_mode") || process.env.VERTEX_AUTH_MODE || "aws_secret",
      googleAccountKey: settings.get("vertex_google_account_key") || process.env.VERTEX_GOOGLE_ACCOUNT_KEY || "work",
      serviceAccountJson: settings.get("vertex_service_account_json") || "",
    },
  };
}

async function maybeRefreshPmTitle({ project, chat }) {
  if (!project || !chat) return;
  const messageCount = Array.isArray(chat.messages) ? chat.messages.length : 0;
  if (messageCount > 5) return;

  const transcript = (chat.messages || [])
    .slice(-10)
    .map((m) => `${String(m.role || "").toUpperCase()}: ${String(m.content || "").trim()}`)
    .join("\n\n");
  if (!transcript.trim()) return;

  const summary = await summarizeText({
    text: transcript,
    purpose: "Generate a short, human-friendly PM chat title",
    settings,
    googleAccounts,
  });

  if (!summary.ok || !summary.summary) return;
  pmProjects.updateTitle({ projectId: project.id, title: summary.summary });
  chats.updateChatTitle({ chatId: project.chatId, title: summary.summary });
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
      roleLabel: "PM",
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
      roleLabel: "PM",
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

async function runSlackAutoReplyTask({ task }) {
  const input = task?.input || {};
  const channel = normalizeText(input.channel);
  const text = normalizeText(input.text);
  if (!channel || !text) {
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: "Invalid Slack task input." } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
    return;
  }

  const cfg = getSlackConfig();
  if (!cfg.botToken) {
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: "Missing SLACK_BOT_TOKEN." } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
    return;
  }

  const startedAt = new Date().toISOString();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "loading_context" } });
  const context = loadContext();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "running" } });

  const prompt = [
    "You are Friday, replying on Oliver's behalf.",
    "Draft a short, helpful response to the Slack message below.",
    "Return ONLY a ```slack_reply``` JSON block with:",
    "- replyText: string",
    "- confidencePct: number 0-100",
    "- shouldReply: boolean",
    "- reason: short string",
    "",
    `Message: ${text}`,
  ].join("\n");

  try {
    const chat = { messages: [{ role: "user", content: prompt }] };
    const result = await runAssistant({
      context,
      chat,
      googleAccounts,
      onEvent: (ev) => tasks.appendEvent({ taskId: task.id, event: ev }),
      getActiveCodexProfile,
      getCodexRunnerPrefs,
      getAssistantRunnerPrefs,
    });

    const output = String(result?.content || "");
    const parsed = extractSlackReply(output) || {};
    const replyText = normalizeText(parsed.replyText);
    const confidencePct = Number(parsed.confidencePct || 0);
    const shouldReply = Boolean(parsed.shouldReply) && replyText.length > 0;

    tasks.appendEvent({
      taskId: task.id,
      event: { type: "slack_reply", replyText, confidencePct, shouldReply, reason: normalizeText(parsed.reason) },
    });

    if (shouldReply && confidencePct >= cfg.autoReplyConfidence) {
      const res = await postSlackMessage({ token: cfg.botToken, channel, text: replyText, threadTs: input.threadTs || null });
      if (!res.ok) {
        tasks.appendEvent({ taskId: task.id, event: { type: "error", message: `slack_send_failed:${res.error}` } });
        tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
        return;
      }
    }

    const costUsd = result?.usage ? estimateCostUsd(result.usage) : null;
    recordProfileUsage({ codexProfiles, profileId: result?.profileId, usage: result?.usage, costUsd });
    if (result?.usage) {
      tasks.appendEvent({ taskId: task.id, event: { type: "usage", usage: result.usage, costUsd } });
    }

    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: true, exitCode: 0 } });
    tasks.setStatus({ taskId: task.id, status: "ok", completedAt: new Date().toISOString() });
  } catch (e) {
    const message = String(e?.message || e);
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message } });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: null } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
  }
}

async function runPmChatTask({ task }) {
  const chatId = task?.input?.chatId;
  const assistantMessageId = task?.input?.assistantMessageId;
  const projectId = task?.input?.projectId;
  if (!chatId || !assistantMessageId || !projectId) {
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: "Invalid PM task input." } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
    return;
  }

  const project = pmProjects.get(projectId);
  const startedAt = new Date().toISOString();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "loading_context" } });
  chats.appendMessageEvent({ messageId: assistantMessageId, event: { type: "status", stage: "loading_context" } });

  const context = loadPmContext();

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
      roleLabel: "PM",
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

    pmProjects.touch({ projectId: projectId });
    const updatedChat = chats.getChat(chatId);
    await maybeRefreshPmTitle({ project: project, chat: updatedChat });

    const actions = extractPmActions(assistantContent);
    if (actions.length) {
      await applyPmActions({ project, actions, settings, googleAccounts, pmProjects });
    }
  } catch (e) {
    const msg = `PM runner error: ${String(e?.message || e)}`;
    const errorMeta = {
      roleLabel: "PM",
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

async function runPmTask({ task }) {
  const input = task?.input || {};
  const title = String(input.title || "").trim() || "PM request";
  const description = String(input.description || "").trim();
  const source = String(input.source || "").trim() || "friday";
  const trelloBoard = String(input?.trello?.board || input?.trelloBoard || "https://trello.com/b/JdzyD1Q7/peronsal-projects").trim() || "https://trello.com/b/JdzyD1Q7/peronsal-projects";
  const trelloList = String(input?.trello?.list || input?.trelloList || "Ideas").trim() || "Ideas";
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "creating_trello_card" } });
  const desc = [
    "Request",
    description || "(no description provided)",
    "",
    "Source",
    source,
    "",
    "Meta",
    `TaskId: ${task.id}`,
    `CreatedAt: ${task.createdAt}`,
  ].join("\n");
  try {
    const result = await createTrelloCard({ title, desc, board: trelloBoard, list: trelloList });
    if (!result?.ok) {
      const message = String(result?.error || result?.message || result?.stderr || "trello_create_failed");
      tasks.appendEvent({ taskId: task.id, event: { type: "error", message } });
      tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: result?.exitCode ?? null } });
      tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
      return;
    }
    const cardUrl = String(result?.url || "").trim();
    if (cardUrl) {
      tasks.appendEvent({ taskId: task.id, event: { type: "trello_card", url: cardUrl, board: trelloBoard, list: trelloList } });
    }
    const nextInput = {
      ...input,
      trello: { board: trelloBoard, list: trelloList, cardUrl },
    };
    tasks.updateInput({ taskId: task.id, input: nextInput });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: true, exitCode: 0 } });
    tasks.setStatus({ taskId: task.id, status: "ok", completedAt: new Date().toISOString() });
  } catch (e) {
    const message = String(e?.message || e);
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message } });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: null } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
  }
}

async function runPmCommandTask({ task }) {
  const input = task?.input || {};
  const command = String(input.command || "").trim();
  if (!command) {
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message: "Invalid task input (missing command)." } });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: null } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt: new Date().toISOString() });
    return;
  }

  const startedAt = new Date().toISOString();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "loading_context" } });
  const context = loadContext();
  tasks.appendEvent({ taskId: task.id, event: { type: "status", stage: "running" } });

  try {
    const chat = { messages: [{ role: "user", content: command }] };
    const result = await runAssistant({
      context,
      chat,
      googleAccounts,
      onEvent: (ev) => tasks.appendEvent({ taskId: task.id, event: ev }),
      getActiveCodexProfile,
      getCodexRunnerPrefs,
      getAssistantRunnerPrefs,
    });

    const output = String(result?.content || "");
    const completedAt = new Date().toISOString();
    const nextInput = {
      ...input,
      result: { ok: true, output, error: "", exitCode: 0, startedAt, completedAt },
    };
    tasks.updateInput({ taskId: task.id, input: nextInput });
    tasks.appendEvent({ taskId: task.id, event: { type: "command_result", ok: true, output, exitCode: 0 } });

    const costUsd = result?.usage ? estimateCostUsd(result.usage) : null;
    recordProfileUsage({ codexProfiles, profileId: result?.profileId, usage: result?.usage, costUsd });
    if (result?.usage) {
      tasks.appendEvent({ taskId: task.id, event: { type: "usage", usage: result.usage, costUsd } });
    }

    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: true, exitCode: 0 } });
    tasks.setStatus({ taskId: task.id, status: "ok", completedAt });
  } catch (e) {
    const message = String(e?.message || e);
    const completedAt = new Date().toISOString();
    const nextInput = {
      ...input,
      result: { ok: false, output: "", error: message, exitCode: null, startedAt, completedAt },
    };
    tasks.updateInput({ taskId: task.id, input: nextInput });
    tasks.appendEvent({ taskId: task.id, event: { type: "command_result", ok: false, error: message, exitCode: null } });
    tasks.appendEvent({ taskId: task.id, event: { type: "error", message } });
    tasks.appendEvent({ taskId: task.id, event: { type: "done", ok: false, exitCode: null } });
    tasks.setStatus({ taskId: task.id, status: "error", completedAt });
  }
}

async function tick() {
  let task = null;
  try {
    task =
      tasks.claimNextQueued({ kind: "slack_auto_reply" }) ||
      tasks.claimNextQueued({ kind: "pm_chat_run" }) ||
      tasks.claimNextQueued({ kind: "pm_command" }) ||
      tasks.claimNextQueued({ kind: "pm_request" }) ||
      tasks.claimNextQueued({ kind: "chat_run" });
  } catch (e) {
    if (e && typeof e === "object" && (e.errcode === 5 || e.code === "ERR_SQLITE_ERROR")) return false;
    throw e;
  }
  if (!task) return false;
  if (task.kind === "pm_chat_run") await runPmChatTask({ task });
  if (task.kind === "pm_command") await runPmCommandTask({ task });
  if (task.kind === "pm_request") await runPmTask({ task });
  if (task.kind === "chat_run") await runChatTask({ task });
  if (task.kind === "slack_auto_reply") await runSlackAutoReplyTask({ task });
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
