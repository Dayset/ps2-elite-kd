# PS2MapOracle — Changelog

Dated project history. Entries are factual and dated; "decided" means the product owner
approved it, "shipped" means it is live in the running pipeline.

## 2026-10-03

- **Asset/bounty layer decided (v1, verifiable-only).** Bounties verifiable via API
  (captures/kills); player construction not in any API. Asset marketplace is P2P escrow:
  site holds points until the asset-holder deploys and verification releases them.

## 2026-10-04

- **Census research verified live** (`docs/census_research.md`): per-base population
  CONFIRMED DEAD (Map API = ownership only). WebSocket events are the live source
  (`Death` → KD/KPM, `FacilityControl` → flips, `MetagameEvent` → alert start/end).
  Character REST stats are STALE (update on logout) — pre-alert roster only.
- **AI Commander v2 core** (`hossin_elimination.py`): mathematical elimination,
  kingmaker detection, war-shape, ranked EV attacks/defends, pop heuristics.

## 2026-10-09

- **Second-place flow live.** When a faction hits 100% win, winner betting closes and
  the two remaining sides get their own market (tree marginals renormalized between
  the pair, elimination check on head-to-head gap, same fees, parimutuel settlement
  by final territory).

## 2026-10-10

- **Locked-winner rule (directive).** Attacks targeting a 100%-locked winner get
  priority 0 — unless p_cap >= 0.9 (free base still worth taking). Defends vs the
  locked winner keep priority.

## 2026-10-11

- **Live mode.** The owner is the only real bettor; NC/TR/VS crowd volumes filling
  parimutuel pools are simulated, odds/fees/payout math runs for real.
- **Star ratings** (★–★★★★★) replace tree level names for confidence in the UI.
- **Heat scores** (commander): 0–100 per base from flip recency (10-min window,
  linear decay; direct flip = 100, adjacent = 40). Hot bases show 🔥 at 40+.
- **Commander rework:** leader collapse warning at −5%/15min territory slide;
  priority is ABSOLUTE = win% at stake / 10; bridge attacks reconnecting a severed
  pocket sort first with priority ≥ 70.
- **Time-weighted pot shares approved:** 1.0 / 0.8 / 0.6 for t0–30 / t30–60 / t60–90.
- **BonusCheques approved:** AUTO +5/hr while balance < 20 (capped at 20);
  MANUAL +25 once per UTC day.
- **Map orientations:** Indar confirmed perfect by visual check (180° total rotation).
  Esamir rotated 90° CCW, shipped cache-busted (visual check still pending).
- **PP removed entirely** from all momentum displays (relative % only).

## 2026-10-12

- **t-rescale shipped.** Win-tree timestamps duration-normalized:
  `t_eff = t × 90 / duration`. Backtest: Hossin Brier 0.16022 → rescaled 0.12515;
  Indar 0.15762 → 0.12310. Applies to 45-min Meltdown and 30-min alerts; the
  elimination override still uses real t with duration-aware max swing.
- **Cut doctrine.** Structural cuts via articulation points (Tarjan DFS,
  `find_cut_points`); cut opportunities sort first in attacks; bases whose supply
  line runs through a threatened chokepoint get `freezing: true` 🥶; severed bases
  show 🥶 instead of 🔥, heat suppressed to 0. Cuts do NOT affect tree logic —
  commander ranking layer only.
- **Per-character logging.** All characters with 5+ kills logged (char_id, faction,
  kills, deaths, KD, KPM, mins_observed). Two-tier outlier flags: early (KD ≥ 5
  AND KPM ≥ 2) ⚠️, confirmed (KD ≥ 5 AND KPM ≥ 3) ⚠️☠️⚠️.
- **Auth logout-only redesign agreed** (`docs/AUTH_DESIGN.md`): enter name → 5s wait
  → ACCEPT → 60s window → ESC/logout, no suicide. Token: HMAC-signed, no expiry,
  one active per character, `ps2oracle_token` in localStorage. No PC fingerprinting.
- **Settlement-instance collision fix PREPARED, not applied.** Recycled alert IDs
  (same world-zone-event_id reused across days) meant a new alert's settlement
  could be absorbed by an older settlement under the same bare alertId.
- **Cloudflare KV/R2 migration considered** ("a bit later"); storage migration is
  prerequisite. No timeline set.

## 2026-10-13

- **Neutral-facility corruption, case 1.** World 1 (Osprey) Hossin: 54/88 facilities faction 0
  (neutral), approx 14:27–15:12 UTC. Production unpatched; neutral-facility hold
  DEFERRED ("keep collecting").
- **Settlement collision, case 1.** World 1 (Osprey) Hossin 1-4-177 (Oct 13/14 instance reuse).

## 2026-10-14

- **Settlement collision, case 2.** World 10 (Wainwright) Esamir 10-8-150 (ended 14:45 UTC, pre-end
  NC 96.1): settlement swallowed by the older instance; alert dropped unsettled,
  payout not released.
