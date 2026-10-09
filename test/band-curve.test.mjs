import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  kpmCurve,
  kpmBandCurve,
  bandReliability,
  BAND_SIGMA,
  BAND_FULL_EVENTS,
  BAND_HIDE_EVENTS,
  BAND_MIN_REL,
} from "../math.mjs";

const rows = [
  { kills: 300, deaths: 50, kpm: 0.3 },
  { kills: 100, deaths: 100, kpm: 1.0 },
  { kills: 40, deaths: 120, kpm: 2.0 },
];

describe("kpmBandCurve", () => {
  it("uses the same X grid as kpmCurve", () => {
    const a = kpmBandCurve(rows).map((p) => p.kpm);
    const b = kpmCurve(rows).map((p) => p.kpm);
    assert.deepEqual(a, b);
  });

  it("reflects local K/D near each X, not the cumulative tail", () => {
    const c = kpmBandCurve(rows);
    const at = (x) => c.find((p) => Math.abs(p.kpm - x) < 1e-9);
    assert.ok(at(0.3).kd > 4, "farm band is high");
    assert.ok(Math.abs(at(1.0).kd - 1) < 0.15, "mid band ≈ 1");
    assert.ok(at(2.0).kd < 0.5, "hard band is low");
    // Cumulative at 0 pools everything (440/270), banded at 0.3 is much higher.
    assert.ok(at(0.3).kd > kpmCurve(rows).find((p) => p.kpm === 0).kd);
  });

  it("weights are Gaussian with sigma BAND_SIGMA", () => {
    const one = [{ kills: 10, deaths: 10, kpm: 1.0 }];
    const c = kpmBandCurve(one);
    const at = (x) => c.find((p) => Math.abs(p.kpm - x) < 1e-9);
    assert.ok(Math.abs(at(1.0).events - 20) < 1e-9);
    const w = Math.exp(-0.5 * (0.2 / BAND_SIGMA) ** 2);
    assert.ok(Math.abs(at(1.2).events - 20 * w) < 1e-9);
    assert.ok(Math.abs(at(1.0).n - 1) < 1e-9);
  });

  it("floors weighted deaths at 1 and is NaN with no events", () => {
    const c = kpmBandCurve([{ kills: 50, deaths: 0, kpm: 0.2 }]);
    const p = c.find((q) => Math.abs(q.kpm - 0.2) < 1e-9);
    assert.equal(p.kd, 50);
    assert.ok(Number.isNaN(kpmBandCurve([]).at(0).kd));
    assert.ok(Number.isNaN(kpmBandCurve([{ kills: 0, deaths: 0, kpm: 1 }]).at(0).kd));
  });

  it("ignores rows with non-numeric kpm", () => {
    const c = kpmBandCurve([{ kills: 5, deaths: 5, kpm: "x" }, ...rows]);
    assert.deepEqual(c, kpmBandCurve(rows));
  });
});

describe("bandReliability", () => {
  it("hides below the event floor", () => {
    assert.equal(bandReliability(0), 0);
    assert.equal(bandReliability(BAND_HIDE_EVENTS - 0.01), 0);
  });
  it("has a visible floor and saturates at full events", () => {
    assert.equal(bandReliability(BAND_HIDE_EVENTS), BAND_MIN_REL);
    assert.equal(bandReliability(BAND_FULL_EVENTS / 2), 0.5);
    assert.equal(bandReliability(BAND_FULL_EVENTS), 1);
    assert.equal(bandReliability(BAND_FULL_EVENTS * 10), 1);
  });
});
