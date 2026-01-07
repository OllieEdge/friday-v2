-- Triage feedback + confidence (Friday v2)

ALTER TABLE triage_items ADD COLUMN confidence_pct INTEGER;

CREATE TABLE IF NOT EXISTS triage_feedback (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- dismissed|completed|reopened|priority_set|note
  actor TEXT NOT NULL DEFAULT 'user',
  reason TEXT,
  outcome TEXT,
  notes TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_triage_feedback_item_id_created_at ON triage_feedback(item_id, created_at);
