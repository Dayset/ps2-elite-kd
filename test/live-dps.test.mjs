// imaginary DPS (owner 2026-10-25): kills +1000, assists +500, exponential
// drain with a 10 s time constant, so the value jumps and drains down.
import test from "node:test";
import assert from "node:assert/strict";
import { dpsNow, DPS_HP, DPS_ASSIST, DPS_TAU_MS, DPS_ASSIST_XP, cashTotals, cashFormula, median, combatHoldMs, spawnRunHoldMs } from "../live-model.mjs";

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
  assert.equal(cashFormula([402, 670, 582], 34), "1654 (402 + 670 + 582)+34%");
  assert.equal(cashFormula([402], 34), "402+34%");
  assert.equal(cashFormula([], 34), "0");
  assert.equal(cashFormula([0], 34), "0"); // a pot of nothing carries no suffix
  assert.equal(cashFormula([0, 0], 34), "0");
});

test("dpsNow tau (owner 2026-10-25): longer tau lowers the spike, keeps old events", () => {
  const now = 1000000;
  assert.equal(dpsNow([{ t: now, dmg: 1000 }], now, 60000), 1000 / 60);
  assert.ok(Math.abs(dpsNow([{ t: now - 61000, dmg: 1000 }], now, 60000) - 1000 * Math.exp(-61 / 60) / 60) < 1e-9);
  assert.equal(dpsNow([{ t: now - 61000, dmg: 1000 }], now), 0); // default 10 s still cuts at 60 s
});

test("cashTotals: one entry per kill, unknown iVi skipped from sum and count", () => {
  assert.deepEqual(cashTotals([]), { sum: 0, count: 0, avg: null });
  assert.deepEqual(cashTotals([2746, 1403]), { sum: 4149, count: 2, avg: 2074.5 });
  assert.deepEqual(cashTotals([2746, null, 1403, undefined, NaN]), { sum: 4149, count: 2, avg: 2074.5 });
  assert.deepEqual(cashTotals([null, null]), { sum: 0, count: 0, avg: null });
  assert.deepEqual(cashTotals([1000, 1000]), { sum: 2000, count: 2, avg: 1000 }); // a repeat victim pays again
});

test("hold (owner 2026-10-25): the decay clock starts after the average gap", () => {
  const ev = [{ t: 0, dmg: 1000 }];
  assert.equal(dpsNow(ev, 5000, 10000, 10000), 100); // inside the hold: flat at full
  close(dpsNow(ev, 15000, 10000, 10000), 100 / Math.sqrt(Math.E)); // 5 s past the hold (close: 1-ULP float noise, not a value miss)
  assert.equal(dpsNow(ev, 71000, 10000, 10000), 0); // past 6τ + hold: gone
  close(dpsNow(ev, 5000, 10000, 0), 100 / Math.sqrt(Math.E)); // no hold: old decay
  close(dpsNow(ev, 5000, 10000, -100), 100 / Math.sqrt(Math.E)); // negative hold ignored
});

test("combatHoldMs: median within-run gap; a gap with a death inside is a spawn run", () => {
  assert.equal(combatHoldMs([0, 30000, 60000], []), 30000);
  assert.equal(combatHoldMs([0, 30000, 60000], [45000]), 30000); // only the clean gap counts
  assert.equal(combatHoldMs([0, 30000], [15000]), 0); // the only gap spans a death
  assert.equal(combatHoldMs([5000], []), 0); // one spike: no gap yet
  assert.equal(combatHoldMs([], []), 0);
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // trailing 10: 12 gaps of 1..12 s → median of the last 10 (3..12) is 7.5 s
  const spikes = [0]; for (let i = 1; i <= 12; i++) spikes.push(spikes[i - 1] + i * 1000);
  assert.equal(combatHoldMs(spikes, []), 7500);
});

test("spawnRunHoldMs: median death→next-spike run; open runs contribute nothing", () => {
  assert.equal(spawnRunHoldMs([0, 100000], [30000, 130000]), 30000);
  assert.equal(spawnRunHoldMs([0, 100000], [30000]), 30000); // second death's run still open
  assert.equal(spawnRunHoldMs([0], []), 0);
  assert.equal(spawnRunHoldMs([], [30000]), 0);
  assert.equal(spawnRunHoldMs([0], [0]), 0); // a spike at the death instant is not after it
});
