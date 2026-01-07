const { newId } = require("../utils/id");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createTaskStore({ tasksDb }) {
  const clientsByTaskId = new Map();

  function get(id) {
    return tasksDb.get(id);
  }

  function setCancel(task, fn) {
    // no-op for durable tasks; cancellation is DB-driven.
    void task;
    void fn;
  }

  function emit(task, event) {
    tasksDb.appendEvent({ taskId: task.id, event });

    const clients = clientsByTaskId.get(task.id);
    if (clients?.size) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) res.write(payload);
    }
  }

  function attachSse(task, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });

    let closed = false;
    let lastEventId = 0;

    const clients = clientsByTaskId.get(task.id) || new Set();
    clients.add(res);
    clientsByTaskId.set(task.id, clients);

    res.on("close", () => {
      closed = true;
      clients.delete(res);
      if (clients.size === 0) clientsByTaskId.delete(task.id);
    });

    (async () => {
      try {
        while (!closed) {
          const events = tasksDb.listEvents({ taskId: task.id, afterId: lastEventId, limit: 500 });
          for (const e of events) {
            lastEventId = e.id;
            res.write(`data: ${JSON.stringify(e.event)}\n\n`);
          }
          await sleep(500);
        }
      } catch {
        // ignore; client likely disconnected
      }
    })();
  }

  function cancel(task, reason = "canceled") {
    const current = tasksDb.get(task?.id);
    if (!current || (current.status !== "queued" && current.status !== "running")) return false;
    tasksDb.setStatus({ taskId: current.id, status: "canceled", completedAt: new Date().toISOString() });
    tasksDb.appendEvent({ taskId: current.id, event: { type: "canceled", reason } });
    const clients = clientsByTaskId.get(current.id);
    if (clients?.size) {
      for (const res of clients) res.end();
      clientsByTaskId.delete(current.id);
    }
    return true;
  }

  function finish(task, ok, exitCode) {
    const current = tasksDb.get(task?.id);
    if (!current || current.status === "canceled") return;
    const status = ok ? "ok" : "error";
    tasksDb.setStatus({ taskId: current.id, status, completedAt: new Date().toISOString() });
    tasksDb.appendEvent({ taskId: current.id, event: { type: "done", ok, exitCode: exitCode ?? null } });
    const clients = clientsByTaskId.get(current.id);
    if (clients?.size) {
      for (const res of clients) res.end();
      clientsByTaskId.delete(current.id);
    }
  }

  function create({ kind, input, status }) {
    return tasksDb.create({ kind, input, status });
  }

  function updateInput({ taskId, input }) {
    return tasksDb.updateInput({ taskId, input });
  }

  return { create, get, updateInput, setCancel, emit, attachSse, cancel, finish };
}

module.exports = { createTaskStore };
