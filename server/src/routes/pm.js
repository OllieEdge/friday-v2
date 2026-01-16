const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function getDefaults(settings) {
  const board = normalizeText(settings.get("pm_trello_board")) || "https://trello.com/b/JdzyD1Q7/peronsal-projects";
  const list = normalizeText(settings.get("pm_trello_list")) || "Ideas";
  return { board, list };
}

function registerPm(router, { tasks, settings }) {
  router.add("GET", "/api/pm/settings", (_req, res) => {
    const defaults = getDefaults(settings);
    return sendJson(res, 200, { ok: true, settings: { trelloBoard: defaults.board, trelloList: defaults.list } });
  });

  router.add("POST", "/api/pm/settings", async (req, res) => {
    const body = (await readJson(req)) || {};
    const trelloBoard = normalizeText(body?.trelloBoard);
    const trelloList = normalizeText(body?.trelloList);

    if (trelloBoard) settings.set("pm_trello_board", trelloBoard);
    if (trelloList) settings.set("pm_trello_list", trelloList);

    const defaults = getDefaults(settings);
    return sendJson(res, 200, { ok: true, settings: { trelloBoard: defaults.board, trelloList: defaults.list } });
  });

  router.add("GET", "/api/pm/requests", (_req, res, url) => {
    const limitRaw = url?.searchParams?.get("limit") || "";
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 20));
    const items = tasks.listRecent({ kind: "pm_request", limit });
    return sendJson(res, 200, { ok: true, items });
  });

  router.add("GET", "/api/pm/commands", (_req, res, url) => {
    const limitRaw = url?.searchParams?.get("limit") || "";
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 20));
    const status = normalizeText(url?.searchParams?.get("status"));
    const allowed = new Set(["queued", "running", "ok", "error", "canceled"]);

    const items = status && allowed.has(status)
      ? tasks.listByStatus({ kind: "pm_command", status, limit })
      : tasks.listRecent({ kind: "pm_command", limit });

    return sendJson(res, 200, { ok: true, items });
  });

  router.add("POST", "/api/pm/commands", async (req, res) => {
    const body = (await readJson(req)) || {};
    const command = normalizeText(body?.command);
    if (!command) return sendJson(res, 400, { ok: false, error: "command_required" });

    const target = normalizeText(body?.target) || "codex_chat";
    const source = normalizeText(body?.source) || "pm";
    const meta = body?.meta ?? null;

    const task = tasks.create({
      kind: "pm_command",
      input: {
        command,
        target,
        source,
        meta,
      },
    });

    tasks.emit(task, { type: "status", stage: "queued" });

    return sendJson(res, 200, { ok: true, taskId: task.id });
  });

  router.add("POST", "/api/pm/commands/:taskId/claim", (_req, res, _url, params) => {
    const task = tasks.get(params.taskId);
    if (!task) return sendJson(res, 404, { ok: false, error: "not_found" });
    if (task.status !== "queued") return sendJson(res, 409, { ok: false, error: "not_queued" });

    const now = new Date().toISOString();
    tasks.setStatus({ taskId: task.id, status: "running", startedAt: now });
    tasks.emit(task, { type: "status", stage: "running" });

    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/pm/commands/:taskId/result", async (req, res, _url, params) => {
    const task = tasks.get(params.taskId);
    if (!task) return sendJson(res, 404, { ok: false, error: "not_found" });

    const body = (await readJson(req)) || {};
    const ok = Boolean(body?.ok);
    const output = normalizeText(body?.output);
    const error = normalizeText(body?.error);
    const exitCode = body?.exitCode == null ? null : Number(body?.exitCode);

    const nextInput = {
      ...(task.input || {}),
      result: { ok, output, error, exitCode, completedAt: new Date().toISOString() },
    };

    tasks.updateInput({ taskId: task.id, input: nextInput });
    tasks.emit(task, { type: "command_result", ok, output, error, exitCode });
    tasks.finish(task, ok, exitCode ?? null);

    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/pm/requests", async (req, res) => {
    const body = (await readJson(req)) || {};
    const title = normalizeText(body?.title);
    if (!title) return sendJson(res, 400, { ok: false, error: "title_required" });

    const defaults = getDefaults(settings);
    const trelloBoard = normalizeText(body?.trelloBoard) || defaults.board;
    const trelloList = normalizeText(body?.trelloList) || defaults.list;
    const description = normalizeText(body?.description);
    const source = normalizeText(body?.source) || "friday";

    const task = tasks.create({
      kind: "pm_request",
      input: {
        title,
        description,
        source,
        trello: { board: trelloBoard, list: trelloList },
      },
    });

    tasks.emit(task, { type: "status", stage: "queued" });

    return sendJson(res, 200, { ok: true, taskId: task.id });
  });
}

module.exports = { registerPm };
