/**
 * 🤺 Duels (owner 2026-10-28): "player vs player outcome history … like a nemesis lookup: how a
 * person fights against the crowd and specifically against you". Pure module (browser + Node).
 *
 *  - one player on the page → that player vs the crowd: the ~200 opponents of the Census
 *    killboard the page already loaded (p.rows), nemesis and favourite target. No Census call.
 *  - two players → head-to-head: every kill between them we can find in one player's KILL / DEATH
 *    history (Census characters_event, 1,000 per page, newest first), cut into fights (a fight
 *    breaks after 10 minutes without a kill between them), with time, weapon, headshot, both
 *    classes and the gap since the previous kill of the fight.
 *
 * Bullets per kill: Census does not record the shots of one kill (nor does any other public
 * source). The "≈" numbers are the killer's LIFETIME average with that weapon (Census
 * characters_weapon_stat fire / hit count ÷ characters_weapon_stat_by_faction kills).
 */
import { eventsUrl, compactEvent, mergeEvents, EVENT_PAGE } from "./scrims.mjs?v=20261028-os2";

/** A fight between the two breaks after this many seconds without a kill between them. */
export const DUEL_GAP = 600;
/** A fight is "1v1" when it has min+ kills and focus+ of the history player's kills & deaths in that time were with the other one. */
export const ONE_V_ONE = Object.freeze({ min: 3, focus: 0.75 });
/** Census pages (1,000 events) read on first open, and per "Read further back" click. */
export const AUTO_PAGES = 5;
export const MORE_PAGES = 5;

/** Census loadout id → class (NC 1–7, TR 8–14, VS 15–21, NSO 28–32 + 45). */
export const CLASS_OF = Object.freeze({
  1: "inf", 8: "inf", 15: "inf", 28: "inf",
  3: "la", 10: "la", 17: "la", 29: "la",
  4: "med", 11: "med", 18: "med", 30: "med",
  5: "eng", 12: "eng", 19: "eng", 31: "eng",
  6: "ha", 13: "ha", 20: "ha", 32: "ha",
  7: "max", 14: "max", 21: "max", 45: "max",
});
export const classOf = (loadout) => CLASS_OF[Number(loadout) || 0] || "";

export const bareName = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim();
const lc = (n) => bareName(n).toLowerCase();

/** Most frequent non-empty value (ties: first seen). */
function mode(list) {
  const c = new Map();
  let best = null, bn = 0;
  for (const v of list) {
    if (!v) continue;
    const n = (c.get(v) || 0) + 1;
    c.set(v, n);
    if (n > bn) { bn = n; best = v; }
  }
  return best == null ? null : [best, bn];
}

/* ---------------------------------------------------------------- vs the crowd */

/** The loaded killboard (opponents with kills / deaths / their KPM) → rows with K/D and share. */
export function crowdRows(p) {
  const src = (p && (p.rawRows || p.rows)) || [];
  let tot = 0;
  for (const r of src) tot += (+r.kills || 0) + (+r.deaths || 0);
  return src
    .filter((r) => r && bareName(r.name))
    .map((r) => {
      const k = +r.kills || 0, d = +r.deaths || 0;
      return { name: String(r.name), kills: k, deaths: d, kd: d ? k / d : null, kpm: Number.isFinite(+r.kpm) && r.kpm != null ? +r.kpm : null, share: tot ? (k + d) / tot : 0 };
    });
}

/**
 * Crowd summary: K/D over all killboard opponents (one name left out, e.g. the head-to-head
 * opponent), nemesis (killed this player most, more deaths than kills) and favourite target.
 */
export function crowdSummary(rows, leaveOut = "") {
  const skip = lc(leaveOut);
  let k = 0, d = 0, nem = null, tgt = null;
  for (const r of rows || []) {
    if (skip && lc(r.name) === skip) continue;
    k += r.kills; d += r.deaths;
    if (r.deaths > r.kills && (!nem || r.deaths > nem.deaths || (r.deaths === nem.deaths && r.kills < nem.kills))) nem = r;
    if (r.kills > r.deaths && (!tgt || r.kills > tgt.kills || (r.kills === tgt.kills && r.deaths < tgt.deaths))) tgt = r;
  }
  return { kills: k, deaths: d, kd: d ? k / d : null, n: (rows || []).length, nemesis: nem, target: tgt };
}

