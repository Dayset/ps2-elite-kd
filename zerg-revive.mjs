/**
 * 🪳 Zerg crowd check (revive check owner-approved 2026-10-22; crowd score,
 * Hardlight and the estimate owner-approved 2026-10-24, t614). DOM-free.
 *
 * Zergs die in a crowd, so the crowd picks them up. From our Honu XP detail
 * (data/xp/<slug>.json, requested / discovered players only), counted when it
 * has ≥ CROWD_MIN_DEATHS deaths by enemy players and ≥ CROWD_MIN_MIN minutes
 * of play (no kill minimum):
 *   per death (Honu "Kill Player" + "Kill Player Class MAX" as target):
 *     revived  = Revive + Squad Revive received          (rvp = its percentile)
 *     healed   = Heal + Squad Heal received
 *     shielded = Shield Repair + Squad Shield Repair received
 *     resupply = Resupply + Squad Resupply received
 *   crowd = mean of the four percentiles; an engineer's Hardlight barrier
 *     (XP 1393, blocking) only ticks inside a big crowd: at ≥ HL_MIN per minute
 *     crowd = max(crowd, (1 − HL_W) × crowd + HL_W × its percentile among
 *     Hardlight earners) — it can only add. The crowd value is then turned into
 *     a percentile again among everyone measured (crp, 0–99), so p25 / p50 /
 *     p75 are real quarters.
 * Check value = the higher of rvp and crp:
 *   rvp ≥ 75 OR crp ≥ 75 → Zerg "confirmed" (score unchanged, said on hover).
 *   A low check value softens a high Zerg gradually, never raises it:
 *     w = 1 at/below p25 → 0 at/above the median (linear);
 *     Zerg = raw − round(w × max(0, raw − check)).
 *   No XP detail → Zerg unchanged.
 * Estimate (no 🪳 Zerg at all, e.g. a medic with few kills / assists): the
 *   check value when it is ≥ ZEST_MIN, shown as "~N". Display only: never a
 *   real Zerg (no sorting, no pools, no name mark).
 * Owner override (human wins): data/reviewed.json "zerg": "cleared" on the
 * player's entry → no crowd result at all (rvp and crp null).
 * build-ranks.mjs stores rvp / crp in the trailing ranks.json / ranks-lite
 * columns "rvp" / "crp"; trait-scores.mjs zergScore() applies them.
 */
import { t as tr } from "./i18n.mjs";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";

export const CROWD_MIN_DEATHS = 50;
export const CROWD_MIN_MIN = 120; // minutes of play in the XP detail (2 h)
export const REV_MIN_DEATHS = CROWD_MIN_DEATHS; // kept name (older callers)
export const REV_SOFT_BAND = [25, 50]; // check value: full soften at/below p25 → none at/above the median
export const REV_CONFIRM = 75; // rvp or crp at/above the upper quartile → "confirmed"
export const ZEST_MIN = 75; // estimate shown only from the upper quartile
export const HL_ID = "1393"; // Hardlight Cover – Blocking Exp (engineer barrier)
export const HL_MIN = 0.02; // Hardlight XP events per minute to count
export const HL_W = 0.2; // Hardlight weight (1/5), can only add
const REVIVE_IDS = ["7", "53"]; // Revive, Squad Revive
const HEAL_IDS = ["4", "51"]; // Heal Player, Squad Heal
const SHIELD_IDS = ["438", "439"]; // Shield Repair, Squad Shield Repair
const RESUP_IDS = ["34", "55"]; // Resupply Player, Squad Resupply
const DEATH_IDS = ["1", "29"]; // Kill Player, Kill Player Class MAX (as target)
export const CROWD_PARTS = Object.freeze(["rev", "heal", "shield", "resup"]);

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const cnt = (t, id) => (t && Array.isArray(t[id]) && fin(t[id][0]) ? t[id][0] : 0);
const sum = (t, ids) => ids.reduce((s, id) => s + cnt(t, id), 0);
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * data/xp/<slug>.json → per-death crowd parts or null below the sample minimum:
 * { deaths, minutes, revived, rev, heal, shield, resup, hl } (hl = Hardlight XP events per minute).
 */
export function crowdSample(xp) {
  const r = xp && xp.totals && xp.totals.r;
  if (!r) return null;
  const deaths = sum(r, DEATH_IDS);
  const minutes = fin(xp.seconds_counted) ? xp.seconds_counted / 60 : 0;
  if (deaths < CROWD_MIN_DEATHS || minutes < CROWD_MIN_MIN) return null;
  const revived = sum(r, REVIVE_IDS);
  const g = xp.totals.g || {};
  return {
    deaths, minutes: Math.round(minutes), revived,
    rev: Math.min(1, revived / deaths), heal: sum(r, HEAL_IDS) / deaths, shield: sum(r, SHIELD_IDS) / deaths, resup: sum(r, RESUP_IDS) / deaths,
    hl: cnt(g, HL_ID) / minutes,
  };
}

