import { t as tr } from "./i18n.mjs";
/**
 * 🚜 / 🪖 infantry dial (owner t590u). Pure, no imports: used by LIVE (live.mjs fill meter) and the main site
 * (app.js stats table + rankings.mjs: a static 🚜 mark by the name, owner t591u–t593u — no fill, glow or animation there).
 *
 * M = the median infantry % over every ranks.json player with a value (taken from the data, never hard-coded;
 * 85.1 over 13,130 players on 2026-10-24). Owner t622u: the 🚜 name mark and the LIVE 🚜 start at the 🚜 cut
 * (p25 of the same data, tractorCuts below), not at M; between the cut and M LIVE shows an empty 🪖.
 *   - inf ≥ M  → 🪖, fill = (inf − M) / (100 − M): M = empty, 100 = full.
 *   - inf < M  → 🚜, fill = (M − inf) / (M − M/2), clamped 0–1: just under M = almost empty,
 *                M/2 (≈ 42.5) and below = full (and shiny on LIVE). The less infantry, the fuller the tractor.
 */
export const INFANTRY_EMOJI = "🪖";
export const TRACTOR_EMOJI = "🚜";

/** Median of a sorted (ascending) array of finite numbers; null when empty. */
export function infMedian(sorted) {
  const a = Array.isArray(sorted) ? sorted.filter((x) => typeof x === "number" && Number.isFinite(x)) : [];
  if (!a.length) return null;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/** True when this infantry % is below the median M (→ 🚜). No value or no median → false. */
export function isTractor(inf, M) {
  return typeof inf === "number" && Number.isFinite(inf) && typeof M === "number" && Number.isFinite(M) && inf < M;
}

/**
 * { emoji, tractor, fill 0..100 (1 decimal) } for one infantry %, or null when there is no value / no median.
 * C = the 🚜 infantry cut (tractorCuts().cut, owner t622u; optional, below M):
 *   - inf < C      → 🚜, fill = (C − inf) / (C − C/2): just under C = almost empty, C/2 and below = full;
 *   - C ≤ inf < M  → 🪖 with an empty fill (no 🚜: not a vehicle main);
 *   - inf ≥ M      → 🪖 as before. Without C the 🚜 starts at M (t590u).
 */
export function infDial(inf, M, C = null) {
  if (typeof inf !== "number" || !Number.isFinite(inf) || typeof M !== "number" || !Number.isFinite(M) || M <= 0 || M >= 100) return null;
  const v = Math.min(100, Math.max(0, inf));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const T = typeof C === "number" && Number.isFinite(C) && C > 0 && C < M ? C : M;
  const tractor = v < T;
  const f = tractor ? clamp01((T - v) / (T - T / 2)) : v < M ? 0 : clamp01((v - M) / (100 - M));
  return { emoji: tractor ? TRACTOR_EMOJI : INFANTRY_EMOJI, tractor, fill: Math.round(f * 1000) / 10 };
}

/* ---------- 🚜 name-mark rule (owner t619u/t622u, like the 🪳 mark: a low percentile + an XP confirmation) ----------
 * Every threshold is a percentile of the build's own data (scripts/build-ranks.mjs computes them; ranks.json "tracCuts"):
 *   🚜 = infantry % below p25 of every ranked player AND (repair XP / min OR vehicle-kill events / min at or above p75
 *        of the players with 2+ h of Honu XP detail), OR infantry % below p2 (clear vehicle play, no XP needed).
 *   reviewed.json "tractor": "cleared" removes the mark (build time). Just a label: no score changes. */
export const TRAC_INF_Q = 25; // infantry percentile (with XP confirmation)
export const TRAC_XP_Q = 75; // repair / vehicle-kill percentile of the XP pool (the confirmation)
export const TRAC_FALLBACK_Q = 2; // infantry percentile marked even without XP
export const TRAC_XP_MIN = 120; // minutes of XP detail for the confirmation pool
/** Honu XP ids from data/exp-types.json "types": vehicle repairs (not MAX / turret / facility) and vehicle kills / assists / gunner kills. */
export function tracXpIds(types) {
  const e = Object.entries(types || {}).filter(([, v]) => Array.isArray(v) && typeof v[0] === "string");
  return {
    repair: e.filter(([, [d]]) => /repair/i.test(d) && !/MAX|Engi Turret|Facility|Object/i.test(d)).map(([k]) => k),
    vkill: e.filter(([, [d]]) => /^Vehicle Destruction|^Kill Assist - |Gunner/i.test(d)).map(([k]) => k),
  };
}
/** { rep, vk } per minute from one data/xp file (given XP, "g"), or null under TRAC_XP_MIN minutes. */
export function tracSample(xp, ids) {
  const min = xp && xp.seconds_counted ? xp.seconds_counted / 60 : 0;
  if (!(min >= TRAC_XP_MIN) || !ids) return null;
  const g = (xp.totals && xp.totals.g) || {};
  const n = (list) => list.reduce((s, k) => s + (Array.isArray(g[k]) ? +g[k][0] || 0 : 0), 0);
  return { rep: n(ids.repair) / min, vk: n(ids.vkill) / min };
}
const atQ = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))] : null);
const finN = (x) => typeof x === "number" && Number.isFinite(x);
/** Cuts from the data: infantry values (any order) + XP samples ({ rep, vk }) → { cut, fb, med, rep, vk } (null parts when empty). */
export function tractorCuts(infVals, samples) {
  const v = (infVals || []).filter(finN).sort((a, b) => a - b);
  const s = [...(samples || [])].filter(Boolean);
  const r = s.map((x) => x.rep).filter(finN).sort((a, b) => a - b), k = s.map((x) => x.vk).filter(finN).sort((a, b) => a - b);
  return { cut: atQ(v, TRAC_INF_Q), fb: atQ(v, TRAC_FALLBACK_Q), med: infMedian(v), rep: atQ(r, TRAC_XP_Q), vk: atQ(k, TRAC_XP_Q) };
}
/** Build-time rule: 1 = 🚜, 0 = no, null = no infantry %. s = tracSample() or null. */
export function tractorRule(inf, s, cuts) {
  if (!finN(inf) || !cuts) return null;
  if (finN(cuts.fb) && inf < cuts.fb) return 1;
  if (!finN(cuts.cut) || !(inf < cuts.cut) || !s) return 0;
  return (finN(cuts.rep) && s.rep >= cuts.rep && s.rep > 0) || (finN(cuts.vk) && s.vk >= cuts.vk && s.vk > 0) ? 1 : 0;
}
/** Page side: the build's "trc" (1 / 0) wins; a player outside the build gets the no-XP fallback only. */
export function tractorMarked(trc, inf, cuts) {
  if (trc === 1 || trc === 0) return trc === 1;
  return !!cuts && finN(inf) && finN(cuts.fb) && inf < cuts.fb;
}
/** reviewed.json "tractor": "cleared" → no 🚜 for that player (same style as "zerg": "cleared"). */
export function tractorCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  return !!e && (e.tractor === "cleared" || e.tractor === false);
}

/* ---------- main site (owner t591u–t593u): a static 🚜 name mark (auto-marks.mjs, next to 🪦), no fill / glow / animation ---------- */
export const TRACTOR_HINT = "🚜 Vehicle mark: plays mostly in vehicles.\nInfantry < {m}% + lots of vehicle repair/kill XP,\nor infantry < {f}%. Just a label, no score changes.";
/** 3-line hover for the 🚜 (all 9 languages: i18n "inf.tractor"); cuts = tractorCuts() (a bare number = the infantry cut). */
export function tractorHint(cuts) {
  const c = typeof cuts === "number" ? { cut: cuts } : cuts || {};
  const f1 = (x) => (finN(x) ? x.toFixed(1) : "?");
  return tr("inf.tractor", TRACTOR_HINT, { m: f1(c.cut), f: f1(c.fb) });
}
