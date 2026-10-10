/**
 * "Red flags 🚩" review rule for build-log.html (hidden page, never the main page).
 * Pattern the user spotted on suspected cheaters: very high skill + low
 * LionHeart + low Inflation. A lead for manual review, NOT proof.
 *
 * Metrics come from player-metrics.mjs (same numbers as the main tables):
 *   adj  = 🎯🎈 ivi (opposition-weighted IvI)   ivi = public IvI
 *   pvs  = 🦁 Brave (LionHeart)                      inflation = 🎈 Inflation
 * The app has no skill tiers or low/high bands, so these were set from the
 * distribution of the 228 cached players (2026-10-07):
 *   🎯🎈 ivi  p90 ≈ 1910, p95 ≈ 2270 → Exceptional ≥ 2200 (≈ top 5–6%)
 *   IvI     p90 ≈ 1455, p95 ≈ 1735 → Exceptional ≥ 1700 (≈ top 5–6%)
 *   🦁 LionHeart median ≈ 3.1; elite players usually 4–18 → low ≤ 2.0 (≈ bottom 40%)
 *   🎈 Inflation median ≈ 2.03 → low ≤ 1.5 (≈ bottom 10%)
 */
import { PADDING_RULE, statMark, PADDING_MARK, PADDING_MARK_TIP } from "./padding.mjs?v=20261009-namesort";
import { classifyBins, RED_PATTERNS, CHART_PATTERNS } from "./bins.mjs?v=20261009-namesort";
import { sessionRuleText } from "./session-stats.mjs?v=20261009-namesort";

export { PADDING_MARK, PADDING_MARK_TIP, RED_PATTERNS, CHART_PATTERNS, classifyBins };

