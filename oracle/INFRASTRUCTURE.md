> **Historical:** the pipeline before 2026-10-18. Current: [CLOUDFLARE.md](CLOUDFLARE.md).

# PS2MapOracle — Infrastructure

How the live system works, end to end. All paths are relative to the backend
working directory (`~/workspace/ps2polymarket/` in production).

```
Census API ──► pollers ──► local files ──► push generator ──► artifact (hex-betting-game)
                  │                                        │
                  │                                        ├──► live UI (getdashboard)
                  │                                        └──► settlement (record_final_check ×3)
                  │
                  └──► watchdog / cut tracker / benchmark (side jobs)
```

## 1. Collection: two pollers

Both run as long-lived background Python processes, ~60s cycles. They are the
only components that talk to Census.

### `map_poller.py` — facility-ownership snapshots

- Polls the Census Map API (`.../get/ps2:v2/map/?world_id=…&zone_ids=…`) every 60s.
- Worlds tracked: 1 (Osprey), 10 (Wainwright), 19 (Jaeger), 25 (Briggs).
- Zones tracked: 2 (Indar), 4 (Hossin), 6 (Amerish), 8 (Esamir), 344 (Oshur).
- Writes one JSON line per snapshot to `data/map_snapshots/<world>/<zone>/<YYYY-MM-DD>.jsonl`
  with `ts`, `facilities` (facility_id → owning faction), and per-facility owner map.
- 60s is the product owner's polling baseline. Speed rises only if
  momentum/needs prove 60s insufficient.

### `census_events.py` — WebSocket event stream

- Connects to `wss://push.planetside2.com/streaming?environment=ps2&service-id=<id>`
  and subscribes to `Death`, `FacilityControl`, `GainExperience`, `MetagameEvent`,
  `PlayerLogin`, `PlayerLogout` for the tracked worlds.
- Every ~60s window it aggregates and writes one JSON line to
  `data/census_events/<world>/<YYYY-MM-DD>.jsonl`:
  - **Death events** → per-faction KD/KPM, per-character kill/death counters
    (`player_stats`: all characters with 5+ kills, full-alert tracking that
    persists across window resets), outlier rows (early/confirmed tiers, with
    `char_id` since 2026-10-17).
  - **FacilityControl flips** → flip list (facility, old/new faction, timestamp)
    feeding heat scores and the cut tracker.
  - **MetagameEvent** → alert start/end detection.
  - **PlayerLogout** → auth challenge verification (see `docs/AUTH_DESIGN.md`).
- `snapshot()` is followed by `reset()` every window — flips do not accumulate
  across windows. The "window saved: N worlds, K kills, F flips" log line counts
  flips from ALL worlds (unfiltered intake); only tracked worlds are written.

### What Census does NOT provide

- **Per-base population** — confirmed dead (Map API = ownership only). Population
  is proxied by active fighters (characters with recent Death events).
- **Character REST stats** — stale (update on logout). Used for pre-alert roster
  only; live stats come from the event stream.
- **Capture-start events** — none. Capture duration is not measurable; base
  "hold time" is the inter-flip gap (see `base_resistance.py`).

## 2. Live push: every 5 minutes

Cron job `hex-betting-live-push` (every 5m, timeout 300s):

1. Run `python3 push_live_state.py` → writes `live_states.json`:
   `{ "states": [...], "settlements": [...] }`.
   - `push_live_state.py` builds one state per live alert: territory, momentum,
     KD, win probabilities (odds engine: `build_winbins_growtree.lookup`), pop
     (with the 2026-10-16 fallback to per-zone player-list length), commander
     block (via `commander_live.py --json`), second-place market, owners map,
     outliers, fight-up lines, calls/hints.
   - Settlement candidates: ended alerts whose pre-end snapshots are available.
     The generator only emits snapshots at or before the actual alert end, and
     keeps each ended alert in the feed for at least three runs.
2. Run `python3 validate_push_payload.py` — schema/range checks. On FAIL, do not
   push; the generator needs a fix, not a retry.
3. For each state: invoke artifact action `push_live` with `{ "state": <object> }`.
   Args are machine-generated (`json.dumps`) into `/tmp/args_push.json`, validated,
   read back, and pasted **verbatim** — never hand-retyped or reshaped.
   (See `CENSUS_ERRORS.md` — paste corruption is the most common failure mode.)
4. For each settlement: invoke `record_final_check` with that object. Checks must
   stay 5 minutes apart — never retry a settlement check in the same run.
5. Read back with `getdashboard`: each live state must show the same `t` and `ts`;
   each settlement must report pending 1/3 or 2/3, or settled 3/3.
6. Retry a failed live push once from the same machine-generated object.
7. Stay silent on success. Notify only on: live push still stale after its retry,
   script failure, final-check rejection, or settlement pending beyond three passes.

### Settlement (triple-check)

