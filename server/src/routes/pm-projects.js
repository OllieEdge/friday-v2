const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const {
  listBoards,
  listLists,
  searchCards,
  getCard,
  updateCardDesc,
  addLabelToCard,
  commentOnCard,
  ensureChecklist,
  ensureChecklistItem,
  setChecklistItemState,
} = require("../lib/trello");
const { sizeProject } = require("../lib/sizing");
const { summarizeText } = require("../lib/summarizer");
const { normalizeText, parseCardIdFromUrl, mergeSizingIntoDesc } = require("../lib/pm-utils");

function pruneInactive({ pmProjects, projectId }) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  pmProjects.removeInactiveWorkers({ projectId, before: cutoff });
}

async function applyChecklist({ project, checklistName, items, completeItems }) {
  if (!project?.trelloCardId) return { ok: false, error: "trello_card_missing" };
  const listRes = await ensureChecklist({ cardId: project.trelloCardId, name: checklistName });
  if (!listRes.ok) return listRes;
  const checklistId = listRes.data?.id;
  if (!checklistId) return { ok: false, error: "checklist_missing" };

  const added = [];
  for (const item of items || []) {
    const entry = await ensureChecklistItem({ cardId: project.trelloCardId, checklistId, name: item });
    if (entry.ok && entry.data?.id) added.push(entry.data);
  }

  for (const item of completeItems || []) {
    const entry = await ensureChecklistItem({ cardId: project.trelloCardId, checklistId, name: item });
    if (entry.ok && entry.data?.id) {
      await setChecklistItemState({ cardId: project.trelloCardId, checkItemId: entry.data.id, state: "complete" });
    }
  }

  return { ok: true, checklistId, added };
}

