const crypto = require("node:crypto");
const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function createTriageQueries(db) {
  function listItems({ status = "open", kind = null, limit = 200 } = {}) {
    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    const st = String(status || "open");
    const k = kind == null ? null : String(kind);
    if (k) {
      return db
        .prepare(
          "SELECT id, runbook_id AS runbookId, kind, status, title, summary_md AS summaryMd, priority, confidence_pct AS confidencePct, source_key AS sourceKey, source_json AS sourceJson, chat_id AS chatId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM triage_items WHERE status = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?;",
        )
        .all(st, k, lim)
        .map(deserializeItem);
    }
    return db
      .prepare(
        "SELECT id, runbook_id AS runbookId, kind, status, title, summary_md AS summaryMd, priority, confidence_pct AS confidencePct, source_key AS sourceKey, source_json AS sourceJson, chat_id AS chatId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM triage_items WHERE status = ? ORDER BY updated_at DESC LIMIT ?;",
      )
      .all(st, lim)
      .map(deserializeItem);
  }

  function getItem(id) {
    const row = db
      .prepare(
        "SELECT id, runbook_id AS runbookId, kind, status, title, summary_md AS summaryMd, priority, confidence_pct AS confidencePct, source_key AS sourceKey, source_json AS sourceJson, chat_id AS chatId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM triage_items WHERE id = ?;",
      )
      .get(id);
    return row ? deserializeItem(row) : null;
  }

  function createItem({ runbookId, kind, title, summaryMd, priority = 0, confidencePct = null, sourceKey, source, chatId }) {
    const id = newId();
    const now = nowIso();
    const srcKey = String(sourceKey || "").trim() || defaultSourceKey({ runbookId, kind, title, summaryMd, source });
    const srcJson = JSON.stringify(source || {});
    const conf = confidencePct == null ? null : clampInt(confidencePct, 0, 100);
    db.prepare(
      "INSERT OR IGNORE INTO triage_items (id, runbook_id, kind, status, title, summary_md, priority, confidence_pct, source_key, source_json, chat_id, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    ).run(
      id,
      runbookId || null,
      String(kind),
      String(title || "Untitled"),
      String(summaryMd || ""),
      Number(priority) || 0,
      conf,
      srcKey,
      srcJson,
      chatId,
      now,
      now,
    );
    const inserted = getItem(id);
    if (inserted) return inserted;
    // insert ignored (duplicate) — return existing one by source key
    const existing = db
      .prepare(
        "SELECT id, runbook_id AS runbookId, kind, status, title, summary_md AS summaryMd, priority, confidence_pct AS confidencePct, source_key AS sourceKey, source_json AS sourceJson, chat_id AS chatId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM triage_items WHERE source_key = ? LIMIT 1;",
      )
      .get(srcKey);
    return existing ? deserializeItem(existing) : null;
  }

  function setStatus({ id, status }) {
    const st = String(status || "").trim();
    const now = nowIso();
    const completedAt = st === "completed" ? now : null;
    db.prepare("UPDATE triage_items SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?;").run(st, now, completedAt, id);
    return getItem(id);
  }

  function setPriority({ id, priority }) {
    const now = nowIso();
    const p = clampInt(priority, 0, 10);
    db.prepare("UPDATE triage_items SET priority = ?, updated_at = ? WHERE id = ?;").run(p, now, id);
    return getItem(id);
  }

  function createFeedback({ itemId, kind, actor = "user", reason = null, outcome = null, notes = null, meta = null }) {
    const id = newId();
    const now = nowIso();
    const k = String(kind || "").trim();
    const a = String(actor || "user").trim() || "user";
    const r = reason == null ? null : String(reason).trim();
    const o = outcome == null ? null : String(outcome).trim();
    const n = notes == null ? null : String(notes).trim();
    const metaJson = meta == null ? null : JSON.stringify(meta);
    db.prepare(
      "INSERT INTO triage_feedback (id, item_id, kind, actor, reason, outcome, notes, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    ).run(id, itemId, k, a, r, o, n, metaJson, now);
    return { id, itemId, kind: k, actor: a, reason: r, outcome: o, notes: n, meta: meta || null, createdAt: now };
  }

  function listRecentFeedback({ runbookId = null, limit = 100 } = {}) {
    const lim = Math.max(1, Math.min(500, Number(limit) || 100));
    const rb = runbookId == null ? null : String(runbookId);
    const rows = rb
      ? db
          .prepare(
            "SELECT f.id, f.item_id AS itemId, f.kind, f.actor, f.reason, f.outcome, f.notes, f.meta_json AS metaJson, f.created_at AS createdAt, i.runbook_id AS runbookId, i.kind AS itemKind, i.status AS itemStatus, i.title AS itemTitle, i.priority AS itemPriority FROM triage_feedback f JOIN triage_items i ON i.id = f.item_id WHERE i.runbook_id = ? ORDER BY f.created_at DESC LIMIT ?;",
          )
          .all(rb, lim)
      : db
          .prepare(
            "SELECT f.id, f.item_id AS itemId, f.kind, f.actor, f.reason, f.outcome, f.notes, f.meta_json AS metaJson, f.created_at AS createdAt, i.runbook_id AS runbookId, i.kind AS itemKind, i.status AS itemStatus, i.title AS itemTitle, i.priority AS itemPriority FROM triage_feedback f JOIN triage_items i ON i.id = f.item_id ORDER BY f.created_at DESC LIMIT ?;",
          )
          .all(lim);
    return rows.map(deserializeFeedback);
  }

  return { listItems, getItem, createItem, setStatus, setPriority, createFeedback, listRecentFeedback };
}

module.exports = { createTriageQueries };

function deserializeItem(row) {
  let source = null;
  try {
    source = JSON.parse(String(row.sourceJson || "{}"));
  } catch {
    source = null;
  }
  const conf = row.confidencePct == null ? null : clampInt(row.confidencePct, 0, 100);
  return { ...row, confidencePct: conf, source };
}

function defaultSourceKey({ runbookId, kind, title, summaryMd, source }) {
  const h = crypto.createHash("sha256");
  h.update(String(runbookId || ""));
  h.update("|");
  h.update(String(kind || ""));
  h.update("|");
  h.update(String(title || ""));
  h.update("|");
  h.update(String(summaryMd || ""));
  h.update("|");
  h.update(JSON.stringify(source || {}));
  return `auto:${h.digest("hex").slice(0, 24)}`;
}

function deserializeFeedback(row) {
  let meta = null;
  try {
    meta = row.metaJson ? JSON.parse(String(row.metaJson)) : null;
  } catch {
    meta = null;
  }
  return { ...row, meta };
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}
