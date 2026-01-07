const { nowIso } = require("../../utils/time");

function createMicrosoftAccountsQueries(db) {
  function list() {
    return db
      .prepare(
        "SELECT account_key AS accountKey, label, kind, tenant_id AS tenantId, email, display_name AS displayName, scopes, connected_at AS connectedAt, updated_at AS updatedAt FROM microsoft_accounts ORDER BY connected_at DESC, account_key ASC;",
      )
      .all();
  }

  function get(accountKey) {
    return db
      .prepare(
        "SELECT account_key AS accountKey, label, kind, tenant_id AS tenantId, email, display_name AS displayName, refresh_token AS refreshToken, scopes, connected_at AS connectedAt, updated_at AS updatedAt FROM microsoft_accounts WHERE account_key = ?;",
      )
      .get(String(accountKey));
  }

  function upsert({ accountKey, label, kind, tenantId, email, displayName, refreshToken, scopes }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO microsoft_accounts (account_key, label, kind, tenant_id, email, display_name, refresh_token, scopes, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_key) DO UPDATE SET label=excluded.label, kind=excluded.kind, tenant_id=excluded.tenant_id, email=excluded.email, display_name=excluded.display_name, refresh_token=excluded.refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at;",
    ).run(
      String(accountKey),
      String(label),
      String(kind),
      tenantId == null ? null : String(tenantId),
      String(email),
      String(displayName),
      String(refreshToken),
      String(scopes || ""),
      now,
      now,
    );
  }

  function remove(accountKey) {
    db.prepare("DELETE FROM microsoft_accounts WHERE account_key = ?;").run(String(accountKey));
  }

  function createState({ nonce, accountKey, label, kind, tenantId, redirectUri, pkceVerifier }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO microsoft_oauth_states (nonce, account_key, label, kind, tenant_id, redirect_uri, pkce_verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
    ).run(
      String(nonce),
      String(accountKey),
      String(label),
      String(kind),
      tenantId == null ? null : String(tenantId),
      String(redirectUri),
      String(pkceVerifier),
      now,
    );
  }

  function consumeState(nonce) {
    db.prepare("BEGIN;").run();
    try {
      const row = db
        .prepare(
          "SELECT nonce, account_key AS accountKey, label, kind, tenant_id AS tenantId, redirect_uri AS redirectUri, pkce_verifier AS pkceVerifier, created_at AS createdAt FROM microsoft_oauth_states WHERE nonce = ?;",
        )
        .get(String(nonce));
      db.prepare("DELETE FROM microsoft_oauth_states WHERE nonce = ?;").run(String(nonce));
      db.prepare("COMMIT;").run();
      return row || null;
    } catch (e) {
      db.prepare("ROLLBACK;").run();
      throw e;
    }
  }

  return { list, get, upsert, remove, createState, consumeState };
}

module.exports = { createMicrosoftAccountsQueries };

