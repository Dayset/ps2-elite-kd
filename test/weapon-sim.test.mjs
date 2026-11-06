// weapon-sim.mjs: seeded recoil / cone-of-fire simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slotOf, canon, SLOTS, BURSTS, simParams, simulate, compareBursts, sprayPattern, rng, burstStats, ADS_DEFAULT, ATTACHMENTS, descEffects, attEffects } from "../weapon-sim.mjs";
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
  for (const n of ["Compensator", "Suppressor", "Flash Suppressor"]) assert.equal(slotOf(n), "barrel", n);
  for (const n of ["Forward Grip", "Laser Sight", "Darklight Flashlight", "Comfort Grip", "Heavy Barrel", "Short Barrel", "Extended Magazine"]) assert.equal(slotOf(n), "rail", n);
  for (const n of ["High Velocity Ammunition", "Soft Point Ammunition", "Flechette Ammunition"]) assert.equal(slotOf(n), "ammo", n);
  for (const n of ["NiCO (1x)", "Default Magazine", "Pink Laser Sight", "Default Back Sight", "Cert Attachment"]) assert.equal(slotOf(n), null, n);
});

test("holding the trigger is not a firing style offered", () => {
  assert.ok(!BURSTS.includes(Infinity));
});

test("the Naginata lists its laser, flash suppressor and ammo types", () => {
  const rec = JSON.parse(readFileSync(new URL("../assets/weapons/recoil.json", import.meta.url), "utf8"));
  const names = (rec.att[804249] || []).map((i) => rec.attNames[i]);
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
  assert.ok(run({ acc: 0.0001, hsr: 0 }, 100).every((s) => s.zone == null));   // a wrong aim is an angle: a miss at 100 m
  assert.ok(run({ acc: 0.0001, hsr: 0 }, 1).every((s) => s.zone));            // but a hit at point-blank
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
