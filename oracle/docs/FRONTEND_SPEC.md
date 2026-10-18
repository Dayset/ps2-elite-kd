# PS2MapOracle — Frontend Rebuild Spec

How to recreate the `hex-betting-game` artifact from scratch. This documents every
button, every server action, the data model, and the flows between them.

---

## 1. Architecture

```
┌─────────────────┐     push_live (5 min)      ┌──────────────────┐
│ Python backend  │ ─────────────────────────▶ │  Artifact server │
│ (this zip)      │                            │  (22 actions +   │
└─────────────────┘                            │   database)      │
                                               └────────┬─────────┘
                                                        │ getdashboard
                                                        ▼
                                               ┌──────────────────┐
                                               │  Browser UI      │
                                               │  (map, charts,   │
                                               │   betting, auth) │
                                               └──────────────────┘
```

The Python backend (`backend/`) is the data producer. The artifact server is the
state holder. The browser UI is the presentation layer. The UI never talks to
Census directly — everything flows through the artifact's actions.

**To recreate:** you need (a) a web frontend, (b) an API server implementing the
22 actions below, (c) a database with the tables in §5, (d) the Python backend
from this zip pushing via `push_live`.

---

## 2. UI Layout (top to bottom)

### 2a. Header
- Title "PS2MapOracle", live clock, connection status dot.
- Bankroll display: current points balance (from `getdashboard`).

### 2b. Alert map (main)
- Hex-grid continent map (SVG or canvas). One map per active alert.
- Each hex colored by owning faction (VS purple / NC blue / TR red).
- Hot bases (heat ≥ 40): 🔥 + heat number under the hex.
- Severed bases: 🥶 instead of 🔥, heat suppressed to 0.
- Warpgate labels rendered outside the map edge.
- Lattice link lines between connected bases (thin, subtle).
- Click a hex → base detail popup (name, owner, heat, commander EV if listed).

### 2c. Win-chance panel
- Three percentages: VS / NC / TR win probability (from `win.*.pct`).
- Star rating ★–★★★★★ derived from probability (display only; tree is hidden).
- Leader badge + collapse warning ("collapse pattern forming") when the leader
  slides ≥5% territory per 15 min.
- Second-place market section (appears when one faction hits 100%):
  two remaining factions with renormalized odds, locked flag, basis label.

### 2d. Win-chance history chart
- Line chart: VS/NC/TR win % over alert time (built from `push_live` tick history).
- Dashed overlay: active-fighter population share per faction ("Active fighters (proxy)").
- Live mode: grows with each 5-min push (up to ~5 min behind real time).
- Replay mode: full history with scrubber.

### 2e. AI Commander panel
Per faction, two ranked lists:
- **Defend:** base name, `vs` attacker, `win_drop` (win% at stake), `priority` 0–100, `heat`, `ev`.
- **Attack:** base name, `target` faction, `win_gain`, `margin_gain`, `priority`, `heat`, `ev`, `pred_heat`.
- **Kingmaker lines:** text + `my_swing`; "+X%" is opportunity, "−X%" is threat/warning.
- War-shape badge: `1v1 LOCKED` / `TWO-FRONT WAR` / `FREE AGENT`.
- Collapse warnings inline on defend rows for the leader.

### 2f. Betting panel
- Market tabs: **Winner** | **Second place** (second tab only when open).
- Faction buttons (VS/NC/TR) with current odds %.
- Stake buttons: **25 / 50 / 100 / 200** (fixed amounts only).
- Place Bet button → `placebet`.
- Fee display: fee-by-odds curve + time-weighted share note (1.0/0.8/0.6).
- Simulated crowd volumes fill the pools (Dayset is the only real bettor).

### 2g. History panel (below bankroll)
- Every vote, newest first: stake, odds at placement, payout, fee, per-vote P&L.
- Totals row + cumulative profit graph.
- "Settle" per alert → `settleposition` (or auto on final check 3/3).
- Corrected-settlement tag: rows can show `WON · corrected` / `LOST · corrected`.
- Reset bankroll: double-tap confirm → `resetbankroll`.

