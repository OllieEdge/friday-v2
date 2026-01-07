const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function createChatsQueries(db) {
  function listChats({ includeHidden = false } = {}) {
    const sql = includeHidden
      ? "SELECT id, title, hidden, created_at AS createdAt, updated_at AS updatedAt FROM chats ORDER BY updated_at DESC;"
      : "SELECT id, title, hidden, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE hidden = 0 ORDER BY updated_at DESC;";
    return db.prepare(sql).all();
  }

  function getChat(chatId) {
    const chat = db
      .prepare("SELECT id, title, hidden, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE id = ?;")
      .get(chatId);
    if (!chat) return null;
    const messages = db
      .prepare(
        "SELECT id, role, content, meta, created_at AS createdAt FROM messages WHERE chat_id = ? ORDER BY created_at ASC;",
      )
      .all(chatId);
    return {
      ...chat,
      messages: messages.map((m) => ({
        ...m,
        meta: m.meta ? safeJsonParse(m.meta) : null,
      })),
    };
  }

  function createChat({ title, hidden = false }) {
    const id = newId();
    const now = nowIso();
    db.prepare("INSERT INTO chats (id, title, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?);").run(
      id,
      String(title || "New chat"),
      hidden ? 1 : 0,
      now,
      now,
    );
    return getChat(id);
  }

  function setChatHidden({ chatId, hidden }) {
    const h = hidden ? 1 : 0;
    const now = nowIso();
    db.prepare("UPDATE chats SET hidden = ?, updated_at = ? WHERE id = ?;").run(h, now, chatId);
    return getChat(chatId);
  }

  function appendMessage({ chatId, role, content, meta }) {
    const exists = db.prepare("SELECT 1 FROM chats WHERE id = ?;").get(chatId);
    if (!exists) return null;
    const id = newId();
    const now = nowIso();
    db.prepare("INSERT INTO messages (id, chat_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?);").run(
      id,
      chatId,
      role,
      String(content ?? ""),
      meta == null ? null : JSON.stringify(meta),
      now,
    );
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?;").run(now, chatId);
    return { id, role, content: String(content ?? ""), meta: meta ?? null, createdAt: now };
  }

  function updateMessage({ messageId, content, meta }) {
    const now = nowIso();
    db.prepare("UPDATE messages SET content = ?, meta = ? WHERE id = ?;").run(
      String(content ?? ""),
      meta == null ? null : JSON.stringify(meta),
      messageId,
    );
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = (SELECT chat_id FROM messages WHERE id = ?);").run(now, messageId);
    return { id: messageId, content: String(content ?? ""), meta: meta ?? null, updatedAt: now };
  }

  function appendMessageEvent({ messageId, event }) {
    const now = nowIso();
    db.prepare("INSERT INTO message_events (message_id, event_json, created_at) VALUES (?, ?, ?);").run(
      messageId,
      JSON.stringify(event ?? {}),
      now,
    );
  }

  function listMessageEvents({ messageId, limit = 400 }) {
    const rows = db
      .prepare("SELECT event_json AS eventJson FROM message_events WHERE message_id = ? ORDER BY id ASC LIMIT ?;")
      .all(messageId, Math.max(1, Math.min(2000, Number(limit) || 400)));
    return rows.map((r) => safeJsonParse(r.eventJson)).filter(Boolean);
  }

  return { listChats, getChat, createChat, setChatHidden, appendMessage, updateMessage, appendMessageEvent, listMessageEvents };
}

module.exports = { createChatsQueries };

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}
