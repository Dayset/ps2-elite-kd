-- PS2MapOracle D1 schema (database "ps2-oracle"). Idempotent.

-- One map snapshot per world per poll: zones = {"<zone>": {"<region>": "<faction 0-3>"}}.
CREATE TABLE IF NOT EXISTS snap (
  world INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  zones TEXT NOT NULL,
  PRIMARY KEY (world, ts)
);

-- Census world_event type=METAGAME rows (alert start/end, final scores).
CREATE TABLE IF NOT EXISTS metagame (
  world INTEGER NOT NULL,
  zone INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  ts INTEGER NOT NULL,
  vs REAL, nc REAL, tr REAL,
  PRIMARY KEY (world, instance_id, state, event_id)
);
CREATE INDEX IF NOT EXISTS metagame_ts ON metagame (ts);

-- Census world_event type=FACILITY rows where the owner changed (base flips).
CREATE TABLE IF NOT EXISTS flip (
  world INTEGER NOT NULL,
  zone INTEGER NOT NULL,
  facility INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  old INTEGER, new INTEGER, held INTEGER, outfit TEXT,
  PRIMARY KEY (world, facility, ts)
);
CREATE INDEX IF NOT EXISTS flip_wz_ts ON flip (world, zone, ts);

-- One row per territory alert instance. key = world-zone-instance_id.
CREATE TABLE IF NOT EXISTS alert (
  key TEXT PRIMARY KEY,
  world INTEGER NOT NULL,
  zone INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  start_ts INTEGER NOT NULL,
  dur INTEGER NOT NULL,
  status TEXT NOT NULL,          -- live | settling | sudden_death | settled | canceled | unresolved
  end_ts INTEGER,
  checks INTEGER NOT NULL DEFAULT 0,
  winner TEXT,                   -- VS | NC | TR | draw
  basis TEXT,                    -- census_final | sudden_death
  final TEXT,                    -- {"VS":..,"NC":..,"TR":..} Census ended scores
  flags TEXT,                    -- JSON array of data-quality flags
  state TEXT,                    -- latest live state (push_live contract)
  commander TEXT,                -- latest commander block (Worker /internal/commander fan-out)
  commander_ts INTEGER,
  updated INTEGER NOT NULL,
  archived_ts INTEGER                -- copied to the archive database (ARCHIVE) at this time
);
CREATE INDEX IF NOT EXISTS alert_status ON alert (status);
CREATE INDEX IF NOT EXISTS alert_start ON alert (start_ts);

-- Win-history ticks (one per minute per live alert).
CREATE TABLE IF NOT EXISTS tick (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  t REAL NOT NULL,
  terr TEXT NOT NULL,
  win TEXT NOT NULL,
  PRIMARY KEY (key, ts)
);

-- Benchmark: predicted win probs per slice, Brier at settlement.
CREATE TABLE IF NOT EXISTS bench (
  key TEXT PRIMARY KEY,
  dur INTEGER NOT NULL,
  slices TEXT NOT NULL,          -- {"t0": {"VS":p,...,"t":min}, ...}
  winner TEXT,
  brier TEXT,                    -- {"t0": b, ...}
  settled_ts INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Live continent population per faction (Honu), one row per minute per live-alert zone.
CREATE TABLE IF NOT EXISTS pop (
  world INTEGER NOT NULL,
  zone INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  vs INTEGER, nc INTEGER, tr INTEGER, ns INTEGER,
  PRIMARY KEY (world, zone, ts)
);

-- Per-alert outlier report from Honu participants (after the alert ends).
CREATE TABLE IF NOT EXISTS report (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- ok | pending | error
  attempts INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  players INTEGER,
  flagged INTEGER,
  confirmed INTEGER,
  faction TEXT,                  -- {"VS":{kills,deaths,kd,players},...}
  outliers TEXT,                 -- [{cid,name,outfit,faction,kills,deaths,minutes,kd,kpm,severity,radar}]
  err TEXT
);

-- PS2 Radar second-opinion cache (flagged players only), rechecked after 3 days.
CREATE TABLE IF NOT EXISTS radar (
  cid TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  entry TEXT NOT NULL
);

-- Login challenges (logout-only verification, oracle/docs/AUTH_DESIGN.md).
CREATE TABLE IF NOT EXISTS challenge (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  name TEXT NOT NULL,
  world INTEGER,
  faction TEXT,
  created INTEGER NOT NULL,
  accepted INTEGER,
  window_end INTEGER,
  status TEXT NOT NULL,          -- created | accepted | passed | expired | completed
  passed_at INTEGER,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS challenge_ip ON challenge (ip_hash, created);

-- Verified characters. token_id = the one active token (NULL after sign-out).
CREATE TABLE IF NOT EXISTS account (
  cid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  world INTEGER,
  faction TEXT,
  token_id TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

-- BonusCheques balance (meme currency: no cash value, never bought, sold, traded or paid out).
CREATE TABLE IF NOT EXISTS wallet (
  cid TEXT PRIMARY KEY,
  balance REAL NOT NULL,
  created INTEGER NOT NULL,
  last_auto_at INTEGER NOT NULL,     -- automatic +5/h top-up bookkeeping
  last_manual_day TEXT               -- UTC day of the last manual BonusCheque
);

-- Votes on alert winners, in BonusCheques (meme currency: no cash value, never
-- bought, sold, traded or paid out).
CREATE TABLE IF NOT EXISTS vote (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  key TEXT NOT NULL,                 -- alert key
  outcome TEXT NOT NULL,             -- VS | NC | TR (winner vote)
  amount REAL NOT NULL, fee REAL NOT NULL, net REAL NOT NULL,
  potential REAL NOT NULL,           -- cheques back if the outcome wins
  pct REAL NOT NULL,                 -- oracle win % when voted
  progress REAL NOT NULL,            -- share of the alert elapsed when voted
  placed_ts INTEGER NOT NULL,
  status TEXT NOT NULL,              -- open | won | lost | void
  reward REAL NOT NULL DEFAULT 0,    -- cheques credited at settlement
  settled_ts INTEGER,
  credited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS vote_cid ON vote (cid, placed_ts);
CREATE INDEX IF NOT EXISTS vote_open ON vote (status, key);
DROP TABLE IF EXISTS bet;            -- renamed to vote on 2026-10-18 (was empty)
