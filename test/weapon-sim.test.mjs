// weapon-sim.mjs: seeded recoil / cone-of-fire simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slotOf, canon, SLOTS, BURSTS, simParams, simulate, compareBursts, sprayPattern, rng, burstStats, burstAnalysis, deepTimings, ADS_DEFAULT, ATTACHMENTS, descEffects, attEffects, hitZone, TARGET } from "../weapon-sim.mjs";
import { fpsFireRateDrop } from "../weapons-model.mjs";
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
  
  assert.ok(Object.keys(ATTACHMENTS).length >= 6);
});

test("FPS limit: the simulator stretches the shot gaps by the same factor, wind-up untouched", () => {
  const base = simParams(AR, FM, STATES, { aim: "ads" });
  const drop = fpsFireRateDrop(60, 600);
  const slow = simParams(AR, FM, STATES, { aim: "ads", fpsDrop: drop });
  assert.ok(Math.abs(slow.gapMs - base.gapMs / (1 - drop)) < 1e-9, `${slow.gapMs} vs ${base.gapMs}`);
  assert.ok(Math.abs(slow.refireMs - base.refireMs / (1 - drop)) < 1e-9);
  assert.equal(slow.delayMs, base.delayMs);
  assert.equal(simParams(AR, FM, STATES, { aim: "ads" }).gapMs, base.gapMs, "no fpsDrop means no change");
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

test("aiming uses the weapon's own ADS fire mode and cone when Census has one", () => {
  const adsFm = { ...FM, cof_recoil: 0.04, recoil_magnitude_min: 0.3, recoil_magnitude_max: 0.3 };
  const adsStates = [{ player_state_id: 1, cof_min: 0.1, cof_max: 3, cof_recovery_rate: 20 }, { player_state_id: 0, cof_min: 0.2, cof_max: 3 }];
  const P = simParams(AR, FM, STATES, { stance: "crouchStill", aim: "ads", adsFm, adsStates });
  assert.equal(P.realAds, true);
  assert.equal(P.cofMin, 0.1);
  assert.equal(P.cofMax, 3);
  assert.equal(P.bloom, 0.04);
  assert.equal(P.vMin, 0.3);
  const hip = simParams(AR, FM, STATES, { stance: "crouchStill", aim: "hip", adsFm, adsStates });
  assert.equal(hip.cofMin, 2.25);
  assert.equal(hip.bloom, 0.12);
});

test("attachment slots: one barrel part, rail part and ammo each; optics and cosmetics are not listed", () => {
  assert.deepEqual([...SLOTS], ["barrel", "rail", "ammo"]);
  for (const n of ["Compensator", "Suppressor", "Flash Suppressor", "Heavy Barrel", "Short Barrel"]) assert.equal(slotOf(n), "barrel", n);
  for (const n of ["Forward Grip", "Laser Sight", "Darklight Flashlight", "Comfort Grip", "Extended Magazine"]) assert.equal(slotOf(n), "rail", n);
  for (const n of ["High Velocity Ammunition", "Soft Point Ammunition", "Flechette Ammunition"]) assert.equal(slotOf(n), "ammo", n);
  for (const n of ["NiCO (1x)", "Default Magazine", "Pink Laser Sight", "Default Back Sight", "Cert Attachment"]) assert.equal(slotOf(n), null, n);
});

test("holding the trigger is not a firing style offered", () => {
  assert.ok(!BURSTS.includes(Infinity));
});

test("the Naginata lists its laser, flash suppressor and ammo types", () => {
  const rec = JSON.parse(readFileSync(new URL("../assets/weapons/recoil.json", import.meta.url), "utf8"));
  const names = (rec.att[804249] || []).map((i) => rec.atts[i][0]);   // slim file: atts = [[name, descIndex]] (scripts/weapon-slim.mjs)
  for (const n of ["Laser Sight", "Flash Suppressor", "Soft Point Ammunition", "High Velocity Ammunition", "Heavy Barrel", "Short Barrel"]) assert.ok(names.includes(n), n);
});

test("Laser Sight narrows the minimum hip cone by a third, not the bloom; Soft Point pushes max damage range out 5 m", () => {
  const base = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill" });
  const laser = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill", attachments: ["Laser Sight"] });
  assert.ok(Math.abs(laser.cofMin - base.cofMin * 0.67) < 1e-9);
  assert.equal(laser.bloom, base.bloom);
  assert.equal(laser.cofMax, base.cofMax);
  const comp = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill", attachments: ["Compensator"] });
  assert.ok(Math.abs(comp.cofMin - base.cofMin * 1.15) < 1e-9);
  assert.equal(comp.cofMax, base.cofMax, "only the minimum cone grows");
  const ads = simParams(AR, FM, STATES, { aim: "ads", attachments: ["Laser Sight"] });
  assert.equal(ads.cofMin, simParams(AR, FM, STATES, { aim: "ads" }).cofMin, "no effect while aiming");
  const sp = simParams(AR, FM, STATES, { attachments: ["Soft Point Ammunition"] });
  assert.equal(sp.profile.rangeMaxDmg, AR.rangeMaxDmg + 5);
  assert.equal(sp.profile.rangeMinDmg, AR.rangeMinDmg);
  const hv = simParams(AR, FM, STATES, { attachments: ["High Velocity Ammunition"] });
  assert.equal(hv.profile.rangeMaxDmg, AR.rangeMaxDmg - 2);
  assert.equal(hv.profile.rangeMinDmg, AR.rangeMinDmg + 20);
  assert.equal(simParams(AR, FM, STATES, { attachments: ["Suppressor"], attDesc: { Suppressor: "the weapon's damage falls off 20 meters sooner" } }).profile.rangeMinDmg, AR.rangeMinDmg - 20);
  assert.equal(simParams(AR, FM, STATES, { attachments: ["Suppressor"], attDesc: { Suppressor: "the weapon's damage falls off 10 meters sooner" }, cat: "SMG" }).profile.rangeMinDmg, AR.rangeMinDmg - 10);
});

test("more wiki attachments: MPL, Weighted Receiver, Smart-Choke, Heavy Magazine, KCAP, Vented Power Core, aliases", () => {
  const base = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill" });
  const mpl = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill", attachments: ["MPL"] });
  assert.ok(Math.abs(mpl.vMin - base.vMin * 0.4) < 1e-9 && Math.abs(mpl.hMax - base.hMax * 0.4) < 1e-9);
  const adsMpl = simParams(AR, FM, STATES, { aim: "ads", attachments: ["MPL"] });
  assert.equal(adsMpl.vMin, simParams(AR, FM, STATES, { aim: "ads" }).vMin, "no effect while aiming");
  assert.equal(simParams(AR, FM, STATES, { aim: "ads", attachments: ["Weighted Receiver"] }).cofMin, 0);
  const hm = simParams(AR, FM, STATES, { aim: "hip", stance: "standStill", attachments: ["Heavy Magazine"] });
  assert.ok(Math.abs(hm.cofMin - base.cofMin * 1.2) < 1e-9);
  assert.equal(simParams(AR, FM, STATES, { attachments: ["KCAP Ammunition"] }).profile.hsMult, AR.hsMult - 0.5);
  assert.equal(simParams(AR, FM, STATES, { attachments: ["KCAP Ammunition"] }).profile.legMult, 1.2, "KCAP flips legs to 1.2x");
  const sg = { ...FM, pellet_spread: 2 };
  assert.equal(simParams(AR, sg, STATES, { aim: "ads", attachments: ["Smart-Choke"] }).pelletSpread, 1.5);
  assert.equal(simParams(AR, sg, STATES, { aim: "hip", attachments: ["Smart-Choke"] }).pelletSpread, 2.5);
  const a0 = simParams(AR, FM, STATES, { aim: "ads" }), a1 = simParams(AR, FM, STATES, { aim: "ads", attachments: ["Vented Power Core"] });
  assert.equal(a1.angMax - a0.angMax, 5);
  assert.equal(canon("Muzzle Brake"), "Compensator");
  assert.equal(simParams(AR, FM, STATES, { aim: "ads", attachments: ["Muzzle Brake"] }).vMin, simParams(AR, FM, STATES, { aim: "ads", attachments: ["Compensator"] }).vMin);
  assert.equal(slotOf("Heavy Magazine"), "ammo");
  assert.equal(slotOf("MPL"), "rail");
});

test("legs: the lower body box is a leg zone at 0.9x, KCAP flips it to 1.2x", () => {
  assert.equal(TARGET.legTop, -0.3, "the waist splits torso from legs");
  assert.equal(hitZone(0, 0.45), "head");
  assert.equal(hitZone(0, 0), "body");
  assert.equal(hitZone(0, -0.29), "body");    // just above the waist
  assert.equal(hitZone(0, -0.31), "leg");     // just below it
  assert.equal(hitZone(0, -1.2), "leg");
  assert.equal(hitZone(0, -1.21), null);
  assert.equal(hitZone(0.31, -0.8), null);
  // a shot aimed at the legs deals leg damage: 7 shots at 10 m (7 x 150.3), where the torso takes 6
  const still = { cofMin: 0, cofMax: 0, bloom: 0, vMin: 0, vMax: 0, hMin: 0, hMax: 0, angMin: 0, angMax: 0 };
  const legP = { ...simParams(AR, FM, STATES, { aim: "ads", aimX: 0, aimY: -0.8 }), ...still };
  const legRun = simulate(legP, { burst: 1, distance: 10, hp: 1000 }, rng(1), true);
  assert.equal(legRun.fired, 7);
  assert.ok(legRun.shots.every((s) => s.zone === "leg"));
  const bodyP = { ...simParams(AR, FM, STATES, { aim: "ads" }), ...still };
  assert.equal(simulate(bodyP, { burst: 1, distance: 10, hp: 1000 }, rng(1)).fired, 6);
  // KCAP at the legs: 5 shots (5 x 200.4 = 1002)
  const kcapP = { ...simParams(AR, FM, STATES, { aim: "ads", aimX: 0, aimY: -0.8, attachments: ["KCAP Ammunition"] }), ...still };
  assert.equal(simulate(kcapP, { burst: 1, distance: 10, hp: 1000 }, rng(1)).fired, 5);
});

test("Unstable (1.2x headshot, bigger bullets) and Disruptor (20 % of the damage drained away)", () => {
  const u = simParams(AR, FM, STATES, { attachments: ["Unstable Ammunition"] });
  assert.equal(u.profile.hsMult, 1.2);
  assert.equal(u.bulletRadius, 0.07);
  const d = simParams(AR, FM, STATES, { attachments: ["Disruptor Ammunition"] });
  assert.ok(Math.abs(d.profile.dmgMax - AR.dmgMax * 0.8) < 1e-9 && Math.abs(d.profile.dmgMin - AR.dmgMin * 0.8) < 1e-9);
  assert.equal(d.profile.hsMult, AR.hsMult);
  // a shot just outside the body box hits with the big bullets, not with the normal ones
  const aim = (P) => { const r = rng(3); let hits = 0; for (let i = 0; i < 300; i++) { const x = simulate({ ...P, cofMin: 0, cofMax: 0, bloom: 0, vMin: 0, vMax: 0, hMin: 0, hMax: 0, angMin: 0, angMax: 0 }, { burst: 1, distance: 10, hp: 1 }, r); if (x.ttk != null) hits++; } return hits; };
  assert.equal(aim(simParams(AR, FM, STATES, {})), 300, "dead centre always hits");
});

test("Explosive: -125 direct, +100 splash even when the shot lands beside the target; Sabot: -10 % rate of fire", () => {
  const e = simParams(AR, FM, STATES, { attachments: ["Explosive Ammunition"] });
  assert.equal(e.profile.dmgMax, AR.dmgMax - 125);
  assert.equal(e.splash, 100);
  assert.equal(e.splashR, 2);
  const s = simParams(AR, FM, STATES, { attachments: ["Sabot Ammunition"] });
  assert.ok(Math.abs(s.gapMs - simParams(AR, FM, STATES, {}).gapMs / 0.9) < 1e-9);
});

test("per-weapon attachments apply only to their weapon, magazine add works", () => {
  const P = { rpm: 600, mag: 30, reloadMs: 2000, pellets: 1, dmgMax: 143, dmgMin: 112, rangeMaxDmg: 10, rangeMinDmg: 50, hsMult: 2 };
  const a = simParams(P, {}, [], { aim: "hip", attachments: ["Impact Ammunition"], weaponName: "Arbalest" });
  assert.equal(a.mag, 24); assert.equal(a.profile.dmgMax, 125);
  const b = simParams(P, {}, [], { aim: "hip", attachments: ["Impact Ammunition"], weaponName: "Other" });
  assert.equal(b.mag, 30); assert.equal(b.profile.dmgMax, 143);
  assert.equal(simParams(P, {}, [], { attachments: ["High-capacity Battery"] }).mag, 33);
  assert.equal(canon("Counterweight"), "Comfort Grip");
  assert.equal(slotOf("Detect Bolt"), "ammo");
});

test("aim: accuracy 0 never hits, hsr 1 aims all at the head, compensation shrinks vertical kick", () => {
  const P = { rpm: 600, mag: 30, reloadMs: 2000, pellets: 1, dmgMax: 143, dmgMin: 112, rangeMaxDmg: 10, rangeMinDmg: 50, hsMult: 2 };
  const FM = { cof_recoil: 0, recoil_magnitude_min: 0.3, recoil_magnitude_max: 0.3 };
  const ST = [{ player_state_id: 1, cof_min: 0, cof_max: 0 }];
  const run = (o, d = 20) => simulate(simParams(P, FM, ST, { stance: "crouchStill", aim: "hip", ...o }), { burst: 1, distance: d, hp: 1e9 }, rng(3), true).shots;
  assert.ok(run({ acc: 0.0001, hsr: 0 }, 100).every((s) => !s.zone));          // a shot misses with probability 1 - accuracy
  assert.ok(run({ acc: 0.0001, hsr: 0 }, 1).every((s) => !s.zone));
  assert.ok(run({ acc: 1, hsr: 0, aimTarget: "head" }).every((s) => s.zone === "head"));   // aim at the head: every shot on it
  assert.ok(run({ acc: 1, hsr: 0, aimY: -0.9 }).every((s) => s.zone === "leg"));           // aim at the legs: the leg zone
  assert.ok(run({ acc: 1, hsr: 0, aimX: 0.5, aimY: -0.9 }).every((s) => !s.zone));         // beside the body: misses
  assert.ok(run({ acc: 1, hsr: 1, aimY: -0.9 }).every((s) => s.zone === "head"));          // legs aimed, headshot chance: the head
  assert.ok(run({ acc: 0.7, hsr: 1 }, 20).some((s) => s.zone === "head"));    // head aim still lands heads with imperfect aim
  assert.ok(run({ acc: 1, hsr: 1 }).every((s) => s.zone === "head"));
  assert.ok(run({ acc: 1, hsr: 0 }).every((s) => s.zone === "body"));
  const y = (o) => simulate(simParams(P, { ...FM, recoil_recovery_rate: 0.0001, recoil_recovery_delay_ms: 1e7 }, ST, { aim: "hip", ...o }), { burst: Infinity, distance: 20, hp: 1e9 }, rng(3), true).shots.at(-1).y;
  assert.ok(Math.abs(y({ comp: 0.5 })) < Math.abs(y({ comp: 0 })));
});

test("Census descriptions give per-weapon magazine, slug, flechette and capsulate numbers", () => {
  assert.deepEqual(descEffects("Extended Magazine", "Increases the amount of ammunition in each magazine by 10 rounds, and the weapon takes 15% longer"), { magAdd: 10 });
  assert.equal(descEffects("Extended Magazine", "Doubles the amount of ammunition in each magazine, and").magMul, 2);
  assert.equal(descEffects("Smart Feeder", "Increases magazine size by 50 rounds ... slows your reload speed by 0.325 seconds.").reloadAdd, 325);
  assert.equal(descEffects("SPRW Ammunition", "Increases projectile velocity by 25%, while reducing magazine size by 25.").magAdd, -25);
  const slug = descEffects("Slug Ammunition", "fires an accurate, high-velocity slug dealing 450 damage, falling off to 300 at the weapon's minimum damage range.");
  assert.deepEqual([slug.dmgSet, slug.dmgSetMin, slug.pelletsSet], [450, 300, 1]);
  const P = { rpm: 400, mag: 6, reloadMs: 2000, pellets: 6, dmgMax: 120, dmgMin: 40, rangeMaxDmg: 8, rangeMinDmg: 30, hsMult: 1, };
  const f = simParams(P, {}, [], { attachments: ["Flechette Ammunition"], attDesc: { "Flechette Ammunition": "triple the maximum and minimum damage falloff range, but reduce the number of pellets fired per shot by 2." } });
  assert.equal(f.pellets, 4); assert.equal(f.profile.rangeMaxDmg, 24);
  const c = simParams(P, {}, [], { attachments: ["Capsulate Ammunition"], attDesc: { "Capsulate Ammunition": "reduces magazine size by 4." } });
  assert.deepEqual([c.pellets, c.mag, c.profile.dmgMax], [2, 2, 360]);
  assert.equal(attEffects("Mystery Part", "does something", "X"), null);
});

test("burst analysis: 20 shots, zones sum to the total, expected damage adds up, later shots decay", () => {
  const P = simParams(AR, FM, STATES, { aim: "ads", stance: "standMove" });
  const rows = burstAnalysis(P, { distance: 10, runs: 300, seed: 1 });
  assert.equal(rows.length, 20);
  let cumul = 0;
  for (let i = 0; i < 20; i++) {
    const r = rows[i];
    assert.equal(r.shot, i + 1);
    assert.ok(Math.abs(r.body + r.head + r.leg - r.total) < 1e-12);
    assert.ok(r.total <= 1 && r.total >= 0, `shot ${r.shot} total ${r.total}`);
    assert.ok(Math.abs(r.expDmg - (r.body * 167 + r.head * 334 + r.leg * 150.3)) < 1e-9, `shot ${r.shot} expDmg ${r.expDmg}`);
    cumul += r.expDmg;
    assert.ok(Math.abs(r.cumul - cumul) < 1e-9, `shot ${r.shot} cumul ${r.cumul}`);
  }
  assert.ok(rows[0].total > 0.9, `first shot total ${rows[0].total}`);
  assert.ok(rows[19].total < rows[0].total, `last ${rows[19].total} vs first ${rows[0].total}`);
  assert.deepEqual(burstAnalysis(P, { distance: 10, runs: 300, seed: 1 }), rows, "same seed, same table");
});

test("burst stats carry the median shots to kill", () => {
  const P = simParams(AR, FM, STATES, { aim: "ads", stance: "standMove", acc: 1, hsr: 0 });
  const s = burstStats(P, { burst: 1, distance: 10, hp: 1000, runs: 60, seed: 1 });
  assert.equal(typeof s.medianShots, "number");
  assert.ok(s.medianShots >= 1 && s.medianShots <= 30, `medianShots ${s.medianShots}`);
  const c = compareBursts(P, { distance: 10, hp: 1000, runs: 60, seed: 1 });
  assert.ok(c.rows.every((r) => typeof r.medianShots === "number" || r.medianShots == null));
});

test("deep timings: Dorf's click-down, release delays and pulldown", () => {
  const P = simParams(AR, FM, STATES, { aim: "ads", stance: "standMove" });
  const T = deepTimings(P, { fps: 150, resY: 2160, fov: 74, zoom: 1.35 });
  assert.equal(T.recoil.length, 20);
  assert.equal(T.cof.length, 20);
  assert.equal(T.pull.length, 20);
  const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
  // click-down: one frame per shot (1000/150 ms) plus the gaps between them (100 ms at 600 rpm)
  near(T.recoil[0].down, 1000 / 150);
  near(T.recoil[1].down, 100 + 2 * 1000 / 150);
  near(T.recoil[19].down, 19 * 100 + 20 * 1000 / 150);
  for (let i = 0; i < 20; i++) {
    near(T.recoil[i].total, T.recoil[i].down + T.recoil[i].release, 1e-9);
    near(T.cof[i].total, T.cof[i].down + T.cof[i].release, 1e-9);
    assert.equal(T.cof[i].down, T.recoil[i].down, "both tables share the click-down");
    assert.ok(T.recoil[i].release >= 100, "the release delay includes the refire");
    if (i) {
      assert.ok(T.recoil[i].release >= T.recoil[i - 1].release, "recoil release never shrinks");
      assert.ok(T.cof[i].release >= T.cof[i - 1].release, "CoF release never shrinks");
    }
  }
  // the horizontal kicks of the first two shots are all that accumulate: the recoil release plateaus from burst 3
  assert.equal(T.recoil[2].release, T.recoil[19].release);
  assert.ok(T.recoil[1].release > T.recoil[0].release, "the second shot adds one horizontal kick");
  // pulldown: the mean kick (0.5 deg here), the first shot's extra kick, pixels from screen/FOV/zoom, speed per second
  near(T.pull[0].deg, -0.5);
  near(T.pull[0].px, (2160 / 74) * 1.35 * -0.5, 1e-9);
  near(T.pull[0].speed, T.pull[0].px / 0.1, 1e-9);
  near(T.pull[0].angle, 0);
  const fsr = simParams(AR, { ...FM, recoil_first_shot_modifier: 1.5 }, STATES, { aim: "ads", stance: "standMove" });
  const Tf = deepTimings(fsr);
  near(Tf.pull[0].deg, -0.75);
  near(Tf.pull[1].deg, -0.5);
});

test("loadout: the exact-maths profile and the stat rows take the same attachment numbers as the simulator", async () => {
  const { loadoutEffects, loadoutProfile, loadoutRec } = await import("../weapon-sim.mjs");
  assert.equal(loadoutProfile(AR, loadoutEffects([], {}, "x")), AR, "no attachments: the same profile");
  assert.equal(loadoutProfile(AR, loadoutEffects(["Compensator"], {}, "x")), AR, "a recoil-only part leaves the profile alone");
  const soft = loadoutProfile(AR, loadoutEffects(["Soft Point Ammunition"], {}, "x"));
  assert.equal(soft.rangeMaxDmg, AR.rangeMaxDmg + 5);
  const sim = simParams(AR, FM, STATES, { aim: "ads", attachments: ["Soft Point Ammunition"] });
  assert.equal(sim.profile.rangeMaxDmg, soft.rangeMaxDmg, "same falloff as the simulator");
  const ext = loadoutProfile(AR, loadoutEffects(["Extended Magazine"], { "Extended Magazine": "Increases magazine size by 10 rounds." }, "x"));
  assert.equal(ext.mag, AR.mag + 10);
  const sabot = loadoutProfile(AR, loadoutEffects(["Sabot Ammunition"], {}, "x"));
  assert.ok(Math.abs(sabot.rpm - AR.rpm * 0.9) < 1e-9);
  const rec = { fm: { ...FM }, adsFm: { ...FM, cof_recoil: 0.06 }, states: STATES, adsStates: STATES };
  const A = loadoutEffects(["Compensator", "Heavy Barrel"], {}, "x");
  const r = loadoutRec(rec, A, false);
  assert.ok(Math.abs(r.adsFm.recoil_magnitude_min - FM.recoil_magnitude_min * 0.7) < 1e-9);
  assert.ok(Math.abs(r.adsFm.cof_recoil - 0.06 * 0.8) < 1e-9);
  assert.ok(Math.abs(r.states[0].cof_min - STATES[0].cof_min * 1.15) < 1e-9, "Compensator widens the minimum hip cone");
  assert.equal(rec.adsFm.cof_recoil, 0.06, "the Census rows are not changed in place");
  const P = simParams(AR, FM, STATES, { aim: "ads", adsFm: rec.adsFm, adsStates: STATES, attachments: ["Compensator", "Heavy Barrel"] });
  assert.ok(Math.abs(P.vMin - r.adsFm.recoil_magnitude_min) < 1e-9 && Math.abs(P.bloom - r.adsFm.cof_recoil) < 1e-9, "the table and the simulator agree");
});

test("aim rule: headshot rate 0 aims every shot at the chest, 1 at the head (no separate aim point)", () => {
  const P = { ...simParams(AR, FM, STATES, { aim: "ads", acc: 1, hsr: 0 }), cofMin: 0, cofMax: 0, bloom: 0, vMin: 0, vMax: 0, hMin: 0, hMax: 0, angMin: 0, angMax: 0 };
  const zones = (hsr) => sprayPattern({ ...P, hsr }, { distance: 10, seed: 3, shots: 20 }).map((s) => s.zone);
  assert.ok(zones(0).every((z) => z === "body"), "0 %: chest only");
  assert.ok(zones(1).every((z) => z === "head"), "100 %: head only");
});
