/**
 * Regression suite for core elite-K/D math (Node built-in test runner).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  X_MAX,
  INFLATION_KPM,
  SLOPE_FLOOR,
  SLOPE_EPS,
  RF_SOFT,
  isFiniteNum,
  pooled,
  sliceAt,
  kpmCurve,
  curveSlope,
  pressureVolume,
  lionHeart,
  adjustedIvi,
  deathMixLite,
  rfIf,
  yScale,
  scaleContains,
  applyYZoom,
  clampYZoom,
  Y_ZOOM_DEFAULT,
  Y_ZOOM_MIN,
  Y_ZOOM_MAX,
} from "../math.mjs";

function approx(a, b, eps = 1e-9) {
  if (!isFiniteNum(a) && !isFiniteNum(b)) return true;
  return Math.abs(a - b) <= eps;
}

function assertApprox(actual, expected, eps = 1e-6, msg = "") {
  assert.ok(
    approx(actual, expected, eps),
    `${msg || "approx"}: got ${actual}, expected ${expected} (±${eps})`
  );
}

/** Synthetic declining curve: KD falls as enemy KPM rises. */
function decliningCurve({
  softKd = 3.0,
  hardKd = 1.0,
  deaths = 20,
  steps = 21,
} = {}) {
  const curve = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const kpm = t * X_MAX;
    const kd = softKd + (hardKd - softKd) * t;
    curve.push({ kpm, kd, deaths, kills: kd * deaths, n: 5 });
  }
  return curve;
}

describe("pooled + sliceAt", () => {
  it("pools kills/deaths and computes KD", () => {
    const r = pooled([
      { kills: 10, deaths: 5 },
      { kills: 5, deaths: 5 },
    ]);
    assert.equal(r.kills, 15);
    assert.equal(r.deaths, 10);
    assertApprox(r.kd, 1.5);
  });

  it("KD is NaN when deaths are 0 and no kills", () => {
    const r = pooled([{ kills: 0, deaths: 0 }]);
    assert.equal(r.deaths, 0);
    assert.ok(Number.isNaN(r.kd));
  });

  it("sliceAt keeps only rows with kpm >= cut and pools them", () => {
    const rows = [
      { name: "soft", kpm: 0.2, kills: 20, deaths: 5 },
      { name: "mid", kpm: 0.6, kills: 10, deaths: 10 },
      { name: "hard", kpm: 1.8, kills: 4, deaths: 8 },
    ];
    const at05 = sliceAt(rows, 0.5);
    assert.equal(at05.n, 2);
    assert.equal(at05.kills, 14);
    assert.equal(at05.deaths, 18);
    assertApprox(at05.kd, 14 / 18);

    const at15 = sliceAt(rows, 1.5);
    assert.equal(at15.n, 1);
    assertApprox(at15.kd, 0.5);
  });

  it("sliceAt with empty / all-below-cut yields deaths 0", () => {
    const empty = sliceAt([], 0.5);
    assert.equal(empty.n, 0);
    assert.equal(empty.deaths, 0);
    const none = sliceAt([{ kpm: 0.1, kills: 9, deaths: 3 }], 0.5);
    assert.equal(none.n, 0);
    assert.equal(none.deaths, 0);
  });
});

describe("Inflation @ 0.5 KPM", () => {
  it("uses INFLATION_KPM = 0.5 (not 1.5)", () => {
    assert.equal(INFLATION_KPM, 0.5);
  });

  it("inflation = global_kd / KD among deaths vs ≥0.5 KPM", () => {
    const p = {
      global_kd: 4.0,
      rows: [
        { name: "farm", kpm: 0.2, kills: 40, deaths: 5 }, // soft padding
        { name: "avg", kpm: 0.6, kills: 10, deaths: 10 },
        { name: "elite", kpm: 1.7, kills: 5, deaths: 10 },
      ],
    };
    const dm = deathMixLite(p);
    // ≥0.5 → avg+elite: 15k/20d = 0.75; inflation = 4/0.75
    assertApprox(dm.kd05, 0.75);
    assertApprox(dm.inflation, 4 / 0.75);
    assert.equal(dm.d05, 20);
    assert.equal(dm.n05, 2);
  });

  it("NaN inflation when hard-slice KD is tiny / empty", () => {
    const p = {
      global_kd: 2,
      rows: [{ name: "only-soft", kpm: 0.1, kills: 10, deaths: 2 }],
    };
    const dm = deathMixLite(p);
    assert.ok(Number.isNaN(dm.inflation));
  });
});