### 2h. BonusCheques
- AUTO: +5/hr while balance < 20, capped at 20 (server-side tick).
- MANUAL "Cash BonusCheque" button: +25 once per UTC day → `cashbonuscheque`.

### 2i. Auth footer
- Character name input + Register button → `start_auth_challenge`.
- Popup: instructions + big ACCEPT button (5s wait before ACCEPT) → `accept_auth_challenge`.
- 60s window: user logs out of PS2 via ESC → `check_auth_challenge` polls →
  `complete_auth` returns HMAC token → stored as `ps2oracle_token` in localStorage.
- Token sent with every authenticated action. One active token per character;
  new verification revokes the old.

### 2j. Replay simulator
- Alert picker (from `installreplaylibrary` / `push_replays`).
- Scrubber + play button; probability overlay renders from tick data.
- Bets in replay mode use `mode: "replay"` (segregated from live bankroll).

---

## 3. Server actions (all 22)

### Live data ingest
| Action | Input | What it does |
|---|---|---|
| `push_live` | `{state}` — full alert state (schema §4) | Upserts the live alert; appends win-% to history; updates map owners, commander, second-place market. Called every 5 min by the Python backend. Validates strictly (see AGENTS.md paste rules). |
| `sync_live_alerts` | `{active_alert_ids[]}` | Prunes alerts no longer active. |
| `push_replays` | `{library: {alerts[]}}` | Stores replay tick bundles for the simulator. |
| `installreplaylibrary` | `{}` | Seeds the built-in replay set. |

### Betting
| Action | Input | What it does |
|---|---|---|
| `placebet` | `{token, mode, alertId, market, faction, amount, t, progressPct, win}` — amount ∈ {25,50,100,200}, market ∈ {winner, second} | Validates token + market open, deducts stake, records vote with odds snapshot + fee. |
| `settleposition` | `{token, mode, alertId}` | Pays out settled positions for one alert to bankroll. |
| `getdashboard` | `{token?}` | Returns everything the UI renders: bankroll, live alerts, history, bonus state. |

### Settlement
| Action | Input | What it does |
|---|---|---|
| `record_final_check` | `{alertId, endedAt, snapshotAt, territory}` | Triple-check settlement. Settlement records keyed by (alertId, endedAt) since 2026-10-16 (migration 0015); bare-alertId keying caused recycled-ID collisions. | Holds payout on checks 1/3 and 2/3; releases on 3/3. Accepts a closer pre-end snapshot; logs winner disagreement. Never settles from a live push. |
| `record_sudden_death_result` | `{token, alertId, winner, runnerUp?}` | Records 15-min kill-overtime outcome for tied alerts (4.5% of alerts). |
| `repair_alert_1_4_153` | — | One-off correction for a mis-settled alert (kept for audit). |

### Auth (in-game proof)
| Action | Input | What it does |
|---|---|---|
| `start_auth_challenge` | `{name}` (1–64 chars) | Validates character via Census, creates challenge UUID, returns popup instructions. |
| `accept_auth_challenge` | `{challenge_id}` | Starts the 60s window (5s wait before ACCEPT, anti-squatter). |
| `check_auth_challenge` | `{challenge_id}` | Polls whether the logout was observed on the Census stream. |
| `complete_auth` | `{challenge_id, replace_token?}` | Issues HMAC token, revokes prior token for the character. |
| `verify_auth_token` | `{token}` | Returns character identity for a token. |
| `latest_auth_challenge` | `{character_id}` | Returns the newest challenge for resume. |
| `logout_auth_token` | `{token}` | Revokes the token. |
| `auth_stream_health` | `{}` | Reports whether the Census event stream is alive. |
| `deleteallcharacters` | — | Wipes character/auth records (admin). |

### Economy
| Action | Input | What it does |
|---|---|---|
| `cashbonuscheque` | `{token?}` | +25 once per UTC day (manual). |
| `resetbankroll` | `{token?}` | Resets balance (double-confirm in UI). |
| `resetbonuscheques` | `{token?}` | Resets daily-claim state. |

---

## 4. Core data contract: `push_live` state

The `state` object is the single contract between backend and frontend.
Required top-level fields: `ts, t, live, alert, territory, momentum, kd, win, leader`.
Full JSON schema is in the action definition; key sub-objects:

