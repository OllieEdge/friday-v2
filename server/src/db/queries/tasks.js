const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function createTasksQueries(db) {
  function create({ kind, input, status = "queued" }) {
    const id = newId();
    const now = nowIso();
    db.prepare("INSERT INTO tasks (id, kind, status, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);").run(
      id,
      String(kind || "task"),
      String(status || "queued"),
      input == null ? null : JSON.stringify(input),
      now,
      now,
    );
    return get(id);
  }

  function get(id) {
    const row = db
      .prepare(
        "SELECT id, kind, status, input_json AS inputJson, created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt, completed_at AS completedAt FROM tasks WHERE id = ?;",
      )
      .get(id);
    if (!row) return null;
    return { ...row, input: row.inputJson ? safeJsonParse(row.inputJson) : null };
  }

  function setStatus({ taskId, status, startedAt, completedAt }) {
    const now = nowIso();
    db.prepare("UPDATE tasks SET status = ?, started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?;").run(
      String(status),
      startedAt ?? null,
      completedAt ?? null,
      now,
      taskId,
    );
    return get(taskId);
  }

  function updateInput({ taskId, input }) {
    const now = nowIso();
    db.prepare("UPDATE tasks SET input_json = ?, updated_at = ? WHERE id = ?;").run(
      input == null ? null : JSON.stringify(input),
      now,
      taskId,
    );
    return get(taskId);
  }

  function appendEvent({ taskId, event }) {
    const now = nowIso();
    db.prepare("INSERT INTO task_events (task_id, event_json, created_at) VALUES (?, ?, ?);").run(
      taskId,
      JSON.stringify(event ?? {}),
      now,
    );
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?;").run(now, taskId);
  }

  function listEvents({ taskId, afterId = 0, limit = 500 }) {
    const rows = db
      .prepare(
        "SELECT id, event_json AS eventJson FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?;",
      )
      .all(taskId, Math.max(0, Number(afterId) || 0), Math.max(1, Math.min(2000, Number(limit) || 500)));
    return rows.map((r) => ({ id: r.id, event: safeJsonParse(r.eventJson) })).filter((r) => r.event);
  }

  function claimNextQueued({ kind }) {
    const now = nowIso();
    db.exec("BEGIN IMMEDIATE;");
    try {
      const row = kind
        ? db.prepare("SELECT id FROM tasks WHERE status = 'queued' AND kind = ? ORDER BY created_at ASC LIMIT 1;").get(kind)
        : db.prepare("SELECT id FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1;").get();
      if (!row?.id) {
        db.exec("COMMIT;");
        return null;
      }
      const res = db
        .prepare("UPDATE tasks SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued';")
        .run(now, now, row.id);
      if (res.changes !== 1) {
        db.exec("COMMIT;");
        return null;
      }
      db.exec("COMMIT;");
      return get(row.id);
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
  }

  return { create, get, setStatus, updateInput, appendEvent, listEvents, claimNextQueued };
}

module.exports = { createTasksQueries };
