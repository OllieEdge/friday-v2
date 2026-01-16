CREATE TABLE IF NOT EXISTS pm_projects (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  trello_card_url TEXT,
  trello_card_id TEXT,
  trello_board_id TEXT,
  trello_list_id TEXT,
  size_label TEXT,
  size_estimate TEXT,
  size_risks TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_projects_updated ON pm_projects(updated_at);
CREATE INDEX IF NOT EXISTS idx_pm_projects_last_activity ON pm_projects(last_activity_at);

CREATE TABLE IF NOT EXISTS pm_project_workers (
  project_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  lane TEXT,
  last_activity_at TEXT NOT NULL,
  PRIMARY KEY(project_id, worker_id),
  FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_project_workers_project ON pm_project_workers(project_id);
