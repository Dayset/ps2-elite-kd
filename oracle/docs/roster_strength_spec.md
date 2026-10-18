# Roster Strength — feature spec (draft 2026-10-11)

## Problem
The win-probability oracle (per-continent grow-trees on time/territory/momentum)
is blind to WHO is online. An alert where one faction fields three elite
outfits looks identical to a casual zerg at the same territory split. Roster
strength is the largest known missing signal; the tree is at/near its ceiling
on position features (Phase 1/2 backtests, 2026-10-10/11: ship nothing).

## Constraint
We do NOT have historical per-player KD (Death-event stream started recently;
historical alerts carry facility flips only). So: spec now, log per alert going
forward, validate in ~1 month of data. No backtest possible today — do not
ship on vibes.

---

## 1. Source comparison

| Source | Skill metrics | Roster (who's online) | Freshness | Auth | Rate limit | Verdict |
|---|---|---|---|---|---|---|
| **Honu** `wt.honu.pw` | Lifetime weapon stats per character: `weapon_kills`, `weapon_deaths`, `weapon_fire_count`, `weapon_hit_count`, `weapon_headshots`, `weapon_play_time` (all `valueForever`) via `/api/character/{id}/stats`; pairwise `/killboard` (cap 200) | **`/api/session/history/{epoch}?worldID=` returns ALL PC sessions online at a time** (ExpandedSession = session + PsCharacter incl. faction) — one call per alert = full roster | Sessions realtime (Honu's own Census stream); stats lifetime (Census-stale, fine for skill proxy) | None (public JSON) | **60 req/min/IP + 10 concurrent** on `/api` (from source, Startup.cs); 429 → `{"error":"too many requests!"}`; some endpoints (`honu-data`) rate-limit-exempt | **Primary source** |
| **Census** (baseline) | `character` collection lifetime stats (stale: update on logout) | None directly (no online roster) | Stats stale; WS stream realtime (we run our own) | Service ID (free); `s:example` 10/min | Generous with service ID | Fallback for skill; WS already ours |
| **FISU** `ps2.fisu.pw` | None documented (player/killboard pages are HTML) | `/api/population/?world={id}` → `{"result":[{"worldId","timestamp","vs","nc","tr","ns","unknown"}]}` — **verified live 2026-10-11** | Realtime | None | Unknown; light use advised | Aggregate pop cross-check only, not skill |
| **Auraxify** `ps2.auraxify.com` | None | None per-player | — | — | — | **Not useful.** `faction-focus.html` is 5-min buckets of kills *suffered* per faction per server (30d) — aggregate faction-level, JS-rendered, no documented public API. `stream.html` is a Census WS proxy; we already run our own stream, so additive value is zero. Do not scrape; nothing to borrow. |

### Exact Honu endpoints (verified: source code + our working stat script)
- `GET https://wt.honu.pw/api/session/history/{unix_epoch}?worldID={1,10,19,25}`
  → `{"data":[{"session":{...},"character":{...PsCharacter...}}]}` — every PC
  character with a session overlapping that minute on that world. **The roster
  endpoint: one call per alert.**
- `GET https://wt.honu.pw/api/character/{id}/stats`
  → `[{"statName":"weapon_kills","valueForever":"1234",...}]` — lifetime skill.
- `GET https://wt.honu.pw/api/character/{id}` — meta (name, faction, outfit,
  world, BR). `GET /api/character/many?IDs=` — batch version.
- `GET https://wt.honu.pw/api/character/{id}/killboard` — pairwise killboard,
  hard cap 200 rows.
- `GET /api/character/{id}/honu-data`, `/api/character/many/honu-data` —
  TrackedPlayer in-memory data, **rate-limit-exempt** (`[DisableRateLimiting]`).
- Response envelope: `{"data": ...}` on 200, 204 when missing.

### Standing Honu etiquette (from alignment record — non-negotiable)
One sessions-list call per character; no scripted page scraping; never buy
speed by hitting Honu harder — local compute (caching) is the lever. The design
below respects this: exactly **1 Honu call per alert** for the roster, plus
cache-miss stat fills only, against a persistent 7-day-TTL local skill cache.

---

## 2. Recommendation

- **(a) Pre-alert roster scoring: Honu.** `/api/session/history` at alert start
  (1 call), then per-character skill from a persistent local cache
  (`~/workspace/ps2polymarket/roster_skill_cache.sqlite`, 7-day TTL, keyed by
  character ID); misses filled in background from `/api/character/{id}/stats`
  (≤60/min budget, never blocking the push). Census character stats as
  fallback if Honu is down.
- **(b) Live in-alert updates: our own Death-event stream** (already running in
  `census_events.py`; per-faction KD/KPM already in `push_live_state.py`).
  No external source needed. FISU `/api/population/` optional cross-check for
  the active-fighter proxy, not skill.

## 3. Feature design

### Per-faction features (computed at alert start, refreshed every 5 min)
Roster = character IDs from Honu history (t=0) ∪ Death-stream attackers
(rolling; catches late joiners). Skill per character from cache (lifetime
stats); unknown/new characters get the population prior (K/D 1.0, KPM 0.5).

1. `roster_kd` — playtime-weighted mean lifetime K/D
   (`weapon_kills/weapon_deaths`; weight = `weapon_play_time`).
2. `elite_share` — fraction of roster with lifetime K/D ≥ 2.0.
3. `outfit_conc` — Herfindahl index of outfit membership
   (Σ share²; high = one stacked outfit = coordination signal).
4. `roster_kpm` — playtime-weighted mean `weapon_kills/(weapon_play_time/60)`.
5. `live_kd` — faction KD from our Death stream (already collected; currently
   displayed but not used by the tree).

All five are cheap: one Honu call per alert + cache reads + stream aggregates
we already compute.

### Pipeline plug-in (two phases)
- **Phase 1 — log only (start now).** `push_live_state.py` gains a
  `roster_snapshot(alert_key, t)` that writes the five features per faction
  into the per-alert log (see §5). Commander may *display* `live_kd` momentum
  as an informational call (no odds impact). No model change.
- **Phase 2 — validate, then maybe ship (~1 month).** Train a post-tree
  adjustment (logistic on the five features, per faction) on the first 70% of
  logged alerts (time split), test on the last 30%.
- **Ship bar:** out-of-sample Brier improvement **≥ 0.0015** vs raw tree on
  the held-out split **and** directionally consistent across ≥2 continents.
  Else keep logging, do not ship. (Same evidentiary bar as the Phase 1/2
  backtests that rejected star-shrinkage, Platt, isotonic, and base-rate
  shrinkage.)
- **Do not** rebuild the grow-trees with roster features until the post-tree
  adjustment proves signal — tree rebuilds are expensive and the adjustment
  is the cheap test.

### Why this shape
- One Honu call per alert keeps us inside etiquette and rate limits.
- Cache-first skill lookup means the feature is available at t=0 even for
  300-player alerts (full live pull would take ~5 min at 60 req/min).
- Post-tree adjustment (not tree rebuild) isolates the new signal for a clean
  ablation: tree-only Brier vs tree+roster Brier.

## 4. Validation plan
1. Accumulate ≥200 alerts with complete roster logs (~1 month at current
   alert cadence across worlds 1/10/19/25).
2. Time-split 70/30. Fit logistic adjustment on train; score Brier on test.
3. Ablations: tree-only; tree+`live_kd`; tree+all five. Report all three.
4. Decision rule (§3 ship bar). If shipped, re-validate monthly — roster
   meta drifts (outfits move servers), and the Phase 2 backtest showed
   calibration doesn't transfer across time periods.

## 5. What to start logging NOW (minimal, cheap)
Append one JSON line per alert per 5-min tick to
`~/workspace/ps2polymarket/roster_log.jsonl`:
```json
{
  "alert": "10-4-12345", "t": 30, "ts": 1791700000,
  "VS": {"n": 87, "roster_kd": 1.24, "elite_share": 0.11,
          "outfit_conc": 0.18, "roster_kpm": 0.9, "live_kd": 1.05,
          "char_ids": ["5428...", "..."]},
  "NC": {...}, "TR": {...},
  "final": {"VS": 34.1, "NC": 39.8, "TR": 26.1, "winner": "NC"}
}
```
- `n`, `char_ids`: from Honu `/api/session/history` at t=0, then Death-stream
  attackers joined in per tick (cap stored IDs at 500/faction; IDs are enough
  to re-derive skill later from cache).
- Skill features: computed from the local cache at log time; cache misses
  logged as `"skill_cached": false` and backfilled by the background filler.
- `final`: written when the alert settles (territory + winner).
- Cost per tick: 0 external calls (all local). Cost per alert: 1 Honu call.

## 6. Open questions (do not block Phase 1)
- NSO characters: assign faction by observed allegiance (Death-stream
  team_id), else drop from roster features.
- Cross-faction alts: lifetime stats follow the character, not the player —
  accepted noise; outfit_conc partially captures stacked groups anyway.
- Does play-money-vs-real effort change anything? Not applicable — skill
  features are effort-agnostic.
- Honu session coverage: if Honu's stream misses a world, fall back to
  Death-stream-only roster (character IDs from kills/deaths).
