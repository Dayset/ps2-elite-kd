import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("dist chart wiring: pureivi joins adjs in the getHist floor rule (2026-10-30)", () => {
    // rankings.mjs is a browser module; guard the wiring at the source level.
    const src = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("histogram(vals, { floor:"));
    assert.ok(line, "getHist floor line present");
    assert.ok(line.includes('"adjs"') && line.includes('"pureivi"'), `floor covers adjs + pureivi: ${line.trim()}`);
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

  it("histogram log1p: skewed data spreads out, counts still add up, stats unchanged", () => {
    // Activity-like: most values near 0, a long tail (p99 ≈ 6.4, median ≈ 0.26).
    const vals = range(1000, (i) => (i < 700 ? i / 700 : 0.7 + ((i - 700) / 300) * 6));
    const lin = histogram(vals);
    const log = histogram(vals, { scale: "log1p" });
    assert.equal(log.scale, "log1p");
    assert.equal(log.digits, 2);
    assert.equal(log.step, niceStep(log.step)); // nice step in log(1+x) units
    assert.equal(log.bins.reduce((a, b) => a + b.count, 0), 1000);
    assert.equal(log.bins.at(-1).cumPct, 100);
    assert.equal(log.median, lin.median);
    assert.equal(log.p90, lin.p90);
    assert.equal(log.p99, lin.p99);
    const core = log.bins.filter((b) => b.kind === "core");
    assert.ok(core.length >= 12 && core.length <= 40, `log core bins ${core.length}`);
    for (let i = 1; i < core.length; i++) assert.ok(core[i].x0 >= core[i - 1].x1 - 1e-9, "log edges increase");
    // The point of the scale: the tallest bar drops a lot vs linear.
    const maxPct = (h) => Math.max(...h.bins.map((b) => b.pct));
    assert.ok(maxPct(log) < maxPct(lin) * 0.75, `log max ${maxPct(log)} vs linear max ${maxPct(lin)}`);
    assert.ok(core.every((b) => b.x1 > b.x0), "every log bin has positive width");
  });

  it("histogram log1p falls back to linear for negatives / constant data", () => {
    const neg = histogram([-5, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30], { scale: "log1p" });
    assert.equal(neg.scale, "linear");
    assert.equal(histogram([3, 3, 3], { scale: "log1p" }).bins.reduce((a, b) => a + b.count, 0), 3);
    assert.equal(histogram([], { scale: "log1p" }).bins.length, 0);
  });

  it("dist chart wiring: act / pvs / rkd / rf use log1p, the rest stay linear (2026-11-15)", () => {
    const src = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
    const set = src.split("\n").find((l) => l.includes("LOG1P_DIST = new Set"));
    assert.ok(set, "LOG1P_DIST set present");
    for (const id of ["act", "pvs", "rkd", "rf"]) assert.ok(set.includes(`"${id}"`), `log1p covers ${id}: ${set.trim()}`);
    for (const id of ["adjs", "cons", "apk", "inf", "pureivi", "luck", "zerg"]) assert.ok(!set.includes(`"${id}"`), `log1p must not cover ${id}`);
    const line = src.split("\n").find((l) => l.includes("histogram(vals, { floor:"));
    assert.ok(line && line.includes('scale: LOG1P_DIST.has(id) ? "log1p" : "linear"'), `getHist passes scale: ${line && line.trim()}`);
    assert.ok(src.includes('dist.nonLinear'), "axis labels the non-linear scale");
    assert.ok(src.includes('dist.mjs?v=20261115-log1'), "rankings loads the log1p dist build (cache-bust pin, 2026-11-15)");
  });

  it("binIndexOf places values in the right log1p bin", () => {
    const vals = range(1000, (i) => (i < 700 ? i / 700 : 0.7 + ((i - 700) / 300) * 6));
    const h = histogram(vals, { scale: "log1p" });
    for (const v of [0, 0.1, 0.26, 1.7, 6.4]) {
      const i = binIndexOf(h, v);
      assert.ok(i >= 0, `v=${v}`);
      const b = h.bins[i];
      if (b.kind === "core") assert.ok(v >= b.x0 && v <= b.x1, `v=${v} in ${b.x0}–${b.x1}`);
    }
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
