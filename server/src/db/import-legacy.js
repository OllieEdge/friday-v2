const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("../config/paths");

function importLegacyChatsIfEmpty(db) {
  const countRow = db.prepare("SELECT COUNT(1) AS c FROM chats;").get();
  if ((countRow?.c || 0) > 0) return { imported: 0, reason: "db_not_empty" };

  const legacyPath = path.join(DATA_DIR, "chats.json");
  if (!fs.existsSync(legacyPath)) return { imported: 0, reason: "no_legacy_file" };

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    return { imported: 0, reason: "legacy_parse_failed" };
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return { imported: 0, reason: "legacy_empty" };

  const insChat = db.prepare("INSERT OR IGNORE INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);");
  const insMsg = db.prepare(
    "INSERT OR IGNORE INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?);",
  );

  let importedChats = 0;
  db.exec("BEGIN;");
  try {
    for (const c of legacy) {
      if (!c?.id) continue;
      insChat.run(
        String(c.id),
        String(c.title || "New chat"),
        String(c.createdAt || new Date().toISOString()),
        String(c.updatedAt || c.createdAt || new Date().toISOString()),
      );
      importedChats++;
      for (const m of c.messages || []) {
        if (!m?.id) continue;
        insMsg.run(
          String(m.id),
          String(c.id),
          m.role === "assistant" ? "assistant" : "user",
          String(m.content || ""),
          String(m.createdAt || new Date().toISOString()),
        );
      }
    }
    db.exec("COMMIT;");
    return { imported: importedChats, reason: "ok" };
  } catch (e) {
    db.exec("ROLLBACK;");
    return { imported: 0, reason: `error: ${String(e?.message || e)}` };
  }
}

module.exports = { importLegacyChatsIfEmpty };

