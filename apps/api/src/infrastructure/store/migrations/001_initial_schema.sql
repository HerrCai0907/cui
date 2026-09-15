CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  origin TEXT,
  ai_thread_id TEXT,
  ai_harness TEXT,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_round INTEGER,
  queued_prompt_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX sessions_updated_at_id_idx ON sessions(updated_at DESC, id DESC);
CREATE INDEX sessions_pinned_idx ON sessions(pinned);
CREATE INDEX sessions_queued_prompt_count_idx ON sessions(queued_prompt_count);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT,
  round INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  UNIQUE(session_id, order_index)
);

CREATE INDEX messages_session_order_idx ON messages(session_id, order_index);

CREATE TABLE rounds (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  base_commit TEXT,
  diff TEXT NOT NULL,
  diff_summary_json TEXT,
  has_changes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  atomic_review_json TEXT,
  PRIMARY KEY(session_id, round)
);

CREATE TABLE queued_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  models_json TEXT,
  created_at TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  UNIQUE(session_id, order_index)
);

CREATE INDEX queued_prompts_session_order_idx ON queued_prompts(session_id, order_index);
