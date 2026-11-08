// Live session values (owner 2026-11-08): the same raw, no-rounding treatment
// as the 🎲 Live luck, for every session column — ☠️ K/D, 🪖 Infantry,
// 🤝 Assists, 🪳 Zerg, 🌈 G. All five are session-scoped (since the page /
// stream started), so they move with every kill, death and assist — a
// lifetime stat shown raw would barely move, and that is the whole point.
//
// Definitions (session analogues of the lifetime columns; the lifetime
// formulas live in the data pipeline, so these are the session versions,
// documented here and in the hover tips):
// - K/D: session kills ÷ session deaths.
// - Infantry: session foot kills ÷ session classified kills. Foot = the
//   kill's weapon category is not a vehicle category; MAX counts as foot,
//   vehicle seats / MANA turrets / Glaive do not (same rule as the
//   lifetime 🪖 Infantry). A kill whose weapon is unknown (no catalog yet,
//   no weapon, unlisted) is excluded from both sides, never guessed.
// - Assists (apk): session assists ÷ session kills, assists = the same
//   GainExperience ids as the DPM (DPS_ASSIST_XP: 2, 3, 371, 372).
// - Zerg: the same zergScore as the Rankings table, fed with the session
//   Inflation and the session apk, ranked in the population pools. Session
//   Inflation = your iVi ÷ the mean iVi of the enemies you met this
//   session (1 = even fights, above 1 = easy fights lifting your K/D).
//   No revive data exists for a session, so rvp / crp are null — the score
//   is the lower of the two percentiles, never raised by the crowd check.
// - G: the same (1 − K/D rank) × (1 − Brave rank) × 100, with the session
//   K/D and the session Brave ranked in the population pools. Session
//   Brave = session kills per minute ÷ the fastest enemies' Activity —
//   the 90th percentile of the Activity of the enemies met this session
//   ("your Activity, checked against the fastest-killing enemies you meet").
//
// Floor: no number until SESS_MIN_KILLS session kills (same 10 as the
// 🎲 luck) — a K/D from two kills is noise, not a value.
import { zergScore } from "./trait-scores.mjs?v=20261027-z79";

export const SESS_MIN_KILLS = 10;

export function sessionReady(kills) {
  return Number.isFinite(kills) && kills >= SESS_MIN_KILLS;
}

/** Session K/D: kills ÷ deaths; Infinity with kills but no deaths, null with no kills. */
export function sessionKd(kills, deaths) {
  if (!Number.isFinite(kills) || kills <= 0) return null;
  if (!Number.isFinite(deaths) || deaths <= 0) return Infinity;
  return kills / deaths;
}

// Exact weapon-catalog categories that are vehicle mounts (assets/weapons/
// catalog.json, e[1]; compared trimmed — "Lightning Primary Weapon " ships
// with a trailing space). Everything else is foot, except the MANA turret
// and Glaive, which the lifetime 🪖 Infantry also excludes (matched by
// weapon name, since they sit in the "Infantry Abilities" category).
export const VEHICLE_CATEGORIES = new Set([
  "Vehicle Weapons", "Sunderer Front Gunner", "Sunderer Rear Gunner",
  "Lightning Primary Weapon", "Magrider Primary Weapon", "Magrider Gunner Weapon",
  "Vanguard Primary Weapon", "Vanguard Gunner Weapon",
  "Prowler Primary Weapon", "Prowler Gunner Weapon",
  "Scythe Wing Mount", "Scythe Nose Cannon",
  "Reaver Nose Cannon", "Reaver Wing Mount",
  "Mosquito Nose Cannon", "Mosquito Wing Mount",
  "Liberator Tail Weapon", "Liberator Nose Cannon", "Liberator Belly Weapon",
  "Galaxy Top Weapon", "Galaxy Tail Weapon", "Galaxy Left Weapon", "Galaxy Right Weapon",
  "Harasser Top Gunner", "Valkyrie Nose Gunner",
  "Colossus Primary Weapon", "Colossus Front Right Weapon", "Colossus Front Left Weapon",
  "Colossus Rear Right Weapon", "Colossus Rear Left Weapon",
  "Bastion Point Defense", "Bastion Bombard", "Bastion Weapon System",
  "Chimera Primary Weapons", "Chimera Secondary Weapons",
  "ANT Top Turret", "Javelin Primary Weapon",
  "Corsair Front Turret", "Corsair Rear Turret",
  "Flash Primary Weapon", "Aerial Combat Weapon", "Vehicle Abilities",
]);

