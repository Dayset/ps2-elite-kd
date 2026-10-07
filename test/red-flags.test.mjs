/** Red-flag review rule (status.html) + shared player metrics. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RED_FLAG_RULE as R, skillTier, redFlag, redFlagRuleText } from "../red-flags.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

describe("skillTier", () => {
  it("Exceptional at the threshold, Almost within 10% below, else none", () => {
    assert.equal(skillTier({ adj: 2200, ivi: 0 }).tier, "Exceptional");
    assert.equal(skillTier({ adj: 1980, ivi: 0 }).tier, "Almost exceptional");
    assert.equal(skillTier({ adj: 1979, ivi: 0 }).tier, "");
    assert.equal(skillTier({ adj: NaN, ivi: 1700 }).tier, "Exceptional");
    assert.equal(skillTier({ adj: NaN, ivi: 1530 }).tier, "Almost exceptional");
    assert.equal(skillTier({ adj: NaN, ivi: NaN }).tier, "");
  });
  it("uses the better of 🎯 ivi and public IvI", () => {
    const s = skillTier({ adj: 1000, ivi: 2000 });
    assert.equal(s.basis, "ivi");
    assert.equal(s.tier, "Exceptional");
  });
});

describe("redFlag", () => {
  const hit = { adj: 2600, ivi: 1100, pvs: 0.2, inflation: 1.3 };
  it("flags high skill + low LionHeart + low Inflation", () => {
    assert.equal(redFlag(hit).flagged, true);
  });
  it("band edges are inclusive", () => {
    assert.equal(redFlag({ ...hit, pvs: R.LIONHEART_LOW_MAX, inflation: R.INFLATION_LOW_MAX }).flagged, true);
  });
  it("any single condition missing → not flagged", () => {
    assert.equal(redFlag({ ...hit, adj: 1500 }).flagged, false);
    assert.equal(redFlag({ ...hit, pvs: 2.01 }).flagged, false);
    assert.equal(redFlag({ ...hit, inflation: 1.51 }).flagged, false);
    assert.equal(redFlag({ ...hit, pvs: NaN }).flagged, false);
    assert.equal(redFlag({ ...hit, inflation: undefined }).flagged, false);
  });
  it("rule text mentions thresholds and 'not proof'", () => {
    const t = redFlagRuleText();
    assert.match(t, /1980/);
    assert.match(t, /1530/);
    assert.match(t, /not proof/);
  });
});

describe("playerMetrics", () => {
  it("computes the table columns from a raw cached player", () => {
    const rows = [
      { name: "a", kills: 30, deaths: 5, kpm: 0.3 },
      { name: "b", kills: 10, deaths: 5, kpm: 0.9 },
      { name: "c", kills: 4, deaths: 4, kpm: 1.6 },
    ];
    const p = normalizePlayer({ player: { display: "X", cid: "1", global_kd: 3, global_kpm: 1, ivi: 900, rows } });
    const m = playerMetrics(p);
    assert.equal(m.ivi, 900);
    assert.ok(Number.isFinite(m.inflation));
    assert.ok(Number.isFinite(m.pvs));
    assert.ok(Number.isFinite(m.adj));
    // inflation = global KD / KD at ≥0.5 enemy KPM = 3 / (14/9)
    assert.ok(Math.abs(m.inflation - 3 / (14 / 9)) < 1e-9);
  });
});
