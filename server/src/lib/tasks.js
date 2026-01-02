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
    };
    tasks.set(id, task);
    return task;
  }

  function get(id) {
    return tasks.get(id) || null;
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

  function finish(task, ok, exitCode) {
    task.status = ok ? "ok" : "error";
    emit(task, { type: "done", ok, exitCode: exitCode ?? null });
    for (const res of task.clients) res.end();
    task.clients.clear();
  }

  return { create, get, emit, attachSse, finish };
}

module.exports = { createTaskStore };