describe("curveSlope (full-curve, deaths > 0)", () => {
  it("returns negative slope for a declining K/D curve", () => {
    const slope = curveSlope({ curve: decliningCurve() });
    assert.ok(slope < 0, `expected negative slope, got ${slope}`);
    assert.ok(isFiniteNum(slope));
  });

  it("ignores points with deaths === 0", () => {
    const curve = decliningCurve({ steps: 12 });
    // Poison half the points with deaths=0 and absurd KD — must not flip slope sign.
    for (let i = 0; i < curve.length; i += 2) {
      curve[i] = { ...curve[i], deaths: 0, kd: 999, kills: 0 };
    }
    const slope = curveSlope({ curve });
    assert.ok(slope < 0, `deaths=0 spikes must be ignored, got ${slope}`);
  });

  it("rebuilds curve from rows when curve is short", () => {
    const rows = [];
    for (let i = 0; i < 8; i++) {
      const kpm = 0.2 + i * 0.25;
      const deaths = 10 + i;
      const kd = 2.5 - i * 0.2;
      rows.push({ name: `e${i}`, kpm, deaths, kills: kd * deaths });
    }
    const slope = curveSlope({ rows, curve: [] });
    assert.ok(isFiniteNum(slope));
    assert.ok(slope < 0);
  });

  it("NaN when fewer than 4 valid (deaths>0) points", () => {
    const curve = [
      { kpm: 0.2, kd: 2, deaths: 5 },
      { kpm: 0.8, kd: 1.5, deaths: 5 },
      { kpm: 1.4, kd: 1.0, deaths: 5 },
    ];
    assert.ok(Number.isNaN(curveSlope({ curve })));
  });
});

describe("LionHeart / pressureVolume bounds", () => {
  it("LionHeart is Activity × (shifted slope)^1.5", () => {
    const activity = 2.0;
    const slope = -1.0; // shifted = -1 - (-2) + 0.05 = 1.05
    const expected = activity * Math.pow(-1.0 - SLOPE_FLOOR + SLOPE_EPS, 1.5);
    assertApprox(pressureVolume(activity, slope), expected);
    assertApprox(lionHeart(activity, slope), expected);
  });

  it("does not explode on spuriously positive slope (whale / weird mid-band)", () => {
    const activity = 5.0;
    const slope = 1.5; // positive — old mid-band bug
    const lh = pressureVolume(activity, slope);
    assert.ok(isFiniteNum(lh));
    // shifted = max(1.5 - (-2) + 0.05, eps) = 3.55; 5 * 3.55^1.5 ≈ 33.4
    assert.ok(lh < 100, `LionHeart too large for positive slope: ${lh}`);
    assert.ok(lh > 0);
  });

  it("floors extremely steep negative slopes so LionHeart stays finite", () => {
    const activity = 3.0;
    const slope = -50; // pathological
    const lh = pressureVolume(activity, slope);
    // shifted collapses to SLOPE_EPS
    assertApprox(lh, activity * Math.pow(SLOPE_EPS, 1.5), 1e-9);
    assert.ok(lh < 1);
  });

  it("NaN when activity or slope is NaN", () => {
    assert.ok(Number.isNaN(pressureVolume(NaN, -1)));
    assert.ok(Number.isNaN(pressureVolume(1, NaN)));
  });
});

describe("adjIvI (adjustedIvi)", () => {
  it("soft RF 0.6 ≈ public IvI 600", () => {
    assertApprox(adjustedIvi(600, RF_SOFT), 600);
  });

  it("scales with log2(RF / 0.6)", () => {
    // RF = 1.2 → log2(2)=1 → 600*(1+1)=1200
    assertApprox(adjustedIvi(999, 1.2), 1200);
  });

  it("NaN for non-positive RF", () => {
    assert.ok(Number.isNaN(adjustedIvi(600, 0)));
    assert.ok(Number.isNaN(adjustedIvi(600, -1)));
    assert.ok(Number.isNaN(adjustedIvi(600, null)));
  });
});

