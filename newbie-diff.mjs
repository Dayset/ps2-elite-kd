/**
 * 🐣 Newbie softening of a negative 🔀 Diff (owner 2026-10-22). DOM-free.
 *
 * 🔀 Diff should say whether an infantry player has potential (😤 DieHard) or
 * is an 🤥 Impostor (good aim, poor results). New accounts are still learning:
 * on this board 29% of players under 10 h are Impostors, vs 5% at 200–700 h
 * and 1% at 2000 h+, and the median Diff only reaches 0 around the median play
 * time. So a negative Diff is scaled by an experience factor:
 *   play time = lifetime kills ÷ lifetime KPM (same estimate as 🛖, hut.mjs);
 *   lo = p5 of this build's play times (≈ 6 h), hi = the median (≈ 385 h);
 *   factor = 0 at/below lo, ln(h ÷ lo) ÷ ln(hi ÷ lo) between, 1 at/above hi
 *   (log scale: the Impostor share falls by about the same step per doubling
 *   of play time). No play time → no change. Positive Diff untouched.
 * Owner override (human wins): data/reviewed.json "newbieDiff": "cleared" on the
 * player's entry → full negative Diff, no softening.
 * build-ranks.mjs stores the factor in the trailing ranks.json / ranks-lite
 * column "nbd" (3 decimals; null = no change); trait-scores.mjs aimGap() applies it.
 */
import { t as tr } from "./i18n.mjs";

export const NBD_BAND = [0.05, 0.5]; // play-time percentiles: factor 0 at/below p5 → 1 at/above the median

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Ramp ends (minutes) from the population's play minutes → { lo, hi, n }. */
export function nbdCuts(playMins) {
  const v = (playMins || []).filter((x) => fin(x) && x > 0).sort((a, b) => a - b);
  const at = (q) => (v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : NaN);
  return { lo: at(NBD_BAND[0]), hi: at(NBD_BAND[1]), n: v.length };
}

/** Factor (0…1) on a negative Diff for play minutes, or null when there is no change. */
export function newbieFactor(playMin, cuts) {
  const lo = cuts && cuts.lo, hi = cuts && cuts.hi;
  if (!fin(playMin) || !fin(lo) || !fin(hi) || lo <= 0 || hi <= lo || playMin >= hi) return null;
  if (playMin <= lo) return 0;
  return Math.log(playMin / lo) / Math.log(hi / lo);
}

/** reviewed.json: "newbieDiff": "cleared" on the player entry. */
export function newbieCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  return !!(e && (e.newbieDiff === "cleared" || e.newbieDiff === false));
}

export const NBD_NOTE = tr("nbd.note", "Short play time: a negative Diff is softened (new players are still learning).");
export const NBD_EXPLAIN = tr("nbd.explain", "🐣 New player: a negative 🔀 Diff counts less for players with few hours.");
export const nbdFromTip = (raw) => tr("diff.nbdFrom", "🐣 Softened from {raw} (short play time: still learning).", { raw });
