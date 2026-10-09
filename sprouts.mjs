/**
 * 🌱 "Could use a hand" list for build-log.html (hidden page): players whose
 * fights are going rough right now — the opposite end from the 🚩 red-flag
 * bin, and kept separate from it. Could be new, playing support / medic /
 * engi, or just learning. Shown so veterans can spot who might appreciate
 * tips or a squad invite; never a ranking to mock anyone with.
 *
 * Rule (automatic): raw ⚔️ iVi (adjs, BEFORE the clamp-to-0 used for display)
 * ≤ 0, and a top-50 sample big enough to mean something (≥ 300 kills+deaths).
 */
export const SPROUT_RULE = Object.freeze({
  /** Raw ⚔️ iVi (adjs) at/below this. */
  MAX_ADJS: 0,
  /** Minimum kills + deaths across the top-50 opponents. */
  MIN_EVENTS: 300,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Kills + deaths across the player's top-N opponent rows. */
export function sampleEvents(rows) {
  let n = 0;
  for (const r of rows || []) n += (+r.kills || 0) + (+r.deaths || 0);
  return n;
}

/**
 * Apply the rule. m = playerMetrics row (needs adjs); events = top-50
 * kills+deaths. Missing iVi never qualifies (can't judge without it).
 */
export function sprout(m, events, rule = SPROUT_RULE) {
  const adjs = m && fin(m.adjs) ? m.adjs : NaN;
  const lowIvi = fin(adjs) && adjs <= rule.MAX_ADJS;
  const enough = fin(events) && events >= rule.MIN_EVENTS;
  return { sprout: lowIvi && enough, lowIvi, enough, adjs, events: fin(events) ? events : 0 };
}

/** Human-readable rule text (build-log.html). */
export function sproutRuleText(rule = SPROUT_RULE) {
  return (
    `Listed when ⚔️ iVi (raw, before the main page rounds negatives up to 0) is ≤ ${rule.MAX_ADJS} ` +
    `and the top-50 sample has at least ${rule.MIN_EVENTS} kills + deaths (so a few bad fights don't count). ` +
    `Automatic, from the shared cache.`
  );
}
