// Commander focus (oracle-worker/src/focus.js). Fixture: Osprey Hossin 1-4-49349
// at minute 86.6, header NC 7.8 % / TR 85.1 %. NC then took Roothouse Distillery
// (cutting TR's Johari Cove) and won; the focus must have pointed there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusPlan, smoothWin, cutOff } from "../oracle-worker/src/focus.js";
import { ownership } from "../oracle-worker/src/commander.js";
import { regionMap, latticeFor, binGetter, captureModel } from "../oracle-worker/src/models.js";
import { territory, FACS } from "../oracle-worker/src/engine.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/focus-osprey-hossin-t86.json", import.meta.url), "utf8"));
const r2f = regionMap(4), L = latticeFor(4);
const own = ownership(F.z, r2f);
const t1 = territory(F.z), t0 = territory(F.z15);
const mom = Object.fromEntries(FACS.map((f) => [f, t1[f] - t0[f]]));
const header = Object.fromEntries(Object.entries(F.header).map(([k, v]) => [k, { pct: v }]));
const CM = captureModel(4);
const pf = (fid) => (CM[`${fid}|P1:pressured`] || {}).p ?? 0.33;   // as the Worker passes it
const plan = (t, extra = {}) => focusPlan({ own, lattice: L, getBin: binGetter(4), t, dur: 90, mom, header, pf, ...extra });

test("3.4 min left, one base decides: NC's focus is a capture that wins it, TR's is holding it", () => {
  const p = plan(F.t);
  const nc = p.NC;
  assert.equal(nc.focus.kind, "take");
  assert.equal(nc.focus.now, 7.8);
  assert.equal(nc.focus.then, 100);
  const all = [nc.focus, ...nc.backups];
  const rh = all.find((x) => x.bases[0] === "Roothouse Distillery");
  assert.ok(rh, JSON.stringify(all.map((x) => x.text)));
  assert.deepEqual(rh.cuts, ["Johari Cove"]);
  assert.match(rh.text, /cuts off 1 enemy base \(Johari Cove\)/);
  assert.equal(p.TR.focus.kind, "hold");
  assert.equal(p.TR.focus.then, 0, "if TR loses it, TR is out");
  assert.ok(nc.backups.length <= 2);
});

test("a faction that can't win any more gets a spoiler play against the leader", () => {
  const vs = plan(F.t).VS;
  assert.equal(vs.focus.kind, "spoil");
  assert.equal(vs.focus.leader, "TR");
  assert.ok(vs.focus.then < vs.focus.now);
});

test("with time left, a two-capture plan that sets up the cut beats its first step", () => {
  const p = plan(75, { header: null });
  assert.equal(p.NC.focus.kind, "plan", JSON.stringify(p.NC.focus));
  assert.deepEqual(p.NC.focus.bases, ["Hurakan Western Pass", "Roothouse Distillery"]);
  assert.ok(p.NC.focus.then > p.NC.focus.now + 10);
  const sets = [p.NC.focus, ...p.NC.backups].filter((x) => x.kind === "plan").map((x) => [...x.bases].sort().join("+"));
  assert.equal(new Set(sets).size, sets.length, "A-then-B and B-then-A shown once");
});

test("no moves after the end; Meltdowns skip the cut rule", () => {
  const p = plan(89.6);
  for (const f of FACS) assert.equal(p[f].quiet, true);
  const m = plan(F.t, { noCuts: true });
  assert.ok([m.NC.focus, ...m.NC.backups].every((x) => !x.cuts.length));
});

test("cutOff and smoothWin basics", () => {
  const { cut } = cutOff(own, L.adj, Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f])));
  assert.deepEqual([...cut].map((f) => L.names[f]), [], "nothing cut before the capture");
  const w = smoothWin(binGetter(4), { VS: 30, NC: 33, TR: 34 }, { VS: 0, NC: 0, TR: 0 }, 50, 90);
  assert.ok(Math.abs(FACS.reduce((s, f) => s + w[f], 0) - 100) < 1e-6);
  // Smooth across the tree's 5 % steps: one base more never lowers the odds by much, and moves them.
  const a = smoothWin(binGetter(4), { VS: 30, NC: 33.0, TR: 34 }, { VS: 0, NC: 0, TR: 0 }, 50, 90).NC;
  const b = smoothWin(binGetter(4), { VS: 30, NC: 34.1, TR: 32.9 }, { VS: 0, NC: 0, TR: 0 }, 50, 90).NC;
  assert.ok(b > a, `${a} -> ${b}`);
});
