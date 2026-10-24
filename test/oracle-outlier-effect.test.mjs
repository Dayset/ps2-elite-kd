// Extreme-player attribution measurement (oracle-worker/history/outlier-effect.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchHonu, compactReport, compactPop, popChange, strongFactions, analyze } from "../oracle-worker/history/outlier-effect.mjs";

test("matchHonu: same instance on another continent is skipped; Honu times without Z are UTC", () => {
  const a = { world: 10, zone: 4, instance_id: 46377, start_ts: Date.parse("2026-10-23T21:58:00Z") / 1000 };
  const list = [{ id: 1, worldID: 10, zoneID: 6, instanceID: 46377, timestamp: "2026-10-23T21:58:00" },
    { id: 2, worldID: 10, zoneID: (5 << 16) | 4, instanceID: 46377, timestamp: "2026-10-23T21:58:30" }];
  assert.equal(matchHonu(list, a), 2);
  assert.equal(matchHonu(list.slice(0, 1), a), null);
});

test("compactReport drops vouched players; strongFactions reads confirmed / burst only", () => {
  const e = (id, k, d, m) => ({ characterID: id, kills: k, deaths: d, secondsOnline: m * 60 });
  const c = { status: "ok", rep: compactReport({ entries: [e("1", 398, 1, 88), e("2", 362, 21, 85), e("3", 124, 17, 33)],
    characters: [{ id: "1", name: "Bauminator45", factionID: 3 }, { id: "2", name: "Fantom220TR", factionID: 3 }, { id: "3", name: "Someone", factionID: 2 }] }) };
  assert.deepEqual(c.rep.flagged.map((x) => x[0]), ["Bauminator45", "Someone"]);
  assert.deepEqual(strongFactions(c), ["TR"]);
});

test("popChange: Hossin 10-4-46377 shape, VS fell most relative to the others", () => {
  const pop = compactPop([...Array(19)].map((_, i) => ({ timestamp: new Date((1000 + i * 300) * 1000).toISOString(), countVS: 119 - i * 4, countNC: 102 - i * 2, countTR: 112 - i * 2 })), 1000);
  const p = popChange(pop, 90);
  assert.ok(p.VS.rel < 0.8 && p.TR.rel > 1);
});

test("analyze: Brier split and calibration classes", () => {
  const odds = [{ m: 10, frac: 0.11, p: { VS: 0.3, NC: 0.3, TR: 0.4 } }];
  const s = analyze([{ key: "a", winner: "TR", strong: ["TR"], odds, pop: null }, { key: "b", winner: "VS", strong: [], odds, pop: null }]);
  assert.equal(s.with_extreme, 1); assert.equal(s.extreme_on_winner, 1);
  assert.equal(s.calibration.has.all.won_minus_p, 0.6);
  assert.ok(s.brier.with_extreme.brier < s.brier.without_extreme.brier);
});