- **Settlement collision, case 3.** World 10 (Wainwright) Indar 10-2-147: stale winner (VS, from
  Oct 13) contradicted today's winner (TR). Dashboard showed the wrong winner.
  Fix decision taken the same day.
- **First migration package** (`ps2maporacle.zip`, 156 files, 2026-10-14).
- **Dumb-baseline backtest delivered.** Same out-of-sample set as backtest_phase2:
  tree Brier 0.1488, coin flip 0.2222 (33% edge), territory-share 0.1842 (19% edge),
  bet-the-leader 0.2372 (worse than random). Tree's advantage is calibration, not
  winner-picking. Per-slice territory baseline wiring into `benchmark_log.py`
  proposed — decision PENDING.

## 2026-10-15

- **Neutral-facility corruption, case 2 — commander contradiction.** World 1 (Osprey) Esamir
  1-8-186: 31/51 facilities neutral (61%) from ~20:30Z through 21:25Z, territory
  summing to 39.2%. Header said VS 100 / NC 0 / TR 0 with "NC eliminated"; commander
  said NC 100%. Root cause: header applies the elimination override + leader-100
  fallback; commander `win_pct` is the raw joint tree with elimination only as a
  flag. Validator checks ranges/enums only — no territory-sum or header↔commander
  consistency check. Settlement NOT corrupted (today's instance settled VS, matching
  post-recovery reality). Three fixes offered (input guard / commander elimination
  override / validator safety net) — decision PENDING.
- **Session-stats / outlier-guard / check-legends data gates** noted as known
  live-data failures in the sibling ps2-elite-kd suite (not this package).

## 2026-10-16

- **Settlement fix SHIPPED.** Settlement records keyed by **(alertId, endedAt)**
  instead of bare alertId (artifact migration 0015; all 29 existing
  `settlement_verification` rows preserved through re-keying). Generator already
  sent `endedAt`; the fix was entirely in the artifact action. Sudden-death action,
  1-4-153 repair action, and dashboard verification lookup adjusted to the same
  instance keying.
- **Re-settle 10-2-148 as NC (triple-check, production).** Today's world 10 (Wainwright) Indar
  instance (ended 2026-10-16T17:52:40Z, pre-end NC 51.7 / TR 28.1 / VS 20.2) had
  been absorbed by the Oct 12 TR settlement. After the fix: check 1/3, 2/3, 3/3 →
  settled NC, runner-up TR, payoutDelta 0 (nobody had money on the alert; wrong
  record, not lost payout). Oct 12 record preserved as TR (verified via migration
  audit + benchmark, which holds Oct 12 → TR and today → NC independently).
- **Pop patch SHIPPED.** Per-zone `active_players` was never set by the writer
  (only at world level), so live pop read 0/0/0 and `win_popadj` was dead code.
  Reader now falls back to `len(per-zone players ID list)`. Caveat: the writer caps
  that list at 150 IDs, so the fallback undercounts above 150. Verified live:
  World 1 (Osprey) Esamir pop VS 48 / NC 76 / TR 98.
- **Settlement collision averted (new instance).** World 10 (Wainwright) Esamir 10-8-150 ran again
  as a new instance; with the fix live, its settlement keys by (alertId, endedAt).

## 2026-10-17

- **Outlier-log char_id fix SHIPPED.** `census_events.py` `snapshot()` dropped the
  `char_id` that `flag_outliers()` had computed, forcing manual joins. One-line fix:
  outlier rows now carry `char_id` as first key. No new identity collection —
  `player_stats` already logs `char_id`. Confirmed by code + compile; a live
  `char_id`-carrying outlier row in production output was still pending at ship time.
- **Defend-EV hold-time re-rank SHIPPED** (overriding the display-only
  recommendation). `commander_live.py` defend EV now multiplied by
  `hold_factor = ref_median_hold / base_median_hold` (ref = median of 85 Hossin
  bases ≈ 23.0 min; GLASS up to ~2.1x, STRONGHOLD down to ~0.61x). Hossin only;
  other continents factor 1.0. Priority untouched (win_drop-based, not EV-based)
  — only defend order/top-3 re-ranks. Defend rows also carry `hold_factor` +
  `resistance` class + `median_hold_min`. Mechanism: a coordinated outfit answers
  a flip in ~a minute, randoms cannot; a freshly flipped base is a juicy
  flip-back target. Caveat: hold time is an inter-flip gap, not a measured capture
  duration. Scope: commander UI only — odds, benchmark, and settlement are
  unaffected (they never read commander EV).
- **Base resistance computed for all 5 continents** (`base_resistance_{amerish,
  esamir,hossin,indar,oshur}.json` in `backend/`). Commander wires Hossin only;
  other continents degrade gracefully (factor 1.0).
