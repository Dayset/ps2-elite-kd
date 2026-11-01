# 2026-11-01: recalculate stored odds with the fixed engine

Commit 7ce3af59f fixed a bug where a faction holding more ground than any past alert
had at that minute (mostly Meltdown leaders at 85-90 % of the live zone) read as 0 %,
so the others' small odds were blown up (alert 40-8-32824: NC 0 % at t16, VS 100 % at t30).

This change rewrites only the stored minute-by-minute odds (`tick.win` in the main
database and `ticks[i].win` in the archive bundles) for the 143 minutes in 13 alerts
that had the bug. Nothing else in the records changes: territory, benchmark slices and
Brier scores, votes, final state.

- `backup.json`: every replaced value (old) and its replacement (new). `approx: true`
  marks 31 minutes where the stored value could not be reproduced to the decimal from
  the map snapshots (momentum timing), but the replay confirms the same 0 %-leader bug.
- `apply-*.sql` / `revert-*.sql`: guarded on the old value, safe to re-run.
- Run with the "Oracle D1 maintenance" workflow (action apply or revert).
