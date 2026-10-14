# Census API Research — Data Sources for Live Alert Commander

Researched 2026-10-04. All endpoints verified against live Census API or official/community docs.

## Base URL

```
https://census.daybreakgames.com/<service_id>/get/ps2:v2/<collection>?<params>
```

- `s:example` = public demo ID. **~10 queries/minute** before `Missing Service ID` errors.
- Custom service ID: free signup at https://census.daybreakgames.com/#devSignup, "usually hear back within a few hours." Higher limits (not publicly documented, but community consensus is it's generous for polite polling).
- Pagination ceiling: `c:limit` max 5000 per call.

## 1. Map API — facility ownership (NO population)

**Endpoint:**
```
GET /get/ps2:v2/map?world_id=10&zone_ids=4
```

**Returns:** `map_list[0].Regions.Row[]` — each `{RowData: {RegionId, FactionId}}`.
- `FactionId`: 0=none, 1=VS, 2=NC, 3=TR.
- Zone 4 = Hossin. World 10 = Miller, 1 = Connery, 40 = SolTech.

**Verified 2026-10-04:** returns region→faction ownership only. **No population field exists.** There is no per-base or per-hex population anywhere in Census. Confirmed dead end.

**Live use:** 1 call per poll per zone. Poll every 5 min = 18 calls per 90-min alert. Trivial.

## 2. Character stats — KD, BR (NOT real-time)

**Endpoint:**
```
GET /get/ps2:v2/character?name.first_lower=<name>&c:resolve=stat
```

**Returns per character:**
- `battle_rank.value` (BR), `faction_id`, `name`
- `stats.stat[]`: each `{stat_name, profile_id, value_forever, value_monthly, value_weekly, value_daily, last_save}`

**Key stat_names:** `kills`, `deaths`, `assist_count`, `score`, `time_played`, `headshots`.

**Critical limitation:** `last_save` shows when stats were last written. These update **on logout or periodically, NOT in real-time.** A player mid-alert will show stale stats. Useful for *historical* KD (pre-alert roster profiling), useless for live "how are they doing right now."

**Live use:** Pre-fetch roster historical KD once at alert start. 90 characters (30/faction) = 90 calls. Too many for `s:example` in one burst; fine with custom service ID spaced over a few minutes, or use `c:limit` batching by character_id list.

## 3. Online status — who's playing

**Endpoint (single):**
```
GET /get/ps2:v2/characters_online_status?character_id=<id>
```
Returns `{"online_status": "0"|"1"}`.

**Endpoint (outfit roster):**
```
GET /get/ps2:v2/outfit?alias_lower=<tag>&c:resolve=member_online_status
```
Returns members with `online_status` per `character_id`.

**Limitation:** No "list all online characters on world X" endpoint. You must already know the character IDs (from outfit rosters, event stream, or prior data). Cannot discover the full live roster via REST alone.

**Live use:** If tracking specific outfits (e.g., top 5 per faction), 15 outfit calls per poll = fine. For full roster, must combine with event stream (below).

## 4. Event stream (WebSocket) — THE live data source

**Connect:** `wss://push.planetside2.com/streaming?environment=ps2&service-id=<id>`

**Subscribe:**
```json
{"service":"event","action":"subscribe","worlds":["10"],"eventNames":["Death","FacilityControl","MetagameEvent","PlayerLogin","PlayerLogout","VehicleDestroy"]}
```

**Death payload (verified from community docs):**
```json
{"payload":{
  "attacker_character_id":"...","attacker_team_id":"2",
  "attacker_weapon_id":"24003","attacker_vehicle_id":"0",
  "character_id":"...","team_id":"1",
  "is_headshot":"0","timestamp":"1681105322",
  "world_id":"1","zone_id":"4","facility_id":"0"
}}
```

**This is how you get LIVE faction KD:** aggregate kills/deaths by `attacker_team_id`/`team_id`, filtered to `zone_id=4` (Hossin). Zero REST calls — just count the stream.

**Volume estimate:** A busy Hossin alert might generate 50-150 deaths/minute. Over 90 min = 4,500-13,500 events. Trivial for a WebSocket client to count; do NOT store all of them, just increment faction counters.

**FacilityControl events:** Real-time base flips (who took what, when). Alternative to polling the Map API. PS2Alerts uses this.

**MetagameEvent:** Alert start/end notifications. Use to auto-detect live alerts.

