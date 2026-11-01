SELECT 'alert' AS t, key, status, winner, basis, end_ts, flags, checks, archived_ts FROM alert WHERE key IN ('10-2-46360','10-2-46374');
SELECT 'bench' AS t, key, dur, winner, brier, settled_ts, slices FROM bench WHERE key IN ('10-2-46360','10-2-46374');
SELECT 'vote' AS t, id, cid, key, outcome, amount, fee, net, potential, status, reward, settled_ts, credited FROM vote WHERE key IN ('10-2-46360','10-2-46374') ORDER BY key, id;
SELECT 'wallet' AS t, cid, balance FROM wallet WHERE cid IN (SELECT cid FROM vote WHERE key IN ('10-2-46360','10-2-46374')) ORDER BY cid;
