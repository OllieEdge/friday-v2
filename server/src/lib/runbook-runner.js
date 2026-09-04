const fs = require("node:fs");

const { nowIso } = require("../utils/time");
const { loadRunbooksFromDir, updateRunbookFrontmatter } = require("./runbooks");
const { estimateCostUsd } = require("./cost");

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function resolveRunbookAssistantTimeoutMs() {
  return Math.max(30_000, Number(process.env.RUNBOOK_ASSISTANT_TIMEOUT_MS || 180_000) || 180_000);
}

function triagePromptEnvelope({ runbook, accountKey, cursor, feedbackText }) {
  const cursorJson = cursor ? JSON.stringify(cursor) : "{}";
  return (
    `Runbook: ${runbook.id}\n` +
    `Account: ${accountKey}\n` +
    `Cursor (json): ${cursorJson}\n\n` +
    (feedbackText ? `Recent user feedback (for learning):\n${feedbackText.trim()}\n\n` : "") +
    `Instructions (markdown):\n\n` +
    runbook.body.trim() +
    "\n\n---\n\n" +
    "You are running as a scheduled background job.\n" +
    "- Do NOT perform side-effect actions.\n" +
    "- You MAY read/query external data.\n" +
    "- If the runbook includes commands to query data, you MUST run them (do not just describe them).\n" +
    "- Produce triage items as ONE item per actionable thing.\n\n" +
    "Output ONLY a fenced code block tagged `triage` with JSON shaped exactly like:\n" +
    "{\n" +
    '  "cursor": { ... },\n' +
    '  "items": [\n' +
    "    {\n" +
    '      "kind": "quick_read" | "next_action",\n' +
    '      "priority": 0,\n' +
    '      "confidence_pct": 0,\n' +
    '      "title": "short title",\n' +
    '      "summary_md": "markdown body",\n' +
    '      "source_key": "stable unique key",\n' +
    '      "source": { "gmail": { "account": "work|personal", "messageId": "...", "threadId": "..." } }\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Guidance:\n" +
    "- `priority`: perceived urgency/importance (0=low, 1=normal, 2=high, 3=urgent).\n" +
    "- `confidence_pct`: how sure you are this is exactly what Oliver would do next.\n" +
    "- Even when commands fail, output valid triage JSON with best-effort cursor and `items: []`.\n\n" +
    "If there is nothing to triage, output items: [] and still update cursor if available.\n"
  );
}

function parseTriageJson(text) {
  const s = sanitizeJsonText(String(text || ""));
  const m =
    s.match(/```triage\s*([\s\S]*?)```/i) ||
    s.match(/```json\s*([\s\S]*?)```/i) ||
    s.match(/```\s*([\s\S]*?)```/i);
  const raw = sanitizeJsonText((m ? m[1] : null) || (s.trim().startsWith("{") ? s.trim() : null));
  if (!raw) return null;
  try {
    const json = JSON.parse(String(raw).trim());
    return json && typeof json === "object" ? json : null;
  } catch {
    const extracted = extractFirstJsonObject(String(raw));
    if (!extracted) return null;
    try {
      const json = JSON.parse(extracted);
      return json && typeof json === "object" ? json : null;
    } catch {
      return null;
    }
  }
}

function parseRunbookFallback({ runbookId, accountKey, cursor, content }) {
  const text = String(content || "").trim();
  if (!text) return null;
  const isGmailRunbook = String(runbookId || "") === "gmail-hourly-triage";
  const looksLikeAuthIssue = /google|gmail/i.test(text) && /(token|auth|reconnect|revoked|expired|permission)/i.test(text);
  if (isGmailRunbook && looksLikeAuthIssue) {
    return {
      cursor: cursor || null,
      items: [
        {
          kind: "next_action",
          priority: 2,
          confidence_pct: 96,
          title: `Reconnect Gmail account: ${accountKey}`,
          summary_md: text,
          source_key: `gmail:${accountKey}:auth:reconnect`,
          source: {
            gmail: { account: accountKey },
            runbook: { id: runbookId, type: "auth_reconnect" },
          },
        },
      ],
    };
  }
  return null;
}

