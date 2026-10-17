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
  const s = { footKills: 0, vehKills: 0, otherKills: 0, footDeaths: 0, vehDeaths: 0, otherDeaths: 0, footSecs: 0 };
  let seen = 0;
  for (const r of facRows || []) {
    if (!r) continue;
    const v = (+r.value_vs || 0) + (+r.value_nc || 0) + (+r.value_tr || 0);
    const k = kind(r);
    if (r.stat_name === "weapon_kills") { seen++; s[k === "foot" ? "footKills" : k === "vehicle" ? "vehKills" : "otherKills"] += v; }
    else if (r.stat_name === "weapon_killed_by") { seen++; s[k === "foot" ? "footDeaths" : k === "vehicle" ? "vehDeaths" : "otherDeaths"] += v; }
  }
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
    v: 1,
    at: now,
    ...s,
    kills,
    deaths,
    infKd: r3(s.footDeaths ? s.footKills / s.footDeaths : s.footKills),
    infKpm: r3(s.footSecs ? s.footKills / (s.footSecs / 60) : 0),
    vehShare: r3(vehShare),
    tag,
  };
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
