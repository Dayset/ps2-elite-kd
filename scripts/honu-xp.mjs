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
    const s0 = new Date(c.s).toISOString();
    const s1 = new Date(c.s + c.sec * 1000).toISOString();
    if (!out.first || s0 < out.first) out.first = s0;
    if (!out.last || s1 > out.last) out.last = s1;
    out.sessions[sid] = { s: c.s, sec: c.sec, k: c.k, ...(Number.isFinite(c.d) ? { d: c.d } : {}), g: c.g, r: c.r };
  }
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
      for (const [w0, w1] of wins) {
        const q = `start=${encodeURIComponent(w0)}&end=${encodeURIComponent(w1)}&includeCharacters=false&includeExpTypes=false`;
        budget.calls -= 2; calls += 2;
        aggregateXp(await getJson(`${HONU_API}exp/${cid}/period2?${q}`), cid, "g", g);
        aggregateXp(await getJson(`${HONU_API}exp/characters/other?charIDs=${cid}&${q}`), cid, "r", r);
      }
      const s = Date.parse(sess.start);
      collected.push({ id: sess.id, s, sec: Math.round((Date.parse(sess.end) - s) / 1000), k: sess.kills, d: Number.isFinite(+sess.deaths) ? +sess.deaths : null, g, r });
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
