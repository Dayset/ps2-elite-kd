// Pair model (#92): pure aggregation + the committed pair-model.json shape.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { quantile, median, lognormalFit, measurePair, aggregate, validateModel } from "../replay/pair-model.mjs";

const pe = (t, aKill, o = {}) => ({ t, aKill, w: o.w ?? 0, hs: !!o.hs, aL: o.aL ?? 6, bL: o.bL ?? 13, veh: o.veh ?? 0, z: 0 });
const fights = (evs) => [{ t0: evs[0].t, t1: evs[evs.length - 1].t, ev: evs, a: evs.filter((e) => e.aKill).length, b: evs.filter((e) => !e.aKill).length, focus: 1, one: evs.length >= 3 }];

test("quantile interpolates and handles empty input", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([10, 20, 30], 0.1), 12);
  assert.equal(median([]), null);
});

test("lognormal fit recovers median and sigma", () => {
  const gaps = [60, 120, 240, 480];
  const f = lognormalFit(gaps);
  assert.ok(Math.abs(f.median - 169.7) < 1);
  assert.ok(f.sigma > 0.7 && f.sigma < 0.85);
  assert.deepEqual(lognormalFit([]), { median: null, sigma: null });
});

test("measurePair: gaps, revenge, streak, classes, crowding, mains", () => {
  // A kills at 0, 100 (streak), B revenges at 250, A kills at 300.
  const evs = [pe(0, true), pe(100, true), pe(250, false), pe(300, true)];
  const all = [
    [0, 1, "9", 0, 0, 0, 6, 13, 0], [100, 1, "9", 0, 0, 0, 6, 13, 0],
    [250, 0, "9", 0, 0, 0, 6, 13, 0], [300, 1, "9", 0, 0, 0, 6, 13, 0],
    [120, 1, "7", 0, 0, 0, 6, 10, 0], [260, 0, "8", 0, 0, 0, 6, 10, 0], // other events near kills
  ];
  const m = measurePair(evs, fights(evs), all, "pager", "9", { hsr: 0.2, veh: 0.1 }, { hsr: 0.3, veh: 0.2 }, 80, 90);
  assert.deepEqual(m.gaps, [100, 150, 50]);
  assert.deepEqual(m.revengeGaps, [250, 150, 50]); // A@0 -> B@250; A@100 -> B@250; B@250 -> A@300
  assert.equal(m.sameKiller, 1); assert.equal(m.consecutive, 3);
  assert.equal(m.crowdOther, 3); assert.equal(m.crowdWindows, 4); // 260 falls in both the 250 and the 300 windows
  assert.deepEqual(m.classMatch, { "ha vs ha": 4 });
  assert.equal(m.lifeHS, (3 * 0.2 + 1 * 0.3) / 4);
});

test("measurePair: main weapon and vehicle share count per killer", () => {
  const evs = [pe(0, true, { w: 80 }), pe(60, false, { w: 90, veh: 5 }), pe(120, true, { w: 81 })];
  const m = measurePair(evs, fights(evs), [], "pager", "9", { hsr: 0.2, veh: 0 }, { hsr: 0.2, veh: 0 }, 80, 90);
  assert.equal(m.mainKills, 2); assert.equal(m.vehKills, 1);
});

test("aggregate: bands split, defaults carry exactly the spec keys, complete-only shares", () => {
  const base = { fights: 2, killsPerFight: [2, 2], gaps: [60, 120], revengeGaps: [300], sameKiller: 1, consecutive: 3, oneFights: 1, totalFights: 2, hsKills: 1, pairKills: 4, lifeHS: 0.25, vehKills: 0, lifeVeh: 0.1, mainKills: 2, crowdOther: 4, crowdWindows: 4, classMatch: { "ha vs ha": 4 }, shareMeasured: 0.5 };
  const model = aggregate([
    { ...base, band: "10-23|<0.4", complete: 1, shareKillboard: 0.4, shareExpected: 0.45 },
    { ...base, band: "10-23|<0.4", complete: 0, shareMeasured: 0.9, shareKillboard: 0.9, shareExpected: 0.9 }, // truncated: excluded from shares + fightsPerPair
    { ...base, band: "48+|>0.6", complete: 1, shareKillboard: 0.6, shareExpected: 0.55 },
  ]);
  assert.equal(model.v, 1); assert.equal(model.pairs, 3);
  assert.deepEqual(Object.keys(model.bands).sort(), ["10-23|<0.4", "48+|>0.6"]);
  assert.deepEqual(Object.keys(model.defaults).sort(), ["classMatch", "crowdPerMin", "gapMedianS", "gapSigma", "hsFactor", "killsPerFight", "mainWeaponShare", "oneVoneShare", "revengeMedianS", "streakP", "vehFactor"]);
  assert.equal(model.bands["10-23|<0.4"].shareMeasured, 0.5);
  assert.equal(model.bands["10-23|<0.4"].shareKillboard, 0.4);
  assert.deepEqual(model.bands["10-23|<0.4"].fightsPerPair, [2, 2, 2]); // only the complete pair's fights
  assert.equal(model.defaults.streakP, 1 / 3);
  assert.deepEqual(validateModel(model), []);
});

test("validateModel rejects bad shapes and ranges", () => {
  assert.ok(validateModel(null).length > 0);
  assert.ok(validateModel({ v: 1, at: "x", pairs: 1, bands: {}, defaults: { streakP: 2 } }).includes("defaults.streakP out of range: 2"));
  assert.ok(validateModel({ v: 1, at: "x", pairs: 0, bands: {}, defaults: { killsPerFight: [5, 3, 9] } }).length > 0);
});

test("pair-model.json on disk (when present) passes shape and range checks", () => {
  const p = "data/replay/pair-model.json";
  if (!existsSync(p)) return; // the workflow commits it; before that, nothing to check
  const model = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(validateModel(model), [], "pair-model.json must validate");
  assert.ok(model.pairs >= 0 && Object.keys(model.bands).length >= 0);
});
