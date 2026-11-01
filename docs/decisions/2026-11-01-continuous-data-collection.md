# Decision: continuous data collection outside alerts

**Date:** 2026-11-01 · **Decided by:** Kyrylo (Dayset), project owner · **Status:** active · **Revisit:** 2026-12-01, or as soon as any number below is off by 2× or more

## What was decided

> "And enable mid alert data collection for the map states and other events, make a note somewhere with estimation so we can refer and find this decision later"

Before this, the cache Worker only kept kill data for zones that had an alert running. From now on it keeps PC (worlds 1, 10, 40) data around the clock and marks each kill as in or out of an alert. All of it is **internal only**:

- the routes need the proxy key
- nothing about a single player is published
- the public site only ever shows outfit, faction or class totals.

Nothing changes for the public site, the Oracle odds or the alert-only logic. Alert-only analyses still work because every kill now has an `inAlert` flag.

## What is collected, and where

Everything lives in the KillMonitor Durable Object's SQLite (`worker/src/kill-classes.js`, `worker/src/collect.js`). It is written as one compressed JSON blob row per table per 60 s alarm, and kept for **30 days**. Data from removed players (removal list) is dropped before it is stored.

| Table | What it holds | Before | Now | Switch (Worker variable) | Size cap |
|---|---|---|---|---|---|
| `kc` | Every PC Death: who killed whom, both classes, weapon, vehicle, headshot, plus an `inAlert` flag | alert zones only | **24/7** | `KILL_CLASSES` = `all` · `alerts` · `off` | `KC_MAX_MB`, default 2500 |
| `vd` | Every PC VehicleDestroy: attacker and victim vehicles, weapon, factions, base | not stored | **24/7** | `VEHICLE_KILLS=off` | `VD_MAX_MB`, default 600 |
| `wev` | World events: base flips (FacilityControl, including defends), alert start and end with territory %, continent lock and unlock | flips only in Oracle D1, no locks | **24/7** | `WORLD_EVENTS=off` | `WEV_MAX_MB`, default 100 |
| `ms` | Map state every 5 min, per world: zone crowd by faction, plus each active base's crowd, kills, vehicle kills, conversions, ticks and spawns. Player ids are removed | only the live screen and live-alert Honu population | **every 5 min, 24/7** | `MAP_STATES=off` | `MS_MAX_MB`, default 500 |

How to read the data: `GET /live/collect?kind=vd|wev|ms&since=<unix>&limit=<n>` (proxy key), and `GET /live/killclasses` for `kc`. Sizes, row counts and "full" counters are shown under `collect` and `killClasses` at `/monitor/usage`.

Already continuous before this decision and unchanged:

- Oracle D1 `snap` map snapshots: every minute, 30 days
- `flip`: 90 days
- `metagame` rows
- capture tags: 7 days
- rosters on every capture or defend: 30 days

Considered but **not** collected:

- **Login and logout history.** It would be per-player tracking, so it stays out for privacy.
- **Revives (GainExperience 7/53).** They are not subscribed on PC, so collecting them would add stream messages and cost. They can be added later if needed.
- **Honu population.** It is replaced by the `ms` crowd counts, so no Honu calls are made.

## Measured volumes (real 24 h meter, `/monitor/usage`, 2026-11-01)

| PC stream event, 24 h | Messages |
|---|---|
| Death | 358,599 |
| VehicleDestroy | 65,291 |
| FacilityControl | 16,200 |
| PlayerFacilityCapture / Defend | 22,315 / 34,415 |
| Login / Logout | 18,431 / 18,142 |
| All sockets, total | 980,740 messages, 325.5 MB |

How much storage each table takes:

- **Kills.** Measured: 58,824 alert kills took 4.79 MB, about 81 B per kill. All-day collection gives ≈ 359k × 81 B ≈ **29 MB/day**, so about **0.87 GB** at 30 days.
- **Vehicle kills.** About 65k × 80 B ≈ **5 MB/day**, so about **0.16 GB** at 30 days.
- **World events.** About 16k flips × 60 B, plus a few hundred alert and lock events, ≈ **1 MB/day**, so about **0.03 GB** at 30 days.
- **Map states.** A live activity snapshot is about 13.4 KB for 3 worlds, taken 288 times a day ≈ **4 MB/day**, so about **0.12 GB** at 30 days. Worst case during busy weekend fights is about 0.35 GB.

**Total kept at 30 days: about 1.2 GB.** The hard ceiling with every cap full is 2.5 + 0.6 + 0.1 + 0.5 = **3.7 GB**. When a table reaches its cap it stops writing (the `full` counter goes up). It never grows past the cap.

## Cost against the Workers Paid plan ($5/month)

Cloudflare Durable Objects pricing was checked on 2026-11-01 (page dated 2026-10-18).

| Limit (included per month) | Before this change | Added by this change | % of the included amount |
|---|---|---|---|
| Requests: 1M (incoming WebSocket messages count 20 to 1) | ~1.57M projected | + a few hundred MetagameEvent and Continent messages a day ≈ +0.0005M | about 157%, unchanged. The overage is about $0.09 |
| Duration: 400k GB-s | ~336.6k projected | 0. The object already runs all day for the stream | 84%, unchanged |
| SQLite rows written: 50M | ~0.28M | ≈ 1,440 rows a day each for kc, vd and wev, plus 288 for ms, plus hourly purges ≈ **+0.14M** | ≈ 0.8% |
| SQLite storage: 5 GB-month | small | **+1.2 GB** typical, 3.7 GB ceiling | ≈ 24% typical, 74% worst case |
| Rows read: 25B | small | an hourly purge and size check, and occasional reads | well under 0.01% |

**Extra monthly cost: $0.00 typical.** Everything added fits inside the included amounts. The worst case is still $0, because the size caps stop storage below 5 GB. The account's overall worst-case bill was about $4.34 extra before this change, and that figure comes from requests and duration, not from this decision.

## How to turn it off

Set the Worker variable in the Cloudflare dashboard (Workers → ps2-elite-kd-cache → Settings → Variables), or in `worker/wrangler.toml` under `[vars]`, then redeploy using the "Deploy cache Worker" workflow:

- All kills back to alert-only: `KILL_CLASSES = "alerts"`. To stop kills completely: `"off"`.
- Vehicle kills: `VEHICLE_KILLS = "off"`
- World events: `WORLD_EVENTS = "off"`
- Map states: `MAP_STATES = "off"`
- Shrink a table: `KC_MAX_MB`, `VD_MAX_MB`, `WEV_MAX_MB` or `MS_MAX_MB`, in MB

Turning a table off stops new writes. Rows already stored are removed by the 30-day purge, so nothing has to be deleted by hand.

## When to revisit

- On **2026-12-01**, compare the real `/monitor/usage` sizes with the estimates above.
- Sooner, if any table reports `full > 0`, total storage passes 3 GB, or the Cloudflare bill goes over $6/month.
- When we decide which analyses (out-of-alert class balance, vehicle meta, map-state history) are worth keeping, or which tables can be switched off.
