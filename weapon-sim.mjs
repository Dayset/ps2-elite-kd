// Recoil / cone-of-fire simulator for the weapon comparison page (pure, seeded, no DOM).
//
// An imaginary target stands at a chosen distance, the shooter does NOT compensate
// recoil (no mouse pull-down), and the sim fires with a chosen burst length. It answers
// "which firing style kills fastest with this weapon, from this stance, at this range?"
//
// Data per weapon comes from Census (assets/weapons/recoil.json): vertical / horizontal
// recoil, first-shot multiplier, bloom per shot, cone of fire per stance, recovery.
// NOT in Census (see ASSUMPTIONS): the aim-down-sights cone, the aim bloom, the target
// size and how the cone is filled. Those are constants here, labelled on the page.
//
// Units: angles in degrees, distances in metres, time in ms.
import { hitDamage } from "./weapons-model.mjs";

export const STANCES = Object.freeze(["crouchStill", "standStill", "crouchMove", "standMove"]);
// Census player_state ids: 0 Standing, 1 Crouching, 2 Running, 5 CrouchWalking
export const STATE_ID = Object.freeze({ standStill: 0, crouchStill: 1, standMove: 2, crouchMove: 5 });

/** Aim-down-sights numbers are not in Census. These are the NSX Naginata's wiki values (Accuracy table), applied to every weapon until per-weapon values are known. */
export const ADS_DEFAULT = Object.freeze({ crouchStill: 0.15, standStill: 0.15, crouchMove: 0.35, standMove: 0.4, bloomRatio: 0.5 });

/** Target: aim point = chest centre. Head circle + body rectangle, metres, y up. */
export const TARGET = Object.freeze({ headX: 0, headY: 0.45, headR: 0.15, halfW: 0.3, top: 0.3, bottom: -1.2 });

export const ASSUMPTIONS = Object.freeze([
  "ads-cone", "ads-bloom", "target-size", "cone-uniform", "kick-after-shot", "horizontal-tolerance", "no-compensation",
]);

/**
 * Manual attachment modifiers (Census has no numbers). Sources: Izubrr/planetside_weapon_compare
 * (Forward Grip, Compensator) and the Arsenal Update patch notes, 30 Mar 2022 (the rest).
 * vRecoil / hRecoil / firstShot multiply the recoil numbers, hipCof multiplies the hip cone,
 * hipBloom / adsBloom multiply bloom per shot, hipRecoil multiplies all hip recoil, adsVRecoil only when aiming.
 */
export const ATTACHMENTS = Object.freeze({
  "Compensator": { vRecoil: 0.7, hipCof: 1.15 },
  "Forward Grip": { hRecoil: 0.75 },
  "Angled Forward Grip": { firstShot: 0.4, hRecoil: 1.1 },
  "Comfort Grip": { vRecoil: 1.2 },
  "Heavy Barrel": { adsBloom: 0.8 },
  "Short Barrel": { hipBloom: 0.6, adsVRecoil: 1.2 },
  "Mobile Prediction Laser": { hipRecoil: 0.4 },
});

/** Strategies: shots per burst (Infinity = hold the trigger). */
export const BURSTS = Object.freeze([1, 2, 3, 4, 6, 8, 12, Infinity]);

/**
 * Everything the simulation needs, from the Census record, the stance rows and the chosen options.
 * opts: { stance, aim: "ads" | "hip", attachments: [names], ads }
 */
export function simParams(profile, fm, states, opts = {}) {
  const stance = opts.stance || "crouchStill";
  const aim = opts.aim === "hip" ? "hip" : "ads";
  const ads = { ...ADS_DEFAULT, ...(opts.ads || {}) };
  const row = (states || []).find((r) => r.player_state_id === STATE_ID[stance]) || (states || [])[0] || {};
  const f = fm || {};
  const A = (opts.attachments || []).map((n) => ATTACHMENTS[n]).filter(Boolean);
  const mul = (key) => A.reduce((m, a) => m * (a[key] ?? 1), 1);
  const hip = aim === "hip";
  let cofMin = hip ? (row.cof_min ?? 2) : ads[stance];
  let cofMax = row.cof_max ?? Math.max(cofMin, 1);        // the aim maximum is not in Census: the hip maximum is used
  if (hip) { cofMin *= mul("hipCof"); cofMax *= mul("hipCof"); }
  if (cofMax < cofMin) cofMax = cofMin;
  let bloom = (f.cof_recoil ?? 0.1) * (hip ? mul("hipBloom") : ads.bloomRatio * mul("adsBloom"));
  const rec = (hip ? mul("hipRecoil") : 1);
  const vMul = mul("vRecoil") * (hip ? 1 : mul("adsVRecoil")) * rec;
  const hMul = mul("hRecoil") * rec;
  return {
    gapMs: f.fire_refire_ms || 60000 / profile.rpm,
    mag: profile.mag, reloadMs: profile.reloadMs, pellets: profile.pellets, profile,
    vMin: (f.recoil_magnitude_min ?? 0.3) * vMul, vMax: (f.recoil_magnitude_max ?? 0.3) * vMul,
    first: Math.max(0, (f.recoil_first_shot_modifier ?? 1) * mul("firstShot") * (A.some((a) => a.firstShot) ? 1 : 1)),
    angMin: (f.recoil_angle_min ?? 0) * hMul, angMax: (f.recoil_angle_max ?? 0) * hMul,
    hMin: (f.recoil_horizontal_min ?? 0) * hMul, hMax: (f.recoil_horizontal_max ?? 0) * hMul,
    hTol: (f.recoil_horizontal_tolerance ?? 0.4) * hMul,
    recDelay: f.recoil_recovery_delay_ms ?? 0, recRate: Math.max(0.01, f.recoil_recovery_rate ?? 10),
    cofMin, cofMax, bloom,
    cofRecRate: Math.max(0.01, row.cof_recovery_rate ?? 20), cofRecDelay: row.cof_recovery_delay_ms ?? 0,
    pelletSpread: f.pellet_spread ?? f.cof_pellet_spread ?? 0,
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
  const rows = bursts.filter((b) => b <= P.mag || b === Infinity).map((burst) => burstStats(P, { burst, distance, hp, runs, seed }));
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