async function runRunbookOnce({
  runbook,
  accountKey,
  chats,
  triage,
  runbooksDb,
  loadContext,
  runAssistant,
  tasks,
  task: externalTask,
  codexProfiles,
  getActiveCodexProfile,
  getCodexRunnerPrefs,
  getAssistantRunnerPrefs,
  googleAccounts,
}) {
  const state = runbooksDb.getState(runbook.id);
  let runbookChatId = state?.chatId || null;
  if (!runbookChatId) {
    const chat = chats.createChat({ title: `Runbook: ${runbook.id}`, hidden: true });
    runbookChatId = chat.id;
    runbooksDb.upsertState({ runbookId: runbook.id, chatId: runbookChatId, lastRunAt: null, lastStatus: null, lastError: null });
  }

  const cursor = runbooksDb.getCursor({ runbookId: runbook.id, accountKey }) || {};

  const task = externalTask || (tasks?.create ? tasks.create({ kind: "runbook_run", status: "running" }) : null);
  const run = runbooksDb.createRun({ runbookId: runbook.id, taskId: task?.id });

  let feedbackText = "";
  try {
    const recent = triage?.listRecentFeedback ? triage.listRecentFeedback({ runbookId: runbook.id, limit: 40 }) : [];
    if (Array.isArray(recent) && recent.length) {
      const counts = {};
      for (const f of recent) {
        const k = String(f.kind || "");
        counts[k] = (counts[k] || 0) + 1;
      }
      const head = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");

      const examples = recent
        .slice(0, 8)
        .map((f) => {
          const title = String(f.itemTitle || "").trim();
          const reason = String(f.reason || "").trim();
          const outcome = String(f.outcome || "").trim();
          const bits = [String(f.kind || "").trim(), title ? `“${title}”` : "", reason ? `reason=${reason}` : "", outcome ? `outcome=${outcome}` : ""]
            .filter(Boolean)
            .join(" · ");
          return `- ${bits}`;
        })
        .join("\n");

      feedbackText = `${head}\n\nExamples:\n${examples}`.trim();
    }
  } catch {
    feedbackText = "";
  }

  let assistantMeta = task ? { run: { taskId: task.id, status: "running", startedAt: nowIso() } } : null;
  let assistantMsg = null;
  let context = null;
  let userContent = "";
  let userMsg = null;

  try {
    userContent = triagePromptEnvelope({ runbook, accountKey, cursor, feedbackText });
    userMsg = chats.appendMessage({ chatId: runbookChatId, role: "user", content: userContent });

    assistantMsg = chats.appendMessage({
      chatId: runbookChatId,
      role: "assistant",
      content: "Running runbook…",
      meta: assistantMeta,
    });

    if (task && tasks) tasks.emit(task, { type: "status", stage: "loading_context" });
    context = loadContext();
    if (task && tasks) tasks.emit(task, { type: "status", stage: "running" });
  } catch (e) {
    const msg = `runbook_prep_failed: ${String(e?.message || e)}`;
    runbooksDb.finishRun({ id: run.id, status: "error", error: msg });
    runbooksDb.upsertState({ runbookId: runbook.id, chatId: runbookChatId, lastRunAt: nowIso(), lastStatus: "error", lastError: msg });
    if (task && tasks) tasks.finish(task, false, null);
    return { ok: false, error: msg, taskId: task?.id || null, runId: run.id };
  }

  try {
    const chat = chats.getChat(runbookChatId);
    const chatForAssistant = {
      ...(chat || {}),
      messages: [
        {
          id: userMsg?.id || `runbook-user-${Date.now()}`,
          role: "user",
          content: userContent,
          createdAt: userMsg?.createdAt || nowIso(),
        },
      ],
    };
    const timeoutMs = resolveRunbookAssistantTimeoutMs();
    const result = await withTimeout(
      runAssistant({
        context,
        chat: chatForAssistant,
        mode: "runbook",
        routingHint: { lane: "triage" },
        onEvent: (ev) => {
          if (task && tasks) tasks.emit(task, ev);
          if (assistantMsg) chats.appendMessageEvent({ messageId: assistantMsg.id, event: ev });
        },
        getActiveCodexProfile,
        getCodexRunnerPrefs,
        getAssistantRunnerPrefs,
        googleAccounts,
      }),
      timeoutMs,
      "runbook_assistant_timeout",
    );

    const content = String(result?.content || "");
    let parsed = parseTriageJson(content);
    if (!parsed && !content.trim()) {
      parsed = { cursor, items: [] };
    }
    if (!parsed) {
      parsed = parseRunbookFallback({ runbookId: runbook.id, accountKey, cursor, content });
    }
    if (!parsed) {
      const msg = "runbook_output_parse_failed";
      const errorMeta = task
        ? { run: { taskId: task.id, status: "error", startedAt: assistantMeta.run.startedAt, completedAt: nowIso() } }
        : null;
      if (assistantMsg) chats.updateMessage({ messageId: assistantMsg.id, content, meta: errorMeta });
      chats.appendMessage({ chatId: runbookChatId, role: "assistant", content: `Runbook error: ${msg}\n\n(See previous message for raw output.)` });
      runbooksDb.finishRun({ id: run.id, status: "error", error: msg });
      runbooksDb.upsertState({ runbookId: runbook.id, chatId: runbookChatId, lastRunAt: nowIso(), lastStatus: "error", lastError: msg });
      if (task && tasks) tasks.finish(task, false, null);
      return { ok: false, error: msg, taskId: task?.id || null, runId: run.id };
    }

    const nextCursor = parsed.cursor || null;
    if (nextCursor) runbooksDb.setCursor({ runbookId: runbook.id, accountKey, cursor: nextCursor });

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const kind = String(item.kind || "").trim();
      if (kind !== "quick_read" && kind !== "next_action") continue;
      const title = String(item.title || "").trim() || "Untitled";
      const summaryMd = String(item.summary_md || item.summary || "").trim();
      const priority = Number(item.priority) || 0;
      const confidencePct = item.confidence_pct ?? item.confidencePct ?? null;
      const sourceKey = String(item.source_key || "").trim();
      const source = item.source || {};

      const triageChat = chats.createChat({ title: `Triage: ${title}`, hidden: true });
      chats.appendMessage({
        chatId: triageChat.id,
        role: "assistant",
        content: summaryMd || title,
      });
      triage.createItem({
        runbookId: runbook.id,
        kind,
        title,
        summaryMd: summaryMd || title,
        priority,
        confidencePct,
        sourceKey,
        source,
        chatId: triageChat.id,
      });
    }

    const costUsd = result?.usage ? estimateCostUsd(result.usage) : null;
    if (result?.usage && task && tasks) tasks.emit(task, { type: "usage", usage: result.usage, costUsd });
    if (result?.usage && assistantMsg) chats.appendMessageEvent({ messageId: assistantMsg.id, event: { type: "usage", usage: result.usage, costUsd } });
    if (costUsd != null && codexProfiles && result?.profileId) {
      codexProfiles.addUsage({ id: result.profileId, inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens, outputTokens: result.usage.outputTokens, costUsd });
    }

    const doneMeta = task ? { run: { taskId: task.id, status: "done", startedAt: assistantMeta.run.startedAt, completedAt: nowIso() } } : null;
    if (assistantMsg) chats.updateMessage({ messageId: assistantMsg.id, content, meta: doneMeta });

    runbooksDb.finishRun({ id: run.id, status: "ok" });
    runbooksDb.upsertState({ runbookId: runbook.id, chatId: runbookChatId, lastRunAt: nowIso(), lastStatus: "ok", lastError: null });
    if (task && tasks) tasks.finish(task, true, 0);

    return { ok: true, itemsCreated: items.length, cursor: nextCursor, taskId: task?.id || null, runId: run.id };
  } catch (e) {
    const msg = String(e?.message || e);
    const errorMeta = task ? { run: { taskId: task.id, status: "error", startedAt: assistantMeta?.run?.startedAt || nowIso(), completedAt: nowIso() } } : null;
    if (assistantMsg) chats.updateMessage({ messageId: assistantMsg.id, content: `Runbook error: ${msg}`, meta: errorMeta });
    runbooksDb.finishRun({ id: run.id, status: "error", error: msg });
    runbooksDb.upsertState({ runbookId: runbook.id, chatId: runbookChatId, lastRunAt: nowIso(), lastStatus: "error", lastError: msg });
    if (task && tasks) tasks.finish(task, false, null);
    return { ok: false, error: msg, taskId: task?.id || null, runId: run.id };
  }
}