describe("yScale contains outliers / cheaters / bad players", () => {
  it("linear scale contains ordinary range including true max", () => {
    const ys = [0.4, 0.8, 1.2, 1.9, 2.4];
    const s = yScale(ys);
    assert.equal(s.log, false);
    assert.ok(s.hi >= Math.max(...ys), `hi ${s.hi} < max`);
    assert.ok(s.lo <= Math.min(...ys), `lo ${s.lo} > min`);
    assert.ok(scaleContains(s, ys));
  });

  it("cheater / farm spike (KD ≫ median) still fits; uses log when striking", () => {
    // Bulk around 1–3, one cheater farm spike at 80 (classic clip case)
    const ys = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 80];
    const s = yScale(ys);
    assert.equal(s.log, true, "expected log scale for striking spike");
    assert.ok(s.hi >= 80, `hi must contain spike: ${s.hi}`);
    assert.ok(scaleContains(s, ys.filter((v) => v > 0)));
  });

  it("aLandWhale-style high soft KD without log still contains max", () => {
    // High but not striking enough for log (hi < 15 or not 8× mid)
    const ys = [1.0, 1.5, 2.0, 3.5, 5.0, 7.0, 9.0, 12.0];
    const s = yScale(ys);
    assert.ok(s.hi >= 12, `hi ${s.hi} must contain 12`);
    assert.ok(scaleContains(s, ys));
  });

  it("extremely bad / low player (near-zero KD) stays on a sane scale", () => {
    const ys = [0.05, 0.08, 0.1, 0.12, 0.15];
    const s = yScale(ys);
    assert.equal(s.log, false);
    assert.ok(s.lo >= 0);
    assert.ok(s.hi >= Math.max(...ys));
    assert.ok(s.lo <= Math.min(...ys));
    // Padding uses min span 0.15 even when data is tighter — axis stays readable.
    assert.ok(s.hi > s.lo);
    assert.ok(scaleContains(s, ys));
  });

  it("empty input falls back to 0..2", () => {
    const s = yScale([]);
    assert.deepEqual(s, { lo: 0, hi: 2, log: false });
  });
});

describe("rfIf integration smoke", () => {
  it("builds RF/Activity from opposition rows", () => {
    const p = {
      own_kpm: 1.2,
      rows: [
        { name: "a", kpm: 2.0, kills: 2, deaths: 10 },
        { name: "b", kpm: 1.5, kills: 3, deaths: 8 },
        { name: "c", kpm: 0.4, kills: 20, deaths: 4 },
      ],
    };
    const m = rfIf(p);
    assert.ok(m);
    assert.ok(m.deaths > 0);
    assert.ok(isFiniteNum(m.rf));
    assert.ok(isFiniteNum(m.ifactor));
    const adj = adjustedIvi(800, m.rf);
    assert.ok(isFiniteNum(adj));
    const lh = pressureVolume(m.ifactor, -0.8);
    assert.ok(isFiniteNum(lh));
  });
});

describe("end-to-end weird curves: slope + LionHeart + yScale", () => {
  it("cheater spike curve: slope finite, LionHeart bounded, yScale contains", () => {
    const curve = decliningCurve({ softKd: 4, hardKd: 1.2, deaths: 15 });
    // Inject farm/cheater point at low KPM
    curve[0] = { kpm: 0.0, kd: 120, deaths: 40, kills: 4800, n: 3 };
    const ys = curve.map((p) => p.kd);
    const s = yScale(ys);
    assert.ok(s.hi >= 120);
    assert.ok(scaleContains(s, ys.filter((v) => v > 0)));

    const slope = curveSlope({ curve });
    assert.ok(isFiniteNum(slope));
    // Overall should still trend down despite soft spike (death-weighted)
    assert.ok(slope < 5, `slope not exploded: ${slope}`);

    const lh = pressureVolume(4.0, slope);
    assert.ok(isFiniteNum(lh));
    assert.ok(lh < 500, `LionHeart exploded: ${lh}`);
  });

  it("all-bad player flat low curve: no NaN slope if enough points; LionHeart ok", () => {
    const curve = decliningCurve({ softKd: 0.25, hardKd: 0.1, deaths: 30 });
    const slope = curveSlope({ curve });
    assert.ok(isFiniteNum(slope));
    const lh = pressureVolume(0.3, slope);
    assert.ok(isFiniteNum(lh));
    assert.ok(lh >= 0);
    const s = yScale(curve.map((p) => p.kd));
    assert.ok(scaleContains(s, curve.map((p) => p.kd)));
  });

  it("monotonic rising (weird) curve: positive slope but LionHeart capped by shift formula", () => {
    const curve = decliningCurve({ softKd: 0.5, hardKd: 3.0, deaths: 12 });
    const slope = curveSlope({ curve });
    assert.ok(slope > 0, `expected positive slope, got ${slope}`);
    const lh = pressureVolume(2.5, slope);
    assert.ok(isFiniteNum(lh) && lh < 200);
  });
});

