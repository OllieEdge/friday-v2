const fs = require("node:fs");
const path = require("node:path");
const { nowIso } = require("../../utils/time");
const { newId } = require("../../utils/id");
const { CODEX_PROFILES_DIR } = require("../../config/paths");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createCodexProfilesQueries(db) {
  function list() {
    return db
      .prepare(
        "SELECT id, label, codex_home_path AS codexHomePath, created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt, last_status_text AS lastStatusText FROM codex_profiles ORDER BY updated_at DESC;",
      )
      .all();
  }

  function get(profileId) {
    return db
      .prepare(
        "SELECT id, label, codex_home_path AS codexHomePath, created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt, last_status_text AS lastStatusText FROM codex_profiles WHERE id = ?;",
      )
      .get(profileId);
  }

  function create({ label }) {
    const id = newId();
    const now = nowIso();
    const codexHomePath = path.join(CODEX_PROFILES_DIR, id);
    ensureDir(codexHomePath);

    db.prepare(
      "INSERT INTO codex_profiles (id, label, codex_home_path, created_at, updated_at, last_verified_at, last_status_text) VALUES (?, ?, ?, ?, ?, NULL, NULL);",
    ).run(id, String(label || "Account"), codexHomePath, now, now);
    return id;
  }

  function touchStatus({ id, lastVerifiedAt, lastStatusText }) {
    db.prepare("UPDATE codex_profiles SET last_verified_at = ?, last_status_text = ?, updated_at = ? WHERE id = ?;").run(
      lastVerifiedAt,
      lastStatusText,
      nowIso(),
      id,
    );
  }

  function remove(id) {
    db.prepare("DELETE FROM codex_profiles WHERE id = ?;").run(id);
  }

  return { list, get, create, touchStatus, remove };
}

module.exports = { createCodexProfilesQueries };

