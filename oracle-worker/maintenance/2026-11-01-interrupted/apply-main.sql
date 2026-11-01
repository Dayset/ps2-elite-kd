-- 2 alerts cut short by a server outage (t818s2880): interrupted, no winner, out of the benchmark.
-- No votes were placed on either, so no vote or wallet rows change. Guarded: safe to re-run.
UPDATE alert SET status='interrupted', winner=NULL, basis=NULL, flags='["checked","interrupted:server_silent","ended_early:63","fixed:2026-11-01"]' WHERE key='10-2-46360' AND status='settled' AND winner='TR';
DELETE FROM bench WHERE key='10-2-46360' AND winner='TR' AND settled_ts=1792674391;
UPDATE alert SET status='interrupted', winner=NULL, basis=NULL, flags='["snapshot_stale","checked","interrupted:server_silent","ended_early:72","fixed:2026-11-01"]' WHERE key='10-2-46374' AND status='settled' AND winner='TR';
DELETE FROM bench WHERE key='10-2-46374' AND winner='TR' AND settled_ts=1792767331;
