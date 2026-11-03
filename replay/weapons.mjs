// Real weapon fire profiles for the replay (issue #94, pure).
//
// A profile is the 10-field tuple written by scripts/build-weapon-catalog.mjs
// to assets/weapons/profiles.json:
//   [rpm, mag, reloadMs, dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode]
// with mode auto | semi | burst | bolt. profileOf() returns the real profile
// when the id is in the map, else a typical per-category fallback, else null
// (the caller then keeps its old random rate). Fallbacks are typical values,
// not measured: they only cover the few weapons Census can't resolve.
const T = (rpm, mag, reloadMs, dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode) =>
  [rpm, mag, reloadMs, dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode];
export const FALLBACK = {
  'LMG': T(600, 75, 3500, 143, 112, 10, 65, 2.0, 1, 'auto'),
  'Assault Rifle': T(600, 30, 2200, 143, 112, 10, 65, 2.0, 1, 'auto'),
  'Carbine': T(650, 30, 2000, 143, 112, 10, 60, 2.0, 1, 'auto'),
  'SMG': T(800, 30, 2000, 125, 100, 6, 50, 2.0, 1, 'auto'),
  'Shotgun': T(240, 6, 2800, 125, 50, 5, 30, 1.5, 7, 'semi'),
  'Sniper Rifle': T(60, 5, 3500, 750, 550, 10, 150, 2.1, 1, 'bolt'),
  'Scout Rifle': T(300, 20, 2500, 200, 167, 10, 80, 2.0, 1, 'semi'),
  'Battle Rifle': T(260, 20, 2500, 250, 200, 10, 100, 2.0, 1, 'semi'),
  'Pistol': T(400, 15, 1800, 200, 143, 10, 50, 2.0, 1, 'semi'),
  'Crossbow': T(60, 5, 3000, 650, 450, 10, 60, 2.0, 1, 'bolt'),
  'Heavy Weapon': T(500, 50, 3000, 143, 112, 10, 65, 2.0, 1, 'auto'),
  'Hybrid Rifle': T(600, 30, 2200, 143, 112, 10, 65, 2.0, 1, 'auto'),
  // catch-all category (no table of its own): middle-of-road automatic rifle
  'Infantry Weapons': T(600, 30, 2200, 143, 112, 10, 65, 2.0, 1, 'auto'),
};
const MODES = new Set(['auto', 'semi', 'burst', 'bolt']);
export function toProfile(t) {
  if (!Array.isArray(t) || t.length !== 10) return null;
  const [rpm, mag, reloadMs, dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode] = t;
  for (const v of [rpm, mag, reloadMs, dmgMax, dmgMin, hsMult, pellets])
    if (!Number.isFinite(v) || v <= 0) return null;
  // ranges may be 0: no falloff recorded in Census -> flat damage (far = near)
  for (const v of [rangeMaxDmg, rangeMinDmg]) if (!Number.isFinite(v) || v < 0) return null;
  if (!MODES.has(mode)) return null;
  return { rpm, mag, reloadMs, dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode };
}
export function profileOf(id, category, profiles) {
  return toProfile(profiles?.[id]) ?? toProfile(FALLBACK[category]) ?? null;
}
export function shotsPerSec(p) { return p.rpm / 60; }
// shots to kill 1000 health (500 shield + 500 health), all pellets landing
export function hitsToKill(p, { head = false, far = false } = {}) {
  const dmg = (far ? p.dmgMin : p.dmgMax) * (head ? p.hsMult : 1) * p.pellets;
  return Math.ceil(1000 / dmg);
}
// how the weapon fires: auto sprays up close and bursts 3-6 shots at range,
// semi taps, bolt fires one shot then chambers; burst mode has no count in the
// tuple, so it uses the conventional 3-round burst
export function burstStyle(p) {
  if (p.mode === 'auto') return { kind: 'auto', close: 'full', far: [3, 6] };
  if (p.mode === 'bolt') return { kind: 'bolt', shots: 1 };
  if (p.mode === 'burst') return { kind: 'burst', shots: 3 };
  return { kind: 'semi', shots: 1 };
}
