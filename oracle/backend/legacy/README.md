# oracle/backend/legacy

Artifact-era and one-off files moved here on 2026-10-18 (issue #7). Nothing live
(`commander_live.py`, `push_live_state.py`, `oracle-worker/build-trees.mjs`) uses them.
The live pipeline is described in `oracle/CLOUDFLARE.md`. Moved, not deleted.

- `push_to_artifact.py` — pushed `live_states.json` to the old Muse `hex-betting-game` artifact over HTTP.
- `transform_replay_push.py` — turned `replay_library.json` into the artifact's `push_replays` payload.
- `validate_push_payload.py` — pre-flight schema check for artifact `push_live` payloads.
- `gen_40612_commander.py` — one-off commander data for the alert 10-40612 replay demo.
- `gen_40612_timeline.py` — one-off joint-model timeline for the alert 10-40612 replay demo.
- `push_10-39219.json` … `push_10-46100.json` (9 files) — saved artifact push payloads for individual world 10 alerts.
- `replay_10-40612_commander.json`, `replay_10-40612_timeline.json`, `replay_map_10-40612.json` — replay demo data for alert 10-40612.
- `replay_10-46062_map.json` — map frames for the alert 10-46062 replay demo.
- `replay_compact.json`, `replay_hex_compact.json`, `replay_geo.json`, `replay_flow_v1.json`, `replay_model_v1.json` — older replay demo payloads for the artifact.
- `replay_library.json`, `replay_library_push.json` — replay library and its artifact push form.
- `progress.json`, `progress_v2.json`, `progress_hossin.json`, `progress_continents.json` — resume state of the one-off `fetch_*.py` history downloads (copy back if rerunning those).
- `live_state.json` — old single-alert live state snapshot (the live script writes `live_states.json`).
- `watchdog_state.json` — state of the old VM pipeline watchdog.

Kept in place on purpose: `replay_hexmap.json` (dashboard + Worker), and `replay_map_compact.json`,
`replay_joint_cells.json`, `replay_joint_v1.json`, `replay_10-46062.json`, `replay_elimination_v1.json`
(read or written by `hossin_elimination.py`, which `commander_live.py` imports).
`__pycache__/` was not tracked, so nothing to move.