- **Neutral-facility corruption, case 3 — first to reach a settlement.** World 1 (Osprey)
  Oshur 1-344-248 (ended 2026-10-17T19:19:23Z): final pre-end snapshot summed to
  54.7% (VS 16.0 / NC 22.7 / TR 16.0), neutral locked at the same 34-facility set
  from 18:43Z through the last pre-end snapshot. Triple-check cannot catch this —
  all three checks re-read the same corrupt feed. Winner NC corroborated (only
  faction gaining in the owned subset; benchmark settled NC). Decision PENDING:
  (A) hold this settlement for manual verification, (B) ship a settlement-only
  neutral guard (hold settlement when the final pre-end snapshot sums below ~90%),
  (C) leave the record and tag it corrupt-input.
- **Oshur settlement / base-resistance decisions.** The Oshur options above and the
  Oct 15 commander-contradiction fixes (A/B/C) remain pending. The Oct 14 baseline
  wiring decision (Yes / Not yet) remains pending.
- **Second migration package** (this zip, `ps2maporacle-2026-10-18.zip`).

## Known caveats carried in this package

- `backend/auth_challenge.py` + `backend/auth_test.py` still implement the SUPERSEDED
  suicide+logout auth flow. The agreed design is logout-only
  (`docs/AUTH_DESIGN.md`). The packaged Python auth has NOT been rewritten to
  logout-only; the rewrite is open work.
- `docs/FRONTEND_SPEC.md` DB tables / some action descriptions are reconstruction
  guidance, not exported source. The artifact server itself cannot be exported.
- `deleteallcharacters` and `repair_alert_1_4_153` internals were not fully
  inspected — do not describe them as exact.
- Benchmark numbers in `README.md` (0.150 vs 0.177) are the 100-alert challenge
  reference values; the live `benchmark/benchmark_predictions.jsonl` keeps growing
  past the challenge set.

## 2026-10-18 (GitHub, not yet in the running pipeline)

- **Server IDs corrected.** Census `/world` today: 1 Osprey, 10 Wainwright, 19 Jaeger
  (private events server), 25 Briggs, 40 SolTech. The live pipeline tracked
  [1, 10, 19, 25] wrongly labelled with the pre-merge names Connery/Miller/Emerald/Cobalt; the "Emerald events gap"
  was Jaeger being empty and SolTech was never tracked. Now [1, 10, 25, 40] in
  `map_poller.py`, `census_events.py`, `push_live_state.py`. Older docs that used the wrong pre-merge names Connery/Miller/Emerald/Cobalt
  mean worlds 1/10/19/25.
- **Service ID from `CENSUS_SERVICE_ID`, default `daysetps2legends`** in both pollers
  (was the throttled demo ID `s:example`).
- **Stream half-open fix.** `census_events.py` reconnects after 120s with no message
  at all (Census heartbeats every ~30s) instead of waiting on `recv()` forever; this
  is the "no close frame, then silence" freeze.
- **Migrated to Cloudflare + GitHub Pages** (see `CLOUDFLARE.md`): `ps2-oracle` Worker
  polls Census REST every minute into D1, computes odds with a JS port of the engine
  (parity-tested against Python), settles from Census final scores with sudden death
  for draws, serves `/oracle/` on GitHub Pages; the commander runs in Actions.
  Betting/auth remain in the Muse artifact for now.

## 2026-10-18 (later): betting renamed to voting

- **Owner decision: it's voting, not betting.** All user-facing text, the API
  (`/vote/quote|me|place|bonus|leaderboard`, body `{key, outcome, amount, seen_pct}`),
  the Worker module (`vote.js`), the D1 table (`vote`, was the empty `bet`) and the
  frontend panel (`js/vote.js`, `#voteSlot`) now say vote. Older entries above keep the
  wording of their time.
- **BonusCheques are a meme currency**: no cash value, never bought, sold, traded or
  cashed out, nothing paid out in any form. Every voting card carries this disclaimer
  and the fair-play rules: voting exists to get people playing, own-faction votes
  only, sign-in by in-game logout, riggers and cheaters not welcome.
- Voided votes (draw, canceled, unresolved, corrupt map) give back the full amount,
  fee included.

## 2026-10-18 (evening): Meltdowns read on the live zone

- **Finding:** Census Meltdown final scores add up to ~31–57 % because most of the
  continent is locked (neutral) during a Meltdown; the winner holds most of the
  live zone. The engine had been reading whole-map territory, out of the range the
  tree was grown on, and the old pipeline made 0 %/100 % calls at minute 30 on 17 of
  22 Meltdowns (Brier 0.241 vs Auraxify's 0.151 on shared alerts).
- **Shipped (Worker):** live-zone shares, momentum, elimination and commander for
  Meltdowns; odds pulled 60 % toward even (eliminated factions stay 0); no false
  broken-map flag or vote voiding on Meltdowns; `_raw`/`_v0` bench slices for a
  live re-fit. Territory alerts unchanged; Python parity untouched.

- **Time-aware notes:** with under 15 min left, per-15-min warnings ("collapse pattern
  forming … /15min") are replaced by what the trend means before the end, shown only
  when it can change the winner or a place ("VS fading: at this pace drops to 3rd
  before the end (5 min left)", "NC slipping but holds the lead …"). New comeback
  note at any time: "TR closing in: takes the lead in about 5 min at this pace".
