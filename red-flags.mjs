/**
 * "Red flags 🚩" review rule for status.html (hidden page, never the main page).
 * Pattern the user spotted on suspected cheaters: very high skill + low
 * LionHeart + low Inflation. A lead for manual review, NOT proof.
 *
 * Metrics come from player-metrics.mjs (same numbers as the main tables):
 *   adj  = 🎯 ivi (opposition-weighted IvI)   ivi = public IvI
 *   pvs  = 🦁 LionHeart                       inflation = 🎈 Inflation
 * The app has no skill tiers or low/high bands, so these were set from the
 * distribution of the 228 cached players (2026-10-07):
 *   🎯 ivi  p90 ≈ 1910, p95 ≈ 2270 → Exceptional ≥ 2200 (≈ top 5–6%)
 *   IvI     p90 ≈ 1455, p95 ≈ 1735 → Exceptional ≥ 1700 (≈ top 5–6%)
 *   🦁 LionHeart median ≈ 3.1; elite players usually 4–18 → low ≤ 2.0 (≈ bottom 40%)
 *   🎈 Inflation median ≈ 2.03 → low ≤ 1.5 (≈ bottom 10%)
 */
export const RED_FLAG_RULE = Object.freeze({
  /** 🎯 ivi (adjusted) at/above this = Exceptional. */
  EXCEPTIONAL_ADJ_IVI: 2200,
  /** Public IvI at/above this = Exceptional. */
  EXCEPTIONAL_IVI: 1700,
  /** "Almost exceptional": within 10% below either Exceptional threshold. */
  ALMOST_FRACTION: 0.9,
  /** 🦁 LionHeart at/below this = low band. */
  LIONHEART_LOW_MAX: 2.0,
  /** 🎈 Inflation at/below this = low band. */
  INFLATION_LOW_MAX: 1.5,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Skill vs the Exceptional thresholds: best of 🎯 ivi and public IvI, as a
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
 * Apply the rule to one metrics row ({ adj, ivi, pvs, inflation }).
 * Missing LionHeart / Inflation never flags (can't judge without them).
 */
export function redFlag(m, rule = RED_FLAG_RULE) {
  const skill = skillTier(m, rule);
  const highSkill = !!skill.tier;
  const lowLion = fin(m.pvs) && m.pvs <= rule.LIONHEART_LOW_MAX;
  const lowInfl = fin(m.inflation) && m.inflation <= rule.INFLATION_LOW_MAX;
  return { flagged: highSkill && lowLion && lowInfl, skill, highSkill, lowLion, lowInfl };
}

/** Human-readable rule text (status.html header tooltip). */
export function redFlagRuleText(rule = RED_FLAG_RULE) {
  const pct = Math.round((1 - rule.ALMOST_FRACTION) * 100);
  return (
    `Flagged when ALL hold: skill is Exceptional or within ${pct}% below it ` +
    `(🎯 ivi ≥ ${Math.round(rule.EXCEPTIONAL_ADJ_IVI * rule.ALMOST_FRACTION)} or public IvI ≥ ` +
    `${Math.round(rule.EXCEPTIONAL_IVI * rule.ALMOST_FRACTION)}; Exceptional = ${rule.EXCEPTIONAL_ADJ_IVI} / ` +
    `${rule.EXCEPTIONAL_IVI}), 🦁 LionHeart ≤ ${rule.LIONHEART_LOW_MAX}, and 🎈 Inflation ≤ ` +
    `${rule.INFLATION_LOW_MAX}. A lead for manual review, not proof of cheating.`
  );
}