/**
 * Foot or not for one kill's weapon: true = foot, false = vehicle / MANA /
 * Glaive, null = unknown (no catalog yet, no weapon, unlisted) — never guessed.
 * catalog is the assets/weapons/catalog.json object ({ items: { id: [name, category, ?, image] } }).
 */
export function isFootWeapon(catalog, weaponId) {
  if (!catalog || !catalog.items || weaponId == null) return null;
  const e = catalog.items[String(weaponId)];
  if (!Array.isArray(e)) return null;
  const name = String(e[0] || "");
  const cat = String(e[1] || "").trim();
  if (!cat) return null;
  if (/mana|glaive/i.test(name)) return false;
  return !VEHICLE_CATEGORIES.has(cat);
}

/**
 * Session 🪖 Infantry: { share, foot, total } over the session's kill weapon
 * ids (null entries = kills with no weapon), or null when nothing classified.
 */
export function sessionInf(weapons, catalog) {
  if (!Array.isArray(weapons) || !catalog) return null;
  let foot = 0, total = 0;
  for (const w of weapons) {
    const f = isFootWeapon(catalog, w);
    if (f == null) continue;
    total++;
    if (f) foot++;
  }
  if (!total) return null;
  return { share: foot / total, foot, total };
}

/** Session 🤝 Assists (apk): assists ÷ kills, or null with no kills. */
export function sessionApk(assists, kills) {
  if (!Number.isFinite(kills) || kills <= 0) return null;
  if (!Number.isFinite(assists) || assists < 0) return null;
  return assists / kills;
}

/**
 * Session 🎈 Inflation: your iVi ÷ the mean iVi of the enemies you met
 * (fights: [{ iv }], iv the opponent's raw iVi; unknown / ≤0 opponents
 * excluded). 1 = even fights, above 1 = easy fights. Null with no usable fight.
 */
export function sessionInflation(myIvi, fights) {
  if (!Number.isFinite(myIvi) || myIvi <= 0) return null;
  if (!Array.isArray(fights)) return null;
  let sum = 0, n = 0;
  for (const f of fights) {
    const iv = f && f.iv;
    if (Number.isFinite(iv) && iv > 0) { sum += iv; n++; }
  }
  if (!n) return null;
  return myIvi / (sum / n);
}

/** Value at quantile q (0..1) of a sorted ascending array, linear interpolation. */
export function quantile(sorted, q) {
  if (!Array.isArray(sorted) || !sorted.length) return null;
  if (!Number.isFinite(q)) return null;
  const x = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(x), hi = Math.ceil(x);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/**
 * Session 🦁 Brave: session kills per minute ÷ the fastest enemies'
 * Activity (90th percentile of the Activity values of the enemies met).
 * Null with no session minutes or no known opponent Activity.
 */
export function sessionBrave(kills, minutes, oppActs) {
  if (!Number.isFinite(kills) || kills <= 0) return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (!Array.isArray(oppActs)) return null;
  const acts = oppActs.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!acts.length) return null;
  const fast = quantile(acts, 0.9);
  if (!fast || fast <= 0) return null;
  return kills / minutes / fast;
}

/**
 * Session 🪳 Zerg: the Rankings-table zergScore fed with the session
 * Inflation and session apk (tp = the traitPools object the page already
 * builds). No revive data this session, so rvp / crp are null.
 */
export function sessionZerg(tp, inflation, apk) {
  if (!Number.isFinite(inflation) || inflation <= 0) return null;
  if (!Number.isFinite(apk)) return null;
  const z = zergScore(tp, inflation, apk, null, null);
  return z ? z.score : null;
}

/**
 * Session 🌈 G: (share beaten on K/D) × (share beaten on Brave) × 100 —
 * the same product as the lifetime 🌈 G (columns.html: "each factor is the
 * share of players you beat on that one dimension"). kdPct / bravePct are
 * those shares, 0..1 (the caller ranks the session values in the population
 * pools via percentileOf(pool, v) / 100).
 */
export function sessionG(kdPct, bravePct) {
  if (!Number.isFinite(kdPct) || !Number.isFinite(bravePct)) return null;
  if (kdPct < 0 || kdPct > 1 || bravePct < 0 || bravePct > 1) return null;
  return kdPct * bravePct * 100;
}

/** Raw display text: the JS shortest-round-trip string, no rounding; ∞ stays ∞. */
export function sessText(v) {
  if (v == null) return "–";
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "-∞";
  return String(v);
}
