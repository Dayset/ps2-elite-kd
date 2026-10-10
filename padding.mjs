/**
 * Farm-victim filter (user-approved 2026-10-09: "Flag them and remove farm
 * victims from their stats").
 *
 * A farm victim is an opponent row where the player has ≥ MIN_KILLS kills on
 * them, they killed the player back at most MAX_BACK of that, and their own
 * weapon KPM is below MAX_KPM: an account that never fights back (bot / alt).
 * Their kills and deaths are taken out of the opponent sample for EVERY player
 * (graph lines and all opponent-based metrics). A player is flagged 🚩
 * "padding" (red-flags.mjs) when farm victims are ≥ FLAG_SHARE of the
 * sample's kills. Found on [LHEU] Megatake: 86% of 8944 kills on vulcan112,
 * battletank112 and hammer111 (0 deaths back, KPM 0.00); sample K/D 7.52 → 1.03.
 * DOM-free (browser + Node).
 */
export const PADDING_RULE = Object.freeze({
  /** Kills on one opponent at/above this… */
  MIN_KILLS: 100,
  /** …with deaths back at/below this share of those kills… */
  MAX_BACK: 0.02,
  /** …and opponent weapon KPM below this = farm victim. */
  MAX_KPM: 0.1,
  /** Farm-victim kills at/above this share of the sample's kills = 🚩 padding. */
  FLAG_SHARE: 0.2,
});

/** True when one opponent row is a farm victim. */
export function isFarmVictim(r, rule = PADDING_RULE) {
  const k = +r.kills || 0;
  const d = +r.deaths || 0;
  const kpm = +r.kpm || 0;
  return k >= rule.MIN_KILLS && d <= rule.MAX_BACK * k && kpm < rule.MAX_KPM;
}

/**
 * Split opponent rows into kept rows and farm victims.
 * → { kept, victims: [{ name, kills, deaths, kpm }], kills, deaths, totalKills, share }
 * share = farm kills / all sample kills (before exclusion).
 */
export function splitFarm(rows, rule = PADDING_RULE) {
  const kept = [];
  const victims = [];
  let totalKills = 0;
  let kills = 0;
  let deaths = 0;
  for (const r of rows || []) {
    const k = +r.kills || 0;
    totalKills += k;
    if (isFarmVictim(r, rule)) {
      victims.push({ name: r.name, kills: k, deaths: +r.deaths || 0, kpm: +r.kpm || 0 });
      kills += k;
      deaths += +r.deaths || 0;
    } else kept.push(r);
  }
  victims.sort((a, b) => b.kills - a.kills);
  return { kept, victims, kills, deaths, totalKills, share: totalKills ? kills / totalKills : 0 };
}

/** Short human text for a tooltip ("" when nothing was excluded). */
export function farmNote(farm) {
  if (!farm || !farm.victims || !farm.victims.length) return "";
  const n = farm.victims.length;
  const list = farm.victims.map((v) => `${v.name} ${v.kills}/${v.deaths}`).join(", ");
  return (
    `${farm.kills} kills on ${n} farm account${n === 1 ? "" : "s"} excluded ` +
    `(${Math.round(farm.share * 100)}% of the sample; kills/deaths: ${list}). ` +
    `Farm account = ${PADDING_RULE.MIN_KILLS}+ kills on it, it killed back ≤ ${PADDING_RULE.MAX_BACK * 100}%, its KPM < ${PADDING_RULE.MAX_KPM}.`
  );
}

/* ---------- marks for altered stats (user rule 2026-10-09) ----------
 * "If you alter the stats mark it and flag it, a human will review and decide
 * if it's fluke or just bad luck." Every player whose sample had an automatic
 * exclusion gets a public mark and a 🚩 review flag on build-log.html:
 *   *  stat padding: farm accounts ≥ FLAG_SHARE of the sample's kills
 *   †  stats adjusted: some farm-account kills excluded (under review)
 */
export const PADDING_MARK = "*";
export const PADDING_MARK_TIP = "* stat padding: kills on farm accounts excluded";
export const ADJUSTED_MARK = "†";
export const ADJUSTED_MARK_TIP = "† stats adjusted: some kills on farm accounts excluded (under review)";

