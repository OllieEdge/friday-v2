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
        "SELECT id, label, codex_home_path AS codexHomePath, created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt, last_status_text AS lastStatusText, total_input_tokens AS totalInputTokens, total_cached_input_tokens AS totalCachedInputTokens, total_output_tokens AS totalOutputTokens, total_cost_usd AS totalCostUsd, total_cost_updated_at AS totalCostUpdatedAt FROM codex_profiles ORDER BY updated_at DESC;",
      )
      .all();
  }

  function get(profileId) {
    return db
      .prepare(
        "SELECT id, label, codex_home_path AS codexHomePath, created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt, last_status_text AS lastStatusText, total_input_tokens AS totalInputTokens, total_cached_input_tokens AS totalCachedInputTokens, total_output_tokens AS totalOutputTokens, total_cost_usd AS totalCostUsd, total_cost_updated_at AS totalCostUpdatedAt FROM codex_profiles WHERE id = ?;",
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

  function addUsage({ id, inputTokens, cachedInputTokens, outputTokens, costUsd }) {
    const now = nowIso();
    const inTok = Number(inputTokens) || 0;
    const cachedTok = Number(cachedInputTokens) || 0;
    const outTok = Number(outputTokens) || 0;
    const cost = costUsd == null ? null : Number(costUsd);

    if (cost == null || !Number.isFinite(cost)) {
      db.prepare(
        "UPDATE codex_profiles SET total_input_tokens = total_input_tokens + ?, total_cached_input_tokens = total_cached_input_tokens + ?, total_output_tokens = total_output_tokens + ?, updated_at = ? WHERE id = ?;",
      ).run(inTok, cachedTok, outTok, now, id);
      return;
    }

    db.prepare(
      "UPDATE codex_profiles SET total_input_tokens = total_input_tokens + ?, total_cached_input_tokens = total_cached_input_tokens + ?, total_output_tokens = total_output_tokens + ?, total_cost_usd = total_cost_usd + ?, total_cost_updated_at = ?, updated_at = ? WHERE id = ?;",
    ).run(inTok, cachedTok, outTok, cost, now, now, id);
  }

  return { list, get, create, touchStatus, addUsage, remove };
}

module.exports = { createCodexProfilesQueries };
