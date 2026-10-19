// PS2Alerts history pipeline (oracle-worker/history): record compaction, cut-aware
// minute series (must agree with src/cut.js), tree growth shape, holdout scorer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compact } from "../oracle-worker/history/fetch.mjs";
import { prepare, growTree, growXtrunk, getterFor, evaluate } from "../oracle-worker/history/grow.mjs";
import { cutAwareSnap } from "../oracle-worker/src/cut.js";
import { territory } from "../oracle-worker/src/engine.js";
import { regionMap } from "../oracle-worker/src/models.js";

const S = JSON.parse(readFileSync(new URL("./fixtures/cut-end-snapshots.json", import.meta.url), "utf8"));

function recordFrom(key, flips = []) {
  const a = S[key], r2f = regionMap(a.zone);
  const init = Object.fromEntries(Object.entries(a.z).map(([r, v]) => [String(r2f[r]), +v]));
  return { id: key, world: 10, zone: a.zone, event: 154, start: 1_000_000, end: 1_000_000 + 5400, result: { victor: 2, draw: false }, init, flips };
}

test("compact: PS2Alerts instance + facility entries -> record (captures keep PS2Alerts' score)", () => {
  const inst = { instanceId: "10-46315", world: 10, zone: 4, censusMetagameEventType: 154, timeStarted: "2026-10-18T19:44:57.000Z", timeEnded: "2026-10-18T21:14:58.985Z",
    duration: 5400000, latticeVersion: "1.1", mapVersion: "1.0", result: { vs: 21, nc: 44, tr: 29, cutoff: 4, outOfPlay: 0, victor: 2, draw: false, perBasePercentage: 100 / 85 } };
  const entries = [
    { facility: 306000, isInitial: true, newFaction: 2, oldFaction: 2, timestamp: "2026-10-18T19:44:57.000Z" },
    { facility: 306000, isInitial: false, newFaction: 3, oldFaction: 2, timestamp: "2026-10-18T19:45:01.000Z", mapControl: { vs: 40, nc: 31, tr: 22, cutoff: 5, outOfPlay: 0 } },
    { facility: 306000, isInitial: false, newFaction: 3, oldFaction: 3, timestamp: "2026-10-18T19:50:01.000Z", isDefence: true },
  ];
  const c = compact(inst, entries);
  assert.deepEqual(c.init, { 306000: 2 });
  assert.deepEqual(c.flips, [[4, "306000", 3, 2]], "defences are not flips");
  assert.deepEqual(c.ctl, [[4, 40, 31, 22, 5], [304, 0, 0, 0, 0]].slice(0, 1));
  assert.equal(c.dur, 90);
  assert.equal(c.lattice, "1.1");
  assert.equal(c.result.cutoff, 4);
});

test("prepare: cut-aware minute series matches src/cut.js on a real end-of-alert map", () => {
  const p = prepare(recordFrom("10-4-46315"));
  assert.ok(!p.skip, JSON.stringify(p));
  const want = territory(cutAwareSnap(S["10-4-46315"].z, 4).snap);
  for (const f of ["VS", "NC", "TR"]) assert.ok(Math.abs(p.cut[0][f] - want[f]) < 1e-9, f);
  assert.equal(p.cutN[0], 4);
  assert.ok(p.raw[0].VS > p.cut[0].VS);
  assert.equal(p.raw.length, 91);
  assert.equal(prepare({ ...recordFrom("10-4-46315"), event: 177 }).skip, "meltdown");
  const bad = recordFrom("10-4-46315"); bad.init["999999"] = 1;
  assert.equal(prepare(bad).skip, "lattice mismatch");
});

test("prepare: minute series follow captures (VS loses its cut pocket at minute 10)", () => {
  const flips = ["291000", "300000", "300030", "302000"].map((fid, i) => [600 + i, fid, 2, 1]);
  const p = prepare(recordFrom("10-4-46315", flips));
  assert.equal(p.cutN[0], 4);
  assert.equal(p.raw[11].VS, p.cut[11].VS, "VS has nothing cut any more");
  assert.ok(p.raw[11].VS < p.raw[0].VS);
  assert.equal(p.raw[9].VS, p.raw[0].VS, "captures apply at their minute, not before");
});

test("growTree / evaluate: shapes and a scored holdout", () => {
  const al = [];
  for (let i = 0; i < 30; i++) al.push(prepare({ ...recordFrom("1-4-49349"), id: `x${i}`, result: { victor: 1 + (i % 3), draw: false } }));
  const t = growTree(al, "cut", 4);
  assert.equal(t.meta.alerts_used, 30);
  assert.ok(t.trunk["0,VS,6"] && t.trunk["0,VS,6"][1] === 30, JSON.stringify(Object.keys(t.trunk).slice(0, 5)));
  const x = growXtrunk(al, "cut");
  const ev = evaluate(al.slice(0, 3), { cut: { mode: "cut", getBin: () => getterFor(t, x) } });
  assert.equal(ev.cut.all.n, 3 * 89);
  assert.ok(ev.cut.all.brier > 0 && ev.cut.all.brier < 1);
});
