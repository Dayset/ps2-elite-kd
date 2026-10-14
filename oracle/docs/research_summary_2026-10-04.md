# Research Summary: Game Theory + Census + What's Next
## Compiled 2026-10-04 while Dayset rests

### 1. GAME THEORY TRICKS (new, implementable with current data)

All in `game_theory_notes.md`. The high-impact ones:

**Spoiler mode** — When mathematically eliminated, don't go quiet. Switch to:
"ELIMINATED. Attack [X] to hand it to [Y]." Rank by |swing| on contenders.
Players love spite. This is fun AND strategically correct.

**Tempo** — Net base flips per 15 min per faction. Who has initiative?
"TR +3 tempo. You're -2, reactive." Track if aggressor is accelerating.
Free from flip data. No new API needed.

**Zugzwang** — Stronger than "spread thin." It's "you're doomed if you stay
defensive." Detection: (frontiers × min_defense) > (pop × efficiency).
Advice: "Abandon 6, hold 2, all-in counterattack." The only winning move is
to change the game.

**Real options** — A base isn't just 1.14pp, it's an OPTION on new lanes.
Value = territory + Σ(P(unlock) × EV of unlocked attacks). Re-ranks attacks:
a hub unlocking 3 lanes beats a dead-end, even at same territory.

**Minimax regret** — When leading, don't max EV, minimize worst case.
"Attack A: EV+2.1, fail=-5pp. Attack B: EV+1.8, fail=-2pp. Pick B."
Add risk-mode toggle: LEAD (minimax) vs TRAIL (max EV).

**Best response** — Current EV assumes enemy doesn't react. True EV accounts
for optimal defense. Approximate: assume defender covers your top-1 target,
recompute. "Don't attack where they expect."

**Coalition stability** — When do 2 factions implicitly coordinate vs the third?
If P(VS win | TR weak) + P(NC win | TR weak) > current, incentives align.
Predict: "VS+NC aligned vs TR for ~20min."

### 2. CENSUS DATA (subagent research, verified live)

Full report: `census_research.md`.

**Per-base population: CONFIRMED DEAD.** Map API returns ownership only.
Verified via live curl 2026-10-04. Stop looking.

**The WebSocket event stream is the live answer:**
- `Death` events → live faction KD/KPM, ZERO REST calls. Aggregate by
  team_id filtered to zone_id=4. 50-150 deaths/min in busy alert = trivial.
- `FacilityControl` → real-time base flips (lower latency than 5-min polling).
- `MetagameEvent` → auto-detect alert start/end.

**Character REST stats are STALE** (update on logout). Good for pre-alert
roster historical KD. Useless mid-alert.

**Rate limits:** Need custom service ID (free, approved in hours).
`s:example` at ~10/min breaks on roster fetch. With custom ID: ~120 REST
calls per alert (mostly one-time 90-char roster) + WebSocket for real-time.
Well within limits.

**High impact for live commander:**
1. Live faction KD from Death stream → "TR fielding 1.4 KD, avoid fair fights."
   Turns "skill decides" into specific tactical advice. Zero REST cost.
2. FacilityControl stream → faster breaking-point detection.

**Can't get, stop looking:** per-base pop, world player lists via REST,
bastion/construction, real-time per-char KD via REST.

### 3. THINGS WE MISSED (already have the data!)

From ps2alerts, unused:
- `outfitCaptured` — which outfit took the base. Track elite outfit activity.
- `durationHeld` — low = hotly contested, high = stronghold. Tempo signal.
- `isDefence` — compute P(defense holds | faction). "NC holds 70%, attack TR instead."

### 4. THE RIGHT ORDER (decision hierarchy)

Not a dashboard — a FILTER. Commander outputs in priority order, STOPS when
higher priority fires:

1. **Eliminated?** → SPOILER MODE only. Hide rest.
2. **Breaking point?** → "DEFEND [X] OR DIE." Hide rest.
3. **Zugzwang?** → "ABANDON, COUNTERATTACK." Hide rest.
4. **War shape** → One line: "1v1 locked vs NC. TR free."
5. **Tempo** → One line: "TR +3, you -1."
6. **Kingmaker** → Only if swing >10pp.
7. **Top 3 attacks** by EV (or minimax if leading).
8. **Top 3 defends** by EV.
9. **Pop check** → Only if actionable.

If you're at a breaking point, kingmaker is noise. The hierarchy respects that.

### 5. RECOMMENDED BUILD ORDER

**Phase 1 (current data, no new API):**
1. Spoiler mode
2. Tempo tracking
3. Zugzwang detection
4. Decision hierarchy UI (filter, not dashboard)
5. Use `outfitCaptured`/`durationHeld`/`isDefence`

**Phase 2 (Census WebSocket, custom service ID):**
6. Live faction KD from Death stream
7. FacilityControl for real-time flips
8. Pre-alert roster historical KD as modifier

**Phase 3 (refinements):**
9. Real options valuation
10. Minimax regret mode
11. Coalition prediction
12. Best-response EV

All Phase 1 is implementable NOW with data we have. No blockers.
