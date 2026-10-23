// "All moves" defend list on the cut-aware win drop (oracle-worker/src/defend.js, #63).
// Fixture: Osprey Hossin 1-4-49349 (NC took Roothouse Distillery, cutting TR's
// Johari Cove, and won).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusPlan } from "../oracle-worker/src/focus.js";
import { cutAwareDefends } from "../oracle-worker/src/defend.js";
import { ownership, runCommander } from "../oracle-worker/src/commander.js";
import { regionMap, latticeFor, binGetter, captureModel, resistanceModel } from "../oracle-worker/src/models.js";
import { territory, FACS } from "../oracle-worker/src/engine.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/focus-osprey-hossin-t86.json", import.meta.url), "utf8"));
const r2f = regionMap(4), L = latticeFor(4), own = ownership(F.z, r2f);
const t1 = territory(F.z), t0 = territory(F.z15);
const mom = Object.fromEntries(FACS.map((f) => [f, t1[f] - t0[f]]));
const header = Object.fromEntries(Object.entries(F.header).map(([k, v]) => [k, { pct: v }]));
const CM = captureModel(4), pf = (fid) => (CM[`${fid}|P1:pressured`] || {}).p ?? 0.33;
const START = 1_000_000;

function lists(t) {
  const holds = {};
  const plan = focusPlan({ own, lattice: L, getBin: binGetter(4), t, dur: 90, mom, header, pf, holds });
  const def = cutAwareDefends({ holds, own, lattice: L, flips: [], nowTs: START + Math.round(t * 60), res: resistanceModel(4) });
  const raw = runCommander({ world: 1, zone: 4, startTs: START, t, dur: 90, own, own15: ownership(F.z15, r2f), flips: [],
    lattice: L, pf: CM, res: resistanceModel(4), getBin: binGetter(4) });
  return { plan, def, raw };
}

test("a chokepoint the raw list missed shows up with what losing it cuts off", () => {
  const { def, raw } = lists(60);
  const cairn = def.TR.find((d) => d.name === "Cairn Station");
  assert.ok(cairn, JSON.stringify(def.TR.map((d) => d.name)));
  assert.equal(cairn.cuts, 4);
  assert.deepEqual(cairn.cut_names, ["Hurakan", "Hurakan Secure Storage", "Hurakan Western Pass"]);
  assert.ok(cairn.win_drop >= 10, `cut-aware drop ${cairn.win_drop}`);
  assert.ok(!raw.factions.TR.defend.some((d) => d.name === "Cairn Station"), "the parity list never showed it");
});

test("cut rows come first, ranked by expected loss: Roothouse (decided the alert) before Cairn", () => {
  const { def, plan } = lists(+F.t);
  assert.deepEqual(def.TR.slice(0, 2).map((d) => d.name), ["Roothouse Distillery", "Cairn Station"]);
  assert.deepEqual(def.TR[0].cut_names, ["Johari Cove"]);
  // Same verdict as the focus hold: if TR loses it, TR is out.
  assert.equal(plan.TR.focus.kind, "hold");
  assert.equal(plan.TR.focus.then, 0);
  assert.equal(def.TR[0].win_drop, 100);
  assert.equal(def.TR[0].priority, 100);
});

test("rows keep runCommander's shape plus cuts / cut_names; at most three per faction", () => {
  const { def, raw } = lists(60);
  const keys = Object.keys(raw.factions.TR.defend[0]).sort();
  for (const f of FACS) {
    assert.ok(def[f].length <= 3);
    for (const d of def[f]) {
      assert.deepEqual(Object.keys(d).filter((k) => k !== "cuts" && k !== "cut_names").sort(), keys);
      assert.ok(d.win_drop >= 0 && d.priority >= 0 && d.priority <= 100);
      assert.equal(d.cut_names.length, Math.min(3, d.cuts));
    }
  }
});

test("a small cut (under 2 % of win chance) is ranked on expected loss like any other base", () => {
  const { def } = lists(30);
  const rh = def.TR.find((d) => d.name === "Roothouse Distillery");
  assert.ok(rh && rh.cuts === 1 && rh.win_drop < 2);
  assert.equal(def.TR[0].name, "Cairn Station");
});

test("no threatened bases: nothing replaces the parity list", () => {
  assert.deepEqual(cutAwareDefends({ holds: {}, own, lattice: L, nowTs: START, res: {} }), {});
  assert.deepEqual(cutAwareDefends({ holds: null, own, lattice: L, nowTs: START }), {});
});
