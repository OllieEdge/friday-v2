const { sendJson } = require("../http/respond");

function registerTasks(router, { tasks }) {
  router.add("GET", "/api/tasks/:taskId", (_req, res, _url, params) => {
    const task = tasks.get(params.taskId);
    if (!task) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, task: { id: task.id, kind: task.kind, status: task.status } });
  });

  router.add("POST", "/api/tasks/:taskId/cancel", (_req, res, _url, params) => {
    const task = tasks.get(params.taskId);
    if (!task) return sendJson(res, 404, { ok: false, error: "not_found" });
    const canceled = tasks.cancel(task);
    return sendJson(res, 200, { ok: true, canceled });
  });

  router.add("GET", "/api/tasks/:taskId/events", (req, res, _url, params) => {
    const task = tasks.get(params.taskId);
    if (!task) return sendJson(res, 404, { ok: false, error: "not_found" });
    tasks.attachSse(task, res);
    req.on("close", () => {});
  });
}

module.exports = { registerTasks };
