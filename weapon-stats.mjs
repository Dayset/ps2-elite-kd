// Weapon stat rows for the comparison cards (pure, no DOM).
//
// Every row is one number from Census (profiles.json + recoil.json) or derived from them,
// with a direction: +1 higher is better, -1 lower is better, 0 just shown.
// The page colours a value green when it is the best of the chosen weapons and gold when it
// is the best of the whole class (all weapons of that category).
//
// rec = { fm, states, adsFm, adsStates, pool, handling } from recoil.json (null when not loaded).
// Hip-fire cone comes from the hip fire mode's player_state_group, aim-down-sights cone from the
// ADS fire mode's own group (fire_mode_2.iron_sights = 1), as in Izubrr/planetside_weapon_compare.
import { hitDamage, idealTtk, minShots, dps, effectiveRpm, timeOfShot } from "./weapons-model.mjs?v=20261107-merge1";

export const GROUPS = Object.freeze(["kill", "damage", "magazine", "accuracyAds", "accuracyHip", "recoil", "handling"]);
export const GROUP_EN = Object.freeze({
  kill: "Killing", damage: "Damage", magazine: "Magazine and reload", accuracyAds: "Aim-down-sights cone (min / max)",
  accuracyHip: "Hip-fire cone (min / max)", recoil: "Recoil (aiming)", handling: "Handling",
});

// Census player_state ids
const ST = { stand: 0, crouch: 1, run: 2, crouchWalk: 5 };
const stateRow = (rows, id) => (rows || []).find((r) => r.player_state_id === id) || null;
const cofMin = (rows, id) => { const r = stateRow(rows, id); return r && Number.isFinite(r.cof_min) ? r.cof_min : null; };
const cofMax = (rows, id) => { const r = stateRow(rows, id); return r && Number.isFinite(r.cof_max) ? r.cof_max : null; };
const aimFm = (rec) => (rec && (rec.adsFm || rec.fm)) || null;
const num = (v) => (Number.isFinite(v) ? v : null);
const avg = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : num(a) ?? num(b));

const cone = (group, key, en, which, id) => ({
  key, group, en, dir: -1, unit: "cone",
  get: ({ rec }) => (rec ? cofMin(which === "ads" ? rec.adsStates : rec.states, id) : null),
  max: ({ rec }) => (rec ? cofMax(which === "ads" ? rec.adsStates : rec.states, id) : null),
});

