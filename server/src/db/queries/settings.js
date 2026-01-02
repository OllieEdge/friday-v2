function createSettingsQueries(db) {
  function get(key) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?;").get(key);
    return row?.value ?? null;
  }

  function set(key, value) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
    ).run(key, String(value ?? ""));
  }

  return { get, set };
}

module.exports = { createSettingsQueries };