/** This player's killboard row for the other one (kills + deaths between them), or null. */
export function expectedCount(p, other) {
  const want = lc(other && other.display);
  if (!want) return null;
  const r = ((p && (p.rawRows || p.rows)) || []).find((x) => x && lc(x.name) === want);
  return r ? (+r.kills || 0) + (+r.deaths || 0) : null;
}

/** Whose history to read: the one with fewer kills + deaths per minute reaches further back per page. */
export function pagerOf(a, b) {
  const act = (p) => {
    const kpm = +(p && p.global_kpm), kd = +(p && p.global_kd);
    return kpm > 0 && kd > 0 ? kpm * (1 + 1 / kd) : Infinity;
  };
  return act(b) < act(a) ? b : a;
}

/* ---------------------------------------------------------------- head-to-head */

/**
 * Page back through the history player's events. st = { pid, qid, all: [], cursor: 0, done, pages, oldest }.
 * Stops after `pages` pages, at the end of the history, or once `need` kills between them are in.
 */
export async function readPairPages(st, { base, get, pages = AUTO_PAGES, need = null }) {
  let n = 0;
  const qid = String(st.qid);
  while (n < pages && !st.done) {
    const j = await get(eventsUrl(base, st.pid, { before: st.cursor }));
    if (!j || !Array.isArray(j.characters_event_list)) throw new Error("bad census reply");
    n++;
    st.pages = (st.pages || 0) + 1;
    const list = j.characters_event_list;
    const page = list.map((e) => compactEvent(e, st.pid)).filter(Boolean);
    st.all = mergeEvents(st.all || [], page);
    if (list.length < EVENT_PAGE || !page.length) { st.done = true; break; }
    const oldest = page.reduce((m, x) => Math.min(m, x[0]), Infinity);
    // The edge second is asked again (+1) so a second split across two pages is never lost; mergeEvents dedupes.
    st.cursor = st.cursor && oldest + 1 >= st.cursor ? oldest : oldest + 1;
    if (need != null && st.all.reduce((c, x) => c + (x[2] === qid ? 1 : 0), 0) >= need) break;
  }
  st.oldest = st.all && st.all.length ? st.all[st.all.length - 1][0] : 0;
  return st;
}

/**
 * The history player's compact events → the kills between the two, seen from A (the first name).
 * → [{ t, aKill, w (killer's weapon), hs, z, aL, bL (loadouts), veh (killer's vehicle) }] oldest first.
 */
export function pairEvents(all, qid, pIsA) {
  const q = String(qid);
  return (all || [])
    .filter((x) => x && x[2] === q)
    .map((x) => {
      const pKill = x[1] === 1;
      return { t: x[0], aKill: pIsA ? pKill : !pKill, w: x[3], hs: x[4] === 1, z: x[5], aL: pIsA ? x[6] : x[7], bL: pIsA ? x[7] : x[6], veh: x[8] };
    })
    .sort((u, v) => u.t - v.t);
}

const lowerBound = (ts, t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return lo; };
const upperBound = (ts, t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m + 1; else hi = m; } return lo; };

/**
 * Kills between them → fights, newest first. Each: { t0, t1, ev (oldest first), a, b (kills by A / B),
 * focus (share of the history player's kills & deaths in that time that were between the two), one (1v1), z, wa, wb }.
 */
export function fightsOf(pe, all, pid, gap = DUEL_GAP) {
  const me = String(pid);
  const ts = (all || []).filter((x) => x && x[2] && x[2] !== "0" && x[2] !== me).map((x) => x[0]).sort((a, b) => a - b);
  const out = [];
  let cur = null;
  for (const e of pe || []) {
    if (cur && e.t - cur.t1 <= gap) { cur.ev.push(e); cur.t1 = e.t; continue; }
    cur = { t0: e.t, t1: e.t, ev: [e] };
    out.push(cur);
  }
  for (const f of out) {
    f.a = f.ev.filter((e) => e.aKill).length;
    f.b = f.ev.length - f.a;
    const inTime = upperBound(ts, f.t1) - lowerBound(ts, f.t0);
    f.focus = inTime ? Math.min(1, f.ev.length / inTime) : 1;
    f.one = f.ev.length >= ONE_V_ONE.min && f.focus >= ONE_V_ONE.focus;
    const z = mode(f.ev.map((e) => (Number(e.z) || 0) & 0xffff));
    f.z = z ? z[0] : 0;
    const wa = mode(f.ev.filter((e) => e.aKill).map((e) => e.w));
    const wb = mode(f.ev.filter((e) => !e.aKill).map((e) => e.w));
    f.wa = wa ? wa[0] : 0;
    f.wb = wb ? wb[0] : 0;
  }
  return out.reverse();
}