/** Rows in display order. `unit` tells the page how to print the number. */
export const METRICS = Object.freeze([
  { key: "ideal", group: "kill", en: "Best case (all body hits)", dir: -1, unit: "ms", get: ({ p, range, hp }) => idealTtk(p, { range, hp }) },
  { key: "stk", group: "kill", en: "Shots to kill (body)", dir: -1, unit: "int", get: ({ p, range, hp }) => minShots(p, { range, hp }) },
  { key: "stkHead", group: "kill", en: "Shots to kill (head)", dir: -1, unit: "int", get: ({ p, range, hp }) => minShots(p, { range, hp, head: true }) },
  { key: "dps", group: "kill", en: "Damage per second", dir: 1, unit: "int", get: ({ p, range }) => dps(p, { range }).burst },
  { key: "dpsSus", group: "kill", en: "Sustained damage per second", dir: 1, unit: "int", get: ({ p, range }) => dps(p, { range }).sustained },

  { key: "rpm", group: "damage", en: "Rounds per minute", dir: 1, unit: "int", get: ({ p }) => p.rpm },
  { key: "rpmAvg", group: "damage", en: "Average rate over a magazine", dir: 0, unit: "int", get: ({ p }) => (p.burstN > 1 || p.delayMs ? effectiveRpm(p) : null) },
  { key: "burstN", group: "damage", en: "Shots per trigger pull", dir: 0, unit: "int", get: ({ p }) => (p.burstN > 1 ? p.burstN : null) },
  { key: "windup", group: "damage", en: "Wind-up before the first shot", dir: 0, unit: "ms", get: ({ p }) => p.delayMs || null },
  { key: "dmgHere", group: "damage", en: "Damage per hit here", dir: 1, unit: "int", get: ({ p, range }) => hitDamage(p, range).body * p.pellets },
  { key: "dmgMax", group: "damage", en: "Maximum damage", dir: 1, unit: "int", get: ({ p }) => p.dmgMax * p.pellets },
  { key: "dmgMin", group: "damage", en: "Minimum damage", dir: 1, unit: "int", get: ({ p }) => p.dmgMin * p.pellets },
  { key: "rMax", group: "damage", en: "Maximum damage range", dir: 1, unit: "m", get: ({ p }) => p.rangeMaxDmg },
  { key: "rMin", group: "damage", en: "Minimum damage range", dir: 1, unit: "m", get: ({ p }) => p.rangeMinDmg },
  { key: "hs", group: "damage", en: "Headshot multiplier", dir: 1, unit: "x", get: ({ p }) => p.hsMult },
  { key: "speed", group: "damage", en: "Bullet speed", dir: 1, unit: "mps", get: ({ rec }) => num(rec && rec.handling && rec.handling.projectile_speed) },

  { key: "mag", group: "magazine", en: "Magazine", dir: 1, unit: "int", get: ({ p }) => p.mag },
  { key: "pool", group: "magazine", en: "Ammo pool", dir: 1, unit: "int", get: ({ rec }) => (rec && rec.pool) || null },
  { key: "reload", group: "magazine", en: "Short reload", dir: -1, unit: "s", get: ({ p }) => p.reloadMs },
  { key: "reloadLong", group: "magazine", en: "Long reload", dir: -1, unit: "s", get: ({ p, rec }) => p.reloadMs + ((rec && rec.fm && rec.fm.reload_chamber_ms) || 0) },
  { key: "magTime", group: "magazine", en: "Time to empty the magazine", dir: 0, unit: "s", get: ({ p }) => timeOfShot(p, p.mag) },

  cone("accuracyAds", "adsCS", "Crouched, still", "ads", ST.crouch),
  cone("accuracyAds", "adsSS", "Standing, still", "ads", ST.stand),
  cone("accuracyAds", "adsCM", "Crouched, moving", "ads", ST.crouchWalk),
  cone("accuracyAds", "adsSM", "Standing, moving", "ads", ST.run),
  { key: "adsBloom", group: "accuracyAds", en: "Bloom per shot", dir: -1, unit: "deg", get: ({ rec }) => num(rec && rec.adsFm && rec.adsFm.cof_recoil) },
  cone("accuracyHip", "hipCS", "Crouched, still", "hip", ST.crouch),
  cone("accuracyHip", "hipSS", "Standing, still", "hip", ST.stand),
  cone("accuracyHip", "hipCM", "Crouched, moving", "hip", ST.crouchWalk),
  cone("accuracyHip", "hipSM", "Standing, moving", "hip", ST.run),
  { key: "hipBloom", group: "accuracyHip", en: "Bloom per shot", dir: -1, unit: "deg", get: ({ rec }) => num(rec && rec.fm && rec.fm.cof_recoil) },
  { key: "cofRec", group: "accuracyHip", en: "Cone recovery", dir: 1, unit: "degps", get: ({ rec }) => num(stateRow(rec && rec.states, ST.stand)?.cof_recovery_rate) },

  { key: "vRec", group: "recoil", en: "Vertical recoil per shot", dir: -1, unit: "deg", get: ({ rec }) => { const f = aimFm(rec); return f ? avg(f.recoil_magnitude_min, f.recoil_magnitude_max) : null; } },
  { key: "first", group: "recoil", en: "First-shot recoil", dir: -1, unit: "x", get: ({ rec }) => num(aimFm(rec)?.recoil_first_shot_modifier) },
  { key: "hRec", group: "recoil", en: "Horizontal recoil (max)", dir: -1, unit: "deg", get: ({ rec }) => num(aimFm(rec)?.recoil_horizontal_max) },
  { key: "hTol", group: "recoil", en: "Horizontal tolerance", dir: -1, unit: "deg", get: ({ rec }) => num(aimFm(rec)?.recoil_horizontal_tolerance) },
  { key: "angle", group: "recoil", en: "Recoil angle spread", dir: -1, unit: "deg", get: ({ rec }) => { const f = aimFm(rec); return f && Number.isFinite(f.recoil_angle_min) ? Math.abs((f.recoil_angle_max ?? 0) - f.recoil_angle_min) : null; } },
  { key: "recRate", group: "recoil", en: "Recoil recovery", dir: 1, unit: "degps", get: ({ rec }) => num(aimFm(rec)?.recoil_recovery_rate) },
  { key: "recDelay", group: "recoil", en: "Recovery delay", dir: -1, unit: "ms", get: ({ rec }) => num(aimFm(rec)?.recoil_recovery_delay_ms) },
  { key: "zoom", group: "recoil", en: "Default zoom", dir: 0, unit: "x", get: ({ rec }) => num(rec && rec.adsFm && rec.adsFm.zoom_default) },

  { key: "toAds", group: "handling", en: "Time to aim", dir: -1, unit: "ms", get: ({ rec }) => num(rec && rec.handling && rec.handling.to_iron_sights_ms) },
  { key: "equip", group: "handling", en: "Equip time", dir: -1, unit: "ms", get: ({ rec }) => num(rec && rec.handling && rec.handling.equip_ms) },
  { key: "sprint", group: "handling", en: "Sprint recovery", dir: -1, unit: "ms", get: ({ rec }) => num(rec && rec.handling && rec.handling.sprint_recovery_ms) },
  { key: "move", group: "handling", en: "Move speed while aiming", dir: 1, unit: "x", get: ({ rec }) => num(rec && rec.adsFm && rec.adsFm.move_modifier) },
]);

/** All row values of one weapon: { key: number|null } (+ key + ":max" for cones). */
export function statValues(ctx) {
  const out = {};
  for (const m of METRICS) {
    let v = null;
    try { v = m.get(ctx); } catch { v = null; }
    out[m.key] = Number.isFinite(v) ? v : null;
    if (m.max) { const mx = m.max(ctx); out[m.key + ":max"] = Number.isFinite(mx) ? mx : null; }
  }
  return out;
}

/** The best value of a list by direction; null when there is no direction, fewer than 2 numbers, or all are equal. */
export function bestOf(values, dir) {
  if (!dir) return null;
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (Math.abs(hi - lo) <= 1e-9 * Math.max(1, Math.abs(hi))) return null;
  return dir > 0 ? hi : lo;
}

const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** "gold" (best of the class), "good" (best of the chosen weapons) or "" for one value. */
export function rank(v, dir, chosenBest, classBest) {
  if (!dir || !Number.isFinite(v)) return "";
  if (same(v, classBest)) return "gold";
  if (same(v, chosenBest)) return "good";
  return "";
}

/**
 * Best value per metric over many weapons (the class): { key: number|null }.
 * A best value shared by more than `share` of the class (e.g. the common 650 ms equip time) is no
 * distinction, so it gets no gold (null).
 */
export function classBests(allValues, share = 0.2) {
  const out = {};
  for (const m of METRICS) {
    const xs = allValues.map((v) => v[m.key]).filter((v) => Number.isFinite(v));
    const b = bestOf(xs, m.dir);
    const n = b == null ? 0 : xs.filter((v) => same(v, b)).length;
    out[m.key] = b != null && n <= Math.max(1, Math.floor(share * xs.length)) ? b : null;
  }
  return out;
}
