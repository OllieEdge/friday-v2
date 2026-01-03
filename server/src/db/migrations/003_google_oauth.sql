CREATE TABLE IF NOT EXISTS google_accounts (
  account_key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_oauth_states (
  nonce TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL
);