describe("kpmCurve helper", () => {
  it("produces descending kpm cuts with pooled KD", () => {
    const rows = [
      { kpm: 0.3, kills: 9, deaths: 3 },
      { kpm: 1.0, kills: 4, deaths: 4 },
      { kpm: 2.0, kills: 1, deaths: 5 },
    ];
    const pts = kpmCurve(rows, 2.0, 0.0, 0.5);
    assert.ok(pts.length >= 4);
    assert.ok(pts[0].kpm >= pts[pts.length - 1].kpm);
    // At cut 2.0 only hardest row; deaths > 0
    const hard = pts.find((p) => approx(p.kpm, 2.0, 1e-6));
    assert.ok(hard);
    assert.equal(hard.deaths, 5);
    assert.ok(hard.deaths > 0);
  });
});


describe("applyYZoom", () => {
  it("zoom=1 leaves auto scale unchanged", () => {
    const auto = yScale([0.5, 1, 2, 3]);
    const z = applyYZoom(auto, 1);
    assertApprox(z.lo, auto.lo);
    assertApprox(z.hi, auto.hi);
    assert.equal(z.log, auto.log);
    assert.equal(z.zoom, 1);
  });

  it("zoom>1 shrinks hi (zoom into weak curves)", () => {
    const auto = { lo: 0, hi: 10, log: false };
    const z = applyYZoom(auto, 2);
    assertApprox(z.lo, 0);
    assertApprox(z.hi, 5);
    assert.equal(z.zoom, 2);
  });

  it("zoom<1 expands hi (fit extreme / cheater KD)", () => {
    const auto = { lo: 0, hi: 10, log: false };
    const z = applyYZoom(auto, 0.5);
    assertApprox(z.lo, 0);
    assertApprox(z.hi, 20);
    assert.equal(z.zoom, 0.5);
  });

  it("log scale pins lo and scales hi in log space", () => {
    const auto = { lo: 0.5, hi: 80, log: true };
    const zin = applyYZoom(auto, 2);
    assertApprox(zin.lo, 0.5);
    assert.ok(zin.hi < 80 && zin.hi > 0.5);
    assert.equal(zin.log, true);
    const zout = applyYZoom(auto, 0.5);
    assert.ok(zout.hi > 80);
  });

  it("clampYZoom bounds and default", () => {
    assert.equal(clampYZoom(Y_ZOOM_DEFAULT), 1);
    assert.equal(clampYZoom(0.01), Y_ZOOM_MIN);
    assert.equal(clampYZoom(99), Y_ZOOM_MAX);
    assert.equal(clampYZoom(NaN), Y_ZOOM_DEFAULT);
  });
});

import { OWN_KPM_REF, SPEED_IVI_PER_DOUBLING, speedAdjustedIvi } from "../math.mjs";

describe("speedAdjustedIvi (⚡ ivi)", () => {
  it("uses the documented constants", () => {
    assert.equal(OWN_KPM_REF, 0.98);
    assert.equal(SPEED_IVI_PER_DOUBLING, 300);
  });
  it("is unchanged at typical speed, ±300 per doubling / halving", () => {
    assert.equal(speedAdjustedIvi(1500, 0.98), 1500);
    assert.ok(Math.abs(speedAdjustedIvi(1500, 1.96) - 1800) < 1e-9);
    assert.ok(Math.abs(speedAdjustedIvi(1500, 0.49) - 1200) < 1e-9);
    assert.ok(Math.abs(speedAdjustedIvi(1500, 0.245) - 900) < 1e-9);
  });
  it("matches cached players from 2026-10-07 (within rounding of the reference)", () => {
    // own KPM / adj from the shared cache; expected from the spec (REF ≈ 0.98)
    const cases = [
      ["Offtopia", 1789, 0.5675, 1551],
      ["xCloneKano", 1762, 4.509, 2421],
      ["Simplenubb", 2109, 3.2836, 2631],
      ["JustV6me", 1491, 1.0207, 1507],
    ];
    for (const [name, adj, own, want] of cases) {
      const got = speedAdjustedIvi(adj, own);
      assert.ok(Math.abs(got - want) <= 3, `${name}: ${got.toFixed(1)} vs ${want}`);
    }
  });
  it("returns NaN for missing input or non-positive own KPM", () => {
    for (const [a, k] of [[NaN, 1], [1500, NaN], [null, 1], [1500, null], [undefined, 1], [1500, undefined], [1500, 0], [1500, -1], [1500, ""]]) {
      assert.ok(Number.isNaN(speedAdjustedIvi(a, k)), `${a}, ${k}`);
    }
  });
});
