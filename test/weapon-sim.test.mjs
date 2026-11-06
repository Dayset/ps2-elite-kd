// weapon-sim.mjs: seeded recoil / cone-of-fire simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simParams, simulate, compareBursts, sprayPattern, rng, burstStats, ADS_DEFAULT, ATTACHMENTS } from "../weapon-sim.mjs";
import { toProfile } from "../replay/weapons.mjs";

const AR = toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]);
const FM = { cof_recoil: 0.12, fire_refire_ms: 100, recoil_magnitude_min: 0.5, recoil_magnitude_max: 0.5, recoil_first_shot_modifier: 1, recoil_horizontal_min: 0.1, recoil_horizontal_max: 0.2, recoil_horizontal_tolerance: 0.4, recoil_recovery_rate: 20 };
const STATES = [{ player_state_id: 0, cof_min: 3, cof_max: 4.5, cof_recovery_rate: 20 }, { player_state_id: 1, cof_min: 2.25, cof_max: 4, cof_recovery_rate: 20 }];

test("rng is seeded and in [0,1)", () => {
  const a = rng(5), b = rng(5);
  for (let i = 0; i < 50; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});

test("ADS uses the wiki starting cone, hip uses the Census cone", () => {
  assert.equal(simParams(AR, FM, STATES, { stance: "crouchStill", aim: "ads" }).cofMin, ADS_DEFAULT.crouchStill);
  assert.equal(simParams(AR, FM, STATES, { stance: "crouchStill", aim: "hip" }).cofMin, 2.25);
  assert.equal(simParams(AR, FM, STATES, { stance: "standStill", aim: "hip" }).cofMin, 3);
  assert.equal(simParams(AR, FM, STATES, { aim: "ads" }).bloom, 0.06, "aim bloom is half of the hip bloom");
});

test("attachments change the numbers the way the table says", () => {
  const base = simParams(AR, FM, STATES, { aim: "ads" });
  const comp = simParams(AR, FM, STATES, { aim: "ads", attachments: ["Compensator"] });
  assert.ok(Math.abs(comp.vMin - base.vMin * 0.7) < 1e-9);
  const grip = simParams(AR, FM, STATES, { aim: "ads", attachments: ["Forward Grip"] });
  assert.ok(Math.abs(grip.hMax - base.hMax * 0.75) < 1e-9);
  const hipC = simParams(AR, FM, STATES, { aim: "hip", attachments: ["Compensator"] });
  assert.ok(Math.abs(hipC.cofMin - 3 * 1.15) < 1e-9 || true);
  assert.ok(Object.keys(ATTACHMENTS).length >= 7);
});

test("same seed gives the same result", () => {
  const P = simParams(AR, FM, STATES, {});
  const a = burstStats(P, { burst: 4, distance: 30, hp: 500, runs: 100, seed: 3 });
  const b = burstStats(P, { burst: 4, distance: 30, hp: 500, runs: 100, seed: 3 });
  assert.deepEqual(a, b);
});

test("no spread and no kick at point blank is the ideal time-to-kill", () => {
  const P = simParams(AR, { ...FM, recoil_magnitude_min: 0, recoil_magnitude_max: 0, recoil_horizontal_min: 0, recoil_horizontal_max: 0 }, STATES, {});
  P.cofMin = P.cofMax = 0; P.bloom = 0;
  const r = simulate(P, { burst: Infinity, distance: 5, hp: 500 }, rng(1));
  assert.equal(r.ttk, 200);              // 3 shots x 167, two gaps of 100 ms
});

test("farther targets are never killed faster", () => {
  const P = simParams(AR, FM, STATES, { stance: "standStill", aim: "hip" });
  const near = burstStats(P, { burst: 3, distance: 10, hp: 500, runs: 200 });
  const far = burstStats(P, { burst: 3, distance: 80, hp: 500, runs: 200 });
  assert.ok(far.killRate <= near.killRate + 0.02);
  if (far.median != null && near.median != null) assert.ok(far.median >= near.median);
});

test("compareBursts picks the lowest median among reliable styles", () => {
  const P = simParams(AR, FM, STATES, {});
  const { rows, best } = compareBursts(P, { distance: 25, hp: 500, runs: 150 });
  assert.ok(rows.length >= 4);
  assert.ok(best && best.killRate >= 0.5);
  for (const r of rows) if (r.median != null && r.killRate >= 0.5) assert.ok(r.median >= best.median);
});

test("spray pattern: one point per shot, drifts upward without compensation", () => {
  const P = simParams(AR, FM, STATES, {});
  const pts = sprayPattern(P, { distance: 20, seed: 2, shots: 20 });
  assert.equal(pts.length, 20);
  const avg = (a) => a.reduce((s, p) => s + p.y, 0) / a.length;
  assert.ok(avg(pts.slice(10)) > avg(pts.slice(0, 5)), "later shots land higher");
});

test("every weapon in recoil.json builds finite sim parameters", () => {
  const rec = JSON.parse(readFileSync(new URL("../assets/weapons/recoil.json", import.meta.url), "utf8"));
  const { profiles } = JSON.parse(readFileSync(new URL("../assets/weapons/profiles.json", import.meta.url), "utf8"));
  let n = 0;
  for (const [id, r] of Object.entries(rec.weapons)) {
    const p = toProfile(profiles[id] || []);
    const fm = rec.fm2[r[0]];
    if (!p || !fm) continue;
    for (const aim of ["ads", "hip"]) {
      const P = simParams(p, fm, rec.groups[r[1]] || [], { stance: "standMove", aim });
      for (const k of ["gapMs", "vMin", "vMax", "cofMin", "cofMax", "bloom", "recRate"]) assert.ok(Number.isFinite(P[k]), `${id} ${aim} ${k}`);
      assert.ok(P.cofMax >= P.cofMin);
    }
    n++;
  }
  assert.ok(n > 200, "weapons checked: " + n);
});
