/**
 * 🪳 Zerg revive check (owner-approved 2026-10-22). DOM-free.
 *
 * Zergs die in a crowd, so medics pick them up: in our Honu XP detail the share
 * of deaths that got a revive rises with 🪳 Zerg (quartile medians ≈ 20% → 45%).
 * That makes it a second, independent signal:
 *   revived share = (Revive + Squad Revive received) ÷ deaths by enemy players
 *   (Honu "Kill Player" + "Kill Player Class MAX" with the player as target),
 *   from data/xp/<slug>.json (requested / discovered players only), counted when
 *   the XP detail has ≥ REV_MIN_KILLS kills (same 100-kill rule as 🪳 itself)
 *   and ≥ REV_MIN_DEATHS deaths.
 * rvp = that share's percentile among everyone measured this build (0–99).
 *   rvp ≥ 75 (upper quartile)  → Zerg "confirmed" (score unchanged, said on hover).
 *   Low rvp softens a high Zerg gradually, never raises it: the revive percentile
 *   becomes a third leg of the "lower one counts" rule, with weight w:
 *     w = 1 at/below p25 → 0 at/above the median (linear);
 *     Zerg = raw − round(w × max(0, raw − rvp)).
 *   No revive data → Zerg unchanged (no result shown).
 * Owner override (human wins): data/reviewed.json "zerg": "cleared" on the
 * player's entry → no revive result at all (rvp null).
 * build-ranks.mjs stores rvp in the trailing ranks.json / ranks-lite column "rvp";
 * trait-scores.mjs zergScore() applies it.
 */
import { t as tr } from "./i18n.mjs";

export const REV_MIN_KILLS = 100;
export const REV_MIN_DEATHS = 50;
export const REV_SOFT_BAND = [25, 50]; // rvp: full soften at/below p25 → none at/above the median
export const REV_CONFIRM = 75; // rvp at/above the upper quartile → "confirmed"
const REVIVE_IDS = ["7", "53"]; // Revive, Squad Revive
const DEATH_IDS = ["1", "29"]; // Kill Player, Kill Player Class MAX (as target)

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const cnt = (t, id) => (t && Array.isArray(t[id]) && fin(t[id][0]) ? t[id][0] : 0);

/** data/xp/<slug>.json → { share, revived, deaths, kills } or null below the sample minimum. */
export function revivedShare(xp) {
  const r = xp && xp.totals && xp.totals.r;
  if (!r) return null;
  const deaths = DEATH_IDS.reduce((s, id) => s + cnt(r, id), 0);
  const revived = REVIVE_IDS.reduce((s, id) => s + cnt(r, id), 0);
  const kills = fin(xp.kills_counted) ? xp.kills_counted : 0;
  if (kills < REV_MIN_KILLS || deaths < REV_MIN_DEATHS) return null;
  return { share: Math.min(1, revived / deaths), revived, deaths, kills };
}

/** Soften weight w (0…1) for a revive percentile; 0 when unknown. */
export function reviveWeight(rvp) {
  if (!fin(rvp)) return 0;
  const [lo, hi] = REV_SOFT_BAND;
  return rvp <= lo ? 1 : rvp >= hi ? 0 : (hi - rvp) / (hi - lo);
}

/** Zerg after the revive check: { score, w, confirmed, softened }. rvp null → unchanged. */
export function reviveZerg(raw, rvp) {
  if (!fin(raw)) return { score: raw, w: 0, confirmed: false, softened: false };
  if (!fin(rvp)) return { score: raw, w: 0, confirmed: false, softened: false };
  const w = reviveWeight(rvp);
  const score = raw - Math.round(w * Math.max(0, raw - rvp));
  return { score, w, confirmed: rvp >= REV_CONFIRM, softened: score < raw };
}

/** reviewed.json entry clears the revive check ("zerg": "cleared", or false). */
export function zergCleared(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  return !!e && (e.zerg === "cleared" || e.zerg === false);
}

// Texts (English defaults; translations under the same keys in i18n/*.json).
export const ZREV_NOTE = tr("zrev.note", "Revive check (players with Honu XP detail): many deaths revived by medics confirms a high Zerg; few revives softens it.");
export const ZREV_EXPLAIN = tr("zrev.explain", "🪳 Revive check: zergs die in a crowd, so medics pick them up. Where Honu XP detail exists, the share of deaths that got a revive is compared with everyone measured. Top quarter = Zerg confirmed. Bottom half = a high Zerg is softened gradually toward the revive level (bottom quarter = fully). It never raises Zerg. No XP detail = no change.");
export const zrevConfirmedTip = (rvp) => tr("zrev.confirmed", "Revive check: confirmed, a larger share of deaths revived than {n}% of measured players.", { n: rvp });
export const zrevSoftTip = (raw, rvp) => tr("zrev.soft", "Revive check: reduced from {raw}, few deaths revived (a larger share than only {n}% of measured players).", { raw, n: rvp });
export const zrevPlainTip = (rvp) => tr("zrev.plain", "Revive check: a larger share of deaths revived than {n}% of measured players, no change.", { n: rvp });
