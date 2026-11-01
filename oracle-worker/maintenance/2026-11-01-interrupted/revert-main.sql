-- Undo apply-main.sql: back to settled TR, benchmark rows restored exactly. Guarded: safe to re-run.
UPDATE alert SET status='settled', winner='TR', basis='census_final', flags='["checked"]' WHERE key='10-2-46360' AND status='interrupted';
INSERT OR IGNORE INTO bench (key, dur, slices, winner, brier, settled_ts) VALUES ('10-2-46360', 90, '{"t0":{"VS":0.39399999999999996,"NC":0.18899999999999997,"TR":0.41700000000000004,"t":0.1}}', 'TR', '{"t0":0.1769}', 1792674391);
UPDATE alert SET status='settled', winner='TR', basis='census_final', flags='["snapshot_stale","checked"]' WHERE key='10-2-46374' AND status='interrupted';
INSERT OR IGNORE INTO bench (key, dur, slices, winner, brier, settled_ts) VALUES ('10-2-46374', 90, '{"t0":{"VS":0.314,"NC":0.25,"TR":0.436,"t":0.6}}', 'TR', '{"t0":0.1597}', 1792767331);
