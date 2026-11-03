/**
 * Full Honu XP detail for REQUESTED players only (analyzed on the site, or
 * added on demand). Background refreshes keep the light assists-only pass.
 *
 * Documented Honu API, per finished session not yet counted (newest first,
 * capped per player per run), in <= 24 h windows (Honu's limit):
 *   GET /api/exp/{id}/period2?start&end&includeCharacters=false&includeExpTypes=false
 *       -> events the player EARNED (sourceID = player), all experience IDs
 *   GET /api/exp/characters/other?charIDs={id}&start&end&...
 *       -> events where the player is the TARGET (otherID = player), e.g. kills
 *          on them, heals/revives/resupplies they received, "Saved"
 * Only COUNTS and XP SUMS per experience ID are stored (no raw events), in
 * data/xp/<slug>.json (not loaded by the site). Names: /api/exp/types, cached
 * in data/exp-types.json and refreshed rarely.
 */

const HONU_API = "https://wt.honu.pw/api/";

/* ---- ⏱ time to fight, from the SAME exp blocks (no extra Honu calls) ----
 * The LIVE page's "combat" number (live-model.mjs timeToCombatMs): for every
 * death, the time to the player's next kill or assist; median over all such
 * runs. Inputs, all timestamped exp events already fetched above:
 *   deaths  = received kill XP (otherID = player, another source): the killer's
 *             FIGHT_KILL_EXP_IDS event. Same set as live's Death events except
 *             team kills / suicides (no XP). Revived deaths count, as on LIVE
 *             (Honu's session "deaths" leaves revived ones out — that is why a
 *             session can show 12 deaths but ~100 runs).
 *   spikes  = earned kill XP (same ids) + assist XP (2, 3, 371, 372, as live).
 * Stored as a histogram of whole seconds so the sample can grow forever in a
 * few hundred bytes; the median is read back from it.                     */
export const FIGHT_KILL_EXP_IDS = new Set([1, 29, 278, 279]); // Kill Player, MAX, Priority, High Priority
export const FIGHT_ASSIST_EXP_IDS = new Set([2, 3, 371, 372]);
/** Below this many runs the page keeps its neutral default. */
export const FIGHT_MIN_RUNS = 20;

/** Collect death / spike times (ms) of `cid` from one exp block into `acc`. */
export function fightTimesFromBlock(block, cid, mode, acc = { deaths: [], spikes: [] }) {
  const id = String(cid);
  for (const e of (block && Array.isArray(block.events) ? block.events : [])) {
    if (!e) continue;
    const x = +e.experienceID, t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) continue;
    const src = String(e.sourceID);
    if (mode === "g" && src === id && (FIGHT_KILL_EXP_IDS.has(x) || FIGHT_ASSIST_EXP_IDS.has(x))) acc.spikes.push(t);
    if (mode === "r" && String(e.otherID) === id && src !== id && FIGHT_KILL_EXP_IDS.has(x)) acc.deaths.push(t);
  }
  return acc;
}

/** live-model.mjs combatRuns, same logic; deaths < 1 s apart count once (one death = one event, as on LIVE). */
export function fightRuns(deaths, spikes) {
  const sp = [...spikes].sort((a, b) => a - b);
  const ds = [];
  for (const t of [...deaths].sort((a, b) => a - b)) if (!ds.length || t - ds[ds.length - 1] >= 1000) ds.push(t);
  const runs = [];
  let j = 0;
  for (const d of ds) {
    while (j < sp.length && sp[j] <= d) j++;
    if (j < sp.length) runs.push(sp[j] - d);
  }
  return runs;
}

/** Add runs (ms) into a { n, h: {sec: count} } histogram. */
export function addFightRuns(hist, runs) {
  const out = { n: (hist && hist.n) || 0, h: { ...((hist && hist.h) || {}) } };
  for (const ms of runs || []) {
    if (!(ms >= 0)) continue;
    const k = String(Math.round(ms / 1000));
    out.h[k] = (out.h[k] || 0) + 1;
    out.n++;
  }
  return out;
}

