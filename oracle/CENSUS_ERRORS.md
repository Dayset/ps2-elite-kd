# PS2MapOracle — Errors Usually Encountered

Census API, PS2Alerts, and transport failure modes seen in practice, with the
recorded incident where one exists. This is a field guide, not a theory list.

## A. Census API errors

### 1. Timeouts / Connection refused (REST Map API)

- **Symptom:** `map_poller.py` cycle logs `0 ok / N skipped (Census-dark)`, or
  `Connection refused` in the log tail. Snapshots stop; the freshness probe
  goes STALE.
- **Seen:** 2026-10-15 morning outage — map last wrote 12:59:39Z, events last
  13:01:01Z; a restart at 13:18Z did NOT restore it (Census-side). Resumed
  after ~13:59Z. Also 2026-10-15 ~20:34Z freeze (both pipelines stale ~19 min,
  `Connection refused` / stream error).
- **Handling:** watchdog restarts the poller once (clears local wedging), then
  waits. A restart cannot fix a Census-side outage — do NOT restart in a loop.
  Notify once at `stale_streak` 2. Collection gap only; on-disk history intact.

### 2. Empty WebSocket windows (events stream connected, no data)

- **Symptom:** events windows save with 0 kills / 0 flips for tracked worlds
  while the process stays alive. `pgrep` shows healthy — this is the
  connected-but-not-collecting failure (first seen 2026-10-05: both pollers
  alive for hours, no data written).
- **Seen:** 2026-10-15 events-only outage — events last 14:10:34Z, map stayed
  FRESH. One window showed 812 flips, 0 worlds (see §A.6).
- **Handling:** the watchdog freshness probe (data age, not process liveness)
  is the detector. Never trust `pgrep` alone.

### 3. Stream errors / no close frame (WebSocket)

- **Symptom:** `stream error: no close frame, retry in 5s` in
  `census_events.log`, then silence — the retry never fires.
- **Seen:** 2026-10-18 ~04:36Z (events process showed the error, then froze;
  watchdog relaunched after ~8 min silence).
- **Handling:** watchdog restart (SIGTERM + relaunch) clears it.

### 4. Backlog flushes (1000+ flips in one window)

- **Symptom:** after an outage, the stream delivers a huge backlog at once:
  e.g. 1,218 backlogged FacilityControl flips in one window (worlds 1: 665,
  19: 553), 0 kills; later a 656-flip backlog window.
- **Seen:** 2026-10-15 ~13:48Z (morning outage recovery).
- **Handling:** expected recovery behavior, not corruption. Do not treat a
  backlog window as a writer failure. Note: `snapshot()` is followed by
  `reset()` every window, so flips do not accumulate across windows.

### 5. Frozen snapshots (map data byte-identical while the alert runs)

- **Symptom:** consecutive map snapshots identical while flips are happening
  on the event stream. Census is serving a stale/frozen map view.
- **Seen:** 2026-10-15 Esamir case — snapshot frozen byte-identical
  20:52:56Z → 21:14:51Z (~22 min) during a live alert.
- **Handling:** suspect the input, not the model. Cross-check against the event
  stream (genuine ownership changes). See §A.7 — frozen snapshots are often
  the first sign of neutral-facility corruption.

### 6. Untracked-world flips in the "window saved" line

- **Symptom:** `window saved: 0 worlds, N kills, F flips` — e.g. "0 worlds,
  812 flips".
- **NOT a failure.** The log line counts flips from ALL worlds (unfiltered
  intake), but `snapshot()` only writes records for WORLDS = [1, 10, 19, 25].
  Flips for untracked worlds (or with missing world_id) are counted but not
  written. Do not diagnose a writer/disk failure from this pattern; check
  whether any flips carried a tracked world_id.

### 7. Neutral-facility corruption (frozen neutral, territory sums < 100%)

- **Symptom:** a large block of facilities reports faction `0` (neutral) and
  stays frozen while the alert runs. Territory shares (divided by ALL
  facilities including neutral) are diluted and sum far below 100%.