## 5. What we CANNOT get (confirmed dead ends)

| Want | Status |
|---|---|
| Per-base / per-hex population | **Does not exist.** Map API = ownership only. Verified live. |
| Real-time character KD via REST | **Stale.** Stats update on logout/periodic, not live. |
| List of all online players per world | **No endpoint.** Must know character IDs first. |
| Bastion / construction data | **Not in any API.** Player construction is client-side only. |
| Per-base attacker/defender counts | **No.** Would need to infer from Death event density (noisy). |

## 6. Practical live-commander architecture

**Poll every 5-10 min during a live 90-min alert:**

| Data | Source | Calls per alert | Notes |
|---|---|---|---|
| Facility ownership | Map API (1 call/zone/poll) | ~18 | Or FacilityControl stream events (0 calls) |
| Global faction pop | ps2alerts live (already have) | 0 extra | Census has no world-pop endpoint |
| Live faction KD | Death event stream (zone-filtered) | 0 REST | Aggregate by team_id in real-time |
| Live faction KPM | Death event stream | 0 REST | Kills per team per minute |
| Roster historical KD | Character REST (once at start) | ~90 | Custom service ID, spaced out |
| Outfit activity | Outfit REST + online_status | ~15/poll | Only for tracked outfits |
| Alert start/end | MetagameEvent stream | 0 REST | Auto-detect |

**Total REST budget per alert:** ~120 calls (mostly one-time roster fetch). Well within custom service ID limits. The heavy lifting (KD, flips) is via WebSocket with zero REST cost.

## 7. What improves the commander vs nice-to-have

**HIGH IMPACT (build first):**
1. **Live faction KD/KPM from Death stream** — Turns "1v1 locked, skill decides" into "TR fielding 1.4 KD, avoid fair fights." Directly powers the commander's tactical advice. Zero REST cost.
2. **FacilityControl stream** — Real-time flip feed instead of 5-min Map polling. Lower latency on breaking-point detection.

**MEDIUM IMPACT:**
3. **Roster historical KD (pre-alert)** — Baseline skill per faction. "TR's A-team is on today" as a win-probability modifier. One-time 90-call cost.
4. **Outfit tracking** — Which specific outfits are active (from member_online_status). "TWC2 has 40 online" is actionable intel for regulars who know the outfits.

**LOW IMPACT / SKIP:**
5. **Per-character live BR** — Doesn't change decisions. Faction aggregates are enough.
6. **VehicleDestroy events** — Interesting for armor/air balance, but the commander is infantry-territory focused. Nice-to-have.
7. **PlayerLogin/Logout stream** — Could track pop flow, but ps2alerts global pop already covers this.

## 8. Rate limit safety

- **Always use a custom service ID** (free, few hours approval). `s:example` at 10/min will break during roster fetch.
- **Cache static data:** character historical stats don't change mid-alert. Fetch once.
- **Prefer the stream over polling:** every Death/FacilityControl via WebSocket is one less REST call.
- **Backoff on 429:** if hit, sleep 60s and retry. Don't hammer.
- **The existing ps2alerts politeness rules still apply:** ~1.2s between REST calls, no scripted scraping of rendered pages.

## Key collections reference

| Collection | Use |
|---|---|
| `map?world_id=X&zone_ids=Y` | Facility ownership (no pop) |
| `character` + `c:resolve=stat` | Historical KD/BR per character |
| `characters_online_status` | 0/1 online per character_id |
| `outfit` + `c:resolve=member_online_status` | Outfit roster + who's online |
| `characters_stat` | Raw stat rows (alternative to resolve) |
| `world` | Online/offline only (no pop numbers) |

## Event stream reference

| Event | Payload highlights |
|---|---|
| `Death` | attacker_character_id, attacker_team_id, character_id, team_id, zone_id, facility_id, timestamp, is_headshot, attacker_vehicle_id |
| `FacilityControl` | facility_id, old_faction_id, new_faction_id, zone_id, timestamp |
| `MetagameEvent` | Alert start/end, event state |
| `VehicleDestroy` | attacker/victim vehicle info |
| `PlayerLogin`/`PlayerLogout` | character_id, world_id |
| `BattleRankUp` | character_id, new BR |

---
*All live API responses verified 2026-10-04 via direct curl. Rate limit figures from community docs (auraxium, ps2-api-docs, community trackers).*
