// 🧼 Clean iVi (owner 2026-11-10): ⚔️ iVi discounted by 🌈 G, debug-only.
// The question it answers: who is on top when a high iVi AND a high G are
// not allowed at the same time? Two strengths, side by side, so the owner
// can look at both and keep one:
//   medium: adjs − 10 × G — 1 point of G costs 10 iVi points. The owner's
//     example is a near-tie under it: 2000 / 50% → 1500, 2005 / 51% → 1495.
//   strong: adjs × (1 − G/100) — G reads as the share of the score kept.
//     Same example: 2000 / 50% → 1000, 2005 / 51% → 982.
// G is the two-factor product (g-score.mjs): the share of cached players
// beaten on K/D and Brave at once — a rank share, NOT a cheating
// probability, so neither formula is a measurement, just a chosen exchange
// rate. Both are floored at 0, like the ⚔️ iVi display. Missing adjs or G
// → null ("—"), never a guessed number. Pure: inputs are plain numbers.
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Medium: one G point costs 10 iVi points. */
export function cleanIvIMedium(adjs, g) {
  if (!fin(adjs) || !fin(g)) return null;
  return Math.max(0, adjs - 10 * g);
}

/** Strong: keep (1 − G) of the iVi. */
export function cleanIvIStrong(adjs, g) {
  if (!fin(adjs) || !fin(g)) return null;
  return Math.max(0, adjs * (1 - g / 100));
}
