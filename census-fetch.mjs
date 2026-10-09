/**
 * Per-player data straight from Daybreak Census (no Honu).
 *
 * Same numbers Honu used to give us, because Honu itself is a thin wrapper:
 *  - killboard  = Census characters_event_grouped, summed per opponent (KILL /
 *    DEATH), self rows dropped, top 200 by kills+deaths
 *    (honu Services/Census/KillboardCollection.cs). NOTE: no c:limit, exactly
 *    like Honu: Census then returns every row (a capped/sorted query gives a
 *    different top 200).
 *  - stats      = characters_stat (+ characters_stat_by_faction summed over
 *    VS/NC/TR) (honu Services/Census/CharacterStatCollection.cs). We read the
 *    same six all-weapon totals: weapon_kills, weapon_headshots (by faction),
 *    weapon_deaths, weapon_play_time, weapon_fire_count, weapon_hit_count.
 *  - names      = character?character_id=a,b,c&c:resolve=outfit(alias).
 *
 * Opponent stats are batched: one characters_stat + one by_faction call per
 * up to CENSUS_BATCH ids, so a player is ~5 Census calls instead of ~100 Honu
 * calls. Runs in the browser (app.js) and Node (scripts/refresh-cache.mjs);
 * the caller supplies getJson(url) (with its own pacing / retries / abort).
 */

export const CENSUS_HOST = "https://census.daybreakgames.com";
export const CENSUS_BATCH = 60; // ids per batched call (URL stays < ~1.5 KB)
const FACTION_STATS = ["weapon_kills", "weapon_headshots"];
const PLAIN_STATS = ["weapon_deaths", "weapon_play_time", "weapon_fire_count", "weapon_hit_count"];

/** "https://census.daybreakgames.com/s:<id>/get/ps2:v2/" (id with or without "s:"). */
export function censusBase(serviceId = "example") {
  const id = String(serviceId || "example").trim().replace(/^s:/, "") || "example";
  return `${CENSUS_HOST}/s:${encodeURIComponent(id)}/get/ps2:v2/`;
}

/** Census answered with an error object instead of a list (throttled / bad service ID / down). */
export class CensusError extends Error {
  constructor(message) {
    super(message);
    this.name = "CensusError";
  }
}

function listOf(data, key) {
  if (data && Array.isArray(data[key])) return data[key];
  if (data && (data.error || data.errorCode)) {
    throw new CensusError(`Census unavailable: ${String(data.error || data.errorCode).slice(0, 120)}`);
  }
  throw new CensusError(`Census: unexpected response (no ${key})`);
}

/**
 * Honu-shaped killboard from characters_event_grouped rows.
 * @param {{character_id:string, table_type:string, count:string|number}[]} groups
 * @returns {{sourceCharacterID:string, otherCharacterID:string, kills:number, deaths:number}[]}
 */
export function buildKillboard(groups, charID, max = 200) {
  const self = String(charID);
  const map = new Map(); // insertion order = Census order (tie order matches Honu)
  for (const g of groups || []) {
    if (!g) continue;
    const other = String(g.character_id);
    if (other === self) continue;
    let e = map.get(other);
    if (!e) {
      e = { sourceCharacterID: self, otherCharacterID: other, kills: 0, deaths: 0 };
      map.set(other, e);
    }
    const n = +g.count || 0;
    if (g.table_type === "DEATH") e.deaths += n;
    else if (g.table_type === "KILL") e.kills += n;
  }
  return [...map.values()].sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths)).slice(0, max);
}

/** Pace numbers from the six all-weapon totals (same formulas as before). */
export function paceFromTotals(t) {
  const wk = +t.weapon_kills || 0;
  const wd = +t.weapon_deaths || 0;
  const wt = +t.weapon_play_time || 0;
  const fire = +t.weapon_fire_count || 0;
  const hitc = +t.weapon_hit_count || 0;
  const hs = +t.weapon_headshots || 0;
  const kpm = wt ? wk / (wt / 60) : 0;
  const acc = fire ? (100 * hitc) / fire : 0;
  const hsr = wk ? (100 * hs) / wk : 0;
  return { wk, wd, kpm, acc, hsr, ivi: acc * hsr };
}

/**
 * Per-character totals from batched characters_stat + characters_stat_by_faction rows.
 * Only profile_id 0 rows (the all-classes total Honu exposes) are used.
 * @returns {Map<string, object>} id -> { weapon_kills, ..., _rows }
 */
