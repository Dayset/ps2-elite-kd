// PS2MapOracle odds engine: the JS port must reproduce the Python engine
// (push_live_state.compute_win / second_place) on 400 random fixtures, and the
// committed per-bin model file must match the model JSON in oracle/backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModels } from "../oracle-worker/build-trees.mjs";
import { TREE_BINS, XTRUNK_BINS, REGION_TO_FACILITY } from "../oracle-worker/src/models.gen.js";
import { binGetter } from "../oracle-worker/src/models.js";
import { computeWin, secondPlace, timeBin, maxSwingPP, territory, brier, scoreWinner, sliceMinutes, buildState } from "../oracle-worker/src/engine.js";

const cases = JSON.parse(readFileSync(new URL("./fixtures/oracle-parity.json", import.meta.url), "utf8"));
const close = (a, b, tol = 0.11) => Math.abs(a - b) <= tol;

test("models.gen.js is up to date with oracle/backend (run node oracle-worker/build-trees.mjs)", () => {
  const m = buildModels();
  assert.deepEqual(TREE_BINS, m.trees);
  assert.deepEqual(XTRUNK_BINS, m.xtrunk);
  assert.deepEqual(REGION_TO_FACILITY, m.regions);
});

test("computeWin matches Python on 400 fixtures (levels exact, pct within rounding)", () => {
  let mism = 0;
  for (const c of cases) {
    const { win, raw, trunkv } = computeWin(binGetter(c.zone), c.terr, c.mom, c.t, c.dur);
    for (const f of ["VS", "NC", "TR"]) {
      assert.equal(win[f].level, c.win[f].level, `level ${JSON.stringify(c)}`);
      assert.equal(win[f].n, c.win[f].n);
      assert.ok(close(raw[f], c.raw[f], 1e-9), `raw ${f}`);
      assert.ok(close(trunkv[f], c.trunkv[f], 1e-9), `trunk ${f}`);
      if (win[f].pct !== c.win[f].pct) mism++;
      assert.ok(close(win[f].pct, c.win[f].pct), `pct ${f}: js ${win[f].pct} py ${c.win[f].pct}`);
    }
  }
  assert.ok(mism <= cases.length * 0.05, `too many rounding differences: ${mism}`);
});

test("secondPlace matches Python", () => {
  for (const c of cases) {
    const { raw, trunkv } = computeWin(binGetter(c.zone), c.terr, c.mom, c.t, c.dur);
    const sp = secondPlace(c.terr, raw, trunkv, c.t, c.dur);
    if (!c.second) { assert.equal(sp, null); continue; }
    assert.equal(sp.locked, c.second.locked);
    assert.equal(sp.basis, c.second.basis);
    for (const [f, v] of Object.entries(c.second.odds)) assert.ok(close(sp.odds[f], v), `second ${f}`);
  }
});

test("time bins rescale short alerts to the 90-minute phase", () => {
  assert.equal(timeBin(0, 90), 0);
  assert.equal(timeBin(30, 45), 12);
  assert.equal(timeBin(200, 90), 18);
  assert.equal(maxSwingPP(90, 90), 0);
});

test("territory counts neutral facilities in the denominator", () => {
  assert.deepEqual(territory({ a: "1", b: "1", c: "2", d: "0" }), { VS: 50, NC: 25, TR: 0 });
});

test("settlement helpers", () => {
  assert.equal(scoreWinner({ VS: 32.9, NC: 31.8, TR: 35.3 }), "TR");
  assert.equal(scoreWinner({ VS: 30, NC: 30, TR: 10 }), "draw");
  assert.ok(Math.abs(brier({ VS: 1 / 3, NC: 1 / 3, TR: 1 / 3 }, "VS") - 0.2222) < 1e-3);
  assert.deepEqual(Object.keys(sliceMinutes(45)), ["t0", "t15", "t30"]);
});

test("buildState emits the push_live contract", () => {
  const snap = {};
  const r2f = REGION_TO_FACILITY["4"];
  Object.keys(r2f).forEach((r, i) => { snap[r] = String((i % 3) + 1); });
  const st = buildState({ getBin: binGetter(4), world: 1, zone: 4, eventId: 153, instanceId: 1, startTs: 1000, dur: 90, now: 1000 + 40 * 60, snapNow: snap, snap15: snap, regionMap: r2f });
  for (const k of ["ts", "t", "live", "alert", "territory", "momentum", "win", "leader", "owners", "calls", "hints"]) assert.ok(k in st, k);
  assert.equal(st.t, 40);
  assert.equal(Object.keys(st.owners).length, Object.keys(r2f).length);
  const sum = st.win.VS.pct + st.win.NC.pct + st.win.TR.pct;
  assert.ok(Math.abs(sum - 100) < 0.5, `win sums to ${sum}`);
});