- Alert end → status `settling`, UI shows "settling…".
- `record_final_check` at +0/+5/+10 min with pre-end snapshots. Checks 1–2 hold
  payout; check 3 releases it. A later-arriving closer pre-end snapshot is
  accepted; winner disagreement is logged.
- Settlement records are keyed by **(alertId, endedAt)** (since 2026-10-16) so
  recycled alert IDs cannot collide.
- Never settle from a live push. Never use a post-end snapshot (the
  winner-owns-everything artifact would corrupt the winner).
- Ties → 15-min kill-based sudden death (`record_sudden_death_result`).

## 3. Watchdog: adaptive 1m / 5m

Cron job `ps2polymarket-poller-watchdog`:

- Checks liveness (lockfile PIDs + log activity; `pgrep` is blind in fresh sandbox
  cells, so lockfiles + log freeze + freshness probes are the evidence).
- Restarts any dead poller (`nohup python3 <poller>.py >> logs/<poller>.log 2>&1 &`).
  Lockfiles prevent duplicates.
- Freshness probe: last map snapshot and last events window must be < 15 min old.
  - Both FRESH → `stale_streak = 0`, clear `stale_notified_at`.
  - Either STALE → `stale_streak += 1`; on first stale detection, restart the
    affected poller once (clears local wedging only — cannot fix a Census-side
    outage; never restart in a loop).
  - Notify exactly once per incident when `stale_streak` reaches 2: which
    pipeline(s), last successful timestamps, log-tail error signature,
    confirmation that on-disk history is intact (gap only, no data loss).
- Adaptive schedule: `healthy_streak >= 10` → every 5m (stable, low overhead);
  `healthy_streak == 0` → every 1m (recovering, tight watch). Only update the
  schedule when it actually needs to change.
- State: `watchdog_state.json` (`healthy_streak`, `stale_streak`,
  `stale_notified_at`).
- Reality: the VM/sandbox cell is replaced frequently (often several times a
  day). Every replacement kills both pollers; the watchdog relaunches them.
  Typical collection gap per replacement: ~5–17 min. On-disk history is intact
  across replacements.

## 4. Cut tracker: every 15 minutes

Cron job `cut-tracker-15m`:

- Runs `python3 cut_tracker_run.py` (120s timeout). Reads the latest LOCAL map
  snapshots (world 1 / Osprey, all 5 zones — read-only, no Census calls).
- Detects articulation-point cuts (Tarjan DFS), appends new events to
  `cut_events.jsonl`, advances the watermark in `cut_tracker_state.json`.
- Consecutive snapshot gaps > 600s are skipped by design.
- Silent on success. On failure, tracks consecutive failures; notifies only on
  2 in a row, with the log tail.

## 5. Benchmark logging

- `benchmark_log.py` records per-alert win-probability slices (t0/t30/t60 for
  90-min alerts; t0/t15/t30 for 45-min) from the odds engine into
  `benchmark_predictions.jsonl`, keyed by instance-disambiguated alert key
  (`<alertId>-<start_ts>`, with `census_instance_id` + sequential `alert_n`).
- On settlement, `log_settled` computes Brier = Σ(p − o)² / 3 per slice
  (uniform = 0.2222). 90-min and 45-min pools are kept separate — never pooled.
- `benchmark_map.json` tracks pending (unsettled) alerts.

## 6. The artifact (hosted, not in this package)

`hex-betting-game` is a private fullstack Muse artifact: UI + 22 server actions +
database. It cannot be exported as a file. `docs/FRONTEND_SPEC.md` documents
every action, the data model, and the flows for a rebuild. The artifact holds
all live state: balances, positions, settlement records, auth tokens. The Python
backend in this package is the data producer; the artifact is the state holder;
the browser UI is the presentation layer. The UI never talks to Census directly.

## 7. Cron jobs (all owned by goal `planetside-2-hex-betting-game`)

| Job | Schedule | What it does |
|---|---|---|
| `hex-betting-live-push` | every 5m | §2: live states + triple-checked settlement |
| `ps2polymarket-poller-watchdog` | adaptive 1m / 5m | §3: poller liveness + freshness |
| `cut-tracker-15m` | every 15m | §4: cut-event dataset collection |

## 8. Data layout (production)

```
ps2polymarket/
├── *.py / *.json / *.md   # code + models (this package's backend/)
├── data/
│   ├── map_snapshots/<world>/<zone>/<date>.jsonl
│   ├── census_events/<world>/<date>.jsonl
│   ├── player_stats/<date>.jsonl
│   ├── alerts/            # per-alert archives
│   ├── honu_snapshots/    # Honu cross-check data (assists, XP detail)
│   └── auth/              # challenge records + .token_secret (NEVER ship)
├── logs/                  # poller + tracker logs
├── live_states.json       # latest generator output
├── watchdog_state.json    # watchdog counters
├── cut_events.jsonl       # cut dataset
└── benchmark_predictions.jsonl  # benchmark log
```

On-disk history survives VM replacements; only the running processes die.
