/**
 * 🔀 Diff vehicle damp (owner-approved 2026-10-22). DOM-free.
 *
 * 🔀 Diff should describe infantry play. A big vehicle share lifts the practice
 * side (⚔️ iVi) without any aim behind it, so 59% of 😤 DieHards had 30%+ of their
 * kills from vehicles (vs 20% in the balanced middle). So a positive Diff counts
 * only in proportion to the on-foot share, measured from the typical player:
 *   start = median 🪖 vehicle share of this build's players (≈ 15%);
 *   vehicle share ≤ start → no change;
 *   above → factor = (100 − vehicle %) ÷ (100 − start), so 46% → ×0.63,
 *   76% → ×0.28, all-vehicle → 0. Negative Diff untouched.
 * ⚔️ iVi already carries the 🚜 vehicle cut; that cut lowers iVi for the
 * leaderboard, this one keeps the Diff comparison about infantry.
 * Stacking with 🛖: the stronger of the two factors applies, never both
 * multiplied (min(🛖, 🔀🚜)), so no player is reduced twice.
 * Owner override (human wins): data/reviewed.json "vehDiff": "cleared" on the
 * player's entry, or the 🚜 exemption "vehicleCutCleared" → no damp.
 * build-ranks.mjs stores the factor in the trailing ranks.json / ranks-lite
 * column "vdf" (3 decimals; null = no change); trait-scores.mjs aimGap() applies it.
 */
import { t as tr } from "./i18n.mjs";

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Median vehicle share (%) of the population = the start of the damp. */
export function vehDiffStart(vehShares) {
  const v = (vehShares || []).filter(fin).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return NaN;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/** Factor (0…1) for a vehicle share (%), or null when there is no change. */
export function vehDiffFactor(veh, start) {
  if (!fin(veh) || !fin(start) || start >= 100 || veh <= start) return null;
  return Math.max(0, (100 - veh) / (100 - start));
}

/** reviewed.json: "vehDiff": "cleared" on the player entry, or the 🚜 "vehicleCutCleared" exemption. */
export function vehDiffCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  if (e && (e.vehDiff === "cleared" || e.vehDiff === false)) return true;
  return !!(reviewed && reviewed.vehicleCutCleared && reviewed.vehicleCutCleared[slug]);
}

export const VDIFF_NOTE = tr("vdiff.note", "Many vehicle kills: a positive Diff counts only in proportion to the kills made on foot.");
export const VDIFF_EXPLAIN = tr("vdiff.explain", "🔀 Vehicle damp: vehicle kills lift results without aim, so a positive Diff only counts the on-foot part.");
export const vdiffFromTip = (raw, veh) => tr("diff.vehFrom", "🚜 Reduced from {raw} ({veh}% of kills from vehicles: only the on-foot part counts).", { raw, veh });
