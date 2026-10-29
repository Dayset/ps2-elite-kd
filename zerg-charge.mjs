/**
 * 🪳⚔️ Zerg-adjusted iVi (debug column only, #84; measured 2026-10-28, scripts/zerg-pairs.mjs).
 *
 * The ⚔️ iVi that would give the same duel results at 🪳 Zerg 0:
 *   zergAdj = (iVi + K) · exp(−λ · 🪳) − K
 *
 * Where K and λ come from: 103,689 PC infantry killboard pairs (both players 🪖 ≥ 75 %,
 * 30+ kills between them). Duel strength of a player = c · ln(iVi + K) + g · 🪳, fitted on
 * the pairs' log kill ratio with the two players' vehicle and MAX kill shares held fixed:
 * K = 3100 (95 % 2600…4000), λ = −g / c = 0.00021 per 🪳 step (95 % 0.000118…0.000313).
 * The same weight fits every ⚔️ iVi tier (each tier's own estimate agrees within its range).
 * Checked on players the fit never saw (two random halves of the players, and on separate
 * pairs with fewer kills): the 🪳 bias in duels goes from −0.07…−0.10 % kill ratio per step
 * to −0.02…+0.05 %, and duel predictions get slightly better.
 *
 * What it does: about the same number of points in every tier, not a % of iVi
 * (🪳 50: −53 at iVi 2,050 … −34 at iVi 170; 95 % margin about ±40 %). 🪳 0 → unchanged.
 * It never raises a score. Missing 🪳 (or iVi) → null ("—").
 * No vehicle term: the 🚜 cut already takes vehicle play out of ⚔️ iVi, and in duels
 * vehicle users get MORE kills than even their uncut iVi says.
 * DOM-free; used by stats-table.mjs (debug column) and the tests.
 */
export const ZERG_CHARGE = Object.freeze({ K: 3100, LAMBDA: 0.00021 });

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Zerg-adjusted ⚔️ iVi, or null when iVi or 🪳 is missing. */
export function zergChargedAdjs(adjs, zerg) {
  if (!fin(adjs) || !fin(zerg)) return null;
  const base = adjs + ZERG_CHARGE.K;
  // Far below anything measured (lowest iVi in the pairs ≈ −942): leave it alone rather than flip.
  if (!(base > 0)) return adjs;
  return base * Math.exp(-ZERG_CHARGE.LAMBDA * Math.max(0, zerg)) - ZERG_CHARGE.K;
}