/** Median (ms) of a histogram, same convention as live-model.mjs median (upper middle for even n). */
export function fightMedianMs(hist) {
  if (!hist || !(hist.n > 0)) return null;
  const keys = Object.keys(hist.h).map(Number).sort((a, b) => a - b);
  const want = Math.floor(hist.n / 2);
  let seen = 0;
  for (const k of keys) { seen += hist.h[k]; if (seen > want) return k * 1000; }
  return keys[keys.length - 1] * 1000;
}
const DAY_MS = 24 * 3600 * 1000;

export const XP_NEW_SESSIONS_PER_PLAYER = 3;
export const XP_DETAIL_SESSIONS_KEPT = 50;
export const XP_COUNTED_IDS_KEPT = 3000;
export const EXP_TYPES_MAX_AGE_MS = 30 * DAY_MS;

/** <= 24 h windows covering [start, end]. */
export function xpWindows(startIso, endIso) {
  const out = [];
  const end = Date.parse(endIso);
  for (let t = Date.parse(startIso); t < end; t += DAY_MS) {
    out.push([new Date(t).toISOString(), new Date(Math.min(t + DAY_MS, end)).toISOString()]);
  }
  return out;
}

/**
 * { expId: [count, xpSum] } for events earned (mode "g": sourceID = cid) or
 * received (mode "r": otherID = cid and not self-sourced).
 */
export function aggregateXp(block, cid, mode, into = {}) {
  const id = String(cid);
  for (const e of (block && Array.isArray(block.events) ? block.events : [])) {
    if (!e || e.experienceID == null) continue;
    const src = String(e.sourceID);
    const ok = mode === "g" ? src === id : String(e.otherID) === id && src !== id;
    if (!ok) continue;
    const k = String(e.experienceID);
    const cur = into[k] || (into[k] = [0, 0]);
    cur[0] += 1;
    cur[1] += Number.isFinite(+e.amount) ? +e.amount : 0;
  }
  return into;
}

function addInto(dst, src) {
  for (const [k, [n, xp]] of Object.entries(src || {})) {
    const cur = dst[k] || (dst[k] = [0, 0]);
    cur[0] += n;
    cur[1] += xp;
  }
  return dst;
}

/** Finished, kill-ful sessions not counted yet, newest first, capped. */
export function pickXpSessions(sessions, countedIds, cap = XP_NEW_SESSIONS_PER_PLAYER) {
  const have = new Set((countedIds || []).map(String));
  return (Array.isArray(sessions) ? sessions : [])
    .filter((x) => x && x.id != null && x.end && x.kills > 0 && !have.has(String(x.id))
      && Number.isFinite(Date.parse(x.start)) && Date.parse(x.end) > Date.parse(x.start))
    .sort((p, q) => Date.parse(q.start) - Date.parse(p.start))
    .slice(0, cap);
}

/**
 * Merge newly collected sessions. Totals are running sums over every counted
 * session (never pruned); per-session detail keeps the newest `keep`.
 */
