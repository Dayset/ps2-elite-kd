# PS2MapOracle — Repeating / Migrating the Project

What you need to stand this project up again from this package, and what this
package deliberately does NOT contain.

## 1. Runtime requirements

- **Python 3.12** (developed and run on 3.12.3).
- **Standard library only** for the live pipeline (`map_poller.py`,
  `census_events.py`, `push_live_state.py`, `commander_live.py`,
  `validate_push_payload.py`, `cut_tracker_run.py`).
- **Third-party, one package:** `websockets` — used by `census_events.py`
  (imported lazily inside the connect function). Install with
  `pip install websockets`.
- **Third-party, analysis only:** `matplotlib` + `numpy` — used by backtest /
  plotting / research scripts (`backtest_phase2.py`, `accuracy_curve.py`,
  `base_resistance.py`, `margin_odds.py`, `plot_winlock.py`,
  `validate_hexmaps.py`). Not needed for live collection or pushing.
- A machine that stays up (or a watchdog equivalent): the pollers are
  long-lived processes. In production they run on a VM whose sandbox cell is
  replaced several times a day; the watchdog (§4 in `INFRASTRUCTURE.md`)
  relaunches them. Any supervisor (systemd, cron, a watchdog loop) works as
  long as it restarts dead pollers and checks data freshness, not just
  process liveness.

## 2. Census access

- **Census service ID — REQUIRED, placeholder here.** Get a free one at
  https://census.daybreakgames.com/#devSignup (approval usually within hours).
  This package contains NO real service ID: the code uses the public demo ID
  `s:example` (`map_poller.py`, `census_events.py`) or reads the
  `CENSUS_SERVICE_ID` environment variable (`auth_challenge.py`).
  - `s:example` is rate-limited (~10 queries/minute) and WILL break during
    roster fetches. Do not run production on it.
  - Set `CENSUS_SERVICE_ID` in the environment for every process that calls
    Census (pollers, auth). Never hardcode the ID in source.
- **Census endpoints used:**
  - REST Map API: `https://census.daybreakgames.com/s:<id>/get/ps2:v2/map/`
    (facility ownership snapshots).
  - REST Character API: `.../get/ps2:v2/character/` (roster validation,
    pre-alert stats).
  - WebSocket stream: `wss://push.planetside2.com/streaming?environment=ps2&service-id=<id>`
    (Death / FacilityControl / GainExperience / MetagameEvent / PlayerLogin /
    PlayerLogout).
- **API quota is the budget.** The 60s polling baseline and the WebSocket stream
  are designed to stay well inside a polite service ID's limits. Do not "fix"
  staleness by polling harder — see `CENSUS_ERRORS.md`.

## 3. Artifact setup (the part you cannot copy from this package)

The `hex-betting-game` artifact (UI + 22 server actions + database) is hosted
and CANNOT be exported. To repeat the project you must rebuild it:

1. Read `docs/FRONTEND_SPEC.md` — it documents every button, every action, the
   data model (§5), the `push_live` state contract (§4), and the flows (§6).
2. Implement a server with the 22 actions: `push_live`, `sync_live_alerts`,
   `push_replays`, `installreplaylibrary`, `placebet`, `settleposition`,
   `getdashboard`, `record_final_check`, `record_sudden_death_result`,
   `repair_alert_1_4_153`, `start_auth_challenge`, `accept_auth_challenge`,
   `check_auth_challenge`, `complete_auth`, `verify_auth_token`,
   `latest_auth_challenge`, `logout_auth_token`, `auth_stream_health`,
   `deleteallcharacters`, `cashbonuscheque`, `resetbankroll`,
   `resetbonuscheques`.
3. Implement the database tables from FRONTEND_SPEC §5 (accounts, challenges,
   alerts, ticks, bets, pools, bonus, replays).
4. Implement the UI per FRONTEND_SPEC §2 + §7 (percentages/base names/graphs,
   no PP, star ratings, "collapse pattern forming" vocabulary).
