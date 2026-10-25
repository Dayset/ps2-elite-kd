// live-trends: Honu-faithful math (30 s buckets, trailing 9, cumulative trend).
import test from "node:test";
import assert from "node:assert/strict";
import { trendSeries, trendColors } from "../live-trends.mjs";

const S = 0, MIN = 60000;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ys = (pts) => pts.map((p) => Math.round(p.y * 1000) / 1000);

test("KPM interval: per-bucket rate, trailing mean over growing window", () => {
  const s = trendSeries([10 * 1000, 40 * 1000, 70 * 1000], [], S, 90 * 1000);
  assert.deepEqual(s.kpmInt.map((p) => p.x), [0, 30, 60, 90]);
  assert.deepEqual(ys(s.kpmInt), [2, 2, 2, 1.5]);
});

test("KPM interval: burst leaves the 4.5-min window, idle buckets read 0", () => {
  const s = trendSeries([10 * 1000, 20 * 1000], [], S, 330 * 1000);
  assert.equal(s.kpmInt.length, 12);
  close(s.kpmInt[0].y, 4);
  close(s.kpmInt[8].y, 4 / 9);
  assert.equal(s.kpmInt[9].y, 0);
  assert.equal(s.kpmInt[11].y, 0);
});

test("K/D interval: ratio of summed window kills/deaths, not mean of ratios", () => {
  const s = trendSeries([10 * 1000, 20 * 1000, 40 * 1000], [50 * 1000], S, 90 * 1000);
  assert.deepEqual(ys(s.kdInt), [2, 3, 3, 3]);
});

test("KPM trend: cumulative kills / elapsed minutes, final point at now", () => {
  const s = trendSeries([60 * 1000, 120 * 1000, 180 * 1000], [], S, 240 * 1000);
  assert.deepEqual(s.kpmTrend, [
    { x: 60, y: 0 }, { x: 60, y: 1 }, { x: 120, y: 1 }, { x: 180, y: 1 }, { x: 240, y: 0.75 },
  ]);
});

test("K/D trend: cumulative ratio, deaths floored at 1", () => {
  const s = trendSeries([10 * 1000, 20 * 1000], [70 * 1000], S, 120 * 1000);
  assert.deepEqual(s.kdTrend, [
    { x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 2 }, { x: 70, y: 2 }, { x: 120, y: 2 },
  ]);
});

test("guards: single kill, empty window, unsorted input, out-of-range events", () => {
  const one = trendSeries([10 * 1000], [], S, 60 * 1000);
  assert.deepEqual([one.kpmInt, one.kpmTrend, one.kdInt, one.kdTrend], [[], [], [], []]);
  assert.deepEqual(trendSeries([10 * 1000], [], 60 * 1000, 60 * 1000).kpmInt, []);
  const a = trendSeries([70 * 1000, 10 * 1000, 40 * 1000], [], S, 90 * 1000);
  const b = trendSeries([10 * 1000, 40 * 1000, 70 * 1000], [], S, 90 * 1000);
  assert.deepEqual(a, b);
  const c = trendSeries([-5000, 10 * 1000, 20 * 1000], [], S, 60 * 1000);
  close(c.kpmInt[0].y, 4); // the pre-start kill is not counted
});

test("trendColors: one colour per metric, dark/light palettes differ", () => {
  const d = trendColors(false), l = trendColors(true);
  assert.notEqual(d.kpm, d.kd);
  assert.notEqual(d.kpm, l.kpm);
});
