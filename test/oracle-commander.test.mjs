// AI Commander JS port vs the real Python commander_live.py --json on 60
// realistic random alert states (all five continents, 90/45/30-min alerts,
// cuts, locked winners, fight-up deviations, heat bursts).
// Regenerate: PYTHONHASHSEED=0 python3 oracle-worker/make-commander-fixture.py
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCommander, ownership, pyRound } from "../oracle-worker/src/commander.js";
import { binGetter, latticeFor, captureModel, resistanceModel, regionMap } from "../oracle-worker/src/models.js";

// Python prints -0.0 for tiny negative swings; the port normalises to 0 (same value).
const cases = JSON.parse(readFileSync(new URL("./fixtures/commander-parity.json", import.meta.url), "utf8"),
  (k, v) => (Object.is(v, -0) ? 0 : v));

function runCase(c) {
  const r2f = regionMap(c.zone);
  return runCommander({
    world: 99, zone: c.zone, startTs: c.start, t: c.at, dur: c.dur,
    own: ownership(c.regs_now, r2f), own15: ownership(c.regs_15, r2f), flips: c.flips,
    lattice: latticeFor(c.zone), pf: captureModel(c.zone), res: resistanceModel(c.zone), getBin: binGetter(c.zone),
  });
}

test("pyRound matches Python round() on ties", () => {
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(-0.5), 0);
});

test("commander matches Python on 60 alert states", () => {
  let n = 0;
  for (const c of cases) {
    const js = runCase(c);
    assert.deepEqual(js, c.out, `case ${n} zone ${c.zone} dur ${c.dur} at ${c.at}`);
    n++;
  }
  assert.equal(n, 60);
});

test("commander runs fast enough for the Worker's CPU budget", () => {
  const t0 = performance.now();
  for (const c of cases) runCase(c);
  const per = (performance.now() - t0) / cases.length;
  assert.ok(per < 15, `avg ${per.toFixed(2)} ms per alert`);
});

test("🥶: almost-cut needs real fighting at the chokepoint; real cuts always freeze (Amerish 2026-10-18)", async () => {
  const { latticeFor, regionMap, captureModel, resistanceModel, binGetter } = await import("../oracle-worker/src/models.js");
  const c = JSON.parse(readFileSync(new URL("./fixtures/commander-freeze-amerish.json", import.meta.url), "utf8"));
  const FAC = { 1: "VS", 2: "NC", 3: "TR" };
  const run = (flips) => runCommander({
    world: 10, zone: 6, startTs: c.start_ts, t: (c.now - c.start_ts) / 60, dur: c.dur,
    own: ownership(c.regs, regionMap(6)), own15: null,
    flips: flips.map(([ts, fac, o, n]) => [ts, FAC[n], FAC[o], String(fac)]),
    lattice: latticeFor(6), pf: captureModel(6), res: resistanceModel(6), getBin: binGetter(6),
  });
  const def = (cmd, f, name) => cmd.factions[f].defend.find((d) => d.name === name);
  // Raven Landing's only link home is Auraxis Firearms Corp., which touches TR.
  // TR took AuraxiCom Substation (next to the chokepoint) 6 min ago: almost cut.
  const live = run(c.flips);
  assert.deepEqual([def(live, "VS", "Raven Landing").freezing, def(live, "VS", "Raven Landing").cut_off], [true, false]);
  // Without that capture the chokepoint only touches the enemy: the old rule froze it, the new one doesn't.
  const quiet = run(c.flips.filter(([, fac]) => fac !== 222190));   // AuraxiCom Substation
  assert.equal(def(quiet, "VS", "Raven Landing").freezing, false);
  // The Ascent: every lattice neighbour is enemy, genuinely cut off, frozen either way.
  for (const cmd of [live, quiet]) assert.deepEqual([def(cmd, "TR", "The Ascent").freezing, def(cmd, "TR", "The Ascent").cut_off], [true, true]);
});
