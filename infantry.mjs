/**
 * Infantry vs vehicle split per player (collected silently; build-log counts only).
 *
 * Two Census calls per refreshed player (verified live 2026-10-17):
 *  - characters_weapon_stat_by_faction, stat_name=weapon_kills,weapon_killed_by
 *      weapon_kills    : kills by OUR weapon (item_id) while WE sat in vehicle_id (0 = on foot).
 *      weapon_killed_by: our deaths by the KILLER's weapon/vehicle (vehicle_id 0 = killer on foot).
 *  - characters_weapon_stat, stat_name=weapon_play_time
 *      seconds with each weapon, vehicle_id 0 = on foot. (weapon_deaths here is
 *      "deaths while holding the weapon" and over-counts, so it is not used.)
 *
 * Summary fields (small, ~10 numbers):
 *   footKills    kills on foot (vehicle_id 0, excluding odd items below)
 *   vehKills     kills from a vehicle seat or a deployable/emplaced turret
 *   otherKills   item 0 on foot (unknown / environment)
 *   kills        all of the above
 *   footDeaths   deaths to a killer on foot
 *   vehDeaths    deaths to a killer in a vehicle / turret
 *   deaths       all
 *   footSecs     seconds on foot (weapon play time, vehicle_id 0, real items)
 *   infKd        footKills / footDeaths     ("infantry vs infantry"-ish K/D)
 *   infKpm       footKills / footSecs*60
 *   vehShare     vehKills / kills
 *   tag          infantry (vehShare < 0.25) | vehicle (vehShare >= 0.6) | mixed
 *                (null below MIN_KILLS kills: too little to judge)
 *   v2 (🪖 Infantry column):
 *   maxKills     part of footKills made with MAX arm weapons (MAX_ITEMS)
 *   infShare     footKills / kills — share of lifetime kills made with infantry
 *                weapons. MAX kills COUNT AS INFANTRY (a MAX is an infantry class,
 *                on foot, vehicle_id 0); maxShare shows how much of it was MAX.
 *                Vehicle seats, MANA/AA turrets and the Glaive count as NOT infantry.
 *   maxShare     maxKills / kills
 *   part         "kills" = backfill summary from ONE kills-only call (deaths,
 *                footSecs, infKd, infKpm are null until the next normal refresh)
 * Note: footSecs sums per-weapon play time, which can overlap a bit (two weapons
 * held in one minute), so infKpm is slightly conservative, consistently for all.
 */

export const INFANTRY_TAG = { INFANTRY_MAX: 0.25, VEHICLE_MIN: 0.6, MIN_KILLS: 100 };

/**
 * Odd weapons: on-foot rows (vehicle_id 0) that are really turrets/emplacements.
 * Engineer MANA turrets (AI + AV, all variants) and the Glaive IPC.
 * Seat weapons are already tagged by vehicle_id > 0 in Census, so no list needed.
 */
export const VEHICLE_LIKE_ITEMS = new Set([
  "200", "201", "202", "500", "501", "502", "503", "554", "555", "556", "557",
  "71563", "71564", "71565", "6005223", "6005423", "6005424", "6005425",
  "6002390", "6002391", "6002392", "6002393", "6002394", "6002395", "6002396", "6002397", "6002398",
  "6005635", "6005636", "6006069",
]);

/**
 * MAX arm weapons (Census item_category_id 9, 10, 20, 21, 22, 23: AV/AI/AA MAX left/right;
 * categories 15/16 "Flamethrower/Flak MAX" have no items). Fetched 2026-10-19 with
 * item?item_category_id=9,10,15,16,20,21,22,23 (78 items); a static list keeps the
 * weapon-stat call join-free (the item join made it ~20x slower).
 */
