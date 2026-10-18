# PS2MapOracle

**A PlanetSide 2 prediction game: virtual points staked per map hex, plus a global stake on the alert winner.**

Live: Cloudflare Worker `ps2-oracle` + GitHub Pages `/oracle/` (see `CLOUDFLARE.md`; formerly a private Muse artifact) · Backend: Python/Census API · Status: active collection, not public

Package built **2026-10-18** from current source. This is the second migration package
(the first was `ps2maporacle.zip`, 2026-10-14). See `CHANGELOG.md` for what changed since.

---

## What it is

PS2MapOracle turns PlanetSide 2 continent alerts into a prediction market. Viewers bet virtual points on:

1. **Alert winner** — which faction (VS/NC/TR) wins the alert
2. **Second place** — a separate market that opens when one faction locks the win at 100%
3. **Per-hex stakes** (design) — which faction captures a given base and when

The pool is **parimutuel with no house cut**. Fees feed the winners' pot. Graded entries pay 5%/15%/30% at the 50%/80%/90% checkpoints, plus a 10% certainty kicker when model odds exceed 75%.

The product pairs an **optimal AI Commander** with viewer betting: the commander computes the mathematically best moves (attacks, defends, kingmaker plays), and the betting odds are the expert-read shortcut for new players. Design principle: *dummy-proof* — a new player with no map-reading skill can follow the percentages.

---

## How it works

### Live data pipeline
Since 2026-10-18 the live pipeline runs on Cloudflare: the `ps2-oracle` Worker polls Census REST every minute, stores live states and settlements in D1, the dashboard is served from GitHub Pages (`/oracle/`), and the commander runs in GitHub Actions. See [`CLOUDFLARE.md`](CLOUDFLARE.md) for the current architecture. The old VM pollers (`map_poller.py`, `census_events.py`) and the artifact push are historical (see `INFRASTRUCTURE.md`).

### Win probability model
- `commander_live.py` — the tree model: per-base win contributions, elimination math, kingmaker detection, war-shape classification (1v1 LOCKED / TWO-FRONT WAR / FREE AGENT)
- Star ratings (★–★★★★★) replace raw probabilities in the UI; the tree is the hidden engine
- Backtest verdict: raw tree is at/near the achievable ceiling (Brier 0.1501); calibration overlays are noise
- Separate 45-min and 90-min Brier pools; duration-normalized timestamps (`t_eff = t × 90 / duration`)

### AI Commander
- `hossin_elimination.py` (v2 core) — mathematical elimination, ranked EV attacks/defends, pop heuristics (WASTING POP / HEROIC EFFICIENCY / SPREAD THIN / OVERCONCENTRATED)
- Structural cut detection via articulation points (Tarjan DFS); cut opportunities sort first
- Collapse warnings: alert leader flagged at −5%/15min territory slide ("collapse pattern forming")
- Heat scores from flip recency (10-min window, linear decay)
- Defend EV re-ranked by base hold time (Hossin only, 2026-10-17): fast-turnover bases are perpetual flip-back targets
- UI rule: percentages, base names, graphs — no articles

### Settlement (triple-check)
1. Alert end → "settling…" hold
2. Final map snapshot verified at +0/+5/+10 min (three `record_final_check` calls, 5 min apart)
3. Payout released only after check 3 confirms
- Never settle from a live push; never use post-end snapshots (corrupt winner-owns-everything)
- Settlement records keyed by **(alertId, endedAt)** since 2026-10-16 — bare alertId keying collided on recycled alert IDs
- Ties (4.5% rate) → 15-min kill-based sudden death hold
- Second-place market settles parimutuel by final territory

### Auth
In-game character verification: enter name → Census validates → wait 5s → ACCEPT → 60s window → logout via ESC. HMAC token in localStorage, one active token per character. See `docs/AUTH_DESIGN.md`. Note: `backend/auth_challenge.py` + `backend/auth_test.py` still implement the **superseded** suicide+logout flow and are kept for history only.

---

## Repository layout

