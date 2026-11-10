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

// 🧘🧼 Combined (owner 2026-11-10): 🧘 Pure iVi × (1 − 🌈 G), debug-only, just for
// testing. Both discounts at once — the 🪳 crowd charge AND the G cheese charge.
// 🪳 and G are near-independent (Pearson −0.06 on the 2026-11-10 snapshot; only
// 18 players are both 🪳 ≥ 70 and G ≥ 50), so stacking them docks each sin
// once, not the same sin twice. The base MUST be the Pure value (plain adjs,
// uncentered 🪳 charge) — never the displayed (🪳-evened) ⚔️ iVi, or 🪳 gets
// charged twice. Eyfia is the case it catches: Pure 921, Clean 1372,
// combined 838. PC only (Pure is null on PS) and null when either input is
// missing. Floored at 0 like the ⚔️ iVi display.
/** Keep (1 − G) of the 🧘 Pure iVi. */
export function combinedIvI(pure, g) {
  return cleanIvIStrong(pure, g);
}
