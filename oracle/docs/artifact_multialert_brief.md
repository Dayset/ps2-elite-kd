# Artifact edit brief: multi-server / multi-continent live support

## Context
The Hex Betting Game (`hex-betting-game`) currently handles a single live alert (Miller/Hossin). The backend now pushes live states for ALL servers and continents. Each push_live call carries one alert's state; there can be 0–4 concurrent live alerts.

## Server/continent reference
- Worlds: 1=Osprey, 10=Wainwright, 19=Jaeger, 25=Briggs, 40=SolTech
- Zones: 2=Indar, 4=Hossin, 6=Amerish, 8=Esamir, 344=Oshur
- Alert identity key: `${world}-${zone}-${event_id}` (e.g. `10-4-12345`)

## Required changes

### 1. Multi-alert live state storage
- Store live states keyed by alert identity (`world-zone-event_id`), not a single global.
- Each push_live updates/creates the entry for its alert key.
- When a new event_id arrives for the same world+zone, treat the old alert as ended: settle its pools (see #3) and replace with the new one.
- LIVE mode shows a picker when >1 alert is live; auto-selects when exactly 1.

### 2. Server/continent picker UI
- Add a picker (dropdown or tabs) in LIVE mode: server first, then the live alert(s) on that server.
- Display names: use the reference above (e.g. "Wainwright — Hossin").
- If no alerts are live anywhere, show a clean "no live alerts" state (not a stale final state).

### 3. Per-alert betting pools
- Betting pools, positions, and settlement must be scoped per alert key.
- Each alert gets independent winner + second-place pools (same fee model: 5/15/30 + 10% kicker).
- Settlement triggers: alert end (new event_id or explicit end signal). Settle by final territory.
- The shared 1,000-point bankroll stays global; positions are per-alert.

### 4. Non-Hossin continents (no hex map yet)
- The `owners` field will be EMPTY for non-Hossin alerts (hex geometry only exists for Hossin).
- For these, show territory bars, win% chart, momentum, KD, commander calls — but no hex map (or a graceful "map coming soon" placeholder).
- Hossin alerts keep the full hex map as before.
- Do NOT break on empty `owners`; treat as "no map data".

### 5. Push schema (unchanged shape, now per-alert)
Each push_live call sends `{state: {...}}` with `state.alert = {world, zone, event_id, start_ts}`.
Use this to key storage. Multiple pushes per minute (one per live alert) are normal.

## What NOT to change
- REPLAY mode: untouched (Hossin replays only).
- Fee model, second-place market logic, bankroll persistence.
- The vivid Hossin map.

## Acceptance
- Two simulated concurrent live alerts (different worlds) both appear in the picker, each with independent betting pools.
- Placing a bet on one alert doesn't affect the other.
- Empty `owners` renders cleanly without the hex map.
