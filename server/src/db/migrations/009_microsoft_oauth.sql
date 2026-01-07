CREATE TABLE IF NOT EXISTS microsoft_accounts (
  account_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  tenant_id TEXT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS microsoft_oauth_states (
  nonce TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  tenant_id TEXT NULL,
  redirect_uri TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