export const RED_FLAG_RULE = Object.freeze({
  /** 🎯🎈 ivi (adjusted) at/above this = Exceptional. */
  EXCEPTIONAL_ADJ_IVI: 2200,
  /** Public IvI at/above this = Exceptional. */
  EXCEPTIONAL_IVI: 1700,
  /** "Almost exceptional": within 15% below either Exceptional threshold (user, 2026-10-07). */
  ALMOST_FRACTION: 0.85,
  /** 🦁 LionHeart at/below this = low band. */
  LIONHEART_LOW_MAX: 2.0,
  /**
   * Curve slope at/below this also counts as "low LionHeart". LionHeart bottoms
   * out at Activity × 0.05^1.5, so a huge-Activity player (e.g. lololollala,
   * slope −116, LionHeart 5.3) can never reach ≤ 2.0 however steep the collapse.
   * −2.0 = SLOPE_FLOOR in math.mjs, where LionHeart hits its minimum (2026-10-07).
   */
  SLOPE_COLLAPSE_MAX: -2.0,
  /** 🎈 Inflation at/below this = low band. */
  INFLATION_LOW_MAX: 1.5,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Skill vs the Exceptional thresholds: best of 🎯🎈 ivi and public IvI, as a
 * ratio (1 = exactly Exceptional). Tier: "Exceptional" | "Almost exceptional" | "".
 */
export function skillTier(m, rule = RED_FLAG_RULE) {
  const rAdj = fin(m.adj) ? m.adj / rule.EXCEPTIONAL_ADJ_IVI : -Infinity;
  const rIvi = fin(m.ivi) ? m.ivi / rule.EXCEPTIONAL_IVI : -Infinity;
  const ratio = Math.max(rAdj, rIvi);
  const basis = rAdj >= rIvi ? "adj" : "ivi";
  let tier = "";
  if (ratio >= 1) tier = "Exceptional";
  else if (ratio >= rule.ALMOST_FRACTION) tier = "Almost exceptional";
  return { ratio: fin(ratio) ? ratio : NaN, basis, tier };
}

/**
 * Apply the rule to one metrics row ({ adj, ivi, pvs, slope, inflation }).
 * Missing LionHeart / Inflation never flags (can't judge without them).
 */
export function redFlag(m, rule = RED_FLAG_RULE) {
  const skill = skillTier(m, rule);
  const highSkill = !!skill.tier;
  const lowLion =
    (fin(m.pvs) && m.pvs <= rule.LIONHEART_LOW_MAX) ||
    (fin(m.slope) && m.slope <= rule.SLOPE_COLLAPSE_MAX);
  const lowInfl = fin(m.inflation) && m.inflation <= rule.INFLATION_LOW_MAX;
  return { flagged: highSkill && lowLion && lowInfl, skill, highSkill, lowLion, lowInfl };
}

/** Human-readable rule text (build-log.html header tooltip). */
export function redFlagRuleText(rule = RED_FLAG_RULE) {
  const pct = Math.round((1 - rule.ALMOST_FRACTION) * 100);
  return (
    `Flagged when ALL hold: skill is Exceptional or within ${pct}% below it ` +
    `(🎯🎈 ivi ≥ ${Math.round(rule.EXCEPTIONAL_ADJ_IVI * rule.ALMOST_FRACTION)} or public IvI ≥ ` +
    `${Math.round(rule.EXCEPTIONAL_IVI * rule.ALMOST_FRACTION)}; Exceptional = ${rule.EXCEPTIONAL_ADJ_IVI} / ` +
    `${rule.EXCEPTIONAL_IVI}), 🦁 Brave ≤ ${rule.LIONHEART_LOW_MAX} (or curve slope ≤ ${rule.SLOPE_COLLAPSE_MAX}), and 🎈 Inflation ≤ ` +
    `${rule.INFLATION_LOW_MAX}. A lead for manual review, not proof of cheating.`
  );
}

/* ---------- 🟠 Vehicle pattern ---------- */

/**
 * Pattern from a suspected vehicle cheater (FOV/hitbox aim + radar): elite
 * skill and a very high KD, but infantry aim stats near the bottom of the
 * cache. Inflation is ignored. Thresholds from the 228 cached players
 * (2026-10-07): KD p90 ≈ 4.82 (p95 ≈ 6.78); HSR p10 ≈ 9.1%; accuracy p15 ≈ 16.0%.
 */
export const VEHICLE_RULE = Object.freeze({
  /** Global KD at/above this = very high (≈ p90 of the cache). */
  KD_HIGH_MIN: 4.8,
  /** HSR % at/below this = weak infantry aim (≈ p10). */
  HSR_LOW_MAX: 9.0,
  /** Accuracy % at/below this = weak infantry aim (≈ p15). */
  ACC_LOW_MAX: 16.0,
});

/**
 * Apply the vehicle rule to one metrics row ({ adj, ivi, kd, acc, hsr }).
 * Uses the same skill test as redFlag. Missing aim stats (null / 0 accuracy)
 * never flag — no data isn't weak aim.
 */
export function vehicleFlag(m, rule = VEHICLE_RULE, skillRule = RED_FLAG_RULE) {
  const skill = skillTier(m, skillRule);
  const highSkill = !!skill.tier;
  const highKd = fin(m.kd) && m.kd >= rule.KD_HIGH_MIN;
  const hasAim = fin(m.acc) && m.acc > 0 && fin(m.hsr);
  const weakAim = hasAim && m.hsr <= rule.HSR_LOW_MAX && m.acc <= rule.ACC_LOW_MAX;
  return { flagged: highSkill && highKd && weakAim, skill, highSkill, highKd, weakAim };
}

export function vehicleRuleText(rule = VEHICLE_RULE, skillRule = RED_FLAG_RULE) {
  const pct = Math.round((1 - skillRule.ALMOST_FRACTION) * 100);
  return (
    `Flagged when ALL hold: skill is Exceptional or within ${pct}% below it (same test as Red flags), ` +
    `KD ≥ ${rule.KD_HIGH_MIN}, HSR ≤ ${rule.HSR_LOW_MAX}% and accuracy ≤ ${rule.ACC_LOW_MAX}% ` +
    `(strong results with weak infantry aim). Inflation is ignored. ` +
    `A lead for manual review, not proof of cheating.`
  );
}

/* ---------- 🔴 Rampage pattern ---------- */

/**
 * Short, absurd kill sprees (fresh or long-idle account that just got cheats):
 * KD and KPM both far beyond anything legit in the cache. From the 228 cached
 * players (2026-10-07): best legit-looking KD ≈ 9.7, KPM p99 ≈ 3.3; the known
 * cases sit at KD 24.7–98 with KPM 4.4–4.7 (1stFanOfAhorn — banned, Add1ti0nal).
 * No skill test: these accounts often have too few rows for a fair one.
 */
export const RAMPAGE_RULE = Object.freeze({
  /** Global KD at/above this = beyond any legit player in the cache. */
  KD_MIN: 15,
  /** Global KPM at/above this = top ~1% kill rate. */
  KPM_MIN: 3.0,
});

export function rampageFlag(m, rule = RAMPAGE_RULE) {
  const extremeKd = fin(m.kd) && m.kd >= rule.KD_MIN;
  const fastKills = fin(m.kpm) && m.kpm >= rule.KPM_MIN;
  return { flagged: extremeKd && fastKills, extremeKd, fastKills };
}

/* ---------- 🔴 Padding pattern ---------- */

/**
 * Stat padding (user-approved 2026-10-09): most kills on a few accounts that
 * never fight back. Uses m.farm from player-metrics.mjs (padding.mjs rule):
 * farm-victim kills ≥ PADDING_RULE.FLAG_SHARE of the sample. Those kills are
 * already left out of the player's numbers; the flag says why they changed.
 */
export function paddingFlag(m, rule = PADDING_RULE, { confirmed = false } = {}) {
  const farm = (m && m.farm) || { victims: [], kills: 0, share: 0 };
  // Confirmed on review (reviewed.json "padding") → padding whatever the current share.
  const flagged = confirmed || (!!(farm.victims && farm.victims.length) && farm.share >= rule.FLAG_SHARE);
  return { flagged, share: farm.share || 0, kills: farm.kills || 0, victims: farm.victims || [] };
}

/** True when a metrics row is a 🚩 stat padder (for the "*" name marker). */
export function isPadder(m) {
  return paddingFlag(m).flagged;
}


/* ---------- combined Red flags 🚩 bin ---------- */

/**
 * One automatic bin, OR of three patterns (plus "rampage": KD ≥ 15 and KPM ≥ 3): "aim" (redFlag: high skill + low
 * LionHeart + low Inflation) and "vehicle" (vehicleFlag: high skill + very
 * high KD + weak infantry aim). → { flagged, patterns: ["aim"|"vehicle", …], skill }
 */
export function reviewFlags(m, { confirmed = false } = {}) {
  // aim / vehicle / rampage keep their original inputs: the sample WITH farm
  // victims (m.raw), so adding the padding filter doesn't move those flags.
  const base = (m && m.raw) || m;
  const aim = redFlag(base);
  const veh = vehicleFlag(base);
  const ram = rampageFlag(base);
  const pad = paddingFlag(m, PADDING_RULE, { confirmed });
  // Any automatic exclusion below the padding line still altered the stats:
  // flag for human review (fluke vs bad luck), see padding.mjs statMark.
  const adjusted = !pad.flagged && statMark(m && m.farm).kind === "adjusted";
  const patterns = [];
  if (aim.flagged) patterns.push("aim");
  if (veh.flagged) patterns.push("vehicle");
  if (ram.flagged) patterns.push("rampage");
  if (pad.flagged) patterns.push("padding");
  if (adjusted) patterns.push("adjusted");
  // Bin routing via the shared classifier (bins.mjs, user rule t280u): chart-only
  // patterns ("adjusted") → 📉 Chart anomalies only; any other pattern → 🚩.
  // (The 🧪 outlier part of 📉 comes from status.json, see outlier-guard.mjs.)
  const bins = classifyBins({ patterns });
  return { flagged: patterns.length > 0, red: bins.bin === "red", anomaly: bins.chart.length > 0, bins, patterns, skill: aim.skill, padding: pad };
}

/** Rule line for the 📉 Chart anomalies "🌾 Stat padding" list (its own sub-part, not 🚩; user t288u). */
export function paddingRuleText() {
  return (
    `[padding] ≥ ${Math.round(PADDING_RULE.FLAG_SHARE * 100)}% of sample kills on farm accounts (${PADDING_RULE.MIN_KILLS}+ kills on it, ` +
    `it killed back ≤ ${PADDING_RULE.MAX_BACK * 100}%, its KPM < ${PADDING_RULE.MAX_KPM}). Those kills are excluded from the stats and the name gets the public * mark. ` +
    `A chart-integrity issue, not a 🚩 pattern; a human decides (record it in data/reviewed.json).`
  );
}

/** Rule line for the 📉 Chart anomalies "adjusted — needs review" list. */
export function anomalyRuleText() {
  return (
    `[adjusted] some sample kills on farm accounts (${PADDING_RULE.MIN_KILLS}+ kills on it, it killed back ≤ ${PADDING_RULE.MAX_BACK * 100}%, ` +
    `its KPM < ${PADDING_RULE.MAX_KPM}) were excluded automatically, below the ${Math.round(PADDING_RULE.FLAG_SHARE * 100)}% padding line. ` +
    `The stats are altered, so a human decides: fluke, bad luck or padding (record it in data/reviewed.json).`
  );
}

/** Header tooltip / rule line for the combined bin. */
export function reviewRuleText() {
  const pct = Math.round((1 - RED_FLAG_RULE.ALMOST_FRACTION) * 100);
  const R = RED_FLAG_RULE;
  const V = VEHICLE_RULE;
  return (
    `Flagged when skill is Exceptional or within ${pct}% below it ` +
    `(🎯🎈 ivi ≥ ${Math.round(R.EXCEPTIONAL_ADJ_IVI * R.ALMOST_FRACTION)} or public IvI ≥ ` +
    `${Math.round(R.EXCEPTIONAL_IVI * R.ALMOST_FRACTION)}; Exceptional = ${R.EXCEPTIONAL_ADJ_IVI} / ${R.EXCEPTIONAL_IVI}) AND either ` +
    `[aim pattern] 🦁 Brave ≤ ${R.LIONHEART_LOW_MAX} (or curve slope ≤ ${R.SLOPE_COLLAPSE_MAX}) and 🎈 Inflation ≤ ${R.INFLATION_LOW_MAX}, or ` +
    `[vehicle pattern] KD ≥ ${V.KD_HIGH_MIN}, HSR ≤ ${V.HSR_LOW_MAX}% and accuracy ≤ ${V.ACC_LOW_MAX}% (Inflation ignored). ` +
    `Also flagged regardless of skill: [rampage pattern] KD ≥ ${RAMPAGE_RULE.KD_MIN} and KPM ≥ ${RAMPAGE_RULE.KPM_MIN}; ` +
    `${sessionRuleText().replace(/\. A very one-sided.*$/, "")} (needs Honu session data, computed on refresh; details in 🧪 Session stats); ` +
    `Stat padding (🌾 *) and smaller farm exclusions († adjusted) are chart-integrity issues listed under 📉 Chart anomalies, not here. ` +
    `A lead for manual review, not proof of cheating.`
  );
}
