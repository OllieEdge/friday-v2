const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");

function createChatsQueries(db) {
  function listChats() {
    return db
      .prepare("SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM chats ORDER BY updated_at DESC;")
      .all();
  }

  function getChat(chatId) {
    const chat = db
      .prepare("SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE id = ?;")
      .get(chatId);
    if (!chat) return null;
    const messages = db
      .prepare(
        "SELECT id, role, content, created_at AS createdAt FROM messages WHERE chat_id = ? ORDER BY created_at ASC;",
      )
      .all(chatId);
    return { ...chat, messages };
  }

  function createChat({ title }) {
    const id = newId();
    const now = nowIso();
    db.prepare("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);").run(
      id,
      String(title || "New chat"),
      now,
      now,
    );
    return getChat(id);
  }

  function appendMessage({ chatId, role, content }) {
    const exists = db.prepare("SELECT 1 FROM chats WHERE id = ?;").get(chatId);
    if (!exists) return null;
    const id = newId();
    const now = nowIso();
    db.prepare("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?);").run(
      id,
      chatId,
      role,
      String(content ?? ""),
      now,
    );
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?;").run(now, chatId);
    return { id, role, content: String(content ?? ""), createdAt: now };
  }

  return { listChats, getChat, createChat, appendMessage };
}

module.exports = { createChatsQueries };

