// 🛖 safe-spot Diff damping (owner t504u / t505u): data-derived cuts, soft gates, damping, owner override.
import test from "node:test";
import assert from "node:assert/strict";
import { hutCuts, hutParts, hutFactor, hutDamp, hutCleared, deathsPerMin, HUT_ACT_MULT, HUT_MARK_MIN } from "../hut.mjs";
import { traitPools, aimGap } from "../trait-scores.mjs";
import { applyHutColumn, LITE_COLS } from "../scripts/build-ranks.mjs";

// 100 players: act 0.01…1.00, dpm 0.01…1.00 (kpm = dpm × kd with kd 1), acc 1…100.
const pop = Array.from({ length: 100 }, (_, i) => ({ act: (i + 1) / 100, kpm: (i + 1) / 100, kd: 1, acc: i + 1, inf: 90 }));
const cuts = hutCuts(pop);

test("cuts come from the population", () => {
  assert.equal(cuts.actMedian, 0.505);
  assert.ok(Math.abs(cuts.actCut - 0.505 * HUT_ACT_MULT) < 1e-12);
  assert.equal(cuts.dpmLo, 0.11); // value at the p10 position
  assert.equal(cuts.dpmHi, 0.21);
  assert.equal(cuts.accLo, 50.5);
  assert.equal(cuts.accHi, 61);
  assert.deepEqual([cuts.infLo, cuts.infHi], [75, 85]);
  assert.ok(Math.abs(deathsPerMin(0.6, 3) - 0.2) < 1e-12);
  assert.ok(Number.isNaN(deathsPerMin(0.6, 0)));
});

test("full gate: factor = (Activity ÷ cut)²; Activity at the cut → no change", () => {
  const p = { act: cuts.actCut / 2, kpm: 0.05, kd: 1, acc: 10, inf: 95 };
  assert.ok(Math.abs(hutFactor(p, cuts) - 0.25) < 1e-12);
  assert.equal(hutFactor({ ...p, act: cuts.actCut }, cuts), null);
  assert.equal(hutFactor({ ...p, act: 5 }, cuts), null);
});

test("soft ramps: halfway through each band halves the weight; outside a band → no change", () => {
  const base = { act: 0, kpm: 0.05, kd: 1, acc: 10, inf: 95 };
  assert.equal(hutParts(base, cuts).w, 1);
  const midDpm = hutParts({ ...base, kpm: (cuts.dpmLo + cuts.dpmHi) / 2 }, cuts);
  assert.ok(Math.abs(midDpm.wDpm - 0.5) < 1e-9);
  assert.ok(Math.abs(midDpm.m - 0.5) < 1e-9); // a = 0 → m = 1 − w
  assert.ok(Math.abs(hutParts({ ...base, inf: 80 }, cuts).wInf - 0.5) < 1e-9);
  assert.ok(Math.abs(hutParts({ ...base, acc: (cuts.accLo + cuts.accHi) / 2 }, cuts).wAcc - 0.5) < 1e-9);
  assert.equal(hutFactor({ ...base, kpm: cuts.dpmHi }, cuts), null);
  assert.equal(hutFactor({ ...base, inf: 75 }, cuts), null);
  assert.equal(hutFactor({ ...base, acc: cuts.accHi }, cuts), null);
  // No cliff: a tiny step past the deaths/min p10 cut barely moves the factor.
  const a = hutFactor({ ...base, kpm: cuts.dpmLo }, cuts), b = hutFactor({ ...base, kpm: cuts.dpmLo + 1e-6 }, cuts);
  assert.ok(Math.abs(a - b) < 1e-3);
  assert.equal(hutParts({ ...base, acc: null }, cuts), null);
});

test("damping touches positive Diff only", () => {
  assert.equal(hutDamp(40, 0.25), 10);
  assert.equal(hutDamp(-40, 0.25), -40);
  assert.equal(hutDamp(40, null), 40);
  const tp = traitPools({ adjs: [1, 2, 3, 4], ivi: [4, 3, 2, 1] });
  const g = aimGap(tp, 4, 1, 0.5);
  assert.equal(g.raw, 75);
  assert.equal(g.score, 38);
  assert.equal(g.hut, 0.5);
  assert.equal(aimGap(tp, 1, 4, 0.5).score, -75);
  assert.equal(aimGap(tp, 4, 1).score, 75);
});

test("owner override in reviewed.json", () => {
  const rv = { players: { a: { hut: "cleared" }, b: { decision: "padding" } } };
  assert.equal(hutCleared(rv, "a"), true);
  assert.equal(hutCleared(rv, "b"), false);
  assert.equal(hutCleared(null, "a"), false);
});

test("build: trailing hut / hutMk columns, status list, cleared player gets nothing", () => {
  const cols = ["name", "slug", "act", "kpm", "kd", "acc", "inf", "adjs", "ivi"];
  const rows = pop.map((p, i) => [`P${i}`, `p${i}`, p.act, p.kpm, p.kd, p.acc, p.inf, i, 100 - i]);
  // Two campers: high iVi, low IvI, slow, rarely die, poor aim, all infantry.
  rows.push(["Camper", "camper", 0.05, 0.02, 1, 5, 99, 200, -5], ["Cleared", "cleared", 0.05, 0.02, 1, 5, 99, 200, -5]);
  const ranks = { cols: cols.slice(), rows };
  const st = applyHutColumn(ranks, { players: { cleared: { hut: "cleared" } } });
  const ih = ranks.cols.indexOf("hut"), im = ranks.cols.indexOf("hutMk");
  assert.ok(ih > 0 && im === ih + 1);
  assert.ok(ranks.rows.every((r) => r.length === ranks.cols.length));
  const camper = ranks.rows.find((r) => r[1] === "camper"), cleared = ranks.rows.find((r) => r[1] === "cleared");
  assert.ok(camper[ih] > 0 && camper[ih] < 0.05);
  assert.equal(camper[im], 1);
  assert.equal(cleared[ih], null);
  assert.equal(cleared[im], null);
  const c = st.players.find((p) => p.slug === "camper");
  assert.ok(c.diffRaw - c.diff >= HUT_MARK_MIN && c.marked);
  assert.equal(st.cleared.length, 1);
  assert.equal(st.cleared[0].slug, "cleared");
  assert.ok(st.players.every((p) => p.slug !== "cleared"));
  assert.ok(st.marked <= st.reduced);
  assert.ok(LITE_COLS.includes("hut") && LITE_COLS.includes("hutMk"));
});
