CREATE TABLE run_events (
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id, seq)
);

CREATE INDEX run_events_session_id_idx ON run_events(session_id);
CREATE INDEX run_events_session_created_idx ON run_events(session_id, created_at);
