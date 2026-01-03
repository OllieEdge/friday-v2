const { nowIso } = require("../../utils/time");

function createGoogleAccountsQueries(db) {
  function list() {
    return db
      .prepare(
        "SELECT account_key AS accountKey, email, scopes, connected_at AS connectedAt, updated_at AS updatedAt FROM google_accounts ORDER BY account_key ASC;",
      )
      .all();
  }

  function get(accountKey) {
    return db
      .prepare(
        "SELECT account_key AS accountKey, email, refresh_token AS refreshToken, scopes, connected_at AS connectedAt, updated_at AS updatedAt FROM google_accounts WHERE account_key = ?;",
      )
      .get(accountKey);
  }

  function upsert({ accountKey, email, refreshToken, scopes }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO google_accounts (account_key, email, refresh_token, scopes, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_key) DO UPDATE SET email=excluded.email, refresh_token=excluded.refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at;",
    ).run(String(accountKey), String(email), String(refreshToken), String(scopes || ""), now, now);
  }

  function remove(accountKey) {
    db.prepare("DELETE FROM google_accounts WHERE account_key = ?;").run(String(accountKey));
  }

  function createState({ nonce, accountKey, redirectUri }) {
    const now = nowIso();
    db.prepare(
      "INSERT INTO google_oauth_states (nonce, account_key, redirect_uri, created_at) VALUES (?, ?, ?, ?);",
    ).run(String(nonce), String(accountKey), String(redirectUri), now);
  }

  function consumeState(nonce) {
    db.prepare("BEGIN;").run();
    try {
      const row = db
        .prepare("SELECT nonce, account_key AS accountKey, redirect_uri AS redirectUri, created_at AS createdAt FROM google_oauth_states WHERE nonce = ?;")
        .get(String(nonce));
      db.prepare("DELETE FROM google_oauth_states WHERE nonce = ?;").run(String(nonce));
      db.prepare("COMMIT;").run();
      return row || null;
    } catch (e) {
      db.prepare("ROLLBACK;").run();
      throw e;
    }
  }

  return { list, get, upsert, remove, createState, consumeState };
}

module.exports = { createGoogleAccountsQueries };

