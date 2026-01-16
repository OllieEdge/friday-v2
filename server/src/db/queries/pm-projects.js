const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function createPmProjectsQueries(db) {
  function create({ chatId, title }) {
    const id = newId();
    const now = nowIso();
    db.prepare(
      "INSERT INTO pm_projects (id, chat_id, title, summary, status, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
    ).run(id, chatId, String(title || "PM project"), "", "active", now, now, now);
    return get(id);
  }

  function get(id) {
    const row = db
      .prepare(
        "SELECT id, chat_id AS chatId, title, summary, trello_card_url AS trelloCardUrl, trello_card_id AS trelloCardId, trello_board_id AS trelloBoardId, trello_list_id AS trelloListId, size_label AS sizeLabel, size_estimate AS sizeEstimate, size_risks AS sizeRisks, status, created_at AS createdAt, updated_at AS updatedAt, last_activity_at AS lastActivityAt FROM pm_projects WHERE id = ?;",
      )
      .get(id);
    return row || null;
  }

  function list({ limit = 100 } = {}) {
    const rows = db
      .prepare(
        "SELECT id, chat_id AS chatId, title, summary, trello_card_url AS trelloCardUrl, trello_card_id AS trelloCardId, trello_board_id AS trelloBoardId, trello_list_id AS trelloListId, size_label AS sizeLabel, size_estimate AS sizeEstimate, size_risks AS sizeRisks, status, created_at AS createdAt, updated_at AS updatedAt, last_activity_at AS lastActivityAt FROM pm_projects ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?;",
      )
      .all(Math.max(1, Math.min(200, Number(limit) || 100)));
    return rows;
  }

  function updateTitle({ projectId, title }) {
    const now = nowIso();
    db.prepare("UPDATE pm_projects SET title = ?, updated_at = ? WHERE id = ?;").run(String(title || ""), now, projectId);
    return get(projectId);
  }

  function updateSummary({ projectId, summary }) {
    const now = nowIso();
    db.prepare("UPDATE pm_projects SET summary = ?, updated_at = ? WHERE id = ?;").run(String(summary || ""), now, projectId);
    return get(projectId);
  }

  function appendSummary({ projectId, line }) {
    const now = nowIso();
    const current = get(projectId);
    const text = normalizeText(line);
    if (!text) return current;
    const next = [normalizeText(current?.summary), `- [${now}] ${text}`].filter(Boolean).join("\n");
    db.prepare("UPDATE pm_projects SET summary = ?, updated_at = ? WHERE id = ?;").run(next, now, projectId);
    return get(projectId);
  }

  function updateTrello({ projectId, cardUrl, cardId, boardId, listId }) {
    const now = nowIso();
    db.prepare(
      "UPDATE pm_projects SET trello_card_url = ?, trello_card_id = ?, trello_board_id = ?, trello_list_id = ?, updated_at = ? WHERE id = ?;",
    ).run(cardUrl || null, cardId || null, boardId || null, listId || null, now, projectId);
    return get(projectId);
  }

  function updateSizing({ projectId, sizeLabel, sizeEstimate, sizeRisks }) {
    const now = nowIso();
    db.prepare(
      "UPDATE pm_projects SET size_label = ?, size_estimate = ?, size_risks = ?, updated_at = ? WHERE id = ?;",
    ).run(sizeLabel || null, sizeEstimate || null, sizeRisks || null, now, projectId);
    return get(projectId);
  }

  function updateStatus({ projectId, status }) {
    const now = nowIso();
    db.prepare("UPDATE pm_projects SET status = ?, updated_at = ? WHERE id = ?;").run(String(status || ""), now, projectId);
    return get(projectId);
  }

  function deleteProject({ projectId }) {
    const result = db.prepare("DELETE FROM pm_projects WHERE id = ?;").run(projectId);
    return result.changes > 0;
  }

  function touch({ projectId, at }) {
    const now = at || nowIso();
    db.prepare("UPDATE pm_projects SET last_activity_at = ?, updated_at = ? WHERE id = ?;").run(now, now, projectId);
    return get(projectId);
  }

  function listWorkers({ projectId }) {
    const rows = db
      .prepare(
        "SELECT project_id AS projectId, worker_id AS workerId, lane, last_activity_at AS lastActivityAt FROM pm_project_workers WHERE project_id = ? ORDER BY last_activity_at DESC;",
      )
      .all(projectId);
    return rows;
  }

  function upsertWorker({ projectId, workerId, lane, lastActivityAt }) {
    const at = lastActivityAt || nowIso();
    db.prepare(
      "INSERT INTO pm_project_workers (project_id, worker_id, lane, last_activity_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, worker_id) DO UPDATE SET lane = excluded.lane, last_activity_at = excluded.last_activity_at;",
    ).run(projectId, workerId, lane || null, at);
  }

  function removeInactiveWorkers({ projectId, before }) {
    db.prepare("DELETE FROM pm_project_workers WHERE project_id = ? AND last_activity_at < ?;").run(projectId, before);
  }


  function findByTitle({ title, limit = 10 }) {
    const query = normalizeText(title).toLowerCase();
    if (!query) return [];
    const maxLimit = Math.max(1, Math.min(25, Number(limit) || 10));
    const rows = db
      .prepare(
        "SELECT id, chat_id AS chatId, title, summary, trello_card_url AS trelloCardUrl, trello_card_id AS trelloCardId, trello_board_id AS trelloBoardId, trello_list_id AS trelloListId, size_label AS sizeLabel, size_estimate AS sizeEstimate, size_risks AS sizeRisks, status, created_at AS createdAt, updated_at AS updatedAt, last_activity_at AS lastActivityAt FROM pm_projects WHERE lower(title) LIKE ? ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?;",
      )
      .all(`%${query}%`, maxLimit);
    return rows;
  }

  function findByTrelloCardId({ cardId }) {
    const id = normalizeText(cardId);
    if (!id) return null;
    const row = db
      .prepare(
        "SELECT id, chat_id AS chatId, title, summary, trello_card_url AS trelloCardUrl, trello_card_id AS trelloCardId, trello_board_id AS trelloBoardId, trello_list_id AS trelloListId, size_label AS sizeLabel, size_estimate AS sizeEstimate, size_risks AS sizeRisks, status, created_at AS createdAt, updated_at AS updatedAt, last_activity_at AS lastActivityAt FROM pm_projects WHERE trello_card_id = ? OR trello_card_url LIKE ? ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT 1;",
      )
      .get(id, `%${id}%`);
    return row || null;
  }
  return {
    create,
    get,
    list,
    updateTitle,
    updateSummary,
    appendSummary,
    updateTrello,
    updateSizing,
    updateStatus,
    deleteProject,
    touch,
    listWorkers,
    upsertWorker,
    removeInactiveWorkers,
    findByTitle,
    findByTrelloCardId,
  };
}

module.exports = { createPmProjectsQueries };