export const MAX_ITEMS = new Set([
  "7505", "7506", "7507", "7512", "7513", "7518", "7519", "7520", "7525", "15000", "15001", "15004", "15012", "15013", "15016", "15024", "15025", "15030",
  "16000", "16001", "16004", "16012", "16013", "16016", "16024", "16025", "16026", "16028", "16029", "16030", "16031", "16032", "16033", "17000", "17001",
  "17004", "17012", "17013", "17016", "17024", "17025", "17030", "804652", "804653", "804654", "804655", "804656", "804657", "804717", "804718", "804719",
  "804720", "804721", "804722", "804723", "804724", "804725", "804726", "804727", "804728", "804741", "804742", "804743", "804744", "804745", "804746",
  "804747", "804748", "804749", "804750", "804751", "804752", "6003599", "6003600", "6003601", "6003602", "6003603", "6003604",
]);

/** Shown from this many weapon-stat kills (same floor as the tag). */
export const INF_SHARE_MIN_KILLS = 100;

/** Backfill: kills-only weapon stats for several characters in ONE call (~200 rows each). */
export function infantryKillsUrl(base, cids) {
  const ids = (Array.isArray(cids) ? cids : [cids]).map((c) => encodeURIComponent(c)).join(",");
  return `${base}characters_weapon_stat_by_faction?character_id=${ids}&stat_name=weapon_kills&c:show=character_id,stat_name,item_id,vehicle_id,value_vs,value_nc,value_tr&c:limit=5000`;
}

export function infantryUrls(base, cid) {
  const id = encodeURIComponent(cid);
  return {
    byFaction: `${base}characters_weapon_stat_by_faction?character_id=${id}&stat_name=weapon_kills,weapon_killed_by&c:show=stat_name,item_id,vehicle_id,value_vs,value_nc,value_tr&c:limit=5000`,
    plain: `${base}characters_weapon_stat?character_id=${id}&stat_name=weapon_play_time&c:show=stat_name,item_id,vehicle_id,value&c:limit=5000`,
  };
}

