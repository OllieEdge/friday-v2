ALTER TABLE messages ADD COLUMN meta TEXT;

CREATE TABLE IF NOT EXISTS message_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_events_message_id ON message_events(message_id, id);