5. **Critical settlement semantics** (do not re-invent these):
   - Settlement records keyed by **(alertId, endedAt)** — bare alertId collides
     on recycled alert IDs (see `CHANGELOG.md` 2026-10-16).
   - Triple-check: payout held on checks 1–2, released only on check 3.
   - Never settle from a live push; never use a post-end snapshot.
   - Ties → 15-min kill-based sudden death.
6. Implement auth per `docs/AUTH_DESIGN.md` (logout-only). The packaged
   `backend/auth_challenge.py` still implements the SUPERSEDED suicide+logout
   flow — do NOT deploy it as-is; rewrite it to logout-only first.
7. The HMAC token secret must be generated at deploy time (32 random bytes,
   mode 0600, never committed, never shipped). The packaged code generates it
   into `data/.token_secret` on first run.

## 4. Cron / scheduled jobs to recreate

| Job | Schedule | Command / task |
|---|---|---|
| Live push | every 5m | `push_live_state.py` → validate → `push_live` per state → `record_final_check` per settlement → `getdashboard` read-back |
| Poller watchdog | adaptive 1m / 5m | Check liveness + freshness; restart dead pollers; notify once per incident at stale_streak 2 |
| Cut tracker | every 15m | `cut_tracker_run.py` (reads local snapshots only, no Census calls) |

Full job specs are in `INFRASTRUCTURE.md` §§2–4. Notification rules: silent on
success; one concise line only on stale-after-retry, script failure,
final-check rejection, or settlement pending beyond three passes.

## 5. Data to bootstrap

- **Models (in `backend/`)**: win trees (`winbins_growtree*.json`,
  `winbins_xtrunk.json`), capture models (`hossin_capture_model.json`), base
  resistance (`base_resistance*.json`), hex geometry + regions + links per
  continent. Copy as-is.
- **Benchmark**: `benchmark/benchmark_predictions.jsonl` + `benchmark_map.json`
  carry the running benchmark. You may start fresh (empty files + `{}` map) or
  continue from the packaged snapshot.
- **Cut dataset**: `backend/cut_events.jsonl` (428 events as packaged) +
  `cut_tracker_state.json` watermark. Continue or restart; the tracker is
  watermark-based and idempotent.
- **History**: the multi-GB `data/` history is NOT in this package and is NOT
  required to start. Fresh collection begins accumulating from first run.
  Backtests that need archive alerts (`fetch_alerts*.py`, `fetch_continents.py`)
  re-download from Census.

## 6. What is NOT included (and why)

- **Live DB state** — balances, open positions, settlement records, auth tokens,
  the HMAC token secret. Lives only in the hosted artifact / `data/auth/`.
  Cannot be exported; a fresh deployment starts with empty accounts.
- **Frontend export** — the artifact cannot be exported; FRONTEND_SPEC.md is
  the rebuild spec.
- **Raw alert history** — `data/` (map snapshots, Census events, player stats,
  alert archives). Multi-GB; excluded for size. Curated samples are in
  `backend/` (`benchmark_predictions.jsonl`, `cut_events.jsonl`,
  `live_states.json`).
- **Historical account snapshot** — `account_backup_2026-10-11.json` (bankroll +
  positions) excluded: it is account data, not code.
- **Logs / caches / lockfiles** — `logs/`, `__pycache__/`, `*.log`, `*.lock`,
  `*.sqlite*`, `roster_log.jsonl` (run log).
- **Secrets** — no `.env`, API keys, tokens, passwords, or real Census service
  IDs anywhere in this package (verified by grep before zipping — see below).

## 7. Verification performed on this package

- `unzip -l` listing checked: expected files present, excluded dirs absent.
- Grepped all packaged files for `service-id` (only `s:example` + env-var
  placeholder), `api[_-]?key`, `password`, `secret` (only the runtime-generated
  token-secret code path + HMAC signing code, no values), `token` (only
  `ps2oracle_token` field names + token-handling code, no values), and
  `daybreakgames.com/s:` (only `s:example` + `s:{service_id}` template).
- If you re-package or extend this zip, re-run the same grep before sharing.