/** "on foot" | "vehicle" | "other" for one row. */
function kind(r) {
  const item = String(r.item_id || "0");
  if (String(r.vehicle_id || "0") !== "0" || VEHICLE_LIKE_ITEMS.has(item)) return "vehicle";
  return item === "0" ? "other" : "foot";
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Raw Census rows -> summary (or null if Census had no kill rows at all). */
export function summarizeInfantry(facRows, plainRows, now = Date.now()) {
  const s = { footKills: 0, maxKills: 0, vehKills: 0, otherKills: 0, footDeaths: 0, vehDeaths: 0, otherDeaths: 0, footSecs: 0 };
  let seen = 0;
  // Census lists vehicle kills twice: one item_id 0 row per vehicle_id (the vehicle total,
  // incl. road kills) AND one row per seat weapon. Count max(total, weapon sum) per vehicle
  // so vehicle kills are not doubled (checked 2026-10-19: item 0 ≥ weapon sum).
  const vk = { weapon_kills: new Map(), weapon_killed_by: new Map() };
  for (const r of facRows || []) {
    if (!r) continue;
    const v = (+r.value_vs || 0) + (+r.value_nc || 0) + (+r.value_tr || 0);
    const k = kind(r);
    const isKill = r.stat_name === "weapon_kills";
    if (!isKill && r.stat_name !== "weapon_killed_by") continue;
    seen++;
    const veh = String(r.vehicle_id || "0");
    if (veh !== "0") {
      const m = vk[r.stat_name];
      const e = m.get(veh) || { total: 0, items: 0 };
      if (String(r.item_id || "0") === "0") e.total += v; else e.items += v;
      m.set(veh, e);
      continue;
    }
    if (isKill) {
      s[k === "foot" ? "footKills" : k === "vehicle" ? "vehKills" : "otherKills"] += v;
      if (k === "foot" && MAX_ITEMS.has(String(r.item_id))) s.maxKills += v;
    } else s[k === "foot" ? "footDeaths" : k === "vehicle" ? "vehDeaths" : "otherDeaths"] += v;
  }
  for (const e of vk.weapon_kills.values()) s.vehKills += Math.max(e.total, e.items);
  for (const e of vk.weapon_killed_by.values()) s.vehDeaths += Math.max(e.total, e.items);
  for (const r of plainRows || []) {
    if (r && r.stat_name === "weapon_play_time" && kind(r) === "foot") s.footSecs += +r.value || 0;
  }
  if (!seen) return null;
  const kills = s.footKills + s.vehKills + s.otherKills;
  const deaths = s.footDeaths + s.vehDeaths + s.otherDeaths;
  const vehShare = kills ? s.vehKills / kills : 0;
  const T = INFANTRY_TAG;
  const tag = kills < T.MIN_KILLS ? null : vehShare < T.INFANTRY_MAX ? "infantry" : vehShare >= T.VEHICLE_MIN ? "vehicle" : "mixed";
  return {
    v: 2,
    at: now,
    ...s,
    kills,
    deaths,
    infKd: r3(s.footDeaths ? s.footKills / s.footDeaths : s.footKills),
    infKpm: r3(s.footSecs ? s.footKills / (s.footSecs / 60) : 0),
    vehShare: r3(vehShare),
    infShare: r3(kills ? s.footKills / kills : 0),
    maxShare: r3(kills ? s.maxKills / kills : 0),
    tag,
  };
}

/**
 * Backfill summary from kills-only rows (one batched call, infantryKillsUrl):
 * same kill fields / shares / tag; deaths and time stay null (part: "kills").
 */
export function summarizeInfantryKills(killRows, now = Date.now()) {
  const s = summarizeInfantry((killRows || []).filter((r) => r && r.stat_name === "weapon_kills"), [], now);
  if (!s) return null;
  for (const k of ["footDeaths", "vehDeaths", "otherDeaths", "deaths", "footSecs", "infKd", "infKpm"]) s[k] = null;
  s.part = "kills";
  return s;
}

/**
 * 🪖 Infantry column values from a stored summary → { inf, max, veh } as % (1 decimal),
 * or null when there is no v2 summary or fewer than INF_SHARE_MIN_KILLS kills.
 */
export function infantryShares(sum) {
  if (!sum || !(sum.v >= 2) || !(sum.kills >= INF_SHARE_MIN_KILLS)) return null;
  const pc = (x) => Math.round(x * 1000) / 10;
  return { inf: pc(sum.footKills / sum.kills), max: pc(sum.maxKills / sum.kills), veh: pc(sum.vehKills / sum.kills) };
}

const listOf = (j, k) => (j && Array.isArray(j[k]) ? j[k] : []);

/** Fetch + summarize. Throws on Census errors (caller keeps the previous summary). */
export async function fetchInfantry(cid, { base, getJson, now = Date.now() }) {
  const u = infantryUrls(base, cid);
  const fac = listOf(await getJson(u.byFaction), "characters_weapon_stat_by_faction_list");
  const plain = listOf(await getJson(u.plain), "characters_weapon_stat_list");
  return summarizeInfantry(fac, plain, now);
}

/** Tag counts over player files (build-log). */
export function infantryTagCounts(players) {
  const out = { infantry: 0, mixed: 0, vehicle: 0, low: 0, none: 0 };
  for (const p of players || []) {
    const s = p && p.infantry;
    if (!s) out.none++;
    else if (!s.tag) out.low++;
    else out[s.tag]++;
  }
  return out;
}

/* ---------- 🪖 Infantry column texts (app.js stats table + rankings.mjs) ---------- */

export const INF_HINT =
  "Share of lifetime kills made with infantry weapons (Census weapon stats). Vehicle seats and turrets don't count; MAX suit weapons count as infantry (the MAX share is on hover). A measurement, not a stat change. Shown from 100 kills.";
export const INF_PENDING_TIP = "Not measured yet (fills in with the background refresh), or fewer than 100 kills";

/** Hover text: value, percentile, MAX and vehicle share. */
export function infTip(v, max, veh, pctl) {
  const f = (x) => (typeof x === "number" && Number.isFinite(x) ? `${x.toFixed(1)}%` : "?");
  const rel = pctl == null ? "" : pctl >= 50 ? ` — top ${Math.max(1, 100 - pctl)}%` : ` — bottom ${Math.max(1, pctl)}%`;
  return `Infantry: ${f(v)} of lifetime kills${rel}. Of all kills: MAX ${f(max)} (counted as infantry), vehicles/turrets ${f(veh)}.`;
}
