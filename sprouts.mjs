/**
 * 🌱 "Could use a hand" list for build-log.html (hidden page): players whose
 * fights are going rough right now — the opposite end from the 🚩 red-flag
 * bin, and kept separate from it. Could be new, playing support / medic /
 * engi, or just learning. Shown so veterans can spot who might appreciate
 * tips or a squad invite; never a ranking to mock anyone with.
 *
 * Rule (automatic): raw ⚔️ iVi (adjs, BEFORE the clamp-to-0 used for display)
 * ≤ 0, and an opponent sample big enough to mean something (≥ 300 kills+deaths).
 */
export const SPROUT_RULE = Object.freeze({
  /** Raw ⚔️ iVi (adjs) at/below this. */
  MAX_ADJS: 0,
  /** Minimum kills + deaths across the sampled top opponents (50 in older files, 200 now). */
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
 * Apply the rule. m = playerMetrics row (needs adjs); events = sample
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
    `and the top-opponent sample has at least ${rule.MIN_EVENTS} kills + deaths (so a few bad fights don't count). ` +
    `Automatic, from the shared cache.`
  );
}

/* ---------- 🤖 Likely farm accounts (user t296u, 2026-10-09) ----------
 * "What if someone from the needing-a-hand list is just a bot account for
 * another player?" The mirror image of the padding rule (padding.mjs): an
 * account whose deaths mostly go to one or a few killers it never kills back,
 * and which barely fights itself. Such a 🌱 is not a struggling player, so it
 * moves to a separate 🤖 sub-list on build-log.html (hidden page), linked to
 * the player(s) it feeds, and is not counted as a sprout.
 *
 * Checked 2026-10-09 against all ~1,500 cached players: nobody matches (the
 * highest one-killer death share is 23%, among sprouts 10%), so the rule is a
 * guard for future discovery, set to the low-false-positive side. Known farm
 * accounts (vulcan112, battletank112, hammer111, Donk666, LLL444…) show ≥ 95%
 * of their sampled deaths to one farmer with 0 kills back and KPM ≈ 0.
 */
export const FARM_ACCOUNT_RULE = Object.freeze({
  /** A "feeder" row: the account died to this killer at least this often… */
  MIN_DEATHS: 100,
  /** …and killed them back at most this share of those deaths. */
  MAX_BACK: 0.02,
  /** Feeder deaths ≥ this share of all sampled deaths (unknown killer "0" left out). */
  MIN_SHARE: 0.5,
  /** And the account's own KPM below this (same line as a padding farm victim). */
  MAX_OWN_KPM: 0.1,
});

/** Opponent rows the rule reads: the nameless "0" row (unknown / environment killer) doesn't count. */
const realRow = (r) => r && String(r.name ?? "").trim() !== "" && String(r.name).trim() !== "0";

/**
 * rows = the account's top-opponent rows ({ name, kills, deaths }) before any
 * farm exclusion; ownKpm = its own kills per minute.
 * → { farm, share, deaths, feeders: [{ name, kills, deaths }], ownKpm }
 * feeders sorted by deaths (first = main player it feeds).
 */
export function farmAccount(rows, ownKpm, rule = FARM_ACCOUNT_RULE) {
  let total = 0;
  let fed = 0;
  const feeders = [];
  for (const r of rows || []) {
    if (!realRow(r)) continue;
    const d = +r.deaths || 0;
    const k = +r.kills || 0;
    total += d;
    if (d >= rule.MIN_DEATHS && k <= rule.MAX_BACK * d) {
      feeders.push({ name: String(r.name), kills: k, deaths: d });
      fed += d;
    }
  }
  feeders.sort((a, b) => b.deaths - a.deaths);
  const share = total ? fed / total : 0;
  const kpm = fin(ownKpm) ? ownKpm : NaN;
  const farm = feeders.length > 0 && share >= rule.MIN_SHARE && fin(kpm) && kpm < rule.MAX_OWN_KPM;
  return { farm, share, deaths: fed, feeders, ownKpm: fin(kpm) ? kpm : null };
}

/** Human-readable 🤖 rule text (build-log.html). */
export function farmAccountRuleText(rule = FARM_ACCOUNT_RULE) {
  return (
    `Moved out of 🌱 when at least ${Math.round(rule.MIN_SHARE * 100)}% of the sampled deaths go to killers it died to ` +
    `${rule.MIN_DEATHS}+ times and killed back at most ${rule.MAX_BACK * 100}% of that, and its own KPM is below ${rule.MAX_OWN_KPM}. ` +
    `That looks like an account parked for someone else to farm, not a player who needs a hand. Leads for review, not proof.`
  );
}