/** Fight result from A's side. */
export const fightResult = (f) => (f.a > f.b ? "won" : f.a < f.b ? "lost" : "draw");

/** Census URLs: lifetime shots, hits and kills of both players with the given weapons (2 calls). */
export function weaponShotUrls(base, cids, items) {
  const c = cids.map((x) => encodeURIComponent(String(x))).join(",");
  const i = [...new Set(items.map(String).filter((x) => x && x !== "0"))].join(",");
  return {
    plain: `${base}characters_weapon_stat?character_id=${c}&item_id=${i}&stat_name=weapon_fire_count,weapon_hit_count&c:show=character_id,stat_name,item_id,value&c:limit=5000`,
    kills: `${base}characters_weapon_stat_by_faction?character_id=${c}&item_id=${i}&stat_name=weapon_kills&c:show=character_id,stat_name,item_id,value_vs,value_nc,value_tr&c:limit=5000`,
  };
}

/** Both replies → Map "cid|item" → { shots, hits, kills } (vehicle rows of the same weapon summed). */
export function parseShotStats(plainJson, killsJson, into = new Map()) {
  const slot = (r) => {
    const k = `${r.character_id}|${r.item_id}`;
    let o = into.get(k);
    if (!o) into.set(k, (o = { shots: 0, hits: 0, kills: 0 }));
    return o;
  };
  for (const r of (plainJson && plainJson.characters_weapon_stat_list) || []) {
    if (!r || !r.item_id || r.item_id === "0") continue;
    if (r.stat_name === "weapon_fire_count") slot(r).shots += +r.value || 0;
    else if (r.stat_name === "weapon_hit_count") slot(r).hits += +r.value || 0;
  }
  for (const r of (killsJson && killsJson.characters_weapon_stat_by_faction_list) || []) {
    if (!r || !r.item_id || r.item_id === "0" || r.stat_name !== "weapon_kills") continue;
    slot(r).kills += (+r.value_vs || 0) + (+r.value_nc || 0) + (+r.value_tr || 0);
  }
  return into;
}

/** Lifetime shots / hits per kill of one player with one weapon, or null (no kills or no shots recorded). */
export function perKill(stats, cid, item) {
  const s = stats && stats.get(`${cid}|${item}`);
  if (!s || !s.kills || !s.shots) return null;
  return { shots: s.shots / s.kills, hits: s.hits ? s.hits / s.kills : null, kills: s.kills };
}

/**
 * Both sides' numbers for the comparison table. stats: parseShotStats map (may be empty).
 * → { a, b, n, first, last, fights, ones } with per side: kills, hs, hsr, kd, weapon [id, n], cls [id, n],
 *   streak, shots, hits (≈ averages over the kills whose weapon has lifetime numbers), oneWon.
 */
export function pairSummary(pe, fights, stats, aCid, bCid) {
  const side = (isA) => {
    const mine = pe.filter((e) => e.aKill === isA);
    const k = mine.length, d = pe.length - k;
    const cid = isA ? aCid : bCid;
    let sSum = 0, sN = 0, hSum = 0, hN = 0;
    for (const e of mine) {
      const pk = perKill(stats, cid, e.w);
      if (!pk) continue;
      sSum += pk.shots; sN++;
      if (pk.hits != null) { hSum += pk.hits; hN++; }
    }
    let streak = 0, run = 0;
    for (const e of pe) { run = e.aKill === isA ? run + 1 : 0; if (run > streak) streak = run; }
    const hs = mine.filter((e) => e.hs).length;
    return {
      kills: k, hs, hsr: k ? hs / k : null, kd: d ? k / d : null,
      weapon: mode(mine.map((e) => e.w)), cls: mode(mine.map((e) => classOf(isA ? e.aL : e.bL))),
      streak, shots: sN ? sSum / sN : null, hits: hN ? hSum / hN : null,
      oneWon: fights.filter((f) => f.one && (isA ? f.a > f.b : f.b > f.a)).length,
    };
  };
  return {
    a: side(true), b: side(false), n: pe.length,
    first: pe.length ? pe[0].t : 0, last: pe.length ? pe[pe.length - 1].t : 0,
    fights: fights.length, ones: fights.filter((f) => f.one).length,
  };
}
