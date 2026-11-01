# 2026-11-01: two alerts cut short by a server outage -> interrupted (t818s2880)

Wainwright Indar alerts 10-2-46360 (Oct 22, ended 63 min early, during Daybreak's announced
patch) and 10-2-46374 (Oct 23, ended 72 min early, unannounced crash) were settled as TR wins
from the shutdown's frozen scores. Census then had no captures on the server for 13-90 min
while other servers kept capturing. With the new crash handling (`oracle-worker/src/interrupt.js`)
they become what new crashes get automatically:

- `alert`: status `interrupted`, no winner / basis, flags + `interrupted:server_silent`,
  `ended_early:N`, `fixed:2026-11-01`.
- `bench`: their 2 benchmark rows (t0 slice only) removed, so they leave accuracy / Brier.
- `vote` / `wallet`: no votes were placed on either alert, so nothing to give back.
- archive bundles: same status / winner / flags, Brier removed (the slices stay).

`backup.json` holds every replaced row and both archive bundles exactly as stored.
`apply-*.sql` / `revert-*.sql` are guarded on the old / new status, so re-runs are no-ops;
the revert restores the rows and bundles byte for byte (checked in SQLite).
Run with the "Oracle D1 maintenance" workflow (change `2026-11-01-interrupted`, action apply or revert).
Osprey 1-6-49426 (ended 10 min early, server kept running) stays settled.
