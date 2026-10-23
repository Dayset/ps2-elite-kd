import test from "node:test";
import assert from "node:assert/strict";
import { revivedShare, reviveWeight, reviveZerg, zergCleared } from "../zerg-revive.mjs";
import { vehDiffStart, vehDiffFactor, vehDiffCleared } from "../diff-vehicle.mjs";
import { traitPools, aimGap, zergScore } from "../trait-scores.mjs";

test("revivedShare: revives ÷ enemy-player deaths, sample minimum", () => {
  const xp = { kills_counted: 150, totals: { r: { 1: [80, 0], 29: [20, 0], 7: [30, 0], 53: [10, 0] } } };
  assert.deepEqual(revivedShare(xp), { share: 0.4, revived: 40, deaths: 100, kills: 150 });
  assert.equal(revivedShare({ ...xp, kills_counted: 99 }), null);
  assert.equal(revivedShare({ kills_counted: 150, totals: { r: { 1: [49, 0] } } }), null);
  assert.equal(revivedShare(null), null);
});

test("revive check: soften only a high Zerg, never raise, confirm at p75", () => {
  assert.equal(reviveWeight(10), 1);
  assert.equal(reviveWeight(50), 0);
  assert.equal(reviveWeight(37.5), 0.5);
  assert.deepEqual(reviveZerg(80, 10), { score: 10, w: 1, confirmed: false, softened: true });
  assert.equal(reviveZerg(80, 40).score, 80 - Math.round(0.4 * 40));
  assert.equal(reviveZerg(5, 10).score, 5); // low Zerg untouched
  assert.equal(reviveZerg(80, 60).score, 80);
  assert.equal(reviveZerg(80, 80).confirmed, true);
  assert.equal(reviveZerg(80, null).score, 80); // no data → unchanged
  assert.equal(zergCleared({ players: { a: { zerg: "cleared" } } }, "a"), true);
  assert.equal(zergCleared({ players: {} }, "a"), false);
});

test("zergScore applies rvp; null rvp keeps the old score", () => {
  const p = traitPools({ inflation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], apk: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
  const base = zergScore(p, 10, 1);
  assert.equal(base.score, 90);
  assert.equal(zergScore(p, 10, 1, 20).score, 20);
  assert.equal(zergScore(p, 10, 1, 20).raw, 90);
  assert.equal(zergScore(p, 10, 1, 90).confirmed, true);
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
