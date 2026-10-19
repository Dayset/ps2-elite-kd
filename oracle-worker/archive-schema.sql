-- ps2-oracle-archive (D1, binding ARCHIVE): one JSON bundle per finished alert, kept for good.
-- Bundle format: see oracle-worker/src/archive.js. Sources: "worker" (this Worker) and
-- "ps2alerts" (backfill from api.ps2alerts.com by a GitHub Actions job via POST /archive/ingest).
CREATE TABLE IF NOT EXISTS alert_archive (
  key TEXT PRIMARY KEY,              -- world-zone-instance
  source TEXT NOT NULL,
  world INTEGER NOT NULL, zone INTEGER NOT NULL, instance_id INTEGER NOT NULL, event_id INTEGER,
  start_ts INTEGER NOT NULL, dur INTEGER,
  winner TEXT, basis TEXT,
  archived_ts INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  data TEXT NOT NULL                 -- the bundle JSON
);
CREATE INDEX IF NOT EXISTS archive_start ON alert_archive (start_ts);
CREATE INDEX IF NOT EXISTS archive_src ON alert_archive (source, start_ts);
