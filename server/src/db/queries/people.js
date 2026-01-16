const { newId } = require("../../utils/id");
const { nowIso } = require("../../utils/time");

function createPeopleQueries(db) {
  function listSpaceAliases({ provider, spaceIds }) {
    const prov = String(provider || "").trim();
    const ids = Array.isArray(spaceIds) ? spaceIds.map((s) => String(s || "").trim()).filter(Boolean) : [];
    if (!prov || ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT a.provider, a.space_id AS spaceId, a.person_id AS personId, p.display_name AS displayName
         FROM chat_space_aliases a
         JOIN people p ON p.id = a.person_id
         WHERE a.provider = ? AND a.space_id IN (${placeholders});`,
      )
      .all(prov, ...ids);

    if (rows.length === 0) return [];

    const personIds = [...new Set(rows.map((r) => r.personId))];
    const personPlaceholders = personIds.map(() => "?").join(",");
    const identityRows = db
      .prepare(
        `SELECT person_id AS personId, provider_user_id AS providerUserId, label
         FROM person_identities
         WHERE provider = ? AND person_id IN (${personPlaceholders});`,
      )
      .all(prov, ...personIds);
    const identityByPerson = new Map();
    for (const row of identityRows) {
      if (!identityByPerson.has(row.personId)) identityByPerson.set(row.personId, row);
    }

    return rows.map((row) => {
      const ident = identityByPerson.get(row.personId);
      return {
        provider: row.provider,
        spaceId: row.spaceId,
        personId: row.personId,
        displayName: row.displayName,
        providerUserId: ident?.providerUserId || null,
        identityLabel: ident?.label || null,
      };
    });
  }

  function upsertSpaceAlias({ provider, spaceId, displayName, providerUserId = null, identityLabel = null }) {
    const prov = String(provider || "").trim();
    const space = String(spaceId || "").trim();
    if (!prov || !space) return null;

    const name = String(displayName || "").trim();
    const userId = providerUserId == null ? null : String(providerUserId).trim();
    const now = nowIso();

    let personId = null;
    if (userId) {
      const row = db
        .prepare("SELECT person_id AS personId FROM person_identities WHERE provider = ? AND provider_user_id = ?;")
        .get(prov, userId);
      if (row?.personId) personId = row.personId;
    }

    if (!personId) {
      personId = newId();
      db.prepare("INSERT INTO people (id, display_name, notes, created_at, updated_at) VALUES (?, ?, NULL, ?, ?);").run(
        personId,
        name || "Unknown",
        now,
        now,
      );
    } else if (name) {
      db.prepare("UPDATE people SET display_name = ?, updated_at = ? WHERE id = ?;").run(name, now, personId);
    }

    if (userId) {
      const label = identityLabel == null ? null : String(identityLabel || "").trim() || null;
      const existing = db
        .prepare("SELECT id FROM person_identities WHERE provider = ? AND provider_user_id = ?;")
        .get(prov, userId);
      if (existing?.id) {
        db.prepare("UPDATE person_identities SET person_id = ?, label = ?, updated_at = ? WHERE id = ?;").run(
          personId,
          label,
          now,
          existing.id,
        );
      } else {
        db.prepare(
          "INSERT INTO person_identities (id, person_id, provider, provider_user_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ).run(newId(), personId, prov, userId, label, now, now);
      }
    }

    const existingAlias = db
      .prepare("SELECT id FROM chat_space_aliases WHERE provider = ? AND space_id = ?;")
      .get(prov, space);
    if (existingAlias?.id) {
      db.prepare("UPDATE chat_space_aliases SET person_id = ?, updated_at = ? WHERE id = ?;").run(
        personId,
        now,
        existingAlias.id,
      );
    } else {
      db.prepare(
        "INSERT INTO chat_space_aliases (id, provider, space_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);",
      ).run(newId(), prov, space, personId, now, now);
    }

    const display = name
      ? name
      : db.prepare("SELECT display_name AS displayName FROM people WHERE id = ?;").get(personId)?.displayName || "Unknown";

    return {
      provider: prov,
      spaceId: space,
      personId,
      displayName: display,
      providerUserId: userId,
      identityLabel: identityLabel == null ? null : String(identityLabel || "").trim() || null,
    };
  }

  return { listSpaceAliases, upsertSpaceAlias };
}

module.exports = { createPeopleQueries };
