/**
 * 🪳⚔️ Zerg-adjusted iVi (debug column only, #84; measured 2026-10-28, scripts/zerg-pairs.mjs).
 *
 * The ⚔️ iVi that would give the same duel results at the reference 🪳 Zerg (CENTER = 26.8):
 *   zergAdj = (iVi + K) · exp(−λ · (🪳 − 26.8)) − K
 * Below 🪳 26.8 the score goes up a little, above it goes down.
 *
 * Why 26.8 (owner 2026-10-28, "data driven"): players with no 🪳 score keep
 * their plain iVi in this column, and in duels they play like 🪳 26.8 (95 % 17.5…36.5); the median
 * 🪳 of players who have one is 31 (top 1 %: 8, top 1–5 %: 16, lower half: 40). 26.8 sits
 * inside that range, so adjusted and plain players compare fairly.
 *
 * Where K and λ come from: 103,689 PC infantry killboard pairs (both players 🪖 ≥ 75 %,
 * 30+ kills between them). Duel strength of a player = c · ln(iVi + K) + g · 🪳, fitted on
 * the pairs' log kill ratio with the two players' vehicle and MAX kill shares held fixed:
 * K = 3100 (95 % 2600…4000), λ = −g / c = 0.00021 per 🪳 step (95 % 0.00009…0.00031).
 * The same weight fits every ⚔️ iVi tier (each tier's own estimate agrees within its range).
 * Checked on players the fit never saw (two random halves of the players, and on separate
 * pairs with fewer kills): the 🪳 bias in duels goes from −0.07…−0.10 % kill ratio per step
 * to −0.02…+0.05 %, and duel predictions get slightly better.
 *
 * Size: about the same number of points in every tier, not a % of iVi (at iVi 1,000:
 * 🪳 0 → +23, 🪳 50 → −20, 🪳 99 → −62; 95 % margin about ±45 %). Missing 🪳 (or iVi) → null ("—").
 * No vehicle term: the 🚜 cut already takes vehicle play out of ⚔️ iVi, and in duels
 * vehicle users get MORE kills than even their uncut iVi says.
 * DOM-free; used by stats-table.mjs (debug column) and the tests.
 */
export const ZERG_CHARGE = Object.freeze({ K: 3100, LAMBDA: 0.00021, CENTER: 26.8 });

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Zerg-adjusted ⚔️ iVi, or null when iVi or 🪳 is missing. */
export function zergChargedAdjs(adjs, zerg) {
  if (!fin(adjs) || !fin(zerg)) return null;
  const base = adjs + ZERG_CHARGE.K;
  // Far below anything measured (lowest iVi in the pairs ≈ −942): leave it alone rather than flip.
  if (!(base > 0)) return adjs;
  const z = Math.min(100, Math.max(0, zerg));
  return base * Math.exp(-ZERG_CHARGE.LAMBDA * (z - ZERG_CHARGE.CENTER)) - ZERG_CHARGE.K;
}
