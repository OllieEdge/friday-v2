const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DATA_DIR } = require("../config/paths");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function openDb() {
  ensureDir(DATA_DIR);
  const dbPath = path.join(DATA_DIR, "friday.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return { db, dbPath };
}

module.exports = { openDb };
