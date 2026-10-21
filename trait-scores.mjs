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
 */
import { percentileOf } from "./dist.mjs?v=20261010-sav1";

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

/** 🤥😤 → { score, practice, theory } or null when ⚔️ iVi or IvI is missing. */
export function aimGap(pools, adjs, ivi) {
  const a = pct(pools, "adjs", adjs), i = pct(pools, "ivi", ivi);
  if (a == null || i == null) return null;
  return { score: a - i, practice: a, theory: i };
}

/** 🪳 → { score, infl, apk } or null when Inflation or 🤝 Assists is missing. */
export function zergScore(pools, inflation, apk) {
  const f = pct(pools, "inflation", inflation), a = pct(pools, "apk", apk);
  if (f == null || a == null) return null;
  return { score: Math.min(f, a), infl: f, apk: a };
}
