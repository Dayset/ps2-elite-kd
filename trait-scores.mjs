/**
 * 🤥😤 Impostor–DieHard and 🪳 Zerg (owner t480u–t485u, 2026-10-21): two public
 * trait scores built only from percentiles of stats we already have. They
 * never change any other stat. DOM-free; used by app.js (✨ Stats, pools from
 * ranks-lite.json) and rankings.mjs (🏆 table / 🏅 positions / 📊 chart, pools
 * from ranks.json). Both sides round values the way ranks-lite.json stores
 * them, so the same player gets the same score in both places.
 *
 * Percentile = dist.mjs percentileOf: floored share of players strictly below (0…99).
 *
 * 🤥😤 Impostor–DieHard (−99…+99) = percentile(⚔️ iVi) − percentile(public IvI)
 *   (the same number as the old 🔀 Diff debug column). Negative = 🤥 Impostor
 *   side: the aim on paper (IvI) is better than the real results (⚔️ iVi).
 *   Positive = 😤 DieHard side: results beat the aim. Neither side is "better".
 *
 * 🪳 Zerg (0…99, lower is better) = the LOWER of percentile(🎈 Inflation) and
 *   percentile(🤝 assists per kill). The lower of the two (not an average)
 *   means a player only scores high when BOTH are high: K/D inflated by soft
 *   fights AND many shared kills = riding a big group. A solo farmer of soft
 *   fights (high Inflation, few assists) stays low, and so does a team player
 *   in hard fights (many assists, no inflation). Only players with 🤝 Assists
 *   (≥ 100 kills in recent Honu sessions) and an Inflation value get a score.
 *   Crowd check (zerg-revive.mjs, ranks.json "rvp" revives + "crp" crowd
 *   score): rvp or crp ≥ 75 confirms; when both are low the higher of the two
 *   softens a high Zerg (never raises); no XP detail = unchanged.
 * 🔀 vehicle damp (diff-vehicle.mjs, ranks.json "vdf") and 🛖 (hut.mjs, "hut")
 *   both scale a positive Diff; the stronger (lower) factor applies, never both.
 */
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { reviveZerg } from "./zerg-revive.mjs?v=20261024-crowd1";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
/** Rounding = ranks-lite.json LITE_DIGITS (scripts/build-ranks.mjs). */
export const TRAIT_DIGITS = Object.freeze({ adjs: 1, ivi: 1, inflation: 2, apk: 3 });
export function traitRound(id, v) {
  if (!fin(v)) return NaN;
  const d = TRAIT_DIGITS[id];
  return d == null ? v : +v.toFixed(d);
}

/** Sorted rounded pools from column arrays: { adjs, ivi, inflation, apk } (any may be missing). */
export function traitPools(cols) {
  const out = {};
  for (const id of Object.keys(TRAIT_DIGITS)) {
    const vals = (cols && cols[id]) || [];
    out[id] = vals.map((v) => traitRound(id, v)).filter(fin).sort((a, b) => a - b);
  }
  return out;
}

function pct(pools, id, v) {
  const pool = pools && pools[id];
  if (!pool || !pool.length || !fin(v)) return null;
  return percentileOf(pool, traitRound(id, v));
}

/**
 * 🤥😤 → { score, raw, hut, veh, nbd, by, practice, theory } or null when ⚔️ iVi or IvI is missing.
 * hut = 🛖 damping factor (hut.mjs, ranks.json "hut"), veh = 🔀 vehicle damp
 * factor (diff-vehicle.mjs, ranks.json "vdf"); null = none. A positive score is
 * multiplied by the LOWER of the two and rounded (raw keeps the undamped score);
 * by = "hut" | "veh" | "nbd" | null says which one counted.
 * nbd = 🐣 newbie factor (newbie-diff.mjs, ranks.json "nbd"): a NEGATIVE score × nbd.
 */
export function aimGap(pools, adjs, ivi, hut = null, veh = null, nbd = null) {
  const a = pct(pools, "adjs", adjs), i = pct(pools, "ivi", ivi);
  if (a == null || i == null) return null;
  const raw = a - i;
  const h = fin(hut) && raw > 0 ? hut : null;
  const v = fin(veh) && raw > 0 ? veh : null;
  const n = fin(nbd) && raw < 0 ? nbd : null;
  const m = h == null && v == null ? n : Math.min(h ?? 1, v ?? 1);
  const by = n != null ? "nbd" : m == null ? null : v != null && v < (h ?? 1) ? "veh" : "hut";
  // + 0 turns a rounded −0 into 0
  return { score: m == null ? raw : Math.round(raw * m) + 0, raw, hut: h, veh: v, nbd: n, by, practice: a, theory: i };
}

/**
 * 🪳 → { score, raw, infl, apk, rvp, crp, chk, confirmed, softened } or null when
 * Inflation or 🤝 Assists is missing. rvp = revive percentile, crp = crowd-score
 * percentile (zerg-revive.mjs; null = no data); chk = the higher of the two.
 */
export function zergScore(pools, inflation, apk, rvp = null, crp = null) {
  // Inflation 0 = Census zeroed the lifetime stats (#79), not a real 0: unknown.
  const f = +inflation > 0 ? pct(pools, "inflation", inflation) : null, a = pct(pools, "apk", apk);
  if (f == null || a == null) return null;
  const raw = Math.min(f, a);
  const rv = fin(rvp) ? rvp : null, cr = fin(crp) ? crp : null;
  const r = reviveZerg(raw, rv, cr);
  return { score: r.score, raw, infl: f, apk: a, rvp: rv, crp: cr, chk: r.chk, confirmed: r.confirmed, softened: r.softened };
}
