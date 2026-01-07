const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { estimateCostUsd } = require("../lib/cost");

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

function hydrateMessagesWithRunEvents(chats, chat) {
  if (!chat || !Array.isArray(chat.messages)) return chat;
  const messages = chat.messages.map((m) => {
    const run = m?.meta?.run;
    if (!run) return m;
    const events = chats.listMessageEvents({ messageId: m.id, limit: 400 });
    return { ...m, events };
  });
  return { ...chat, messages };
}

function registerChats(router, { chats, runAssistant, loadContext, tasks, codexProfiles }) {
  router.add("GET", "/api/chats", (_req, res) => {
    const list = chats.listChats();
    return sendJson(res, 200, { ok: true, chats: list });
  });

  router.add("POST", "/api/chats", async (req, res) => {
    const body = await readJson(req);
    const chat = chats.createChat({ title: body?.title });
    return sendJson(res, 201, { ok: true, chat });
  });

  router.add("GET", "/api/chats/:chatId", (_req, res, _url, params) => {
    const chat = hydrateMessagesWithRunEvents(chats, chats.getChat(params.chatId));
    if (!chat) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, chat });
  });

  router.add("POST", "/api/chats/:chatId/visibility", async (req, res, _url, params) => {
    const body = await readJson(req);
    const hidden = Boolean(body?.hidden);
    const chat = chats.setChatHidden({ chatId: params.chatId, hidden });
    if (!chat) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, chat });
  });

  router.add("POST", "/api/chats/:chatId/messages", async (req, res, _url, params) => {
    const body = await readJson(req);
    const userMsg = chats.appendMessage({ chatId: params.chatId, role: "user", content: body?.content ?? "" });
    if (!userMsg) return sendJson(res, 404, { ok: false, error: "not_found" });

    const context = loadContext();
    const chat = chats.getChat(params.chatId);

    let assistantContent = "";
    try {
      const result = await runAssistant({ context, chat });
      assistantContent = String(result?.content || "");
      const costUsd = result?.usage ? estimateCostUsd(result.usage) : null;
      recordProfileUsage({ codexProfiles, profileId: result?.profileId, usage: result?.usage, costUsd });
    } catch (e) {
      assistantContent = `Runner error: ${String(e?.message || e)}`;
    }
    const assistantMsg = chats.appendMessage({ chatId: params.chatId, role: "assistant", content: assistantContent });

    return sendJson(res, 201, { ok: true, messages: [userMsg, assistantMsg] });
  });

  router.add("POST", "/api/chats/:chatId/messages/stream", async (req, res, _url, params) => {
    const body = await readJson(req);
    const content = String(body?.content ?? "");
    const userMsg = chats.appendMessage({ chatId: params.chatId, role: "user", content });
    if (!userMsg) return sendJson(res, 404, { ok: false, error: "not_found" });

    if (!tasks) {
      return sendJson(res, 400, { ok: false, error: "tasks_unavailable" });
    }

    const task = tasks.create({ kind: "chat_run", input: { chatId: params.chatId } });
    const assistantMeta = { run: { taskId: task.id, status: "running", startedAt: new Date().toISOString() } };
    const assistantMsg = chats.appendMessage({ chatId: params.chatId, role: "assistant", content: "Thinking…", meta: assistantMeta });
    if (assistantMsg) {
      tasks.updateInput({ taskId: task.id, input: { ...(task.input || {}), assistantMessageId: assistantMsg.id } });
    }
    tasks.emit(task, { type: "status", stage: "queued" });

    tasks.emit(task, { type: "user_message", message: userMsg });
    if (assistantMsg) tasks.emit(task, { type: "assistant_placeholder", message: assistantMsg });
    sendJson(res, 200, { ok: true, taskId: task.id, userMessage: userMsg, assistantMessage: assistantMsg });
  });
}

module.exports = { registerChats };
