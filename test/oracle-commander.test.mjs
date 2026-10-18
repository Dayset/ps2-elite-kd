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