- **Seen three times:**
  1. **2026-10-13, Connery Hossin:** 54/88 facilities neutral, ~14:27–15:12 UTC.
  2. **2026-10-15, Connery Esamir 1-8-186:** 31/51 neutral (61%) from ~20:30Z
     through 21:25Z; territory summed to 39.2%. Caused a header↔commander
     contradiction (header: VS 100 / NC eliminated; commander: NC 100%) because
     the header applies the elimination override + leader-100 fallback while
     commander `win_pct` is the raw joint tree. Settlement NOT corrupted
     (settled VS, matching post-recovery reality).
  3. **2026-10-17, Connery Oshur 1-344-248:** neutral locked at the same
     34-facility set 18:43Z → last pre-end snapshot 19:18:27Z; final snapshot
     summed to 54.7%. FIRST case to reach a settlement. Triple-check cannot
     catch it (all three checks re-read the same corrupt feed). Winner NC
     corroborated via the event stream (NC only faction gaining in the owned
     subset) and the benchmark.
- **Handling:** the neutral-facility input guard is DEFERRED by product decision
  ("keep collecting"). Pending options: (A) hold an affected settlement for
  manual verification, (B) ship a settlement-only guard (hold settlement when
  the final pre-end snapshot sums below ~90%), (C) leave the record and tag it
  corrupt-input. The validator checks ranges/enums only — no territory-sum or
  header↔commander consistency check exists yet.

### 8. World 25 (Cobalt) Census-dark

- **Symptom:** map poller reports world 25 skipped / Census-dark while other
  worlds are fine. Cobalt is effectively unserved by Census for long stretches.
- **Handling:** expected; the watchdog tolerates per-world failures in a cycle.
  Alert detection for Cobalt is degraded by the source, not by our code.

### 9. Emerald (19) events gap

- **Symptom:** the Census event stream delivers only 2 worlds (Connery +
  Miller). Emerald has zero event windows for 29+ hours (seen 2026-10-16 02:21
  UTC → 2026-10-17 02:14 EST) while Emerald map snapshots stay fresh.
- **Handling:** alert detection is intact (map snapshots); only events-derived
  fields (KD, pop, outliers) are degraded for an Emerald alert. The watchdog
  freshness probe covers world 10 only — it does NOT check 19/25.

### 10. Stale character REST stats

- **Symptom:** character stats from the REST API look wrong mid-alert.
- **Not a bug:** character stats update on LOGOUT. REST is pre-alert roster
  only; live stats must come from the event stream. Never use REST stats as
  live data.

### 11. API quota

- **Symptom:** `Missing Service ID` errors, throttling, or empty replies under
  burst load.
- **Cause:** running on the public demo ID `s:example` (~10 queries/minute).
  A roster fetch (90 characters = 90 calls) alone breaks it.
- **Handling:** use a real service ID (free signup, approval in hours) via the
  `CENSUS_SERVICE_ID` environment variable. Never hardcode it. Do not "fix"
  quota errors by polling harder — quota is the budget.

## B. PS2Alerts / settlement errors

### 1. Recycled alert IDs → settlement collisions

- **Symptom:** `record_final_check` returns "Already verified and settled:
  <WRONG WINNER> won" for today's alert, with `checkCount: 3`,
  `discrepancy: false`, `payoutDelta: 0`. The settlement was absorbed by an
  older settlement under the same bare alertId (PS2Alerts / Census reuse
  world-zone-event_id across days).
