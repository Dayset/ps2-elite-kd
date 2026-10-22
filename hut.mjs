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
 *   a = (🏃 Activity ÷ cut)², Activity ≥ cut → no change. The cut scales with the
 *   player's ⚔️ iVi percentile p (owner t507u): cut = median(Activity) ×
 *   (1.333 + (8 − 1.333) × p / 100 × e), straight line, so weak players get a low cut
 *   (×1.333) and the top of the board up to ×8. e = experience ramp (owner t508u):
 *   estimated play time (lifetime kills ÷ lifetime KPM, minutes) 0 at/below p5 →
 *   1 at/above p25 (p10→p50 let a 22 h camper slip out), so new accounts stay near ×1.333 and veterans get the full
 *   iVi-scaled cut. Missing play time → e = 0 (the gentle end).
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
export const HUT_ACT_MULT = 1.333; // Activity cut multiplier at ⚔️ iVi percentile 0
export const HUT_ACT_MULT_TOP = 8; // … rising in a straight line to this at percentile 100 (owner t507u)
export const HUT_EXP_BAND = [0.05, 0.25]; // experience ramp on estimated play time: 0 at/below p10 → 1 at/above p50 (owner t508u)
/** Activity-cut multiplier for a ⚔️ iVi percentile (0–100) and experience e (0–1); missing → the low end. */
export function hutActMult(iviPct, exp = 1) {
  const p = typeof iviPct === "number" && Number.isFinite(iviPct) ? Math.min(100, Math.max(0, iviPct)) : 0;
  const e = typeof exp === "number" && Number.isFinite(exp) ? Math.min(1, Math.max(0, exp)) : 0;
  return HUT_ACT_MULT + (HUT_ACT_MULT_TOP - HUT_ACT_MULT) * p / 100 * e;
}
/** Estimated lifetime play minutes from lifetime kills and lifetime KPM (NaN when unknown). */
export function playMinutes(kills, kpm) {
  return fin(kills) && fin(kpm) && kpm > 0 && kills > 0 ? kills / kpm : NaN;
}
// Soft gates (owner t505u): each fades 1 → 0 across a data-derived band.
export const HUT_DPM_BAND = [0.1, 0.2]; // deaths/min: full weight at/below p10, none at/above p20
export const HUT_INF_BAND = [75, 85]; // 🪖 infantry %: none at/below 75, full at/above 85
export const HUT_ACC_BAND = [0.5, 0.6]; // accuracy: full at/below the median, none at/above p60
export const HUT_MARK_MIN = 10; // 🛖 shown only when Diff drops by at least this many points
// Short hover on the 🛖 mark (owner t511u); the full meaning lives in HUT_EXPLAIN ("♿ What … means" under ✨ Stats, columns.html#hut).
export const HUT_TIP = tr("hut.tip", "🛖 Spawn Room Warrior");
export const HUT_EXPLAIN = tr("hut.explain", "🛖 Spawn Room Warrior: rarely dies, plays at a slow pace and aims poorly, yet ⚔️ iVi beats IvI by a lot. That positive 🔀 Diff likely comes from safe positions, so it is reduced. The check gets stricter the higher the ⚔️ iVi and the longer the play time: newer and weaker players are judged gently, and players who die often are never touched.");
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
  const act = [], dpm = [], acc = [], play = [];
  for (const r of rows || []) {
    if (fin(r.playMin)) play.push(r.playMin);
    if (fin(r.act)) act.push(r.act);
    const d = deathsPerMin(r.kpm, r.kd);
    if (fin(d)) dpm.push(d);
    if (fin(r.acc)) acc.push(r.acc);
  }
  act.sort((a, b) => a - b); dpm.sort((a, b) => a - b); acc.sort((a, b) => a - b); play.sort((a, b) => a - b);
  const actMedian = median(act);
  return {
    actMedian,
    actCut: actMedian * HUT_ACT_MULT,
    dpmLo: at(dpm, HUT_DPM_BAND[0]), dpmHi: at(dpm, HUT_DPM_BAND[1]),
    accLo: median(acc), accHi: at(acc, HUT_ACC_BAND[1]),
    infLo: HUT_INF_BAND[0], infHi: HUT_INF_BAND[1],
    expLo: at(play, HUT_EXP_BAND[0]), expHi: at(play, HUT_EXP_BAND[1]),
    n: { act: act.length, dpm: dpm.length, acc: acc.length, play: play.length },
  };
}

/** Linear ramp: 1 at/below lo, 0 at/above hi (lo ≥ hi → hard step at lo). */
function down(v, lo, hi) {
  if (v <= lo) return 1;
  if (v >= hi) return 0;
  return (hi - v) / (hi - lo);
}

/**
 * Parts for one player { act, kpm, kd, acc, inf, iviPct, playMin }: { exp, cut, a, wDpm, wInf, wAcc, w, m }.
 * playMin undefined (no experience data passed at all) → e = 1; null / NaN → e = 0.
 * or null when a stat is missing or the cuts aren't usable. m = 1 means no change.
 */
export function hutParts(r, cuts) {
  if (!r || !cuts || ![cuts.actCut, cuts.dpmLo, cuts.dpmHi, cuts.accLo, cuts.accHi].every(fin) || cuts.actCut <= 0) return null;
  const d = deathsPerMin(r.kpm, r.kd);
  if (!fin(r.act) || !fin(d) || !fin(r.acc) || !fin(r.inf)) return null;
  const exp = r.playMin === undefined ? 1 : fin(r.playMin) && fin(cuts.expLo) && fin(cuts.expHi) ? 1 - down(r.playMin, cuts.expLo, cuts.expHi) : 0;
  const cut = fin(cuts.actMedian) && cuts.actMedian > 0 ? cuts.actMedian * hutActMult(r.iviPct, exp) : cuts.actCut;
  const a = r.act >= cut ? 1 : (Math.max(0, r.act) / cut) ** 2;
  const wDpm = down(d, cuts.dpmLo, cuts.dpmHi);
  const wInf = 1 - down(r.inf, cuts.infLo, cuts.infHi);
  const wAcc = down(r.acc, cuts.accLo, cuts.accHi);
  const w = wDpm * wInf * wAcc;
  return { exp, cut, a, wDpm, wInf, wAcc, w, m: 1 - w * (1 - a) };
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