function registerPmProjects(router, { pmProjects, chats, tasks, settings, googleAccounts }) {
  router.add("GET", "/api/pm/projects", (_req, res, url) => {
    const limitRaw = url?.searchParams?.get("limit") || "";
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 100));
    const projects = pmProjects.list({ limit });
    const withWorkers = projects.map((p) => ({ ...p, workers: pmProjects.listWorkers({ projectId: p.id }) }));
    return sendJson(res, 200, { ok: true, projects: withWorkers });
  });

  router.add("POST", "/api/pm/projects", async (req, res) => {
    const body = (await readJson(req)) || {};
    const title = normalizeText(body?.title) || "PM: New project";
    const chat = chats.createChat({ title, hidden: true });
    const project = pmProjects.create({ chatId: chat.id, title });
    return sendJson(res, 201, { ok: true, project, chat });
  });


  router.add("GET", "/api/pm/projects/resolve", (_req, res, url) => {
    const cardUrl = normalizeText(url?.searchParams?.get("cardUrl"));
    const title = normalizeText(url?.searchParams?.get("title"));
    const cardId = normalizeText(url?.searchParams?.get("cardId")) || parseCardIdFromUrl(cardUrl);

    if (!cardId && !title) return sendJson(res, 400, { ok: false, error: "query_required" });

    if (cardId) {
      const project = pmProjects.findByTrelloCardId({ cardId });
      if (project) return sendJson(res, 200, { ok: true, project, candidates: [project] });
    }

    if (title) {
      const candidates = pmProjects.findByTitle({ title, limit: 10 }) || [];
      if (candidates.length === 1) return sendJson(res, 200, { ok: true, project: candidates[0], candidates });
      return sendJson(res, 200, { ok: true, candidates });
    }

    return sendJson(res, 200, { ok: true, candidates: [] });
  });


  router.add("DELETE", "/api/pm/projects/:projectId", (_req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });
    pmProjects.deleteProject({ projectId: project.id });
    if (project.chatId) {
      chats.deleteChat({ chatId: project.chatId });
    }
    return sendJson(res, 200, { ok: true });
  });

  router.add("GET", "/api/pm/projects/:projectId", (_req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });
    pruneInactive({ pmProjects, projectId: project.id });
    const chat = chats.getChat(project.chatId);
    const workers = pmProjects.listWorkers({ projectId: project.id });
    return sendJson(res, 200, { ok: true, project, chat, workers });
  });

  router.add("POST", "/api/pm/projects/:projectId/messages/stream", async (req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });

    const body = (await readJson(req)) || {};
    const content = String(body?.content ?? "");
    const source = normalizeText(body?.source) || "human";
    const workerId = normalizeText(body?.workerId);
    const lane = normalizeText(body?.lane);

    const roleLabel = source === "worker" ? (workerId ? `Worker (${workerId})` : "Worker") : "Oliver";
    const userMsg = chats.appendMessage({
      chatId: project.chatId,
      role: "user",
      content,
      meta: { source, workerId, lane, roleLabel },
    });
    if (!userMsg) return sendJson(res, 404, { ok: false, error: "chat_not_found" });

    const task = tasks.create({ kind: "pm_chat_run", input: { chatId: project.chatId, projectId: project.id, source } });
    const assistantMeta = { roleLabel: "PM", run: { taskId: task.id, status: "running", startedAt: new Date().toISOString() } };
    const assistantMsg = chats.appendMessage({ chatId: project.chatId, role: "assistant", content: "Thinking…", meta: assistantMeta });
    if (assistantMsg) {
      tasks.updateInput({ taskId: task.id, input: { ...(task.input || {}), assistantMessageId: assistantMsg.id } });
    }
    tasks.emit(task, { type: "status", stage: "queued" });

    pmProjects.touch({ projectId: project.id });
    if (workerId) {
      pmProjects.upsertWorker({ projectId: project.id, workerId, lane, lastActivityAt: new Date().toISOString() });
      pruneInactive({ pmProjects, projectId: project.id });
    }

    tasks.emit(task, { type: "user_message", message: userMsg, source });
    if (assistantMsg) tasks.emit(task, { type: "assistant_placeholder", message: assistantMsg, source });

    return sendJson(res, 200, { ok: true, taskId: task.id, userMessage: userMsg, assistantMessage: assistantMsg });
  });

  router.add("POST", "/api/pm/projects/:projectId/trello/assign", async (req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });

    const body = (await readJson(req)) || {};
    const cardUrl = normalizeText(body?.cardUrl);
    const cardId = normalizeText(body?.cardId) || parseCardIdFromUrl(cardUrl);
    if (!cardId) return sendJson(res, 400, { ok: false, error: "card_required" });

    const cardRes = await getCard(cardId);
    if (!cardRes.ok) return sendJson(res, 400, { ok: false, error: cardRes.error || "card_fetch_failed" });

    const card = cardRes.data;
    const next = pmProjects.updateTrello({
      projectId: project.id,
      cardUrl: normalizeText(card?.url) || cardUrl,
      cardId,
      boardId: card?.idBoard,
      listId: card?.idList,
    });

    return sendJson(res, 200, { ok: true, project: next });
  });

  router.add("GET", "/api/pm/trello/boards", async (_req, res) => {
    const data = await listBoards();
    if (!data.ok) return sendJson(res, 400, { ok: false, error: data.error || "boards_failed" });
    return sendJson(res, 200, { ok: true, boards: data.data || [] });
  });

  router.add("GET", "/api/pm/trello/boards/:boardId/lists", async (_req, res, _url, params) => {
    const data = await listLists(params.boardId);
    if (!data.ok) return sendJson(res, 400, { ok: false, error: data.error || "lists_failed" });
    return sendJson(res, 200, { ok: true, lists: data.data || [] });
  });

  router.add("GET", "/api/pm/trello/cards/search", async (_req, res, url) => {
    const query = normalizeText(url?.searchParams?.get("query"));
    const boardId = normalizeText(url?.searchParams?.get("boardId"));
    const data = await searchCards({ boardId, query });
    if (!data.ok) return sendJson(res, 400, { ok: false, error: data.error || "search_failed" });
    return sendJson(res, 200, { ok: true, cards: data.data?.cards || [] });
  });

  router.add("POST", "/api/pm/projects/:projectId/size", async (_req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });

    const chat = chats.getChat(project.chatId);
    const transcript = (chat?.messages || [])
      .slice(-20)
      .map((m) => `${m.role.toUpperCase()}: ${String(m.content || "").trim()}`)
      .join("\n\n");

    const sizing = await sizeProject({ transcript, settings, googleAccounts });
    if (!sizing.ok) return sendJson(res, 400, { ok: false, error: sizing.error || "sizing_failed", raw: sizing.raw });

    const risksText = (sizing.risks || []).join("; ");
    let next = pmProjects.updateSizing({
      projectId: project.id,
      sizeLabel: sizing.sizeLabel,
      sizeEstimate: sizing.timeEstimate,
      sizeRisks: risksText,
    });

    if (next.trelloCardId && next.trelloBoardId) {
      await addLabelToCard({ cardId: next.trelloCardId, boardId: next.trelloBoardId, name: `Size: ${sizing.sizeLabel}` });
      const cardRes = await getCard(next.trelloCardId);
      if (cardRes.ok) {
        const desc = mergeSizingIntoDesc({
          desc: cardRes.data?.desc || "",
          sizeLabel: sizing.sizeLabel,
          timeEstimate: sizing.timeEstimate,
          risks: sizing.risks,
        });
        await updateCardDesc(next.trelloCardId, desc);
      }
    }

    if (project.chatId) {
      const titleSummary = await summarizeText({
        text: transcript,
        purpose: "Generate a short, human-friendly PM chat title",
        settings,
        googleAccounts,
      });
      if (titleSummary.ok && titleSummary.summary) {
        next = pmProjects.updateTitle({ projectId: project.id, title: titleSummary.summary });
        chats.updateChatTitle({ chatId: project.chatId, title: titleSummary.summary });
      }
    }

    return sendJson(res, 200, { ok: true, project: next, sizing });
  });

  router.add("POST", "/api/pm/projects/:projectId/title/refresh", async (_req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });
    const chat = chats.getChat(project.chatId);
    const transcript = (chat?.messages || [])
      .slice(-10)
      .map((m) => `${m.role.toUpperCase()}: ${String(m.content || "").trim()}`)
      .join("\n\n");
    const summary = await summarizeText({
      text: transcript,
      purpose: "Generate a short, human-friendly PM chat title",
      settings,
      googleAccounts,
    });
    if (!summary.ok) return sendJson(res, 400, { ok: false, error: summary.error || "summarize_failed" });
    const title = summary.summary || project.title;
    const updated = pmProjects.updateTitle({ projectId: project.id, title });
    const chatUpdated = chats.updateChatTitle({ chatId: project.chatId, title });
    return sendJson(res, 200, { ok: true, project: updated, chat: chatUpdated });
  });

  router.add("POST", "/api/pm/projects/:projectId/activity", async (req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });
    const body = (await readJson(req)) || {};
    const text = normalizeText(body?.text);
    if (!text) return sendJson(res, 400, { ok: false, error: "text_required" });
    const updated = pmProjects.appendSummary({ projectId: project.id, line: text });
    return sendJson(res, 200, { ok: true, project: updated });
  });

  router.add("POST", "/api/pm/projects/:projectId/trello/comment", async (req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project?.trelloCardId) return sendJson(res, 400, { ok: false, error: "trello_card_missing" });
    const body = (await readJson(req)) || {};
    const raw = normalizeText(body?.raw);
    let text = normalizeText(body?.text);
    if (!text && raw) {
      const summary = await summarizeText({
        text: raw,
        purpose: "Summarize as a Trello comment",
        settings,
        googleAccounts,
      });
      if (!summary.ok) return sendJson(res, 400, { ok: false, error: summary.error || "summarize_failed" });
      text = summary.summary;
    }
    if (!text) return sendJson(res, 400, { ok: false, error: "comment_required" });
    const result = await commentOnCard({ cardId: project.trelloCardId, text });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error || "comment_failed" });
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/pm/projects/:projectId/checklist", async (req, res, _url, params) => {
    const project = pmProjects.get(params.projectId);
    if (!project) return sendJson(res, 404, { ok: false, error: "not_found" });
    const body = (await readJson(req)) || {};
    const checklistName = normalizeText(body?.checklist || "Development Tasks");
    const items = Array.isArray(body?.items) ? body.items.map((i) => normalizeText(i)).filter(Boolean) : [];
    const completeItems = Array.isArray(body?.completeItems) ? body.completeItems.map((i) => normalizeText(i)).filter(Boolean) : [];
    const result = await applyChecklist({ project, checklistName, items, completeItems });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error || "checklist_failed" });
    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerPmProjects };
