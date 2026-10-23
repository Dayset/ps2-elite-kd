import { t as tr, ready as i18nReady } from "./i18n.mjs";
await i18nReady;
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
export const PADDING_RULE = {
  /** Kills on one opponent at/above this… */
  MIN_KILLS: 100,
  /** …with deaths back at/below this share of those kills… */
  MAX_BACK: 0.02,
  /** …and opponent weapon KPM below this = farm victim. */
  MAX_KPM: 0.1,
  /** Farm-victim kills at/above this share of the sample's kills = 🚩 padding. */
  FLAG_SHARE: 0.2,
};
/** PC default farm threshold (kills on one opponent). */
export const PC_FARM_MIN_KILLS = 100;
/**
 * PlayStation room (#55, owner 2026-10-22): console players fight a lot of
 * 1v1 scrims against the same accounts, so a "farm account" there needs
 * 10,000+ kills on it (to be revisited). Set once at load by the PS room
 * (app.js / build-ranks --room ps); PC never calls it.
 */
export const PS_FARM_MIN_KILLS = 10000;
function setFarmMinKillsOne(n) {
  PADDING_RULE.MIN_KILLS = Number.isFinite(+n) && +n > 0 ? +n : PC_FARM_MIN_KILLS;
}

/* ---------- PlayStation scrim rule (owner 2026-10-22) ----------
 * Console players fight long 1v1 scrims on their MAIN accounts, so the PC
 * "farm account" test (opponent KPM < 0.1) misses them and one partner can
 * carry thousands of kills: Hkn1 7,735:0 on one opponent, sample K/D 27 vs
 * ~2.3 in live play. Measured on 1,175 PS and 13,805 PC players:
 *  - PC live play: 99% of single-opponent rows are ≤ 80 kills, and a big
 *    rivalry (40–160 kills) has K/D ≤ 8 at the 95th percentile.
 *  - PS rows of 80+ kills: below 2% deaths back they jump to a median of
 *    340–690 kills (419 rows); from 2% up they are PC-sized (~110–140).
 * Rule, PS only (PC unchanged):
 *  1. 80+ kills on one opponent with ≤ 2% deaths back, whatever its KPM =
 *     one-sided (owner: "if it's 0 deaths in return it's probably padding"):
 *     those kills leave the sample (isFarmVictim).
 *  2. Any other opponent with more than CAP kills = a real scrim: it counts
 *     as CAP kills, deaths scaled the same way, its K/D capped at KD_MAX
 *     (chopScrims). Normal rows (≤ CAP kills) are untouched.
 * Graceful for the community: no automatic "*" padding mark or 🚩 on PS,
 * only the neutral "†" with a scrim note. A human "padding" decision in
 * data-ps/reviewed.json still marks; data-ps/not-farm.json turns a
 * one-sided partner back into a counted (capped) scrim.
 */
export const PS_SCRIM = Object.freeze({ MIN_KILLS: 80, MAX_BACK: 0.02, CAP: 80, KD_MAX: 8 });
const PC_RULE = Object.freeze({ ...PADDING_RULE });
const roomRule = { scrim: false };
function setRoomRuleOne(room) {
  const ps = room === "ps";
  roomRule.scrim = ps;
  PADDING_RULE.MIN_KILLS = ps ? PS_SCRIM.MIN_KILLS : PC_RULE.MIN_KILLS;
  PADDING_RULE.MAX_BACK = ps ? PS_SCRIM.MAX_BACK : PC_RULE.MAX_BACK;
  PADDING_RULE.MAX_KPM = ps ? Infinity : PC_RULE.MAX_KPM;
}
/** True when the PlayStation scrim rule is on (setRoomRule("ps")). */
export function isScrimRoom() {
  return roomRule.scrim;
}

/**
 * Cap long scrims (PS rule 2). → { rows, scrims: [{ name, kills, deaths, countedKills, countedDeaths }] }
 * Rows at or under CAP kills are returned as the same objects.
 */
export function chopScrims(rows, rule = PS_SCRIM) {
  const out = [];
  const scrims = [];
  for (const r of rows || []) {
    const k = +r.kills || 0;
    if (k <= rule.CAP) {
      out.push(r);
      continue;
    }
    const d = +r.deaths || 0;
    const ck = rule.CAP;
    const cd = Math.max(d * (ck / k), ck / rule.KD_MAX);
    out.push({ ...r, kills: ck, deaths: cd });
    scrims.push({ name: r.name, kills: k, deaths: d, countedKills: ck, countedDeaths: Math.round(cd * 10) / 10 });
  }
  scrims.sort((a, b) => b.kills - a.kills);
  return { rows: out, scrims };
}

/* ---------- not-farm allowlist (user t297u, 2026-10-09) ----------
 * data/not-farm.json: accounts a human confirmed are real players ("Dziey looks
 * like a real player, with an attempt to be alive and at least shoot someone").
 * isFarmVictim() never matches them, so every caller of this shared helper
 * (graph, metrics, marks, ranks.json, build-log, misc.html) counts kills on
 * them again. Loaded once at import (browser: fetch next to this module; Node:
 * fs), or set explicitly with setNotFarm() (tests). Missing file = empty list.
 */
const notFarm = { names: new Set(), cids: new Set() };

/** Bare lowercase name: outfit tag "[TAG] " stripped. */
export function bareFarmKey(name) {
  return String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
}

/** Replace the allowlist from not-farm.json content ({ players: { name: { cid } } }); null clears it. */
function setNotFarmOne(json) {
  notFarm.names = new Set();
  notFarm.cids = new Set();
  const players = (json && json.players) || {};
  for (const [key, e] of Object.entries(players)) {
    const k = bareFarmKey(key);
    if (k) notFarm.names.add(k);
    if (e && e.display) notFarm.names.add(bareFarmKey(e.display));
    if (e && e.cid) notFarm.cids.add(String(e.cid));
  }
}

/** True when a human confirmed this opponent row is a real player (data/not-farm.json). */
export function isNotFarm(r) {
  if (!r) return false;
  if (r.cid && notFarm.cids.has(String(r.cid))) return true;
  const k = bareFarmKey(r.name);
  return !!k && notFarm.names.has(k);
}

/* The three review files load in parallel (2026-10-19): index.html starts them with
 * the page (window.__ps2Early); otherwise all three requests go out at once here.
 * They used to be three top-level awaits in a row, holding up app.js start. */
const jsonEarly = (k, rel) => (typeof window !== "undefined" && typeof fetch === "function")
  ? ((window.__ps2Early && window.__ps2Early[k]) || fetch(new URL(rel, import.meta.url).href, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  : null;
const P_NOT_FARM = jsonEarly("notFarm", "./data/not-farm.json");
const P_FARM = jsonEarly("farm", "./data/farm.json");
const P_REVIEWED = jsonEarly("reviewed", "./data/reviewed.json");

try {
  if (P_NOT_FARM) {
    const d = await P_NOT_FARM;
    if (d) setNotFarmOne(d);
  } else {
    const fs = await import("node:fs");
    setNotFarmOne(JSON.parse(fs.readFileSync(new URL("./data/not-farm.json", import.meta.url), "utf8")));
  }
} catch {
  /* no allowlist → nobody exempt */
}

/* ---------- confirmed farm list (user t322u, 2026-10-10) ----------
 * data/farm.json: accounts a human confirmed are bots / farm accounts ("KKLKK is
 * a bot"). The inverse of not-farm.json: isFarmVictim() always matches them,
 * whatever MIN_KILLS / MAX_BACK / MAX_KPM say, so kills on them are excluded for
 * every caller. not-farm.json still wins if an account is on both lists.
 * Missing file = empty list.
 */
const farmList = { names: new Set(), cids: new Set(), entries: [] };

/** Replace the confirmed farm list from farm.json content; null clears it. */
function setFarmListOne(json) {
  farmList.names = new Set();
  farmList.cids = new Set();
  farmList.entries = [];
  const players = (json && json.players) || {};
  for (const [key, e] of Object.entries(players)) {
    const k = bareFarmKey(key);
    if (k) farmList.names.add(k);
    if (e && e.display) farmList.names.add(bareFarmKey(e.display));
    if (e && e.cid) farmList.cids.add(String(e.cid));
    farmList.entries.push({ key: k, cid: e && e.cid ? String(e.cid) : "", display: (e && e.display) || key, reason: String((e && e.reason) || ""), at: String((e && e.at) || "") });
  }
}

/** The confirmed farm list entry for a row / player ({ name|display, cid }), or null. */
export function farmListEntry(r) {
  if (!r) return null;
  const cid = r.cid ? String(r.cid) : "";
  const k = bareFarmKey(r.name || r.display);
  if (!(cid && farmList.cids.has(cid)) && !(k && farmList.names.has(k))) return null;
  return farmList.entries.find((e) => (cid && e.cid === cid) || (k && (e.key === k || bareFarmKey(e.display) === k))) || { key: k, cid, display: r.name || r.display || k, reason: "", at: "" };
}

/** True when a human confirmed this account is a bot / farm account (data/farm.json). */
export function isFarmListed(r) {
  return !!farmListEntry(r);
}

try {
  if (P_FARM) {
    const d = await P_FARM;
    if (d) setFarmListOne(d);
  } else {
    const fs = await import("node:fs");
    setFarmListOne(JSON.parse(fs.readFileSync(new URL("./data/farm.json", import.meta.url), "utf8")));
  }
} catch {
  /* no farm list → automatic rule only */
}

/** True when one opponent row is a farm victim (never for allowlisted real players; always for data/farm.json accounts). */
export function isFarmVictim(r, rule = PADDING_RULE) {
  if (isNotFarm(r)) return false;
  if (isFarmListed(r)) return true;
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
  if (roomRule.scrim) return scrimNote(farm);
  if (!farm || !farm.victims || !farm.victims.length) return "";
  const n = farm.victims.length;
  const list = farm.victims.map((v) => `${v.name} ${v.kills}/${v.deaths}`).join(", ");
  const accounts = n === 1 ? tr("pad.acc1", "1 farm account") : tr("pad.accN", "{n} farm accounts", { n });
  return tr("pad.farmNote", "{kills} kills on {accounts} excluded ({pct}% of the sample; kills/deaths: {list}). Farm account = {min}+ kills on it, it killed back ≤ {back}%, its KPM < {kpm}.", {
    kills: farm.kills, accounts, pct: Math.round(farm.share * 100), list, min: PADDING_RULE.MIN_KILLS, back: PADDING_RULE.MAX_BACK * 100, kpm: PADDING_RULE.MAX_KPM,
  });
}

/** PS room note: one-sided partners not counted, long scrims capped ("" when neither). */
export function scrimNote(farm) {
  const v = (farm && farm.victims) || [];
  // Only scrims whose K/D was actually cut are named; a big rivalry that just
  // lost weight (K/D kept) is not an adjustment worth a mark.
  const sc = ((farm && farm.scrims) || []).filter((x) => x.kills > PS_SCRIM.KD_MAX * Math.max(x.deaths, 1) * 1.0001 || x.deaths === 0);
  const parts = [];
  if (v.length) {
    parts.push(tr("pad.psOneSided", "One-sided scrims not counted: {list} ({pct}% of the sample's kills).", {
      list: v.map((x) => `${x.name} ${x.kills}/${x.deaths}`).join(", "), pct: Math.round((farm.share || 0) * 100),
    }));
  }
  if (sc.length) {
    parts.push(tr("pad.psCapped", "Long scrims counted as {cap} kills each: {list}.", {
      cap: PS_SCRIM.CAP, list: sc.map((x) => `${x.name} ${x.kills}/${x.deaths}`).join(", "),
    }));
  }
  if (!parts.length) return "";
  parts.push(tr("pad.psRule", "Scrims capped: {min}+ kills on one player with ≤ {back}% back are left out; other long scrims count as up to {cap} kills at K/D ≤ {kd}.", {
    min: PS_SCRIM.MIN_KILLS, back: PS_SCRIM.MAX_BACK * 100, cap: PS_SCRIM.CAP, kd: PS_SCRIM.KD_MAX,
  }));
  return parts.join(" ");
}

/* ---------- marks for altered stats (user rule 2026-10-09) ----------
 * "If you alter the stats mark it and flag it, a human will review and decide
 * if it's fluke or just bad luck." Every player whose sample had an automatic
 * exclusion gets a public mark and a 🚩 review flag on build-log.html:
 *   *  stat padding: farm accounts ≥ FLAG_SHARE of the sample's kills
 *   †  stats adjusted: some farm-account kills excluded (under review)
 */
export const PADDING_MARK = "*";
export const PADDING_MARK_TIP = tr("pad.markTip", "* stat padding: kills on farm accounts excluded");
export const ADJUSTED_MARK = "†";
export const ADJUSTED_MARK_TIP = tr("pad.adjustedTip", "† stats adjusted: some kills on farm accounts excluded (under review)");

/** Tooltip for a confirmed padder (reviewed.json "padding"): farm accounts by name, no share or counts. */
export const CONFIRMED_PADDING_TIP = tr("pad.confirmedTip", "* stat padding (confirmed on review): kills on farm accounts excluded");
export function confirmedFarmNote(farm) {
  const names = ((farm && farm.victims) || []).map((v) => String(v.name || v.cid || "").trim()).filter(Boolean);
  return names.length ? tr("pad.farmList", "Farm accounts: {list}.", { list: names.join(", ") }) : "";
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
    return { kind: "padding", mark: PADDING_MARK, legend: PADDING_MARK_TIP, tip: note ? tr("pad.confirmedNote", "{tip}. {note}", { tip: CONFIRMED_PADDING_TIP, note }) : tr("pad.confirmedOnly", "{tip}.", { tip: CONFIRMED_PADDING_TIP }) };
  }
  if (roomRule.scrim) {
    // PS room: never an automatic "*" padding mark, only the neutral "†".
    const note = scrimNote(farm);
    if (!note) return { kind: "", mark: "", legend: "", tip: "" };
    const legend = tr("pad.psLegend", "† scrim-adjusted: one-sided scrims left out, long scrims capped");
    return { kind: "adjusted", mark: ADJUSTED_MARK, legend, tip: `${legend}. ${note}` };
  }
  const has = !!(farm && farm.victims && farm.victims.length);
  if (!has) return { kind: "", mark: "", legend: "", tip: "" };
  const padding = (farm.share || 0) >= rule.FLAG_SHARE;
  if (padding) {
    return { kind: "padding", mark: PADDING_MARK, legend: PADDING_MARK_TIP, tip: tr("pad.paddingNote", "{tip}. {note}", { tip: PADDING_MARK_TIP, note: farmNote(farm) }) };
  }
  const tip = tr("pad.adjustedNote", "† stats adjusted: {kills} kills on farm accounts excluded (under review). {note}", { kills: farm.kills, note: farmNote(farm) });
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
export const REVIEW_DECISIONS = Object.freeze(["fluke", "bad-luck", "padding", "cleared", "not-stalker"]);
/** Decisions that clear an automatic 🌾 padding verdict on build-log (t368u: human overrides win). */
export const CLEARING_DECISIONS = Object.freeze(["fluke", "bad-luck", "cleared"]);
/** 🌾 padding auto-confirmed (t368u); farm share below this = borderline "needs a look". */
export const PADDING_BORDERLINE_SHARE = 0.25;
/** † adjusted auto-accepted (t375u); farm share at or above this (up to FLAG_SHARE) = borderline "needs a look". */
export const ADJUSTED_BORDERLINE_SHARE = 0.15;

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

/* ---------- 💩 confirmed-padder penalty (user t431u follow-up, 2026-10-19) ----------
 * Every confirmed stat padder (data/reviewed.json decision "padding") gets a 💩
 * after the name everywhere it shows, and −10% on ⚔️ adjusted iVi (on top of the
 * farm-kill removal and the "*" mark). Applied inside playerMetrics(), so the
 * main tables, Rankings, ranks.json (rebuilt on every refresh), 🏅 positions,
 * 📊 chart and 🎥 Live all get the same number.
 * Score at or below zero (JinpingX, −12): −10% would move it UP, so it gets a
 * fixed drop of PADDER_PENALTY × PADDER_PENALTY_REF instead (−61 iVi).
 * PADDER_PENALTY_REF = median positive adjusted iVi of the board on 2026-10-19
 * (610.6 over 9,742 players), frozen so the drop never depends on the board.
 * Owner override (human wins): in data/reviewed.json either set the decision
 * to "cleared" (removes "*" confirmed status, 💩 and the penalty), or keep
 * "padding" and add "penalty": "cleared" (keeps "*", removes 💩 and the penalty).
 */
export const PADDER_PENALTY = 0.1;
export const PADDER_PENALTY_REF = 610.6;
export const POOP_MARK = "💩";
export const POOP_TIP = tr("pad.poop", "💩 Confirmed stat padding: −10% on adjusted iVi. Think it's wrong? Contact the site owner.");

const reviewedState = { players: {} };
/** Replace the review decisions used for the 💩 penalty (reviewed.json content; null clears). */
function setReviewedOne(json) {
  reviewedState.players = (json && json.players) || {};
}
const penKey = (s) => String(s || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
/** True when this slug / display name is a confirmed padder whose 💩 penalty is not overridden. */
export function isPenalizedPadder(nameOrSlug) {
  const e = reviewedState.players[penKey(nameOrSlug)];
  return !!e && e.decision === "padding" && e.penalty !== "cleared" && e.penalty !== false;
}
/** Adjusted iVi after the 💩 penalty (non-finite values pass through). */
export function padderPenalty(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return v;
  return v > 0 ? v * (1 - PADDER_PENALTY) : v - PADDER_PENALTY * PADDER_PENALTY_REF;
}

try {
  if (P_REVIEWED) {
    const d = await P_REVIEWED;
    if (d) setReviewedOne(d);
  } else {
    const fs = await import("node:fs");
    setReviewedOne(JSON.parse(fs.readFileSync(new URL("./data/reviewed.json", import.meta.url), "utf8")));
  }
} catch {
  /* no reviewed.json → nobody penalized */
}

/*
 * One module file can load as several instances (Node treats "?v=" import
 * specifiers as distinct modules), so the setters reach every loaded copy:
 * a room override (#55, PS review lists / farm threshold) must hold for all
 * of them, not just the copy the caller imported.
 */
const ps2PaddingCopies = (globalThis.__ps2PaddingCopies ||= []);
ps2PaddingCopies.push({ setRoomRule: setRoomRuleOne, setFarmMinKills: setFarmMinKillsOne, setNotFarm: setNotFarmOne, setFarmList: setFarmListOne, setReviewed: setReviewedOne });
/** Room padding rule: "ps" = scrim rule (see PS_SCRIM), anything else = PC. Reaches every loaded copy. */
export function setRoomRule(v) { for (const i of ps2PaddingCopies) i.setRoomRule && i.setRoomRule(v); }
export function setFarmMinKills(v) { for (const i of ps2PaddingCopies) i.setFarmMinKills(v); }
export function setNotFarm(v) { for (const i of ps2PaddingCopies) i.setNotFarm(v); }
export function setFarmList(v) { for (const i of ps2PaddingCopies) i.setFarmList(v); }
export function setReviewed(v) { for (const i of ps2PaddingCopies) i.setReviewed(v); }
