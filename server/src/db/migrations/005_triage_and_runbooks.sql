ALTER TABLE chats ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS runbook_state (
  runbook_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runbook_runs (
  id TEXT PRIMARY KEY,
  runbook_id TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','ok','error','canceled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runbook_runs_runbook_started ON runbook_runs(runbook_id, started_at DESC);

CREATE TABLE IF NOT EXISTS runbook_cursors (
  runbook_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  cursor_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(runbook_id, account_key)
);

CREATE TABLE IF NOT EXISTS triage_items (
  id TEXT PRIMARY KEY,
  runbook_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('quick_read','next_action')),
  status TEXT NOT NULL CHECK(status IN ('open','completed','dismissed')) DEFAULT 'open',
  title TEXT NOT NULL,
  summary_md TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  source_key TEXT NOT NULL,
  source_json TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_items_source_key ON triage_items(source_key);
CREATE INDEX IF NOT EXISTS idx_triage_items_status_kind ON triage_items(status, kind, updated_at DESC);