/** Old name: { share, revived, deaths } (revived share) or null below the sample minimum. */
export function revivedShare(xp) {
  const s = crowdSample(xp);
  return s ? { share: s.rev, revived: s.revived, deaths: s.deaths } : null;
}

/**
 * Map slug → crowdSample → Map slug → { rvp, crp, crowd, hlp } (percentiles 0–99 among
 * everyone in the map; values rounded to 3 decimals first, Hardlight to 4).
 */
export function crowdPercentiles(samples) {
  const list = [...samples];
  const pools = {};
  for (const k of CROWD_PARTS) pools[k] = list.map(([, s]) => r3(s[k])).sort((a, b) => a - b);
  const hl4 = (v) => Math.round(v * 10000) / 10000;
  const hlPool = list.map(([, s]) => s.hl).filter((v) => v > 0).map(hl4).sort((a, b) => a - b);
  const mid = list.map(([slug, s]) => {
    const c4 = CROWD_PARTS.reduce((t, k) => t + percentileOf(pools[k], r3(s[k])), 0) / CROWD_PARTS.length;
    const hlp = s.hl >= HL_MIN ? percentileOf(hlPool, hl4(s.hl)) : null;
    const crowd = Math.round(hlp != null ? Math.max(c4, (1 - HL_W) * c4 + HL_W * hlp) : c4);
    return [slug, { rvp: percentileOf(pools.rev, r3(s.rev)), crowd, hlp }];
  });
  const cs = mid.map(([, v]) => v.crowd).sort((a, b) => a - b);
  return new Map(mid.map(([slug, v]) => [slug, { ...v, crp: percentileOf(cs, v.crowd) }]));
}

/** The check value: the higher of the revive and crowd percentiles (null when neither is known). */
export function crowdCheck(rvp, crp) {
  const a = fin(rvp) ? rvp : null, b = fin(crp) ? crp : null;
  return a == null ? b : b == null ? a : Math.max(a, b);
}

/** Soften weight w (0…1) for a check percentile; 0 when unknown. */
export function reviveWeight(rvp) {
  if (!fin(rvp)) return 0;
  const [lo, hi] = REV_SOFT_BAND;
  return rvp <= lo ? 1 : rvp >= hi ? 0 : (hi - rvp) / (hi - lo);
}

/** Zerg after the crowd check: { score, w, chk, confirmed, softened }. No rvp / crp → unchanged. */
export function reviveZerg(raw, rvp, crp = null) {
  const chk = crowdCheck(rvp, crp);
  if (!fin(raw) || chk == null) return { score: raw, w: 0, chk, confirmed: false, softened: false };
  const w = reviveWeight(chk);
  const score = raw - Math.round(w * Math.max(0, raw - chk));
  const confirmed = (fin(rvp) && rvp >= REV_CONFIRM) || (fin(crp) && crp >= REV_CONFIRM);
  return { score, w, chk, confirmed, softened: score < raw };
}

/** Estimated 🪳 for a player WITHOUT a Zerg score: the check value at/above ZEST_MIN, else null. */
export function zergEstimate(rvp, crp) {
  const c = crowdCheck(rvp, crp);
  return c != null && c >= ZEST_MIN ? c : null;
}

/** reviewed.json entry clears the crowd check ("zerg": "cleared", or false). */
export function zergCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  return !!e && (e.zerg === "cleared" || e.zerg === false);
}

// Texts (English defaults; translations under the same keys in i18n/*.json).
export const ZREV_NOTE = tr("zrev.note", "🪳 Revives can confirm or lower it.");
export const ZREV_EXPLAIN = tr("zrev.explain", "🪳 Revive check: zergs die in crowds, so they get revived a lot. Often revived = Zerg confirmed; rarely revived = Zerg lowered.");
export const zrevConfirmedTip = (n) => tr("zrev.confirmed", "Crowd check: confirmed (more than {n}% of players).", { n });
export const zrevSoftTip = (raw, n) => tr("zrev.soft", "Crowd check: low (more than only {n}% of players), lowered from {raw}.", { raw, n });
export const zrevPlainTip = (n) => tr("zrev.plain", "Crowd check: more than {n}% of players, no change.", { n });
/** Hover for an estimated 🪳 ("~N"), shown only where there is no Zerg score. */
export const zrevEstTip = (n) => tr("zrev.est", "~{n} = estimate only (no 🪳 Zerg yet): crowd help received beats {n}% of players. Not sorted or marked.", { n });