export function mergeXp(prev, collected, { keep = XP_DETAIL_SESSIONS_KEPT, keepIds = XP_COUNTED_IDS_KEPT, now = Date.now() } = {}) {
  const p = prev && prev.source === "honu-exp-all" ? prev : null;
  const out = {
    source: "honu-exp-all",
    updatedAt: new Date(now).toISOString(),
    sessions_counted: (p && p.sessions_counted) || 0,
    seconds_counted: (p && p.seconds_counted) || 0,
    kills_counted: (p && p.kills_counted) || 0,
    first: (p && p.first) || null,
    last: (p && p.last) || null,
    totals: { g: addInto({}, p && p.totals && p.totals.g), r: addInto({}, p && p.totals && p.totals.r) },
    counted: [...((p && p.counted) || [])],
    fight: { n: (p && p.fight && p.fight.n) || 0, h: { ...((p && p.fight && p.fight.h) || {}) }, sessions: (p && p.fight && p.fight.sessions) || 0 },
    sessions: { ...((p && p.sessions) || {}) },
  };
  for (const c of collected || []) {
    const sid = String(c.id);
    if (out.counted.includes(sid)) continue;
    out.counted.unshift(sid);
    out.sessions_counted++;
    out.seconds_counted += c.sec;
    out.kills_counted += c.k;
    addInto(out.totals.g, c.g);
    addInto(out.totals.r, c.r);
    if (Array.isArray(c.runs)) { const f = addFightRuns(out.fight, c.runs); out.fight.n = f.n; out.fight.h = f.h; out.fight.sessions++; }
    const s0 = new Date(c.s).toISOString();
    const s1 = new Date(c.s + c.sec * 1000).toISOString();
    if (!out.first || s0 < out.first) out.first = s0;
    if (!out.last || s1 > out.last) out.last = s1;
    out.sessions[sid] = { s: c.s, sec: c.sec, k: c.k, ...(Number.isFinite(c.d) ? { d: c.d } : {}), g: c.g, r: c.r };
  }
  out.fight.ms = fightMedianMs(out.fight);
  if (!out.fight.n) delete out.fight;
  const ids = Object.keys(out.sessions).sort((a, b) => out.sessions[b].s - out.sessions[a].s);
  for (const id of ids.slice(keep)) delete out.sessions[id];
  out.counted = out.counted.slice(0, keepIds);
  return out;
}

/**
 * One pass for one requested player. `budget.calls` (shared across players)
 * bounds Honu calls per run; a session is only started if its calls fit.
 * Never throws: returns { xp: prev-or-updated, calls }.
 */
export async function updateHonuXp(cid, prev, { getJson, budget = { calls: Infinity }, cap = XP_NEW_SESSIONS_PER_PLAYER, now = Date.now() } = {}) {
  let calls = 0;
  const keep = prev && prev.source === "honu-exp-all" ? prev : null;
  if (!/^\d+$/.test(String(cid || "")) || budget.calls < 3) return { xp: keep, calls };
  try {
    budget.calls--; calls++;
    const list = await getJson(`${HONU_API}character/${cid}/sessions`);
    const todo = pickXpSessions(list, keep && keep.counted, cap);
    const collected = [];
    for (const sess of todo) {
      const wins = xpWindows(sess.start, sess.end);
      if (budget.calls < 2 * wins.length) break;
      const g = {};
      const r = {};
      const ft = { deaths: [], spikes: [] };
      for (const [w0, w1] of wins) {
        const q = `start=${encodeURIComponent(w0)}&end=${encodeURIComponent(w1)}&includeCharacters=false&includeExpTypes=false`;
        budget.calls -= 2; calls += 2;
        const gb = await getJson(`${HONU_API}exp/${cid}/period2?${q}`);
        aggregateXp(gb, cid, "g", g); fightTimesFromBlock(gb, cid, "g", ft);
        const rb = await getJson(`${HONU_API}exp/characters/other?charIDs=${cid}&${q}`);
        aggregateXp(rb, cid, "r", r); fightTimesFromBlock(rb, cid, "r", ft);
      }
      const s = Date.parse(sess.start);
      collected.push({ id: sess.id, s, sec: Math.round((Date.parse(sess.end) - s) / 1000), k: sess.kills, d: Number.isFinite(+sess.deaths) ? +sess.deaths : null, g, r, runs: fightRuns(ft.deaths, ft.spikes) });
    }
    return { xp: collected.length ? mergeXp(keep, collected, { now }) : keep, calls };
  } catch (e) {
    console.warn(`  Honu XP detail skipped: ${String(e && e.message).slice(0, 80)}`);
    return { xp: keep, calls };
  }
}

/** /api/exp/types -> { id: [name, baseAmount] } (compact). */
export function compactExpTypes(list) {
  const out = {};
  for (const t of Array.isArray(list) ? list : []) {
    if (t && t.id != null) out[String(t.id)] = [String(t.name || ""), Number(t.amount) || 0];
  }
  return out;
}
