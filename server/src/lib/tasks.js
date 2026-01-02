const { newId } = require("../utils/id");

function createTaskStore() {
  const tasks = new Map();

  function create({ kind }) {
    const id = newId();
    const task = {
      id,
      kind,
      createdAt: new Date().toISOString(),
      status: "running",
      events: [],
      clients: new Set(),
      cancelFn: null,
    };
    tasks.set(id, task);
    return task;
  }

  function get(id) {
    return tasks.get(id) || null;
  }

  function setCancel(task, fn) {
    task.cancelFn = typeof fn === "function" ? fn : null;
  }

  function emit(task, event) {
    task.events.push(event);
    if (task.events.length > 500) task.events.splice(0, task.events.length - 500);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of task.clients) {
      res.write(payload);
    }
  }

  function attachSse(task, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    for (const e of task.events) {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    }
    task.clients.add(res);
    res.on("close", () => task.clients.delete(res));
  }

  function cancel(task, reason = "canceled") {
    if (!task || task.status !== "running") return false;
    task.status = "canceled";
    emit(task, { type: "canceled", reason });
    try {
      if (task.cancelFn) task.cancelFn();
    } catch {
      // ignore
    }
    for (const res of task.clients) res.end();
    task.clients.clear();
    return true;
  }

  function finish(task, ok, exitCode) {
    if (!task || task.status !== "running") return;
    task.status = ok ? "ok" : "error";
    emit(task, { type: "done", ok, exitCode: exitCode ?? null });
    for (const res of task.clients) res.end();
    task.clients.clear();
  }

  return { create, get, setCancel, emit, attachSse, cancel, finish };
}

module.exports = { createTaskStore };