- `alert`: `{world, zone, event_id, start_ts, duration_min}` (30/45/90)
- `territory / momentum / kd / pop`: `{VS, NC, TR}` numbers
- `win`: per faction `{pct, level, n, trunk}` — level ∈ trunk/branch/twig/shoot/leaf/xtrunk
- `commander.factions.{VS,NC,TR}`: `{win_pct, war_shape, defend[], attack[], kingmaker[]}`
  - defend entry: `{name, vs, win_drop, ev, priority 0–100, heat 0–100, hold_factor, resistance, median_hold_min}` — hold fields added 2026-10-17 (Hossin only; defend EV re-ranked by hold time, see CHANGELOG.md)
  - attack entry: `{name, target, win_gain, margin_gain, ev, priority, heat}`
- `second`: `{odds: {two non-winner factions totaling 100}, locked, basis}` — basis ∈ scenario/trunk/even/locked
- `owners`: `{facilityId: "VS"|"NC"|"TR"}` map for all 5 continents
- `outliers`: `[{faction, kd, kpm, kills, severity: early|confirmed}]` — KD≥5&KPM≥2 ⚠️, KD≥5&KPM≥3 ☠️
- `fight_up`: `{text, deviation}` — heartbeat narration lines
- `calls`, `hints`: string arrays ("collapse pattern forming" etc.)

---

## 5. Data model (server database)

- **accounts**: `token_hash, character_id, character_name, bankroll, created_at, revoked_at`
- **challenges**: `challenge_id, character_id, status, accepted_at, window_ends_at`
- **alerts**: `alert_id (world-zone-event_id), world, zone, event_id, start_ts, duration_min, status (live|settling|settled|sudden_death), winner, checks_done`
- **ticks**: `alert_id, t, ts, territory, win_pct, pop` (win-history chart source)
- **bets**: `id, token_hash, alert_id, market (winner|second), faction, amount, odds_pct, fee, t, progress_pct, mode (live|replay), status (open|won|lost|corrected), payout`
- **pools**: `alert_id, market, faction, total_staked, crowd_simulated`
- **bonus**: `token_hash, last_auto_at, last_manual_utc_day, balance`
- **replays**: `alert_id, label, date, ticks[]` (simulator library)

---

## 6. Key flows

### Placing a bet
1. UI: user picks market tab → faction → stake → Place Bet.
2. `placebet` validates token, market open (winner closes at 100% lock), deducts stake.
3. Bet stored with odds snapshot; fee computed by fee-by-odds curve.
4. Pools update; `getdashboard` reflects new bankroll + open position.

### Settlement (triple-check)
1. Alert ends → status `settling`, UI shows "settling…".
2. Backend sends `record_final_check` at +0/+5/+10 min with pre-end snapshots.
3. Checks 1–2: hold. Check 3: payout = parimutuel share × time weight (1.0/0.8/0.6).
4. `settleposition` (or auto) credits bankroll; History shows WON/LOST (+`· corrected` if repaired).
5. Tie → `record_sudden_death_result` after 15-min overtime instead.

### Auth (prove you own the character)
1. Footer: enter name → `start_auth_challenge` → popup with instructions + ACCEPT.
2. ACCEPT → `accept_auth_challenge` → 60s window starts.
3. User presses ESC → logout observed on Census stream → `check_auth_challenge` true.
4. `complete_auth` → HMAC token → localStorage `ps2oracle_token`.
5. Every bet/dashboard call sends the token; `verify_auth_token` gates.

---

## 7. Display rules (must preserve on rebuild)

- Percentages, base names, graphs. No articles, no PP (relative % only).
- Star ratings ★–★★★★★ in UI; tree levels hidden.
- "collapse pattern forming" is the warning vocabulary.
- Second-place market: tree marginals renormalized between the pair.
- Kingmaker: "+X% now → Y%" lines; negative lines are warnings, not advice.
- Simulated crowd volumes in pools (real players: currently just Dayset).
- History: newest-first, per-vote P&L, cumulative profit graph, corrected tags.
- Reset requires double-tap confirm.
