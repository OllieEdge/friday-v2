const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function createRunbookQueries(db) {
  function getState(runbookId) {
    return db
      .prepare(
        "SELECT runbook_id AS runbookId, chat_id AS chatId, last_run_at AS lastRunAt, last_status AS lastStatus, last_error AS lastError, updated_at AS updatedAt FROM runbook_state WHERE runbook_id = ?;",
      )
      .get(runbookId);
  }

  function upsertState({ runbookId, chatId, lastRunAt = null, lastStatus = null, lastError = null }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO runbook_state (runbook_id, chat_id, last_run_at, last_status, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(runbook_id) DO UPDATE SET chat_id=excluded.chat_id, last_run_at=excluded.last_run_at, last_status=excluded.last_status, last_error=excluded.last_error, updated_at=excluded.updated_at;",
    ).run(runbookId, chatId, lastRunAt, lastStatus, lastError, now);
    return getState(runbookId);
  }

  function createRun({ runbookId, taskId }) {
    const id = newId();
    const now = nowIso();
    db.prepare(
      "INSERT INTO runbook_runs (id, runbook_id, task_id, status, started_at, finished_at, error, created_at) VALUES (?, ?, ?, 'running', ?, NULL, NULL, ?);",
    ).run(id, runbookId, taskId || null, now, now);
    return { id, runbookId, taskId: taskId || null, status: "running", startedAt: now };
  }

  function finishRun({ id, status, error = null }) {
    const finishedAt = nowIso();
    db.prepare("UPDATE runbook_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?;").run(String(status), finishedAt, error, id);
    return getRun(id);
  }

  function getRun(id) {
    return db
      .prepare(
        "SELECT id, runbook_id AS runbookId, task_id AS taskId, status, started_at AS startedAt, finished_at AS finishedAt, error, created_at AS createdAt FROM runbook_runs WHERE id = ?;",
      )
      .get(id);
  }

  function listRuns({ runbookId, limit = 50 }) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    return db
      .prepare(
        "SELECT id, runbook_id AS runbookId, task_id AS taskId, status, started_at AS startedAt, finished_at AS finishedAt, error, created_at AS createdAt FROM runbook_runs WHERE runbook_id = ? ORDER BY started_at DESC LIMIT ?;",
      )
      .all(runbookId, lim);
  }

  function getCursor({ runbookId, accountKey }) {
    const row = db
      .prepare("SELECT cursor_json AS cursorJson FROM runbook_cursors WHERE runbook_id = ? AND account_key = ?;")
      .get(runbookId, accountKey);
    if (!row) return null;
    try {
      return JSON.parse(String(row.cursorJson || "{}"));
    } catch {
      return null;
    }
  }

  function setCursor({ runbookId, accountKey, cursor }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO runbook_cursors (runbook_id, account_key, cursor_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(runbook_id, account_key) DO UPDATE SET cursor_json=excluded.cursor_json, updated_at=excluded.updated_at;",
    ).run(runbookId, accountKey, JSON.stringify(cursor || {}), now);
  }

  return { getState, upsertState, createRun, finishRun, getRun, listRuns, getCursor, setCursor };
}

module.exports = { createRunbookQueries };

