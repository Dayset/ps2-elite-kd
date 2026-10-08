/** Red-flag review rule (status.html) + shared player metrics. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RED_FLAG_RULE as R, skillTier, redFlag, redFlagRuleText } from "../red-flags.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

describe("skillTier", () => {
  it("Exceptional at the threshold, Almost within 15% below, else none", () => {
    assert.equal(skillTier({ adj: 2200, ivi: 0 }).tier, "Exceptional");
    assert.equal(skillTier({ adj: 1870, ivi: 0 }).tier, "Almost exceptional");
    assert.equal(skillTier({ adj: 1869, ivi: 0 }).tier, "");
    assert.equal(skillTier({ adj: NaN, ivi: 1700 }).tier, "Exceptional");
    assert.equal(skillTier({ adj: NaN, ivi: 1445 }).tier, "Almost exceptional");
    assert.equal(skillTier({ adj: NaN, ivi: 1444 }).tier, "");
    assert.equal(skillTier({ adj: NaN, ivi: NaN }).tier, "");
  });
  it("uses the better of 🎯🎈 ivi and public IvI", () => {
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
    assert.equal(redFlag({ ...hit, adj: 1869 }).flagged, false);
    assert.equal(redFlag({ ...hit, pvs: 2.01 }).flagged, false);
    assert.equal(redFlag({ ...hit, inflation: 1.51 }).flagged, false);
    assert.equal(redFlag({ ...hit, pvs: NaN }).flagged, false);
    assert.equal(redFlag({ ...hit, inflation: undefined }).flagged, false);
  });
  it("rule text mentions thresholds and 'not proof'", () => {
    const t = redFlagRuleText();
    assert.match(t, /1870/);
    assert.match(t, /1445/);
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
    // ⚡ ivi: own KPM falls back to global KPM (1) → inside the 0.8–1.4 neutral band
    assert.ok(Math.abs(m.adjs - m.adj) < 1e-9);
    const slow = playerMetrics(normalizePlayer({ player: { display: "Y", global_kd: 3, global_kpm: 0.4, own_kpm: 0.4, ivi: 900, rows } }));
    // own 0.4 = one doubling below the band → positive 🎯🎈 ivi × 0.5^0.415 (≈ ×0.75)
    assert.ok(slow.adj > 0);
    assert.ok(Math.abs(slow.adjs - slow.adj * Math.pow(0.5, 0.415)) < 1e-9);
    const none = playerMetrics(normalizePlayer({ player: { display: "Z", global_kd: 0, global_kpm: 0, rows: [] } }));
    assert.ok(Number.isNaN(none.adjs));
    // inflation = global KD / KD at ≥0.5 enemy KPM = 3 / (14/9)
    assert.ok(Math.abs(m.inflation - 3 / (14 / 9)) < 1e-9);
  });
});

import { VEHICLE_RULE as V, vehicleFlag, vehicleRuleText, reviewFlags, reviewRuleText } from "../red-flags.mjs";

describe("vehicleFlag", () => {
  // coldandhot's cached numbers (2026-10-07)
  const cold = { adj: 2174.9, ivi: 15.2, kd: 9.41, acc: 8.96, hsr: 1.70, pvs: 0.65, inflation: 3.03 };
  it("catches the coldandhot pattern (inflation ignored)", () => {
    const f = vehicleFlag(cold);
    assert.equal(f.flagged, true);
    assert.equal(f.skill.tier, "Almost exceptional");
    assert.equal(redFlag(cold).flagged, false); // high inflation → not a red flag
  });
  it("edges are inclusive", () => {
    assert.equal(vehicleFlag({ ...cold, kd: V.KD_HIGH_MIN, hsr: V.HSR_LOW_MAX, acc: V.ACC_LOW_MAX }).flagged, true);
  });
  it("any condition missing → not flagged", () => {
    assert.equal(vehicleFlag({ ...cold, adj: 1860 }).flagged, false);
    assert.equal(vehicleFlag({ ...cold, kd: 4.79 }).flagged, false);
    assert.equal(vehicleFlag({ ...cold, hsr: 9.1 }).flagged, false);
    assert.equal(vehicleFlag({ ...cold, acc: 16.1 }).flagged, false);
  });
  it("missing aim data is not weak aim", () => {
    assert.equal(vehicleFlag({ ...cold, acc: 0, hsr: 0 }).flagged, false);
    assert.equal(vehicleFlag({ ...cold, acc: null, hsr: null }).flagged, false);
  });
  it("rule text says it's not proof", () => {
    assert.match(vehicleRuleText(), /KD ≥ 4\.8/);
    assert.match(vehicleRuleText(), /not proof/);
  });
});

describe("reviewFlags (combined bin)", () => {
  it("tags which pattern matched", () => {
    const cold = { adj: 2174.9, ivi: 15.2, kd: 9.41, acc: 8.96, hsr: 1.70, pvs: 0.65, inflation: 3.03 };
    assert.deepEqual(reviewFlags(cold).patterns, ["vehicle"]);
    const aimOnly = { adj: 2600, ivi: 1100, kd: 7, acc: 30, hsr: 40, pvs: 0.2, inflation: 1.3 };
    assert.deepEqual(reviewFlags(aimOnly).patterns, ["aim"]);
    const both = { ...aimOnly, acc: 10, hsr: 5 };
    assert.deepEqual(reviewFlags(both).patterns, ["aim", "vehicle"]);
    assert.equal(reviewFlags({ ...aimOnly, adj: 1500, ivi: 900 }).flagged, false);
  });
  it("85% skill bar: DizzyKnight's numbers land via the aim pattern", () => {
    // [HSR] DizzyKnight cached numbers: 🎯🎈 ivi 1973 ≈ 0.897 × 2200 (≥ 0.85)
    const dizzy = { adj: 1972.7, ivi: 1043, kd: 5.74, acc: 26.99, hsr: 38.65, pvs: 0.10, inflation: 1.36 };
    assert.deepEqual(reviewFlags(dizzy).patterns, ["aim"]);
    assert.equal(reviewFlags(dizzy).skill.tier, "Almost exceptional");
  });
  it("rule text covers both patterns and says not proof", () => {
    const t = reviewRuleText();
    assert.match(t, /aim pattern/);
    assert.match(t, /vehicle pattern/);
    assert.match(t, /not proof/);
  });
});

it("aim pattern: slope collapse counts as low LionHeart when Activity is huge", () => {
  // lololollala-like: Exceptional, Inflation 0.32, slope −116 but LionHeart 5.26 (Activity 470).
  const m = { adj: 4875, ivi: 1510, pvs: 5.26, slope: -116.4, inflation: 0.32 };
  assert.equal(redFlag(m).flagged, true);
  assert.equal(redFlag({ ...m, slope: -1.5 }).flagged, false);
});

it("rampage pattern: absurd KD + KPM flags without a skill test", async () => {
  const { rampageFlag, reviewFlags } = await import("../red-flags.mjs");
  assert.equal(rampageFlag({ kd: 98, kpm: 4.7 }).flagged, true);
  assert.equal(rampageFlag({ kd: 24.7, kpm: 4.41 }).flagged, true);
  assert.equal(rampageFlag({ kd: 9.7, kpm: 4.5 }).flagged, false);
  assert.equal(rampageFlag({ kd: 42, kpm: 1.8 }).flagged, false);
  assert.deepEqual(reviewFlags({ kd: 98, kpm: 4.7, ivi: 228 }).patterns, ["rampage"]);
});
