/**
 * 🛖 Safe-spot damping of 🔀 Diff (owner t500u–t504u, 2026-10-22). DOM-free.
 *
 * Some players almost never leave the spawn room / safe spots: they rarely die,
 * play at a slow pace and aim poorly, yet their ⚔️ iVi percentile beats their
 * IvI percentile by a lot, so 🔀 Diff shows them as 😤 DieHard. Their positive
 * Diff likely comes from safe positions, not from beating their aim.
 *
 * Gradual, no yes/no cliff (owner t504u + t505u). Every cut comes from the
 * live ranks.json population at build time, so it tracks the data:
 *   a = (🏃 Activity ÷ cut)², cut = median(Activity) × 1.333; Activity ≥ cut → no change
 *   w = w_dpm × w_inf × w_acc, each a 0…1 linear ramp:
 *     deaths/min (KPM ÷ K/D): 1 at/below p10 → 0 at/above p20
 *     🪖 Infantry %:          0 at/below 75 → 1 at/above 85
 *     accuracy:               1 at/below the median → 0 at/above p60
 *   factor m = 1 − w × (1 − a); positive Diff × m (rounded). Negative Diff untouched.
 * 🛖 next to the name only where it matters: Diff reduced by ≥ HUT_MARK_MIN points.
 * Owner override (human wins): data/reviewed.json "hut": "cleared" on the
 * player's entry removes the gate (no 🛖, no damping anywhere).
 * build-ranks.mjs stores m in the trailing ranks.json / ranks-lite.json column
 * "hut" (null = no reduction) and 1 in "hutMk" when 🛖 shows; trait-scores.mjs
 * aimGap() applies m.
 */
import { t as tr } from "./i18n.mjs";

export const HUT_MARK = "🛖";
export const HUT_ACT_MULT = 1.333;
// Soft gates (owner t505u): each fades 1 → 0 across a data-derived band.
export const HUT_DPM_BAND = [0.1, 0.2]; // deaths/min: full weight at/below p10, none at/above p20
export const HUT_INF_BAND = [75, 85]; // 🪖 infantry %: none at/below 75, full at/above 85
export const HUT_ACC_BAND = [0.5, 0.6]; // accuracy: full at/below the median, none at/above p60
export const HUT_MARK_MIN = 10; // 🛖 shown only when Diff drops by at least this many points
export const HUT_TIP = tr("hut.tip", "🛖 Safe-spot play: rarely dies, slow pace, low accuracy. A positive 🔀 Diff is reduced, because it likely comes from safe positions rather than from out-playing the aim.");
export const HUT_DIFF_NOTE = tr("hut.diffNote", "🛖 players (rarely die, slow pace, low accuracy): a positive Diff is reduced.");

const fin = (v) => typeof v === "number" && Number.isFinite(v);
function median(sorted) {
  const n = sorted.length;
  if (!n) return NaN;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
/** Deaths per minute from lifetime KPM and K/D (NaN when either is missing or K/D ≤ 0). */
export function deathsPerMin(kpm, kd) {
  return fin(kpm) && fin(kd) && kd > 0 ? kpm / kd : NaN;
}

const at = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : NaN);

/**
 * Cuts from the population: rows = [{ act, kpm, kd, acc }…].
 * → { actMedian, actCut, dpmLo, dpmHi, accLo, accHi, infLo, infHi, n }.
 */
export function hutCuts(rows) {
  const act = [], dpm = [], acc = [];
  for (const r of rows || []) {
    if (fin(r.act)) act.push(r.act);
    const d = deathsPerMin(r.kpm, r.kd);
    if (fin(d)) dpm.push(d);
    if (fin(r.acc)) acc.push(r.acc);
  }
  act.sort((a, b) => a - b); dpm.sort((a, b) => a - b); acc.sort((a, b) => a - b);
  const actMedian = median(act);
  return {
    actMedian,
    actCut: actMedian * HUT_ACT_MULT,
    dpmLo: at(dpm, HUT_DPM_BAND[0]), dpmHi: at(dpm, HUT_DPM_BAND[1]),
    accLo: median(acc), accHi: at(acc, HUT_ACC_BAND[1]),
    infLo: HUT_INF_BAND[0], infHi: HUT_INF_BAND[1],
    n: { act: act.length, dpm: dpm.length, acc: acc.length },
  };
}

/** Linear ramp: 1 at/below lo, 0 at/above hi (lo ≥ hi → hard step at lo). */
function down(v, lo, hi) {
  if (v <= lo) return 1;
  if (v >= hi) return 0;
  return (hi - v) / (hi - lo);
}

/**
 * Parts for one player { act, kpm, kd, acc, inf }: { a, wDpm, wInf, wAcc, w, m }
 * or null when a stat is missing or the cuts aren't usable. m = 1 means no change.
 */
export function hutParts(r, cuts) {
  if (!r || !cuts || ![cuts.actCut, cuts.dpmLo, cuts.dpmHi, cuts.accLo, cuts.accHi].every(fin) || cuts.actCut <= 0) return null;
  const d = deathsPerMin(r.kpm, r.kd);
  if (!fin(r.act) || !fin(d) || !fin(r.acc) || !fin(r.inf)) return null;
  const a = r.act >= cuts.actCut ? 1 : (Math.max(0, r.act) / cuts.actCut) ** 2;
  const wDpm = down(d, cuts.dpmLo, cuts.dpmHi);
  const wInf = 1 - down(r.inf, cuts.infLo, cuts.infHi);
  const wAcc = down(r.acc, cuts.accLo, cuts.accHi);
  const w = wDpm * wInf * wAcc;
  return { a, wDpm, wInf, wAcc, w, m: 1 - w * (1 - a) };
}

/** Damping factor m (0…1) for positive Diff, or null when there is no reduction. */
export function hutFactor(r, cuts) {
  const p = hutParts(r, cuts);
  return p && p.m < 1 ? p.m : null;
}

/** Diff after damping: positive scores × factor (rounded); everything else unchanged. */
export function hutDamp(score, factor) {
  if (!fin(score) || !fin(factor) || score <= 0) return score;
  return Math.round(score * factor);
}

/** reviewed.json entry clears 🛖 ("hut": "cleared", or false). */
export function hutCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  return !!e && (e.hut === "cleared" || e.hut === false);
}
