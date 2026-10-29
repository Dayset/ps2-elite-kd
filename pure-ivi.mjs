/**
 * 🧘‍♂️ Pure iVi — the uncentered 🪳 charge on the plain ⚔️ iVi (2026-10-28 duel study).
 * NOT Claude's #84 (zerg-charge.mjs): no centering on 26.8, no 60-day freshness gate,
 * no K/λ curve — the straight linear charge, kept as a debug monitor column so the
 * owner can watch what the uncentered numbers would do next to the evened-out ⚔️ iVi.
 *
 *   charged = adjs × (1 − 0.00436 × 🪳)            (adjs > 0)
 *   charged = adjs − 0.00436 × 🪳 × 610.6          (adjs ≤ 0; fixed drop, padder precedent)
 * Missing adjs or 🪳 → null ("—"). 🪳 0 → adjs unchanged.
 * DOM-free.
 */
export const PURE_IVI_CHARGE = Object.freeze({ RATE: 0.00436, NEG_BASE: 610.6 });

/** Uncentered 🪳-charged iVi, or null when iVi or 🪳 is missing. */
export function pureIvI(adjs, zerg) {
  if (typeof adjs !== "number" || !Number.isFinite(adjs)) return null;
  if (typeof zerg !== "number" || !Number.isFinite(zerg)) return null;
  if (adjs > 0) return adjs * (1 - PURE_IVI_CHARGE.RATE * zerg);
  return adjs - PURE_IVI_CHARGE.RATE * zerg * PURE_IVI_CHARGE.NEG_BASE;
}
