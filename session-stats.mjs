/**
 * 🧪 Session stats (build-log.html only; user t294u). Per-player metrics from
 * the Honu session data we already collect quietly:
 *   - player.assists (every cached player, light pass): per session
 *     [assists, kills, seconds, startMs, shareSum, shareN, mult, deaths?]
 *   - data/xp/<slug>.json (requested / compared players): per session counts
 *     of every experience id earned (g) and received (r).
 * Assists are NOT shown on the public pages (user preference): these numbers
 * only feed status.json → build-log.html (🧪 Session stats) and the guard.
 *
 * Rates are normalized per kill / per minute / per death, so a long session
 * doesn't look "bigger". A player is measured once the counted sessions hold
 * ≥ MIN_KILLS kills (≈ an hour of play, same spirit as the 100-fight minimum).
 *
 * "session" 🚩 pattern (report wording stays neutral: a lead, not proof):
 * a very one-sided recent record — very few assists per kill, a headshot-heavy
 * kill mix and a session K/D far beyond the top legit players. Thresholds were
 * set by comparing the 4 confirmed cheaters (data/hidden.json) with the top
 * legit players and the whole measured population (see SESSION_RULE).
 * DOM-free, no network.
 */

export const SESSION_MIN = Object.freeze({
  /** Kills in counted sessions before a player's session metrics count. */
  MIN_KILLS: 100,
  /** A single session counts for max KPM / max K/D only from this long … */
  SESSION_SEC: 600,
  /** … and with at least this many kills. */
  SESSION_KILLS: 20,
});

/** Experience ids (Honu /api/exp/types). */
export const XP = Object.freeze({
  KILL: [1, 278, 279], ASSIST: [2, 3, 371, 372], HEADSHOT: [37], KILL_STREAK: [8], BOUNTY_STREAK: [595],
  STOP_STREAK: [38], DOMINATION: [10], REVENGE: [11], SAVIOR: [335, 592], SAVED: [336],
  SPOT_KILL: [36], PRIORITY: [278, 279], REVIVE: [7, 53],
});

/**
 * Metric catalogue. tier "a" = from the light assists pass (most players),
 * "x" = needs full XP detail (requested players only). Labels for build-log.
 */
export const SESSION_METRICS = Object.freeze([
  { id: "s_apk", tier: "a", label: "Assists / kill", tip: "Kill assists per kill in recent sessions (cheaters rarely share kills)" },
  { id: "s_share", tier: "a", label: "Assist dmg share", tip: "Average damage share of an assist (from assist XP ÷ kill XP)" },
  { id: "s_kpm", tier: "a", label: "Session KPM", tip: "Kills per minute over all counted sessions" },
  { id: "s_maxKpm", tier: "a", label: "Best-session KPM", tip: `Highest KPM of one session (≥ ${SESSION_MIN.SESSION_SEC / 60} min, ≥ ${SESSION_MIN.SESSION_KILLS} kills)` },
  { id: "s_kpmCv", tier: "a", label: "KPM spread (CV)", tip: "Std-dev ÷ mean of per-session KPM (how uneven sessions are)" },
  { id: "s_kd", tier: "x", label: "Session K/D", tip: "Kills ÷ deaths in counted sessions (deaths = kill events on the player)" },
  { id: "s_maxKd", tier: "x", label: "Best-session K/D", tip: "Highest K/D of one session (same minimum as best KPM; deaths floored at 1)" },
  { id: "s_hsk", tier: "x", label: "Headshots / kill", tip: "Headshot XP events per kill" },
  { id: "s_ksk", tier: "x", label: "Kill-streak / kill", tip: "Kill Streak XP events per kill (share of kills made while on a streak)" },
  { id: "s_domk", tier: "x", label: "Domination / kill", tip: "Domination kills per kill" },
  { id: "s_revk", tier: "x", label: "Revenge / kill", tip: "Revenge kills per kill" },
  { id: "s_revDom", tier: "x", label: "Revenge ÷ domination", tip: "Revenge kills per domination kill (low = dominates, rarely needs revenge)" },
  { id: "s_savk", tier: "x", label: "Savior / kill", tip: "Savior kills (saving a teammate) per kill" },
  { id: "s_spotk", tier: "x", label: "Spot kills / kill", tip: "Spot-kill bonus events per kill" },
  { id: "s_prik", tier: "x", label: "Priority / kill", tip: "Priority + high-priority kills per kill (bounty / streak targets)" },
  { id: "s_stopk", tier: "x", label: "Streak stops / kill", tip: "Stop Kill Streak events per kill" },
]);
export const SESSION_METRIC_IDS = Object.freeze(SESSION_METRICS.map((m) => m.id));
export const SESSION_LABELS = Object.freeze(Object.fromEntries(SESSION_METRICS.map((m) => [m.id, "🧪 " + m.label])));

/**
 * 🚩 "session" pattern: ALL must hold (each from recent sessions, ≥ MIN_KILLS):
 *   assists per kill ≤ APK_MAX, headshot share ≥ HS_MIN (headshot XP per kill
 *   when XP detail exists, else Census lifetime HSR), session K/D ≥ KD_MIN
 *   (XP detail / stored session deaths, else Census lifetime KD).
 */
export const SESSION_RULE = Object.freeze({
  APK_MAX: 0.1,
  HS_MIN: 0.5,
  KD_MIN: 7,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const sumIds = (o, ids) => ids.reduce((n, id) => n + ((o && o[String(id)] && +o[String(id)][0]) || 0), 0);
const div = (a, b) => (b > 0 ? a / b : null);

function cv(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (!(mean > 0)) return null;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v) / mean;
}

/** Light assists record → [{ a, k, sec, share, shareN, d|null }] */
function assistSessions(a) {
  return Object.values((a && a.sessions) || {})
    .filter((s) => Array.isArray(s) && s.length >= 4)
    .map((s) => ({ a: +s[0] || 0, k: +s[1] || 0, sec: +s[2] || 0, share: +s[4] || 0, shareN: +s[5] || 0, d: fin(s[7]) ? s[7] : null }));
}

/** Full XP record → [{ a, k, sec, d, g, r }] */
function xpSessions(x) {
  return Object.values((x && x.sessions) || {})
    .filter((s) => s && fin(+s.sec))
    .map((s) => ({ a: sumIds(s.g, XP.ASSIST), k: +s.k || 0, sec: +s.sec || 0, d: fin(s.d) ? s.d : sumIds(s.r, XP.KILL), g: s.g || {}, r: s.r || {} }));
}

/**
 * One player's session metrics. assists = player.assists, xp = data/xp record
 * (either may be null). Returns null when there's no session data at all.
 * { sessions, kills, minutes, source, measured, values: { s_*: number|null } }
 */
export function sessionMetrics({ assists = null, xp = null } = {}, min = SESSION_MIN) {
  const as = assistSessions(assists);
  const xs = xpSessions(xp && xp.source === "honu-exp-all" ? xp : null);
  if (!as.length && !xs.length) return null;
  const aK = as.reduce((n, s) => n + s.k, 0);
  const xK = xs.reduce((n, s) => n + s.k, 0);
  // Base tier from whichever pass counted more kills (they cover the same recent sessions).
  const base = xK > aK ? xs : as;
  const kills = base.reduce((n, s) => n + s.k, 0);
  const secs = base.reduce((n, s) => n + s.sec, 0);
  const asst = base.reduce((n, s) => n + s.a, 0);
  const v = {};
  v.s_apk = div(asst, kills);
  const shareN = as.reduce((n, s) => n + s.shareN, 0);
  v.s_share = base === as && shareN ? as.reduce((n, s) => n + s.share, 0) / shareN : null;
  if (v.s_share == null && xs.length) v.s_share = null; // XP detail keeps counts, not per-assist shares
  v.s_kpm = div(kills, secs / 60);
  const big = base.filter((s) => s.sec >= min.SESSION_SEC && s.k >= min.SESSION_KILLS);
  const kpms = big.map((s) => s.k / (s.sec / 60));
  v.s_maxKpm = kpms.length ? Math.max(...kpms) : null;
  v.s_kpmCv = cv(kpms);
  // Deaths: XP detail (kill events on the player) or stored session deaths.
  // (assists-pass sessions carry deaths since 2026-10-09; older ones don't, so only the known ones count).
  const asD = as.filter((s) => s.d != null);
  const asDK = asD.reduce((n, s) => n + s.k, 0);
  // Whichever source counted more kills; K/D only once that is ≥ MIN_KILLS (one tiny session can't decide it).
  const dSrc = xK >= asDK ? xs : asD;
  const kdKills = dSrc.reduce((n, s) => n + s.k, 0);
  if (kdKills >= min.MIN_KILLS) {
    const k = dSrc.reduce((n, s) => n + s.k, 0);
    const d = dSrc.reduce((n, s) => n + (s.d || 0), 0);
    v.s_kd = k / Math.max(1, d);
    const dBig = dSrc.filter((s) => s.sec >= min.SESSION_SEC && s.k >= min.SESSION_KILLS);
    v.s_maxKd = dBig.length ? Math.max(...dBig.map((s) => s.k / Math.max(1, s.d || 0))) : null;
  } else { v.s_kd = null; v.s_maxKd = null; }
  if (xs.length) {
    const g = {};
    for (const s of xs) for (const [id, c] of Object.entries(s.g)) g[id] = (g[id] || 0) + ((c && +c[0]) || 0);
    const cnt = (ids) => ids.reduce((n, id) => n + (g[String(id)] || 0), 0);
    const k = xK;
    v.s_hsk = div(cnt(XP.HEADSHOT), k);
    v.s_ksk = div(cnt(XP.KILL_STREAK), k);
    v.s_domk = div(cnt(XP.DOMINATION), k);
    v.s_revk = div(cnt(XP.REVENGE), k);
    v.s_revDom = cnt(XP.DOMINATION) ? cnt(XP.REVENGE) / cnt(XP.DOMINATION) : null;
    v.s_savk = div(cnt(XP.SAVIOR), k);
    v.s_spotk = div(cnt(XP.SPOT_KILL), k);
    v.s_prik = div(cnt(XP.PRIORITY), k);
    v.s_stopk = div(cnt(XP.STOP_STREAK), k);
  } else {
    for (const m of SESSION_METRICS) if (m.tier === "x" && !(m.id in v)) v[m.id] = null;
  }
  for (const id of SESSION_METRIC_IDS) if (!fin(v[id])) v[id] = null;
  return {
    sessions: base.length, kills, minutes: Math.round(secs / 60),
    source: xs.length ? (base === xs ? "xp" : "assists+xp") : "assists",
    xpKills: xK, xpSessions: xs.length, kdKills,
    measured: kills >= min.MIN_KILLS,
    values: v,
  };
}

/**
 * The 🚩 "session" pattern for one measured player. census = { hsr (%), kd }
 * (lifetime fallbacks). → { flagged, apk, hs, hsSrc, kd, kdSrc, lowAssists, headshotHeavy, oneSided }
 */
export function sessionFlag(sm, census = {}, rule = SESSION_RULE) {
  const out = { flagged: false, apk: null, hs: null, hsSrc: "", kd: null, kdSrc: "", lowAssists: false, headshotHeavy: false, oneSided: false };
  if (!sm || !sm.measured) return out;
  const v = sm.values;
  out.apk = v.s_apk;
  if (fin(v.s_hsk) && sm.xpKills >= SESSION_MIN.MIN_KILLS) { out.hs = v.s_hsk; out.hsSrc = "session"; }
  else if (fin(census.hsr)) { out.hs = census.hsr / 100; out.hsSrc = "lifetime"; }
  if (fin(v.s_kd)) { out.kd = v.s_kd; out.kdSrc = "session"; }
  else if (fin(census.kd)) { out.kd = census.kd; out.kdSrc = "lifetime"; }
  out.lowAssists = fin(out.apk) && out.apk <= rule.APK_MAX;
  out.headshotHeavy = fin(out.hs) && out.hs >= rule.HS_MIN;
  out.oneSided = fin(out.kd) && out.kd >= rule.KD_MIN;
  out.flagged = out.lowAssists && out.headshotHeavy && out.oneSided;
  return out;
}

export function sessionRuleText(rule = SESSION_RULE, min = SESSION_MIN) {
  return (
    `[session pattern] in recent Honu sessions (≥ ${min.MIN_KILLS} kills counted): assists per kill ≤ ${rule.APK_MAX}, ` +
    `headshot share ≥ ${Math.round(rule.HS_MIN * 100)}% (headshot XP per kill; Census lifetime HSR when no XP detail) and ` +
    `K/D ≥ ${rule.KD_MIN} (session deaths; Census lifetime KD when none). A very one-sided record; a lead for manual review, not proof.`
  );
}

const q = (s, f) => s[Math.floor(f * (s.length - 1))];
/** Distribution of one metric over measured players: { n, p01, p05, median, p95, p99, max, min }. */
export function distribution(values) {
  const s = values.filter(fin).sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  return { n: s.length, min: s[0], p01: q(s, 0.01), p05: q(s, 0.05), median: q(s, 0.5), p95: q(s, 0.95), p99: q(s, 0.99), max: s[s.length - 1] };
}
