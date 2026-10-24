import test from "node:test";
import assert from "node:assert/strict";
import { crowdSample, crowdPercentiles, crowdCheck, zergEstimate, revivedShare, reviveWeight, reviveZerg, zergCleared, HL_MIN, HL_W } from "../zerg-revive.mjs";
import { vehDiffStart, vehDiffFactor, vehDiffCleared } from "../diff-vehicle.mjs";
import { traitPools, aimGap, zergScore } from "../trait-scores.mjs";

test("crowdSample: received per death, 50 deaths + 2 h, no kill minimum", () => {
  const xp = { kills_counted: 3, seconds_counted: 7200, totals: { r: { 1: [80, 0], 29: [20, 0], 7: [30, 0], 53: [10, 0], 4: [50, 0], 51: [50, 0], 438: [20, 0], 34: [5, 0], 55: [5, 0] }, g: { 1393: [24, 0] } } };
  const s = crowdSample(xp);
  assert.equal(s.deaths, 100);
  assert.equal(s.rev, 0.4);
  assert.equal(s.heal, 1);
  assert.equal(s.shield, 0.2);
  assert.equal(s.resup, 0.1);
  assert.equal(s.hl, 0.2); // 24 Hardlight events in 120 min
  assert.deepEqual(revivedShare(xp), { share: 0.4, revived: 40, deaths: 100 });
  assert.equal(crowdSample({ ...xp, seconds_counted: 7199 }), null); // under 2 h
  assert.equal(crowdSample({ seconds_counted: 9000, totals: { r: { 1: [49, 0] } } }), null); // under 50 deaths
  assert.equal(crowdSample(null), null);
});

test("crowdPercentiles: mean of four, Hardlight can only add, re-percentiled", () => {
  const mk = (k, hl = 0) => ({ deaths: 100, minutes: 200, revived: k, rev: k / 100, heal: k / 50, shield: k / 200, resup: k / 400, hl });
  const m = new Map([["a", mk(1)], ["b", mk(2)], ["c", mk(3)], ["d", mk(4, 0.01)], ["e", mk(5)]]);
  const p = crowdPercentiles(m);
  assert.deepEqual([..."abcde"].map((s) => p.get(s).crp), [0, 20, 40, 60, 80]);
  assert.equal(p.get("a").rvp, 0);
  assert.equal(p.get("e").rvp, 80);
  assert.equal(p.get("d").hlp, null); // below HL_MIN per minute
  m.set("a", mk(1, 0.5)); // a lone big Hardlight earner gets a lift, never a drop
  const q = crowdPercentiles(m);
  assert.ok(q.get("a").crowd >= p.get("a").crowd);
  assert.equal(HL_MIN, 0.02);
  assert.equal(HL_W, 0.2);
});

test("crowd check: confirm on revives OR crowd, soften by the higher, never raise", () => {
  assert.equal(reviveWeight(10), 1);
  assert.equal(reviveWeight(50), 0);
  assert.equal(reviveWeight(37.5), 0.5);
  assert.deepEqual(reviveZerg(80, 10), { score: 10, w: 1, chk: 10, confirmed: false, softened: true });
  assert.equal(reviveZerg(80, 40).score, 80 - Math.round(0.4 * 40));
  assert.equal(reviveZerg(5, 10).score, 5); // low Zerg untouched
  assert.equal(reviveZerg(80, 60).score, 80);
  assert.equal(reviveZerg(80, 80).confirmed, true);
  assert.equal(reviveZerg(80, null).score, 80); // no data → unchanged
  assert.equal(reviveZerg(80, 10, 60).score, 80); // crowd score high → no soften (the higher counts)
  assert.equal(reviveZerg(80, 10, 20).score, 20);
  assert.equal(reviveZerg(80, 97, 69).confirmed, true); // revives alone confirm (MasterR80 case)
  assert.equal(reviveZerg(80, 30, 76).confirmed, true); // crowd alone confirms
  assert.equal(reviveZerg(80, 74, 74).confirmed, false);
  assert.equal(reviveZerg(20, 99, 99).score, 20); // never raised
  assert.equal(crowdCheck(null, 40), 40);
  assert.equal(zergCleared({ players: { a: { zerg: "cleared" } } }, "a"), true);
  assert.equal(zergCleared({ players: {} }, "a"), false);
});

test("estimated 🪳: max of revives / crowd, only from p75", () => {
  assert.equal(zergEstimate(80, 40), 80);
  assert.equal(zergEstimate(30, 91), 91);
  assert.equal(zergEstimate(74, 70), null);
  assert.equal(zergEstimate(null, null), null);
});

test("zergScore applies rvp / crp; null keeps the old score", () => {
  const p = traitPools({ inflation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], apk: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
  const base = zergScore(p, 10, 1);
  assert.equal(base.score, 90);
  assert.equal(zergScore(p, 10, 1, 20).score, 20);
  assert.equal(zergScore(p, 10, 1, 20).raw, 90);
  assert.equal(zergScore(p, 10, 1, 90).confirmed, true);
  assert.equal(zergScore(p, 10, 1, 20, 80).score, 90);
  assert.equal(zergScore(p, 10, 1, 20, 80).confirmed, true);
  assert.equal(zergScore(p, 10, 1, 20, 80).chk, 80);
  assert.equal(zergScore(p, 10, 1, null, 30).score, 90 - Math.round(0.8 * 60));
});

test("Diff vehicle damp: median start, on-foot share, lower of 🛖 / 🚜", () => {
  assert.equal(vehDiffStart([5, 10, 30]), 10);
  assert.equal(vehDiffFactor(10, 10), null);
  assert.equal(vehDiffFactor(55, 10), 0.5);
  assert.equal(vehDiffFactor(100, 10), 0);
  const p = traitPools({ adjs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ivi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const g = aimGap(p, 10, 1, 0.8, 0.5);
  assert.equal(g.raw, 90);
  assert.equal(g.score, 45);
  assert.equal(g.by, "veh");
  assert.equal(aimGap(p, 10, 1, 0.4, 0.5).score, 36);
  assert.equal(aimGap(p, 10, 1, 0.4, 0.5).by, "hut");
  assert.equal(aimGap(p, 1, 10, null, 0.5).score, -90); // negative untouched
  assert.equal(vehDiffCleared({ players: { a: { vehDiff: "cleared" } } }, "a"), true);
  assert.equal(vehDiffCleared({ vehicleCutCleared: { b: {} }, players: {} }, "b"), true);
});
