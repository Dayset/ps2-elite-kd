import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortedFinite, quantile, lowerBound, percentileOf, shareAtOrAbove,
  niceStep, histogram, binIndexOf, stepDigits,
} from "../dist.mjs";
import { COLORS, LIGHT_COLORS, paletteColor } from "../palette.mjs";

const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));

describe("dist helpers", () => {
  it("quantile / percentile / share above", () => {
    const s = sortedFinite([5, 1, NaN, 3, null, 2, 4]);
    assert.deepEqual(s, [1, 2, 3, 4, 5]);
    assert.equal(quantile(s, 0.5), 3);
    assert.equal(quantile(s, 0.25), 2);
    assert.equal(quantile(s, 0.9), 4.6);
    assert.equal(lowerBound(s, 3), 2);
    assert.equal(percentileOf(s, 1), 0);
    assert.equal(percentileOf(s, 5), 80); // 4 of 5 below
    assert.equal(percentileOf(s, NaN), null);
    assert.equal(shareAtOrAbove(s, 4), 40);
    assert.equal(shareAtOrAbove(s, 0), 100);
    assert.equal(shareAtOrAbove(s, 9), 0);
  });

  it("nice steps and label digits", () => {
    assert.equal(niceStep(78), 100);
    assert.equal(niceStep(0.24), 0.25);
    assert.equal(niceStep(0.17), 0.2);
    assert.equal(niceStep(3.3), 5);
    assert.equal(niceStep(0), 1);
    assert.equal(stepDigits(100), 0);
    assert.equal(stepDigits(2.5), 1);
    assert.equal(stepDigits(0.25), 2);
    assert.equal(stepDigits(0.2), 1);
    assert.equal(stepDigits(0.05), 2);
  });

  it("histogram: ~30 nice bins over p1–p99, tails in ≤/≥ bins, counts add up", () => {
    // 1000 values 0..999 plus two far outliers
    const vals = range(1000).concat([-5000, 50000]);
    const h = histogram(vals);
    assert.equal(h.n, 1002);
    const total = h.bins.reduce((a, b) => a + b.count, 0);
    assert.equal(total, 1002);
    assert.equal(h.bins[0].kind, "under");
    assert.equal(h.bins.at(-1).kind, "over");
    assert.ok(h.bins.at(-1).count >= 1);
    const core = h.bins.filter((b) => b.kind === "core");
    assert.ok(core.length >= 12 && core.length <= 40, `core bins ${core.length}`);
    assert.equal(h.step, niceStep(h.step)); // nice
    // cumulative ends at 100 and never decreases
    assert.equal(h.bins.at(-1).cumPct, 100);
    for (let i = 1; i < h.bins.length; i++) assert.ok(h.bins[i].cumPct >= h.bins[i - 1].cumPct);
    // pct sums to 100
    assert.ok(Math.abs(h.bins.reduce((a, b) => a + b.pct, 0) - 100) < 1e-9);
    assert.ok(Math.abs(h.median - 499.5) < 1);
  });

  it("histogram floor: below-scale values (< 0) go to the lowest overflow bin", () => {
    const vals = range(500, (i) => i * 5).concat(range(30, (i) => -100 - i)); // 30 negatives
    const h = histogram(vals, { floor: 0 });
    assert.equal(h.lo, 0);
    assert.equal(h.bins[0].kind, "under");
    assert.equal(h.bins[0].count, 30);
    assert.equal(binIndexOf(h, -150), 0);
    assert.equal(binIndexOf(h, 0), 1);
  });

  it("binIndexOf places values in the right bin incl. the closed last core bin", () => {
    const h = histogram(range(100));
    for (const v of [0, 13.5, 50, 99]) {
      const i = binIndexOf(h, v);
      assert.ok(i >= 0, `v=${v}`);
      const b = h.bins[i];
      if (b.kind === "core") assert.ok(v >= b.x0 && v <= b.x1);
    }
    assert.equal(binIndexOf(h, NaN), -1);
  });

  it("constant data and empty input don't crash", () => {
    const h = histogram([3, 3, 3]);
    assert.equal(h.bins.reduce((a, b) => a + b.count, 0), 3);
    assert.equal(histogram([]).bins.length, 0);
  });

  it("shared player palette (main chart + ranks markers)", () => {
    assert.equal(COLORS.length, 10);
    assert.equal(LIGHT_COLORS.length, 10);
    assert.equal(paletteColor(0), "#9fd4ee");
    assert.equal(paletteColor(11, true), LIGHT_COLORS[1]);
  });
});
