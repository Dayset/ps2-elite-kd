// 🧼 Clean iVi (owner 2026-11-10): ⚔️ iVi discounted by 🌈 G, debug-only.
// The question it answers: who is on top when a high iVi AND a high G are
// not allowed at the same time? adjs × (1 − G/100) — G reads as the share
// of the score kept. The owner's example: 2000 / 50% → 1000, 2005 / 51% →
// 982. A medium strength (adjs − 10 × G) shipped alongside it in 3eec31a7
// and was REMOVED the same day by the owner's pick: in the top 500 the two
// lists were 485/500 identical, but medium still left 5 players over G 90%
// in the top 500 while strong leaves none over G 50%.
// G is the two-factor product (g-score.mjs): the share of cached players
// beaten on K/D and Brave at once — a rank share, NOT a cheating
// probability, so the formula is a chosen exchange rate, not a measurement.
// Floored at 0, like the ⚔️ iVi display. Missing adjs or G → null ("—"),
// never a guessed number. Pure: inputs are plain numbers.
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Keep (1 − G) of the iVi. */
export function cleanIvIStrong(adjs, g) {
  if (!fin(adjs) || !fin(g)) return null;
  return Math.max(0, adjs * (1 - g / 100));
}
