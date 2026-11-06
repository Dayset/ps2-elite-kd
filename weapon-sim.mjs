// Recoil / cone-of-fire simulator for the weapon comparison page (pure, seeded, no DOM).
//
// An imaginary target stands at a chosen distance, the shooter does NOT compensate
// recoil (no mouse pull-down), and the sim fires with a chosen burst length. It answers
// "which firing style kills fastest with this weapon, from this stance, at this range?"
//
// Data per weapon comes from Census (assets/weapons/recoil.json): vertical / horizontal
// recoil, first-shot multiplier, bloom per shot, cone of fire per stance, recovery.
// Aiming uses the weapon's own ADS fire mode (fire_mode_2.iron_sights = 1): its recoil,
// bloom and cone per stance. NOT in Census: attachment numbers, the target size and how
// the cone is filled. Those are constants here, labelled on the page.
//
// Units: angles in degrees, distances in metres, time in ms.
import { hitDamage } from "./weapons-model.mjs";

export const STANCES = Object.freeze(["crouchStill", "standStill", "crouchMove", "standMove"]);
// Census player_state ids: 0 Standing, 1 Crouching, 2 Running, 5 CrouchWalking
export const STATE_ID = Object.freeze({ standStill: 0, crouchStill: 1, standMove: 2, crouchMove: 5 });

/** Fallback only, for a weapon whose Census data has no aim-down-sights fire mode: the NSX Naginata's wiki values. Normally the ADS cone comes from the ADS fire mode's own player_state_group. */
export const ADS_DEFAULT = Object.freeze({ crouchStill: 0.15, standStill: 0.15, crouchMove: 0.35, standMove: 0.4, bloomRatio: 0.5 });

/** Target: aim point = chest centre. Head circle + body rectangle, metres, y up. */
export const TARGET = Object.freeze({ headX: 0, headY: 0.45, headR: 0.15, halfW: 0.3, top: 0.3, bottom: -1.2 });

export const ASSUMPTIONS = Object.freeze([
  "target-size", "cone-uniform", "kick-after-shot", "horizontal-tolerance", "no-compensation",
]);

/**
 * Attachment slots, from the PlanetSide 2 wiki (Fandom, read 6 Nov 2026): Compensator, Suppressor and
 * Flash Suppressor are barrel attachments; the grips, Laser Sight, Hybrid Laser, flashlight, Heavy
 * Barrel, Short Barrel and Extended Magazine are all RAIL attachments (so Heavy Barrel + Short
 * Barrel, or a grip + laser, cannot be fitted together); ammunition types are the ammo slot.
 * Census lists what a weapon can mount but not the slot, so it comes from the name. Rarer parts
 * (Muzzle Brake, Smart-Choke, launchers, Heavy Magazine...) are placed by the same rule, unverified.
 * Optics, default parts, cosmetic laser colours and cert items are not listed.
 */
export const SLOTS = Object.freeze(["barrel", "rail", "ammo"]);
const SLOT_RE = {
  barrel: /^(Compensator|Flash Suppressor|Suppressor|Muzzle Brake|Smart-Choke|Hybrid Suppressor|Burst Stabilizer|Recoil Stabilizer|Confetti Suppressor)$/i,
  rail: /^(Forward Grip|Angled Forward Grip|Comfort Grip|Laser Sight|Hybrid Laser|Darklight Flashlight|Zip Light|Heavy Barrel|Short Barrel|Extended Magazine|Heavy Magazine|Smart Feeder|Grenade Launcher|Underbarrel Shotgun|Smoke Launcher|Cure Launcher|Adaptive Class Underbarrel)$/i,
  ammo: /Ammunition$/i,
};
export function slotOf(name) {
  for (const s of SLOTS) if (SLOT_RE[s].test(String(name || "").trim())) return s;
  return null;
}

/**
 * Attachment modifiers. Census has NO numbers for attachments; these are typed in from the
 * PlanetSide 2 wiki attachment pages (Fandom, read 6 Nov 2026, current to patch 2023-02-08 or
 * later), which agree with Izubrr/planetside_weapon_compare and the Arsenal Update notes.
 * vRecoil / hRecoil (horizontal recoil, tolerance, angle) / firstShot multiply the recoil numbers,
 * hipMinCof the MINIMUM hip cone, hipSpread the hip pellet spread, hipBloom / adsBloom the bloom
 * per shot, adsVRecoil the vertical recoil while aiming only. maxRange / minRange add metres to the
 * damage falloff range (minRangeSmg replaces minRange on SMGs). An entry with no keys is a known
 * attachment with no effect on killing. Bullet speed changes are not modelled: a hit is instant here.
 * Not modelled (no usable numbers): Extended Magazine (amount depends on the weapon), Slug and
 * Flechette ammunition (damage and pellet count depend on the shotgun class) and the rarer ammo types.
 */
