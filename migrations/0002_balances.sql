-- Observations, never back-calculated from transactions or receipt valuations.
CREATE TABLE balance_snapshots (
  captured_at TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL
);
CREATE TABLE balance_refresh (
  id INTEGER PRIMARY KEY CHECK(id=1),
  health_json TEXT NOT NULL
);
