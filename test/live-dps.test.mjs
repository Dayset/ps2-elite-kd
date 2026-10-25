// imaginary DPS (owner 2026-10-25): kills +1000, assists +500, exponential
// drain with a 10 s time constant, so the value jumps and drains down.
import test from "node:test";
import assert from "node:assert/strict";
import { dpsNow, DPS_HP, DPS_ASSIST, DPS_TAU_MS, DPS_ASSIST_XP, cashTotals, cashFormula } from "../live-model.mjs";

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("DPS constants: one player 1000 HP, assist half a kill, 10 s drain", () => {
  assert.equal(DPS_HP, 1000);
  assert.equal(DPS_ASSIST, 500);
  assert.equal(DPS_TAU_MS, 10000);
  assert.deepEqual([...DPS_ASSIST_XP].sort((a, b) => a - b), [2, 3, 371, 372]);
});

test("a kill jumps to 100 and drains exponentially", () => {
  const ev = [{ t: 0, dmg: 1000 }];
  assert.equal(dpsNow(ev, 0), 100);
  close(dpsNow(ev, 10000), 100 / Math.E);
  close(dpsNow(ev, 20000), 100 / Math.E ** 2);
});

test("kills and assists add up; old and future events do not count", () => {
  assert.equal(dpsNow([{ t: 0, dmg: 1000 }, { t: 0, dmg: 500 }], 0), 150);
  close(dpsNow([{ t: 0, dmg: 1000 }, { t: 10000, dmg: 1000 }], 10000), 100 + 100 / Math.E);
  assert.equal(dpsNow([{ t: 0, dmg: 1000 }], 60000), 0); // drained past the window
  assert.equal(dpsNow([{ t: 10000, dmg: 1000 }], 0), 0); // future damage is not damage yet
  assert.equal(dpsNow([], 0), 0);
});

test("cashFormula (owner 2026-10-25): the pot shows its own arithmetic", () => {
  assert.equal(cashFormula([]), "0");
  assert.equal(cashFormula([null, undefined]), "0");
  assert.equal(cashFormula([300]), "300");
  assert.equal(cashFormula([300, 500, 434]), "1234 (300 + 500 + 434)");
  assert.equal(cashFormula([0, 500]), "500 (0 + 500)"); // a known 0 counts and shows
  assert.equal(cashFormula([null, 200, null]), "200"); // unknowns never shown
});

test("cashTotals: one entry per kill, unknown iVi skipped from sum and count", () => {
  assert.deepEqual(cashTotals([]), { sum: 0, count: 0, avg: null });
  assert.deepEqual(cashTotals([2746, 1403]), { sum: 4149, count: 2, avg: 2074.5 });
  assert.deepEqual(cashTotals([2746, null, 1403, undefined, NaN]), { sum: 4149, count: 2, avg: 2074.5 });
  assert.deepEqual(cashTotals([null, null]), { sum: 0, count: 0, avg: null });
  assert.deepEqual(cashTotals([1000, 1000]), { sum: 2000, count: 2, avg: 1000 }); // a repeat victim pays again
});
