// 🎬 Living stat gauges (#108, pure): the gauge math in replay/gauges.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { kpmSpan, kpmGauge, kdRow, kdLives, accBar, hsHeads, spkGauge } from "../replay/gauges.mjs";

test("KPM span: one minute unless one kill takes longer", () => {
  assert.deepEqual(kpmSpan(1.44), { spanSec: 60, spanMin: 1 });
  assert.deepEqual(kpmSpan(3), { spanSec: 60, spanMin: 1 });
  assert.deepEqual(kpmSpan(0.5), { spanSec: 120, spanMin: 2 });
  assert.deepEqual(kpmSpan(0.3), { spanSec: 240, spanMin: 4 });
  assert.deepEqual(kpmSpan(0), { spanSec: 60, spanMin: 1 });
});

test("KPM notches continue across bars (1.44 KPM → 41.7 s, 83.3 s, …)", () => {
  const first = kpmGauge(1.44, 10, []);
  assert.equal(first.notches.length, 1);
  assert.ok(Math.abs(first.notches[0].frac - 41.6667 / 60) < 1e-4);
  assert.equal(first.notches[0].filled, false);
  const second = kpmGauge(1.44, 70, []);
  assert.equal(second.spanIndex, 1);
  assert.equal(second.notches.length, 1);
  assert.ok(Math.abs(second.notches[0].frac - 23.3333 / 60) < 1e-4, "83.3 s lands 23.3 s into the second bar");
  const third = kpmGauge(1.44, 130, []);
  assert.equal(third.notches.length, 2, "125.0 s and 166.7 s both fall in the 120–180 s span");
  assert.ok(Math.abs(third.fill - 10 / 60) < 1e-9);
});

test("KPM marks accumulate and a kill fills its nearest notch", () => {
  const g = kpmGauge(1.44, 130, [41.7, 90, 200]);
  assert.equal(g.marks.length, 3, "marks == kills, across spans");
  const hit = kpmGauge(1.44, 10, [42]);
  assert.equal(hit.notches[0].filled, true, "kill at 42 s fills the 41.7 s notch");
  const miss = kpmGauge(1.44, 10, [10]);
  assert.equal(miss.notches[0].filled, false, "kill at 10 s is not within half an interval of 41.7 s");
});

test("K/D row: floor coffins + fraction bar, kills fill left to right", () => {
  assert.deepEqual(kdRow(4.54, 0), { full: 4, frac: 0.54, filled: 0, partialWidth: 0.54, over: 0 });
  const two = kdRow(4.54, 2);
  assert.equal(two.filled, 2); assert.equal(two.partialWidth, 0.54);
  const five = kdRow(4.54, 5);
  assert.equal(five.filled, 4); assert.equal(five.partialWidth, 1); assert.equal(five.over, 0);
  const seven = kdRow(4.54, 7);
  assert.equal(seven.filled, 4); assert.equal(seven.partialWidth, 1); assert.equal(seven.over, 2);
});

test("K/D lives: current first, then the two most recent finished, dimmed", () => {
  const lives = [{ n: 1, t0: 0, t1: 100 }, { n: 2, t0: 100, t1: 200 }, { n: 3, t0: 200, t1: 300 }, { n: 4, t0: 300, t1: 400 }];
  const kills = [10, 50, 120, 150, 210, 250, 260, 320];
  const rows = kdLives(4.54, lives, kills, 330);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].n, rows[0].kills, rows[0].dimmed], [4, 1, false]);
  assert.deepEqual([rows[1].n, rows[1].kills, rows[1].dimmed], [3, 3, true]);
  assert.deepEqual([rows[2].n, rows[2].kills, rows[2].dimmed], [2, 2, true]);
});

test("accuracy bar and HS heads and shots/kill gauge", () => {
  assert.deepEqual(accBar(3, 10, 0.298), { frac: 0.3, marker: 0.298 });
  assert.deepEqual(accBar(0, 0, 0.298), { frac: 0, marker: 0.298 });
  const hs = hsHeads([{ hs: true }, { hs: false }, { hs: true }], 0.327);
  assert.deepEqual(hs, { heads: [true, false, true], expected: 3 });
  const spk = spkGauge(12, 20.2);
  assert.equal(spk.frac, 12 / 20.2);
  assert.ok(Math.abs(spk.markerFrac - 20.2 / (20.2 * 1.5)) < 1e-9, "lifetime marker sits inside the bar");
  assert.equal(spkGauge(30, 20.2).frac, 1, "fill caps at the lifetime value");
});
