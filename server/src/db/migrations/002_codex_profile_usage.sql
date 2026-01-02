ALTER TABLE codex_profiles ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_profiles ADD COLUMN total_cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_profiles ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_profiles ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE codex_profiles ADD COLUMN total_cost_updated_at TEXT;