export const ATTACHMENTS = Object.freeze({
  "Compensator": { vRecoil: 0.7, hipMinCof: 1.15 },
  "Suppressor": { minRange: -20, minRangeSmg: -10 },
  "Flash Suppressor": {},
  "Forward Grip": { hRecoil: 0.75 },
  "Angled Forward Grip": { firstShot: 0.4, hRecoil: 1.1 },
  "Comfort Grip": { vRecoil: 1.2, hRecoil: 0.8 },
  "Laser Sight": { hipMinCof: 0.67 },
  "Hybrid Laser": { hipMinCof: 0.67, hipSpread: 0.67 },
  "Darklight Flashlight": {},
  "Heavy Barrel": { adsBloom: 0.8 },
  "Short Barrel": { hipBloom: 0.6, adsVRecoil: 1.2 },
  "Soft Point Ammunition": { maxRange: 5 },
  "High Velocity Ammunition": { maxRange: -2, minRange: 20 },
});

/** Strategies: shots per burst (holding the trigger down is not offered: it is never the practical choice). */
export const BURSTS = Object.freeze([1, 2, 3, 4, 6, 8, 12]);

/**
 * Everything the simulation needs, from the Census record, the stance rows and the chosen options.
 * opts: { stance, aim: "ads" | "hip", attachments: [names], ads }
 */
function adjustRanges(profile, A, cat) {
  const sum = (k) => A.reduce((m, a) => m + (a[k] || 0), 0);
  const dMax = sum("maxRange");
  const dMin = A.reduce((m, a) => m + (cat === "SMG" && a.minRangeSmg != null ? a.minRangeSmg : a.minRange || 0), 0);
  if (!dMax && !dMin) return profile;
  const far = profile.rangeMinDmg > 0 ? Math.max(0, profile.rangeMinDmg + dMin) : profile.rangeMinDmg;
  return { ...profile, rangeMaxDmg: Math.max(0, profile.rangeMaxDmg + dMax), rangeMinDmg: far };
}

export function simParams(profile, fm, states, opts = {}) {
  const stance = opts.stance || "crouchStill";
  const hip = opts.aim === "hip";
  // aiming uses the weapon's own ADS fire mode (fire_mode_2.iron_sights = 1) and its own cone per stance
  const realAds = !hip && opts.adsStates && opts.adsStates.length ? true : false;
  const rows = realAds ? opts.adsStates : states;
  const f = (!hip && opts.adsFm) || fm || {};
  const ads = { ...ADS_DEFAULT, ...(opts.ads || {}) };
  const row = (rows || []).find((r) => r.player_state_id === STATE_ID[stance]) || (rows || [])[0] || {};
  const A = (opts.attachments || []).map((n) => ATTACHMENTS[n]).filter(Boolean);
  const mul = (key) => A.reduce((m, a) => m * (a[key] ?? 1), 1);
  let cofMin = hip || realAds ? (row.cof_min ?? 2) : ads[stance];
  let cofMax = row.cof_max ?? Math.max(cofMin, 1);
  if (hip) cofMin *= mul("hipMinCof");
  if (cofMax < cofMin) cofMax = cofMin;
  const baseBloom = f.cof_recoil ?? (fm && fm.cof_recoil) ?? 0.1;
  const bloom = baseBloom * (hip ? mul("hipBloom") : (opts.adsFm ? 1 : ads.bloomRatio) * mul("adsBloom"));
  const rec = (hip ? mul("hipRecoil") : 1);
  const vMul = mul("vRecoil") * (hip ? 1 : mul("adsVRecoil")) * rec;
  const hMul = mul("hRecoil") * rec;
  return {
    gapMs: f.fire_refire_ms || 60000 / profile.rpm,
    mag: profile.mag, reloadMs: profile.reloadMs, pellets: profile.pellets,
    profile: adjustRanges(profile, A, opts.cat),
    vMin: (f.recoil_magnitude_min ?? 0.3) * vMul, vMax: (f.recoil_magnitude_max ?? 0.3) * vMul,
    first: Math.max(0, (f.recoil_first_shot_modifier ?? 1) * mul("firstShot")),
    angMin: (f.recoil_angle_min ?? 0) * hMul, angMax: (f.recoil_angle_max ?? 0) * hMul,
    hMin: (f.recoil_horizontal_min ?? 0) * hMul, hMax: (f.recoil_horizontal_max ?? 0) * hMul,
    hTol: (f.recoil_horizontal_tolerance ?? 0.4) * hMul,
    recDelay: f.recoil_recovery_delay_ms ?? 0, recRate: Math.max(0.01, f.recoil_recovery_rate ?? 10),
    cofMin, cofMax, bloom,
    cofRecRate: Math.max(0.01, row.cof_recovery_rate ?? 20), cofRecDelay: row.cof_recovery_delay_ms ?? 0,
    pelletSpread: (f.pellet_spread ?? f.cof_pellet_spread ?? 0) * (hip ? mul("hipSpread") : 1),
    realAds,
  };
}

