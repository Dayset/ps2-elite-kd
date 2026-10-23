import test from "node:test";
import assert from "node:assert/strict";
import { nbdCuts, newbieFactor, newbieCleared } from "../newbie-diff.mjs";
import { traitPools, aimGap } from "../trait-scores.mjs";

test("🐣 ramp ends: p5 → median of play minutes", () => {
  const c = nbdCuts(Array.from({ length: 100 }, (_, i) => (i + 1) * 60).concat([NaN, null, 0]));
  assert.equal(c.lo, 6 * 60);
  assert.equal(c.hi, 51 * 60);
  assert.equal(c.n, 100);
});

test("🐣 factor: 0 at/below lo, log-smooth, none at/above hi or without play time", () => {
  const c = { lo: 60, hi: 960 };
  assert.equal(newbieFactor(30, c), 0);
  assert.equal(newbieFactor(60, c), 0);
  assert.equal(newbieFactor(240, c), 0.5); // ln 4 ÷ ln 16
  assert.equal(newbieFactor(960, c), null);
  assert.equal(newbieFactor(NaN, c), null);
  assert.equal(newbieFactor(null, c), null);
  assert.ok(newbieFactor(239, c) < newbieFactor(241, c)); // no step
  assert.equal(newbieCleared({ players: { a: { newbieDiff: "cleared" } } }, "a"), true);
  assert.equal(newbieCleared({ players: { a: { hut: "cleared" } } }, "a"), false);
});

test("aimGap: nbd scales only a negative Diff", () => {
  const p = traitPools({ adjs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ivi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const neg = aimGap(p, 1, 10, null, null, 0.5);
  assert.equal(neg.raw, -90);
  assert.equal(neg.score, -45);
  assert.equal(neg.by, "nbd");
  assert.equal(aimGap(p, 1, 10, null, null, 0).score, 0);
  assert.ok(Object.is(aimGap(p, 1, 10, null, null, 0).score, 0)); // no −0
  const pos = aimGap(p, 10, 1, null, null, 0.5);
  assert.equal(pos.score, 90);
  assert.equal(pos.nbd, null);
  assert.equal(pos.by, null);
});
