# 2026-11-01: Meltdown odds without the pull toward even

Commit 3f9bc4e1c set `MELTDOWN_SHRINK` to 0: the refit on every minute of 67 scored
Meltdowns (2,909 minutes, leave-one-alert-out) picked no pull (Brier 0.1405 -> 0.1030,
same winner picks). The pull also made jumps such as NC 100 % -> 69 % -> 100 % on the
same map (alert 40-8-32824, t25-36).

This rewrites only the stored minute-by-minute odds (`tick.win` in the main database
and `ticks[i].win` in the archive bundles) of Meltdown minutes stored with the pull
(since 2026-10-18 14:57 UTC-5): 2,380 minutes in 65 alerts. Nothing else changes:
territory, benchmark slices and Brier scores, votes, final state.

- `backup.json`: every replaced value (old) and its replacement (new). 1,460 minutes
  were replayed exactly; 920 (`approx: true`) could not be replayed to the decimal from
  the map snapshots, so the pull was undone arithmetically on the stored value (checked
  against the exact replays: within 0.3 points, 0.05 on average).
- `apply-*.sql` / `revert-*.sql`: guarded on the old value, safe to re-run.
- Run with the "Oracle D1 maintenance" workflow (change `2026-11-01-meltdown-pull`).
