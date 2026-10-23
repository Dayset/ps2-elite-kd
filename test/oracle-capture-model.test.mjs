// Per-base capture chances for every continent (oracle-worker/history/capture-model.mjs,
// "Model B" of oracle/backend/hossin_models.py) and the bundled models (#63).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addAlert, pack, wilson, fromRecord, fromBundle, compare } from "../oracle-worker/history/capture-model.mjs";
import { captureModel } from "../oracle-worker/src/models.js";

// a — b — c
const adj = new Map([["a", new Set(["b"])], ["b", new Set(["a", "c"])], ["c", new Set(["b"])]]);

test("addAlert: frontier, pressure and 15-minute capture window per 5-minute sample", () => {
  const glob = new Map(), fac = new Map();
  // c goes TR -> NC at min 3 (pressure on b), NC takes b at min 8, nothing else.
  addAlert({ dur: 30, init: new Map([["a", 1], ["b", 1], ["c", 3]]), flips: [[3, "c", 2], [8, "b", 2]] }, adj, glob, fac);
  assert.deepEqual(Object.fromEntries(fac), { "b|P0:none": [3, 0], "c|P0:none": [2, 0], "b|P1:pressured": [1, 1], "a|P1:pressured": [2, 0] });
  assert.deepEqual(Object.fromEntries(glob), { "P0:none|early:0-30": [5, 0], "P1:pressured|early:0-30": [3, 1] });
});

test("pack: minimum sample size, rounded p and Wilson interval like the Python", () => {
  const out = pack(new Map([["x|P1:pressured", [40, 10]], ["y|P1:pressured", [29, 29]]]), 30);
  assert.deepEqual(Object.keys(out), ["x|P1:pressured"]);
  assert.equal(out["x|P1:pressured"].p, 0.25);
  assert.deepEqual(out["x|P1:pressured"].ci, wilson(0.25, 40));
  assert.deepEqual(wilson(0.5, 0), [0, 0]);
});

test("fromRecord / fromBundle: both sources give the same timeline; Meltdowns are skipped", () => {
  const rec = { id: 7, world: 10, zone: 2, event: 147, start: 1000, end: 1000 + 5400, init: { a: 1, b: 2 }, flips: [[120, "a", 2, 1]] };
  const tl = fromRecord(rec);
  assert.equal(tl.dur, 90);
  assert.deepEqual([...tl.init], [["a", 1], ["b", 2]]);
  assert.deepEqual(tl.flips, [[2, "a", 2]]);
  assert.equal(fromRecord({ ...rec, event: 176 }), null);
  const b = fromBundle({ key: "10-2-7", zone: 2, event_id: 147, dur: 90, frames: [{ t: 0, set: { a: "VS", b: "NC" } }, { t: 2, set: { a: "NC" } }] });
  assert.deepEqual([...b.init], [...tl.init]);
  assert.deepEqual(b.flips, tl.flips);
});

test("compare: identical models agree perfectly", () => {
  const m = { global: { g: { p: 0.3 } }, per_facility: { "1|P1:pressured": { n: 200, p: 0.2 }, "2|P1:pressured": { n: 200, p: 0.4 }, "3|P1:pressured": { n: 200, p: 0.5 } } };
  const c = compare(m, m);
  assert.equal(c.n, 3); assert.equal(c.r, 1); assert.equal(c.mad, 0);
});

test("bundled capture models: every continent with a model has pressured values in 0..1", () => {
  for (const z of [2, 4, 6, 8]) {
    const pf = captureModel(z);
    const pressured = Object.entries(pf).filter(([k]) => k.endsWith("|P1:pressured"));
    if (z === 4) assert.ok(pressured.length > 50, "Hossin model present");
    for (const [, v] of pressured) assert.ok(v.p >= 0 && v.p <= 1 && v.n >= 30);
  }
});
