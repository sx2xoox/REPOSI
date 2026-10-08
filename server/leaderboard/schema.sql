-- Same as SCHEMA in src/logic.ts (the Worker also creates it on first use).
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  boss_ms INTEGER NOT NULL,
  split_ms INTEGER NOT NULL,
  name TEXT NOT NULL,
  seed TEXT NOT NULL,
  device TEXT NOT NULL,
  run_id TEXT NOT NULL,
  char TEXT NOT NULL,
  weapon TEXT NOT NULL,
  build TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (run_id, floor)
);
CREATE INDEX IF NOT EXISTS runs_split ON runs (season, floor, split_ms);
CREATE INDEX IF NOT EXISTS runs_run ON runs (run_id);
CREATE INDEX IF NOT EXISTS runs_device ON runs (device, at);
CREATE INDEX IF NOT EXISTS runs_ip ON runs (ip, at);
