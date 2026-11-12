/**
 * Tier lists for weapon-compare.html: every weapon ranked by effective DPS
 * while strafing, per class, hip and ADS separately.
 *
 * Effective DPS = burst DPS at the page range (from weapons-model.mjs, with
 * the FPS fire-rate drop applied when the footer FPS limit is on) times the
 * share of a 10-round moving burst the cone still lands on a 0.5 m torso
 * (weapon-adad.mjs burstHitAvg, the same "what it costs" model as the ADAD
 * cost panel). Stock loadout, standing, current Census data only — the
 * historical 2018 rows carry no fire-mode data, so they cannot rank the
 * current game; the ADAD table keeps both versions, the tiers do not.
 *
 * Tiers are rank bands inside each class — S top 10%, A next 20%, B next
 * 30%, C next 25%, D the rest — not the rankings' population bands
 * (IVI_TIERS): in a 26-weapon class the best share strictly below is
 * 25/26 = 96.2%, so "Top 1%" (needs >= 99%) could never fire. Classes
 * with fewer than TIER_MIN_CLASS weapons are ranked but untiered.
 *
 * Pellet weapons rank on their spread-adjusted DPS (weapons-model.mjs dps
 * with the weapon's pellet spread + standing cone from recoil.json), so a
 * shotgun's effective DPS falls with range as its pellets miss — the old
 * all-pellets-land DPS read far too high past 10 m.
 *
 * Pure and DOM-free; the page passes its loaded weapons and recoil.json.
 */
import { dps, withFpsLimit } from "./weapons-model.mjs?v=20261112-pellet1";
import { pelletConeRaw } from "./weapon-sim.mjs?v=20261112-pellet1";
import { deriveCurrent, paramsFor, nStill, burstHitAvg, SHOTS } from "./weapon-adad.mjs?v=20261109-merge1";

/** Rank bands, best first: `max` = largest (rank + 1) / class-size share in the band. */
export const TIER_BANDS = Object.freeze([
  { id: "S", max: 0.10 },
  { id: "A", max: 0.30 },
  { id: "B", max: 0.60 },
  { id: "C", max: 0.85 },
  { id: "D", max: 1.01 },
]);
/** Fewer weapons than this in a class: rank them, but give no tier. */
export const TIER_MIN_CLASS = 5;

/** Tier id for 0-based `rank` in a class of `n` weapons, or null when the class is too small to tier. */
export function tierBand(rank, n) {
  if (!Number.isFinite(rank) || !Number.isFinite(n) || n < TIER_MIN_CLASS || rank < 0 || rank >= n) return null;
  const q = (rank + 1) / n;
  for (const b of TIER_BANDS) if (q <= b.max) return b.id;
  return "D";
}

/**
 * One weapon's strafing numbers for a stance: { eff, loss, nFree }.
 * `weapon` = { id, name, cat, fac, p } (the compare page's weapon record);
 * `recoil` = raw recoil.json. Null when the weapon has no usable cone data
 * (no fire-mode record, or a stance with a missing minimum/bloom) — the
 * caller omits it, never invents a number. `fpsOn`/`fps` mirror the
 * footer's FPS limit; off means no fire-rate drop.
 */
export function weaponEff(weapon, recoil, { range, fpsOn, fps, stance }) {
  if (!weapon || !weapon.p || !recoil || !recoil.weapons) return null;
  // deriveCurrent only reads n/f/c as labels (and rpm as a fallback the
  // cone maths never uses), so a synthetic row from the catalog record is
  // the same computation as the 2018 row for the same item.
  const cur = deriveCurrent({ n: weapon.name, f: weapon.fac, c: weapon.cat }, recoil, weapon.id);
  if (!cur) return null;
  const p = paramsFor(cur, stance, "stand");
  if (!p || p.still === null || p.move === null || p.bloom === null) return null;
  const nFree = nStill(p.still, p.move, p.bloom);
  const hitMove = burstHitAvg(p.still, p.move, p.bloom, nFree, SHOTS, range, "moving");
  const hitIdeal = burstHitAvg(p.still, p.move, p.bloom, nFree, SHOTS, range, "ideal");
  const prof = fpsOn ? withFpsLimit(weapon.p, fps) : weapon.p;
  // the burst DPS is spread-adjusted for pellet weapons (standing cone,
  // this stance): a shotgun's pellets miss at range, so its DPS falls with
  // the range instead of reading all-pellets-land at every distance
  const raw = dps(prof, { range, ...pelletConeRaw(recoil, weapon.id, stance === "hip") }).burst;
  if (!Number.isFinite(raw)) return null;
  return {
    eff: raw * hitMove,
    loss: hitIdeal > 0 ? 1 - hitMove / hitIdeal : null,
    nFree,
  };
}

/**
 * Tier rows for every class: { classes: [{ cat, rows }], total, omitted }.
 * `weapons` = the compare page's weapon records; classes are sorted by name,
 * rows by effective DPS descending (name breaks ties, so the order is
 * deterministic). Rows carry { id, name, fac, cat, eff, loss, nFree, tier }.
 */
export function computeTiers(weapons, recoil, opts) {
  const byCat = new Map();
  let total = 0, omitted = 0;
  for (const w of weapons || []) {
    const e = weaponEff(w, recoil, opts);
    if (!e) { omitted++; continue; }
    total++;
    const row = { id: w.id, name: w.name, fac: w.fac, cat: w.cat, eff: e.eff, loss: e.loss, nFree: e.nFree, tier: null };
    (byCat.get(w.cat) || byCat.set(w.cat, []).get(w.cat)).push(row);
  }
  const classes = [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cat, rows]) => {
    rows.sort((a, b) => b.eff - a.eff || a.name.localeCompare(b.name));
    rows.forEach((r, i) => { r.tier = tierBand(i, rows.length); });
    return { cat, rows };
  });
  return { classes, total, omitted };
}
