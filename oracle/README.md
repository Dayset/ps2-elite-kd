# PS2MapOracle

**A PlanetSide 2 prediction game: virtual points staked per map hex, plus a global stake on the alert winner.**

Live: private Muse artifact (`hex-betting-game`) · Backend: Python/Census API · Status: active collection, not public

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

### Live data pipeline (60s baseline)
- `map_poller.py` — Census facility-ownership snapshots every 60s, all servers/continents
- `census_events.py` — WebSocket stream: Death events → faction KD/KPM, FacilityControl → base flips, MetagameEvent → alert start/end
- Population is proxied by active fighters (Census has no population endpoint)
- Per-character logging: all characters with 5+ kills (KD, KPM, outlier flags ⚠️/☠️)

### Win probability model
- `commander_live.py` — the tree model: per-base win contributions, elimination math, kingmaker detection, war-shape classification (1v1 LOCKED / TWO-FRONT WAR / FREE AGENT)
- Star ratings (★–★★★★★) replace raw probabilities in the UI; the tree is the hidden engine
- Backtest verdict: raw tree is at/near the achievable ceiling (Brier 0.1501); calibration overlays are noise
- Separate 45-min and 90-min Brier pools; duration-normalized timestamps

### AI Commander
- `hossin_elimination.py` (v2 core) — mathematical elimination, ranked EV attacks/defends, pop heuristics (WASTING POP / HEROIC EFFICIENCY / SPREAD THIN / OVERCONCENTRATED)
- Structural cut detection via articulation points (Tarjan DFS); cut opportunities sort first
- Collapse warnings: alert leader flagged at −5%/15min territory slide
- Heat scores from flip recency (10-min window, linear decay)
- UI rule: percentages, base names, graphs — no articles

### Settlement (triple-check)
1. Alert end → "settling…" hold
2. Final map snapshot verified at +0/+5/+10 min
3. Payout released only after check 3 confirms
- Never settle from a live push; never use post-end snapshots (corrupt winner-owns-everything)
- Ties (4.5% rate) → 15-min kill-based sudden death hold
- Second-place market settles parimutuel by final territory

### Auth
In-game character verification: enter name → Census validates → ACCEPT → 60s window → logout via ESC. HMAC token in localStorage, one active token per character.

---

## Repository layout

```
ps2maporacle/
├── README.md              # this file
├── backend/               # Python backend (138 files)
│   ├── map_poller.py          # 60s Census map snapshots
│   ├── census_events.py       # WebSocket: deaths, flips, alerts
│   ├── commander_live.py      # win-probability tree + AI commander
│   ├── push_live_state.py     # 5-min artifact push generator
│   ├── *_hexmap.json          # continent hex geometry (5 continents)
│   ├── *_regions.json         # facility data per continent
│   └── ...                    # models, backtests, research scripts
├── docs/                  # design notes and research (8 files)
│   ├── census_research.md
│   ├── game_theory_notes.md
│   └── DEBUTE_BOOK_v1.md
├── benchmark/             # 100-alert Brier challenge data
│   ├── benchmark_predictions.jsonl
│   ├── benchmark_log.py
│   └── benchmark_map.json
└── goal/
    └── GOAL.md            # project goal statement
```

**Excluded:** `data/` (2.6GB alerts history, map snapshots, census events, player stats) — live collection storage, not needed for the codebase. The frontend artifact (`hex-betting-game`, fullstack) cannot be exported to a file; it runs privately in Muse.

---

## Key design decisions

- **Visibility is the king.** Probability dynamics on live charts, not raw numbers.
- **No PP anywhere.** All momentum displays use relative %, never percentage points.
- **Time-weighted pot shares:** 1.0 / 0.8 / 0.6 for t0–30 / t30–60 / t60–90 (from measured leader hit rates).
- **BonusCheques:** +5/hr auto top-up when broke (<20, capped at 20); +25 manual once/day.
- **Second-place market** opens at 100% lock; tree marginals renormalized between the pair.
- **Kingmaker lines** show resulting win% (now → then); −% lines are warnings.
- **API quota is the budget.** Background work stays cheap; 60s is the polling baseline.

## Benchmark

100-alert Brier challenge vs Auraxify alert predictor (peer):
- PS2MapOracle: **0.150** · Auraxify: 0.177
- Slices: t0 / t30 / t60 (90-min) · t0 / t15 / t30 (45-min), never pooled

## Status / deferred

- Settlement instance-ID collision fix: prepared, not applied (awaiting decision)
- Neutral-facility data-quality guard: prepared, not applied
- Public hosting / Cloudflare KV-R2 migration: deferred
- Auth proof (register → F5 → still authenticated): open