export function totalsByCharacter(statRows, factionRows) {
  const out = new Map();
  const slot = (id) => {
    let t = out.get(id);
    if (!t) out.set(id, (t = { _rows: 0 }));
    return t;
  };
  for (const r of statRows || []) {
    if (!r || String(r.profile_id || "0") !== "0") continue;
    const t = slot(String(r.character_id));
    t[r.stat_name] = +r.value_forever || 0;
    t._rows++;
  }
  for (const r of factionRows || []) {
    if (!r || String(r.profile_id || "0") !== "0") continue;
    const t = slot(String(r.character_id));
    t[r.stat_name] = (+r.value_forever_vs || 0) + (+r.value_forever_nc || 0) + (+r.value_forever_tr || 0);
    t._rows++;
  }
  return out;
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** URLs for one batch of ids (exported for tests). */
export function statUrls(base, ids) {
  const list = ids.join(",");
  return {
    stat: `${base}characters_stat?character_id=${list}&stat_name=${PLAIN_STATS.join(",")}&c:show=character_id,stat_name,profile_id,value_forever&c:limit=${ids.length * PLAIN_STATS.length * 2 + 10}`,
    faction: `${base}characters_stat_by_faction?character_id=${list}&stat_name=${FACTION_STATS.join(",")}&c:show=character_id,stat_name,profile_id,value_forever_vs,value_forever_nc,value_forever_tr&c:limit=${ids.length * FACTION_STATS.length * 2 + 10}`,
    names: `${base}character?character_id=${list}&c:show=character_id,name.first&c:resolve=outfit(alias)&c:limit=${ids.length}`,
  };
}

export function killboardUrl(base, charID) {
  return `${base}characters_event_grouped?character_id=${encodeURIComponent(charID)}`;
}

/**
 * Pace (and optionally names) for many characters in few calls.
 * @param {string[]} ids
 * @param {{ base:string, getJson:(url:string)=>Promise<any>, names?:boolean }} o
 * @returns {Promise<Map<string, { pace: object|null, name?: string, outfitTag?: string }>>}
 *   pace is null when Census has no stat rows for that id (deleted / unknown).
 */
export async function fetchCharacterInfo(ids, { base, getJson, names = true, batch = CENSUS_BATCH }) {
  const uniq = [...new Set((ids || []).map(String))].filter((id) => /^\d{5,25}$/.test(id) && id !== "0");
  const out = new Map();
  for (const part of chunks(uniq, batch)) {
    const u = statUrls(base, part);
    const statRows = listOf(await getJson(u.stat), "characters_stat_list");
    const facRows = listOf(await getJson(u.faction), "characters_stat_by_faction_list");
    let nameRows = [];
    if (names) nameRows = listOf(await getJson(u.names), "character_list");
    const totals = totalsByCharacter(statRows, facRows);
    const nm = new Map();
    for (const ch of nameRows) {
      if (ch && ch.character_id) {
        nm.set(String(ch.character_id), {
          name: (ch.name && ch.name.first) || "",
          outfitTag: (ch.outfit && ch.outfit.alias) || "",
        });
      }
    }
    for (const id of part) {
      const t = totals.get(id);
      const info = { pace: t && t._rows ? paceFromTotals(t) : null };
      if (names) Object.assign(info, nm.get(id) || { name: "", outfitTag: "" });
      out.set(id, info);
    }
  }
  return out;
}

/** Killboard (top 200, Honu order) for one character. */
export async function fetchKillboard(charID, { base, getJson }) {
  const groups = listOf(await getJson(killboardUrl(base, charID)), "characters_event_grouped_list");
  return buildKillboard(groups, charID);
}

/**
 * Everything loadLive needs after the character is resolved: own pace,
 * sorted killboard, and the top-N opponent rows ({name, kills, deaths, kpm}).
 * memo (optional Map id -> info) reuses opponent lookups across players.
 */
export async function fetchPlayerCensus(charID, { base, getJson, topN = 50, memo = null }) {
  const cid = String(charID);
  const board = await fetchKillboard(cid, { base, getJson });
  board.sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths)); // stable: same as before
  const sample = board.slice(0, topN);
  const want = [cid, ...sample.map((p) => String(p.otherCharacterID))].filter(
    (id) => id !== "0" && !(memo && memo.has(id))
  );
  const fresh = await fetchCharacterInfo(want, { base, getJson });
  const info = (id) => (memo && memo.has(id) ? memo.get(id) : fresh.get(id));
  if (memo) for (const [id, v] of fresh) if (v.pace) memo.set(id, v); // don't memoize misses
  const ownInfo = info(cid);
  let lookups = 0;
  let paceFails = 0;
  const rows = sample.map((pair) => {
    const oid = String(pair.otherCharacterID);
    if (oid === "0") return { name: oid, kills: +pair.kills || 0, deaths: +pair.deaths || 0, kpm: 0 };
    lookups++;
    const v = info(oid) || { pace: null, name: "", outfitTag: "" };
    if (!v.pace) paceFails++;
    const tag = v.outfitTag ? `[${v.outfitTag}] ` : "";
    return {
      name: tag + (v.name || oid),
      kills: +pair.kills || 0,
      deaths: +pair.deaths || 0,
      kpm: (v.pace && v.pace.kpm) || 0,
    };
  });
  return {
    own: (ownInfo && ownInfo.pace) || null,
    board,
    rows,
    lookups,
    paceFails,
  };
}

/**
 * Token bucket for client-side pacing: `capacity` burst, `perMinute` refill.
 * take() resolves when a token is available; pause(ms) blocks everyone
 * (e.g. after a 429 with Retry-After).
 */
export function tokenBucket({ capacity, perMinute, now = () => Date.now(), sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let tokens = capacity;
  let last = now();
  let blockedUntil = 0;
  let chain = Promise.resolve();
  const refill = () => {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) * perMinute) / 60000);
    last = t;
  };
  async function takeOne() {
    for (;;) {
      const t = now();
      if (t < blockedUntil) {
        await wait(blockedUntil - t);
        continue;
      }
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await wait(Math.ceil(((1 - tokens) * 60000) / perMinute));
    }
  }
  return {
    take() {
      const p = chain.then(takeOne);
      chain = p.catch(() => {});
      return p;
    },
    pause(ms) {
      blockedUntil = Math.max(blockedUntil, now() + Math.max(0, ms));
    },
    get tokens() {
      refill();
      return tokens;
    },
  };
}

/** Census pacing default: s:example is throttled to 10/min per IP; a registered ID is paced at 60/min (polite, not a Daybreak limit). */
export function defaultCensusRate(serviceId) {
  const id = String(serviceId || "example").replace(/^s:/, "");
  // example: at most 9 calls in any minute (burst 1 + 8/min); its limit is 10/min.
  return id === "example" ? { capacity: 1, perMinute: 8 } : { capacity: 5, perMinute: 60 };
}
