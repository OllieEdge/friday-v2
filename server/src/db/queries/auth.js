function createAuthQueries(db) {
  function cleanupExpired() {
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');").run();
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');").run();
  }

  function countUsers() {
    const row = db.prepare("SELECT COUNT(*) AS c FROM auth_users;").get();
    return Number(row?.c || 0);
  }

  function countPasskeys() {
    const row = db.prepare("SELECT COUNT(*) AS c FROM auth_passkeys;").get();
    return Number(row?.c || 0);
  }

  function getFirstUser() {
    return (
      db
        .prepare("SELECT id, label, created_at AS createdAt FROM auth_users ORDER BY created_at ASC LIMIT 1;")
        .get() || null
    );
  }

  function listUsers() {
    return db.prepare("SELECT id, label, created_at AS createdAt FROM auth_users ORDER BY created_at ASC;").all();
  }

  function getUserById(id) {
    return (
      db
        .prepare("SELECT id, label, created_at AS createdAt FROM auth_users WHERE id = ?;")
        .get(String(id)) || null
    );
  }

  function createUser({ id, label }) {
    db.prepare("INSERT INTO auth_users (id, label) VALUES (?, ?);").run(String(id), String(label));
    return getUserById(id);
  }

  function listPasskeysByUserId(userId) {
    return db
      .prepare(
        "SELECT id, user_id AS userId, credential_id AS credentialId, counter, transports, created_at AS createdAt FROM auth_passkeys WHERE user_id = ? ORDER BY created_at DESC;"
      )
      .all(String(userId));
  }

  function getPasskeyByCredentialId(credentialId) {
    return (
      db
        .prepare(
          "SELECT id, user_id AS userId, credential_id AS credentialId, public_key AS publicKey, counter, transports, created_at AS createdAt FROM auth_passkeys WHERE credential_id = ?;"
        )
        .get(String(credentialId)) || null
    );
  }

  function createPasskey({ id, userId, credentialId, publicKey, counter, transports }) {
    db.prepare(
      "INSERT INTO auth_passkeys (id, user_id, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?, ?);"
    ).run(String(id), String(userId), String(credentialId), publicKey, Number(counter) || 0, transports ? String(transports) : null);
    return getPasskeyByCredentialId(credentialId);
  }

  function updatePasskeyCounter({ credentialId, counter }) {
    db.prepare("UPDATE auth_passkeys SET counter = ? WHERE credential_id = ?;").run(Number(counter) || 0, String(credentialId));
  }

  function deletePasskeyById(id) {
    db.prepare("DELETE FROM auth_passkeys WHERE id = ?;").run(String(id));
  }

  function createChallenge({ id, userId, type, challenge, expiresAt }) {
    cleanupExpired();
    db.prepare("INSERT INTO auth_challenges (id, user_id, type, challenge, expires_at) VALUES (?, ?, ?, ?, ?);").run(
      String(id),
      userId ? String(userId) : null,
      String(type),
      String(challenge),
      String(expiresAt)
    );
  }

  function getChallengeByValue({ type, challenge }) {
    cleanupExpired();
    return (
      db
        .prepare(
          "SELECT id, user_id AS userId, type, challenge, created_at AS createdAt, expires_at AS expiresAt FROM auth_challenges WHERE type = ? AND challenge = ? LIMIT 1;"
        )
        .get(String(type), String(challenge)) || null
    );
  }

  function deleteChallengeById(id) {
    db.prepare("DELETE FROM auth_challenges WHERE id = ?;").run(String(id));
  }

  function createSession({ id, userId, expiresAt }) {
    cleanupExpired();
    db.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?);").run(String(id), String(userId), String(expiresAt));
  }

  function getSessionById(id) {
    cleanupExpired();
    return (
      db
        .prepare("SELECT id, user_id AS userId, created_at AS createdAt, expires_at AS expiresAt FROM auth_sessions WHERE id = ?;")
        .get(String(id)) || null
    );
  }

  function deleteSessionById(id) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?;").run(String(id));
  }

  return {
    cleanupExpired,
    countUsers,
    countPasskeys,
    getFirstUser,
    listUsers,
    getUserById,
    createUser,
    listPasskeysByUserId,
    getPasskeyByCredentialId,
    createPasskey,
    updatePasskeyCounter,
    deletePasskeyById,
    createChallenge,
    getChallengeByValue,
    deleteChallengeById,
    createSession,
    getSessionById,
    deleteSessionById,
  };
}

module.exports = { createAuthQueries };
