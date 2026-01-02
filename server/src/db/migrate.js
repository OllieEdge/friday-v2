const fs = require("node:fs");
const path = require("node:path");

function getUserVersion(db) {
  const row = db.prepare("PRAGMA user_version;").get();
  const key = Object.keys(row || {})[0];
  return Number(row?.[key] || 0);
}

function setUserVersion(db, v) {
  db.exec(`PRAGMA user_version = ${Number(v) || 0};`);
}

function listMigrations() {
  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));
  return files.map((f) => ({ filename: f, filePath: path.join(dir, f) }));
}

function migrate(db) {
  const current = getUserVersion(db);
  const migrations = listMigrations();
  let applied = current;

  for (const m of migrations) {
    const num = Number(m.filename.split("_")[0]);
    if (!Number.isFinite(num) || num <= current) continue;
    const sql = fs.readFileSync(m.filePath, "utf8");
    db.exec("BEGIN;");
    try {
      db.exec(sql);
      setUserVersion(db, num);
      db.exec("COMMIT;");
      applied = num;
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
  }

  return { from: current, to: applied };
}

module.exports = { migrate };