function updateRunbookFile({ runbook, patch }) {
  const raw = fs.readFileSync(runbook.path, "utf8");
  const next = updateRunbookFrontmatter(raw, patch);
  fs.writeFileSync(runbook.path, next, "utf8");
}

function listRunbooks({ dir, runbooksDb }) {
  const runbooks = loadRunbooksFromDir(dir);
  return runbooks.map((rb) => {
    const st = runbooksDb.getState(rb.id);
    const lastRunAt = st?.lastRunAt || null;
    const lastStatus = st?.lastStatus || null;
    const lastError = st?.lastError || null;
    const everyMinutes = rb.meta.everyMinutes ?? null;
    const nextRunAt = lastRunAt && everyMinutes ? new Date(new Date(lastRunAt).getTime() + everyMinutes * 60_000).toISOString() : null;
    return {
      id: rb.id,
      title: rb.meta.title || rb.id,
      enabled: Boolean(rb.meta.enabled),
      everyMinutes,
      timezone: rb.meta.timezone,
      accounts: rb.meta.accounts,
      cursorStrategy: rb.meta.cursorStrategy,
      path: rb.path,
      lastRunAt,
      lastStatus,
      lastError,
      nextRunAt,
    };
  });
}

module.exports = { runRunbookOnce, listRunbooks, updateRunbookFile, parseTriageJson, triagePromptEnvelope };

function sanitizeJsonText(s) {
  return String(s || "")
    .replace(/\uFEFF/g, "")
    .replace(/\u2028|\u2029/g, "\n")
    .trim();
}

function extractFirstJsonObject(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return s.slice(start, i + 1).trim();
  }
  return null;
}