/** Tooltip for a confirmed padder (reviewed.json "padding"): farm accounts by name, no share or counts. */
export const CONFIRMED_PADDING_TIP = "* stat padding (confirmed on review): kills on farm accounts excluded";
export function confirmedFarmNote(farm) {
  const names = ((farm && farm.victims) || []).map((v) => String(v.name || v.cid || "").trim()).filter(Boolean);
  return names.length ? `Farm accounts: ${names.join(", ")}.` : "";
}

/**
 * Mark for a player's farm split ({ victims, kills, share }).
 * → { kind: "padding" | "adjusted" | "", mark, legend, tip }
 * opts.confirmed (user t295u follow-up): a human confirmed this player as a stat
 * padder (data/reviewed.json decision "padding") → always "*", whatever the
 * current farm share (bigger samples dilute it). Others keep the FLAG_SHARE rule.
 * Add future automatic exclusions here so they get marked + flagged too.
 */
export function statMark(farm, rule = PADDING_RULE, { confirmed = false } = {}) {
  if (confirmed) {
    const note = confirmedFarmNote(farm);
    return { kind: "padding", mark: PADDING_MARK, legend: PADDING_MARK_TIP, tip: CONFIRMED_PADDING_TIP + "." + (note ? " " + note : "") };
  }
  const has = !!(farm && farm.victims && farm.victims.length);
  if (!has) return { kind: "", mark: "", legend: "", tip: "" };
  const padding = (farm.share || 0) >= rule.FLAG_SHARE;
  if (padding) {
    return { kind: "padding", mark: PADDING_MARK, legend: PADDING_MARK_TIP, tip: `${PADDING_MARK_TIP}. ${farmNote(farm)}` };
  }
  const tip =
    `${ADJUSTED_MARK} stats adjusted: ${farm.kills} kills on farm accounts excluded (under review). ` + farmNote(farm);
  return { kind: "adjusted", mark: ADJUSTED_MARK, legend: ADJUSTED_MARK_TIP, tip };
}

/** Note shown with a name: confirmed padders get farm-account names only (no share / counts). */
export function markNote(farm, { confirmed = false } = {}) {
  return confirmed ? confirmedFarmNote(farm) : farmNote(farm);
}

/**
 * Human review decisions (data/reviewed.json → { players: { slug: { decision, note, at } } }).
 * decision: "fluke" | "bad-luck" | "padding". Recorded by hand; shown on
 * build-log.html next to the review flag. The automatic mark stays either way
 * (the numbers are still adjusted).
 */
export const REVIEW_DECISIONS = Object.freeze(["fluke", "bad-luck", "padding"]);

export function reviewDecision(reviewed, slug) {
  const e = reviewed && reviewed.players && reviewed.players[slug];
  if (!e || !REVIEW_DECISIONS.includes(e.decision)) return null;
  return { decision: e.decision, note: String(e.note || ""), at: e.at || null };
}

/**
 * Confirmed stat padders (user t295u, 2026-10-09: "all the statpadders are
 * confirmed, make a separate wall of shame"): slugs whose human review
 * decision in data/reviewed.json is "padding". Drives the hidden list page
 * (misc.html), so any future "padding" decision shows up there automatically.
 * → [{ slug, note, at }] sorted by slug.
 */
export function confirmedPadders(reviewed) {
  const players = (reviewed && reviewed.players) || {};
  return Object.keys(players)
    .map((slug) => ({ slug, r: reviewDecision(reviewed, slug) }))
    .filter((x) => x.r && x.r.decision === "padding")
    .map((x) => ({ slug: x.slug, note: x.r.note, at: x.r.at }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Farm accounts for display: name, or the character ID when it has no name (no kill/death counts). */
export function farmAccountLabels(farm) {
  return ((farm && farm.victims) || []).map((v) => String(v.name || v.cid || "").trim()).filter(Boolean);
}

/** Set of slugs confirmed as stat padders (reviewed.json decision "padding"). */
export function confirmedPadderSlugs(reviewed) {
  return new Set(confirmedPadders(reviewed).map((x) => x.slug));
}
