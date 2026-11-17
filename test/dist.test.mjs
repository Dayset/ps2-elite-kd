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

  it("histogram sqrt: iVi-like data moves the peak left vs log1p, counts add up, stats unchanged (2026-11-17)", () => {
    // ⚔️ iVi-like: a quarter negative, positives exponential (mean ~700,
    // truncated at 1900) — density falls with value, so log1p's widening
    // bins put the tallest bar on the right and sqrt puts it where the
    // density actually peaks.
    const vals = range(1000, (i) =>
      i < 270 ? -1300 + (i / 270) * 1250
        : Math.min(1900, -700 * Math.log(1 - ((i - 270) / 730) * 0.95)));
    const lin = histogram(vals, { floor: 0 });
    const log = histogram(vals, { floor: 0, scale: "log1p" });
    const sq = histogram(vals, { floor: 0, scale: "sqrt" });
    assert.equal(sq.scale, "sqrt");
    assert.equal(sq.digits, 0, "square edges are integers, no decimals needed");
    assert.equal(sq.step, niceStep(sq.step)); // nice step in sqrt units
    assert.equal(sq.bins.reduce((a, b) => a + b.count, 0), 1000);
    assert.equal(sq.bins.at(-1).cumPct, 100);
    assert.equal(sq.median, lin.median);
    assert.equal(sq.p90, lin.p90);
    assert.equal(sq.p99, lin.p99);
    const core = sq.bins.filter((b) => b.kind === "core");
    assert.ok(core.length >= 12 && core.length <= 40, `sqrt core bins ${core.length}`);
    for (let i = 1; i < core.length; i++) assert.ok(core[i].x0 >= core[i - 1].x1 - 1e-9, "sqrt edges increase");
    assert.ok(core.every((b) => b.x1 > b.x0), "every sqrt bin has positive width");
    assert.ok(core.every((b) => Number.isInteger(b.x0) && Number.isInteger(b.x1)), "sqrt edges are whole numbers");
    const peakSlot = (h) => {
      const c = h.bins.filter((b) => b.kind === "core");
      const p = c.reduce((a, b) => (b.pct > a.pct ? b : a), c[0]);
      return (h.bins.indexOf(p) + 0.5) / h.bins.length;
    };
    const sqPeak = core.reduce((a, b) => (b.pct > a.pct ? b : a), core[0]);
    const logCore = log.bins.filter((b) => b.kind === "core");
    const logPeak = logCore.reduce((a, b) => (b.pct > a.pct ? b : a), logCore[0]);
    assert.ok(sqPeak.x1 <= 400, `sqrt peak ends at ${sqPeak.x1}, not in the tail`);
    assert.ok(logPeak.x0 >= 400, `log1p peak starts at ${logPeak.x0}, on the right`);
    assert.ok(peakSlot(sq) < 0.6 && peakSlot(log) > 0.7, `sqrt peak slot ${peakSlot(sq).toFixed(2)} vs log1p ${peakSlot(log).toFixed(2)}`);
  });

  it("histogram sqrt falls back to linear for negatives / constant data", () => {
    const neg = histogram([-5, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30], { scale: "sqrt" });
    assert.equal(neg.scale, "linear");
    assert.equal(histogram([3, 3, 3], { scale: "sqrt" }).bins.reduce((a, b) => a + b.count, 0), 3);
    assert.equal(histogram([], { scale: "sqrt" }).bins.length, 0);
  });

  it("histogram symlog: two-sided data spreads both ways, counts add up, stats unchanged (2026-11-15)", () => {
    // ⚔️ iVi-like: a quarter negative with real spread, bulk positive —
    // uniform in signed-log space on each side, so the transform (not the
    // fixture) is what spreads the bars out.
    const inv = (y) => Math.sign(y) * Math.expm1(Math.abs(y));
    const vals = range(1000, (i) => (i < 270 ? inv(-7.2 + (i / 270) * 6.7) : inv(((i - 270) / 730) * 7.5)));
    const lin = histogram(vals, { floor: 0 });
    const sym = histogram(vals, { scale: "symlog" });
    assert.equal(sym.scale, "symlog");
    assert.equal(sym.digits, 2);
    assert.equal(sym.step, niceStep(sym.step)); // nice step in signed-log units
    assert.equal(sym.bins.reduce((a, b) => a + b.count, 0), 1000);
    assert.equal(sym.bins.at(-1).cumPct, 100);
    assert.equal(sym.median, lin.median);
    assert.equal(sym.p90, lin.p90);
    assert.equal(sym.p99, lin.p99);
    const core = sym.bins.filter((b) => b.kind === "core");
    assert.ok(core.length >= 12 && core.length <= 40, `symlog core bins ${core.length}`);
    for (let i = 1; i < core.length; i++) assert.ok(core[i].x0 >= core[i - 1].x1 - 1e-9, "symlog edges increase");
    assert.ok(core[0].x0 < 0 && core.at(-1).x1 > 0, "core spans zero both ways");
    assert.ok(core.every((b) => b.x1 > b.x0), "every symlog bin has positive width");
    // The point of the scale: the ≤0 lump is gone, the tallest bar drops.
    const maxPct = (h) => Math.max(...h.bins.map((b) => b.pct));
    assert.ok(maxPct(sym) < maxPct(lin) * 0.75, `symlog max ${maxPct(sym)} vs linear max ${maxPct(lin)}`);
    assert.ok((sym.bins.find((b) => b.kind === "under")?.pct ?? 0) < 2, "no big underflow lump left");
  });

  it("histogram symlog ignores floor and equals log1p on ≥ 0 data", () => {
    const vals = range(1000, (i) => (i < 700 ? i / 700 : 0.7 + ((i - 700) / 300) * 6));
    const sym = histogram(vals, { scale: "symlog" });
    const log = histogram(vals, { scale: "log1p" });
    assert.deepEqual(sym.bins, log.bins, "all-≥0 data: symlog ≡ log1p");
    assert.equal(sym.scale, "symlog");
    // Floor must not clip the negative side: same bins with floor: 0 passed.
    const neg = range(400, (i) => -800 + i * 4).concat(range(600, (i) => i * 3));
    const a = histogram(neg, { scale: "symlog" });
    const b = histogram(neg, { floor: 0, scale: "symlog" });
    assert.deepEqual(a.bins, b.bins, "floor: 0 is ignored in symlog mode");
    assert.ok(a.bins.some((x) => x.kind === "core" && x.x0 < 0), "core covers negatives");
    assert.equal(histogram([3, 3, 3], { scale: "symlog" }).bins.reduce((x, y) => x + y.count, 0), 3);
    assert.equal(histogram([], { scale: "symlog" }).bins.length, 0);
  });

  it("binIndexOf places values in the right symlog bin, negatives included", () => {
    const vals = range(1000, (i) => (i < 270 ? -1300 + (i / 270) * 1250 : ((i - 270) / 730) * 1900));
    const h = histogram(vals, { scale: "symlog" });
    for (const v of [-1200, -500, -50, 0, 50, 500, 1500]) {
      const i = binIndexOf(h, v);
      assert.ok(i >= 0, `v=${v}`);
      const b = h.bins[i];
      if (b.kind === "core") assert.ok(v >= b.x0 && v <= b.x1, `v=${v} in ${b.x0}–${b.x1}`);
    }
    assert.equal(binIndexOf(h, NaN), -1);
  });

  it("dist chart wiring: act / pvs / rkd / rf / combinedivi use log1p, adjs uses sqrt, the rest stay linear (2026-11-17)", () => {
    const src = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
    const set = src.split("\n").find((l) => l.includes("LOG1P_DIST = new Set"));
    assert.ok(set, "LOG1P_DIST set present");
    for (const id of ["act", "pvs", "rkd", "rf", "combinedivi"]) assert.ok(set.includes(`"${id}"`), `log1p covers ${id}: ${set.trim()}`);
    for (const id of ["adjs", "cons", "apk", "inf", "pureivi", "luck", "zerg"]) assert.ok(!set.includes(`"${id}"`), `log1p must not cover ${id}`);
    const sqrtSet = src.split("\n").find((l) => l.includes("SQRT_DIST = new Set"));
    assert.ok(sqrtSet && sqrtSet.includes('"adjs"'), `SQRT_DIST covers adjs: ${sqrtSet && sqrtSet.trim()}`);
    for (const id of ["act", "pvs", "rkd", "rf", "combinedivi", "pureivi"]) assert.ok(!sqrtSet.includes(`"${id}"`), `sqrt must not cover ${id}`);
    assert.ok(!src.includes("SYMLOG_DIST"), "no symlog wiring left (dropped 2026-11-15: negatives are one underflow bar)");
    assert.ok(!src.includes("dist.symlogHint"), "no symlog pill hint left");
    const scaleLine = src.split("\n").find((l) => l.includes("const scale = SQRT_DIST.has(id)"));
    assert.ok(scaleLine && scaleLine.includes('SQRT_DIST.has(id) ? "sqrt" : LOG1P_DIST.has(id) ? "log1p" : "linear"'), `getHist picks sqrt/log1p: ${scaleLine && scaleLine.trim()}`);
    assert.ok(src.includes('dist.nonLinear'), "axis labels the non-linear scale");
    assert.ok(src.includes('dist.mjs?v=20261117-sqrt1'), "rankings loads the sqrt dist build (cache-bust pin, 2026-11-17)");
    // 📊 y-scale cap (2026-11-15): the axis tops out at the tallest CORE bar,
    // tail bars (under/over) never set it — and a tail bar taller than the
    // axis clips at the plot top instead of poking out of the chart.
    assert.ok(src.includes('h.bins.filter((b) => b.kind === "core").map((b) => b.pct)'), "y-scale caps at the tallest core bar");
    assert.ok(src.includes("Math.max(M.t, yL(b.pct))"), "tail bars clip at the plot top");
  });

  it("binIndexOf places values in the right sqrt bin", () => {
    const vals = range(1000, (i) => (i < 270 ? -1300 + (i / 270) * 1250 : ((i - 270) / 730) * 1900));
    const h = histogram(vals, { floor: 0, scale: "sqrt" });
    assert.equal(h.scale, "sqrt");
    for (const v of [0, 50, 200, 1000, 1900]) {
      const i = binIndexOf(h, v);
      assert.ok(i >= 0, `v=${v}`);
      const b = h.bins[i];
      if (b.kind === "core") assert.ok(v >= b.x0 && v <= b.x1, `v=${v} in ${b.x0}–${b.x1}`);
    }
    assert.equal(binIndexOf(h, NaN), -1);
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
