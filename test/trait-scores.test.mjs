// 🔀 Diff (public) + 🪳 Zerg (owner t480u–t487u): trait-scores.mjs percentiles.
import test from "node:test";
import assert from "node:assert/strict";
import { traitPools, aimGap, zergScore } from "../trait-scores.mjs";
import { diffEmoji } from "../trait-tips.mjs";

const pools = traitPools({
  adjs: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  ivi: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  inflation: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 3],
  apk: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
});

test("Diff = ⚔️ iVi percentile − IvI percentile (floored share below), signed", () => {
  assert.deepEqual(aimGap(pools, 1000, 10), { score: 90, raw: 90, hut: null, veh: null, nbd: null, by: null, practice: 90, theory: 0 }); // raw/hut/veh/by: 🛖 + 🔀🚜 damping fields (t504u)
  assert.deepEqual(aimGap(pools, 100, 100), { score: -90, raw: -90, hut: null, veh: null, nbd: null, by: null, practice: 0, theory: 90 });
  assert.equal(aimGap(pools, 550, 55).score, 0);
  assert.equal(aimGap(pools, NaN, 50), null);
  assert.equal(aimGap(pools, 500, null), null);
});

test("Zerg = the lower of the Inflation and Assists percentiles: solo farmers stay low", () => {
  assert.equal(zergScore(pools, 3, 1).score, 90); // both high → zerg
  assert.equal(zergScore(pools, 3, 0.1).score, 0); // high inflation, few assists → not zerg
  assert.equal(zergScore(pools, 1, 1).score, 0); // many assists, no inflation → not zerg
  assert.equal(zergScore(pools, 2, null), null); // no 🤝 (under 100 session kills) → "—"
});

test("values are rounded like ranks-lite.json, so Stats and Rankings agree", () => {
  assert.equal(aimGap(pools, 500.04, 50.04).score, aimGap(pools, 500, 50).score);
});

test("Diff thirds: ≤ −33 🤥, ≥ +33 😤, balanced in between", () => {
  assert.equal(diffEmoji(-33), "🤥");
  assert.equal(diffEmoji(-32), "");
  assert.equal(diffEmoji(32), "");
  assert.equal(diffEmoji(33), "😤");
  assert.equal(diffEmoji(NaN), "");
});