```
ps2maporacle/
├── README.md              # this file
├── CHANGELOG.md           # dated changelog (2026-10-03 → present)
├── INFRASTRUCTURE.md      # how the live pipeline + cron jobs work
├── REPEAT.md              # what is needed to repeat / migrate it
├── CENSUS_ERRORS.md       # Census API + PS2Alerts errors seen in practice
├── backend/               # Python backend (143 files)
│   ├── map_poller.py          # 60s Census map snapshots
│   ├── census_events.py       # WebSocket: deaths, flips, alerts
│   ├── commander_live.py      # win-probability tree + AI commander
│   ├── push_live_state.py     # 5-min artifact push generator
│   ├── *_hexmap.json          # continent hex geometry (5 continents)
│   ├── *_regions.json         # facility data per continent
│   ├── *_capture_model.json   # per-facility capture probabilities
│   ├── base_resistance*.json  # per-base median hold times (all 5 continents)
│   └── ...                    # models, backtests, research scripts
├── docs/                  # design notes and research (10 files)
│   ├── FRONTEND_SPEC.md       # artifact rebuild spec (22 actions, DB model)
│   ├── AUTH_DESIGN.md         # logout-only auth design (current)
│   ├── census_research.md
│   ├── game_theory_notes.md
│   └── DEBUTE_BOOK_v1.md
├── benchmark/             # Brier benchmark data + logger
│   ├── benchmark_predictions.jsonl
│   ├── benchmark_log.py
│   └── benchmark_map.json
└── goal/
    └── GOAL.md            # project goal statement
```

---

## Excluded (and why)

- **`data/` (multi-GB)** — live collection storage: raw map snapshots, Census event windows, player stats, alert history. Not needed for the codebase. Curated samples (`benchmark_predictions.jsonl`, `cut_events.jsonl`, `live_states.json`) are in `backend/` instead.
- **Frontend export** — the `hex-betting-game` artifact (fullstack: UI + 22 actions + DB) cannot be exported to a file; it runs privately in Muse. `docs/FRONTEND_SPEC.md` is the rebuild spec.
- **Live DB state** — balances, open positions, auth tokens, the HMAC token secret (`data/.token_secret`). Not exportable, not in this package. The historical `account_backup_2026-10-11.json` snapshot (bankroll + positions) is also excluded.
- **Logs, caches, lockfiles** — `logs/`, `__pycache__/`, `*.log`, `*.lock`, `*.sqlite*`, `roster_log.jsonl` (9MB run log).
- **Secrets** — no `.env`, API keys, tokens, passwords, or real Census service IDs in this package. Code uses the public demo ID `s:example` or the `CENSUS_SERVICE_ID` environment variable. See `REPEAT.md`.

## Key design decisions

- **Visibility is the king.** Probability dynamics on live charts, not raw numbers.
- **No PP anywhere.** All momentum displays use relative %, never percentage points.
- **Time-weighted pot shares:** 1.0 / 0.8 / 0.6 for t0–30 / t30–60 / t60–90 (from measured leader hit rates).
- **BonusCheques:** +5/hr auto top-up when broke (<20, capped at 20); +25 manual once/day.
- **Second-place market** opens at 100% lock; tree marginals renormalized between the pair.
- **Kingmaker lines** show resulting win% (now → then); −% lines are warnings.
- **API quota is the budget.** Background work stays cheap; 60s is the polling baseline.
- **Collect first, then measure.** No corrections invented before the data supports them.

## Benchmark

Brier challenge vs Auraxify alert predictor (peer), 100-alert target:
- PS2MapOracle: **0.150** · Auraxify: 0.177
- These are backtest/reference figures, not live results; for the current live pipeline and settlement see [`CLOUDFLARE.md`](CLOUDFLARE.md).
- Slices: t0 / t30 / t60 (90-min) · t0 / t15 / t30 (45-min), never pooled
- Live benchmark in `benchmark/benchmark_predictions.jsonl` (grows with each settled alert)

## Status / deferred / open

- Neutral-facility data-quality guard: still deferred (see `CENSUS_ERRORS.md` — third corrupt-input case reached a settlement on 2026-10-17; settlement-only guard decision pending).
- Per-slice territory baseline wiring into benchmark: decision pending (territory-share baseline alongside tree).
- Public hosting / Cloudflare KV-R2 migration: deferred.
- Auth proof (register → F5 → still authenticated): open.
- Esamir / Oshur map orientation: visual confirmation pending.