- **Seen:** 1-4-177 (Oct 13/14); 10-8-150 (Oct 14 — swallowed, alert dropped
  unsettled, payout not released); 10-2-147 (Oct 14 — stale VS winner
  contradicted today's TR winner; dashboard showed the wrong winner);
  10-2-148 (Oct 16 — today's NC absorbed by Oct 12 TR).
- **Fix (shipped 2026-10-16):** settlement records keyed by
  **(alertId, endedAt)** (migration 0015). The generator already sent
  `endedAt`; the fix was entirely in the artifact action. Today's 10-2-148
  was re-settled as NC, 3/3, payoutDelta 0. The benchmark (which keys by
  instance-disambiguated `<alertId>-<start_ts>`) was never affected.
- **Rule:** any settlement lookup keyed by bare alertId is a bug. Always key
  by (alertId, endedAt) or an instance-disambiguated key.

### 2. Post-end winner-owns-everything snapshot artifact

- **Symptom:** the first post-end map snapshot shows the winner owning nearly
  every facility (e.g. NC 69 after an Oshur alert) — a Census post-end
  artifact, not the real final state.
- **Handling:** NEVER settle from a live push; NEVER use post-end snapshots.
  Settlement uses pre-end snapshots only, verified at +0/+5/+10 min. This is
  why the triple-check exists.

### 3. PS2Alerts corrections to settled winners

- **Symptom:** a settled winner disagrees with PS2Alerts.
- **Seen (2 settled lines):** 10-6-244 alert_n 2 — "TR won per PS2Alerts
  10-46215 (was VS)"; 10-6-157 alert_n 3 — "NC won per PS2Alerts 10-46200
  (was VS)".
- **Handling:** settled winners do NOT all "stand on our own data" — two
  carry PS2Alerts corrections. Corrections are recorded in the benchmark line
  with source. Do not claim otherwise.

### 4. Ties → sudden death

- **Symptom:** alert ends with no winner (tie).
- **Rate:** ~4.5% of alerts.
- **Handling:** pipeline holds settlement; artifact shows "awaiting sudden
  death"; `record_sudden_death_result` records the 15-min kill-overtime
  outcome. Backtest excludes draws (impact 0.1501 → 0.153, negligible).

## C. Transport errors (backend → artifact)

These are the most frequent day-to-day failures. The payload is usually fine;
the paste is corrupt. Rule: **machine-generate, validate, read back, paste
verbatim. Never hand-retype or reshape.**

### 1. Paste corruption (fields dropped / merged / wrong)

- **Symptom:** push lands `ok:true` but stored state is wrong — e.g. an NC
  attack entry merged into its defend array; a TR defend's heat/priority/vs
  copied from a neighboring entry; a duplicated owners-map key dropping a
  base owner; a stray meta-commentary string inside `fight_up.text`.
- **Handling:** `getdashboard` read-back does NOT summarize commander detail,
  so prose corruption is invisible post-hoc. Before invoking, diff the
  emission field-by-field against the machine file (owners block key-by-key;
  every numeric field; every short display string). On finding a slip,
  re-push the corrected machine-generated object immediately.

### 2. 3-vs-4 closing-brace tail

- **Symptom:** tool-schema failure: "arguments did not match
  artifact.invoke_action's schema". The pasted args end with 3 closing braces
  instead of 4 — the `{"state": {...}}` wrapper needs one close each for
  `fight_up`, `commander`, `state`, and `args`. A 3-brace tail is invalid JSON
  ("Expecting ',' delimiter"), arrives as a string, and fails identically to
  other paste corruption.
- **Handling:** verify the tail brace count before invoking. After two failed
  pastes: stop hand-pasting; write the candidate to a file, `json`-parse it,
  byte-diff against the machine file, invoke only when byte-identical.

### 3. Literal newlines in `fight_up.text`

- **Symptom:** tool-schema failure on an otherwise valid payload. The
  `fight_up.text` string contains real newlines instead of `\n` escapes,
  breaking the tool schema.
- **Handling:** emission must be byte-faithful: backslash-n escapes,
  compact separators, `\uXXXX` escapes included. Pretty-printed JSON
  (added spaces, literal →/— chars for `\u2192`/`\u2014`, real newlines for
  `\n`) is RETYPING, not verbatim — it has dropped fields while landing
  `ok:true`.

### 4. Duplicate owners-map keys

- **Symptom:** `ok:true`, but a base owner is missing in the stored state.
  A repetitive numeric key ("302030" pasted as duplicate "302020") collapses
  silently in JSON (duplicate keys, same value).
- **Handling:** diff the owners block key-by-key against the machine file
  before invoking; the read-back must show every owner key from the file.

### 5. Emission from the checklist (fabrication, not transcription)

- **Symptom:** a push composed from a field-checklist dump instead of the
  file text lands 10+ corrupt fields (wrong win %, zeroed kd/momentum,
  dropped outlier, dropped owners map, fabricated `win_popadj`) with `ok:true`.
- **Handling:** the checklist dump is for VERIFICATION ONLY, never for
  emission. Compose args by copying the exact file text, character-for-character.
  Emission-from-checklist is fabrication, not transcription.

### 6. Settled-push size

- **Symptom:** a ~9KB full-state settled push fails artifact schema validation.
- **Handling:** settled pushes use the MINIMAL required state shape
  (ts, t, live, alert, territory, momentum, kd, win, leader, calls, hints).
  Keep settled payloads small.
