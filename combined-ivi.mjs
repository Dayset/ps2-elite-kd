// 🧼 Combined (owner 2026-11-10): 🧘 Pure iVi × (1 − 🌈 G), debug-only, just for
// testing. Both discounts at once — the 🪳 crowd charge AND the G cheese charge.
// 🪳 and G are near-independent (Pearson −0.06 on the 2026-11-10 snapshot; only
// 18 players are both 🪳 ≥ 70 and G ≥ 50), so stacking them docks each sin
// once, not the same sin twice. The base MUST be the Pure value (plain adjs,
// uncentered 🪳 charge) — never the displayed (🪳-evened) ⚔️ iVi, or 🪳 gets
// charged twice. Eyfia is the case it catches: Pure 921 → combined 838.
// The Clean column (⚔️ iVi × (1 − G)) shipped alongside it in 79e9e150 and was
// REMOVED the same day by the owner's pick; this column keeps the 🧼 emoji.
// G is the two-factor product (g-score.mjs): the share of cached players
// beaten on K/D and Brave at once — a rank share, NOT a cheating
// probability, so the formula is a chosen exchange rate, not a measurement.
// Floored at 0, like the ⚔️ iVi display. Missing Pure or G → null ("—"),
// never a guessed number. Pure: inputs are plain numbers.
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Keep (1 − G) of the 🧘 Pure iVi. */
export function combinedIvI(pure, g) {
  if (!fin(pure) || !fin(g)) return null;
  return Math.max(0, pure * (1 - g / 100));
}