/** Small fast seeded RNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD = Math.PI / 180;
const rnd = (r, a, b) => a + (b - a) * r();

function hitZone(x, y) {
  const dx = x - TARGET.headX, dy = y - TARGET.headY;
  if (dx * dx + dy * dy <= TARGET.headR * TARGET.headR) return "head";
  if (Math.abs(x) <= TARGET.halfW && y <= TARGET.top && y >= TARGET.bottom) return "body";
  return null;
}

/**
 * One kill attempt. Returns { ttk (ms or null), shots: [{ t, x, y, zone }], fired }.
 * `burst` shots, then a pause long enough to recover kick and bloom completely, then again.
 * A magazine runs dry -> short reload. Gives up after 3 magazines.
 */
export function simulate(P, { burst = Infinity, distance = 20, hp = 1000 }, r, keepShots = false) {
  const { body, head } = hitDamage(P.profile, distance);
  const tan = Math.tan;
  let t = 0, ox = 0, oy = 0, hx = 0, cof = P.cofMin, dealt = 0, inBurst = 0, magLeft = P.mag, fired = 0;
  const shots = [];
  const limit = P.mag * 3;
  while (fired < limit) {
    // the shot leaves where the crosshair is, with the cone on top (kick comes after)
    const radius = (cof + (P.pellets > 1 ? P.pelletSpread : 0)) / 2;
    for (let k = 0; k < P.pellets; k++) {
      const a = r() * 2 * Math.PI, d = Math.sqrt(r()) * radius;
      const ax = ox + d * Math.cos(a), ay = oy + d * Math.sin(a);
      const x = distance * tan(ax * RAD), y = distance * tan(ay * RAD);
      const zone = hitZone(x, y);
      if (keepShots) shots.push({ i: fired, t, x, y, zone });
      if (zone) dealt += zone === "head" ? head : body;
    }
    fired++; inBurst++; magLeft--;
    if (dealt >= hp) return { ttk: t, shots, fired };
    // kick, bloom
    const mult = inBurst === 1 ? P.first : 1;
    const v = rnd(r, P.vMin, P.vMax) * mult;
    const ang = rnd(r, P.angMin, P.angMax) * RAD;
    oy += v * Math.cos(ang); ox += v * Math.sin(ang);
    let h = rnd(r, P.hMin, P.hMax);
    let sign = r() < 0.5 ? -1 : 1;
    if (Math.abs(hx + sign * h) > P.hTol) sign = -sign;          // tolerance: the drift turns back
    hx += sign * h; ox += sign * h;
    cof = Math.min(P.cofMax, cof + P.bloom);
    // next shot
    if (magLeft <= 0) {
      t += P.reloadMs; magLeft = P.mag; ox = oy = hx = 0; cof = P.cofMin; inBurst = 0;
    } else if (inBurst >= burst) {
      const kick = Math.hypot(ox, oy);
      const pause = Math.max(P.recDelay + kick / P.recRate * 1000, P.cofRecDelay + (cof - P.cofMin) / P.cofRecRate * 1000);
      t += P.gapMs + pause; ox = oy = hx = 0; cof = P.cofMin; inBurst = 0;
    } else {
      t += P.gapMs;
      // while the trigger is held the kick does not recover (it only does after a pause)
    }
  }
  return { ttk: null, shots, fired };
}

const quant = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

/** Monte Carlo over `runs` kills for one burst length. */
export function burstStats(P, { burst, distance, hp, runs = 600, seed = 1 }) {
  const r = rng(seed * 7919 + (Number.isFinite(burst) ? burst : 99));
  const kills = [];
  for (let i = 0; i < runs; i++) {
    const res = simulate(P, { burst, distance, hp }, r);
    if (res.ttk != null) kills.push(res.ttk);
  }
  kills.sort((a, b) => a - b);
  return { burst, killRate: kills.length / runs, median: quant(kills, 0.5), p10: quant(kills, 0.1), p90: quant(kills, 0.9) };
}

/** All strategies; `best` = lowest median among those that kill at least half the time. */
export function compareBursts(P, { distance = 20, hp = 1000, runs = 600, seed = 1, bursts = BURSTS } = {}) {
  const rows = bursts.filter((b) => b <= P.mag).map((burst) => burstStats(P, { burst, distance, hp, runs, seed }));
  let best = null;
  for (const s of rows) if (s.median != null && s.killRate >= 0.5 && (!best || s.median < best.median)) best = s;
  return { rows, best };
}

/** One full spray (hold the trigger) with the impact points, for the pattern picture. */
export function sprayPattern(P, { distance = 20, seed = 1, shots = 30 } = {}) {
  const r = rng(seed * 104729);
  const big = { ...P, mag: Math.max(P.mag, shots) };
  const res = simulate(big, { burst: Infinity, distance, hp: 1e9 }, r, true);
  return res.shots.filter((s) => s.i < shots);
}
