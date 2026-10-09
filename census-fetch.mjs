/**
 * Per-player data straight from Daybreak Census (no Honu).
 *
 * Same numbers Honu used to give us, because Honu itself is a thin wrapper:
 *  - killboard  = Census characters_event_grouped, summed per opponent (KILL /
 *    DEATH), self rows dropped, top 200 by kills+deaths (the scored sample is the
 *    first OPPONENT_TOP_N of them)
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
 * up to CENSUS_BATCH ids, so a player is ~8 Census calls instead of ~100 Honu
 * calls. Runs in the browser (app.js) and Node (scripts/refresh-cache.mjs);
 * the caller supplies getJson(url) (with its own pacing / retries / abort).
 */

export const CENSUS_HOST = "https://census.daybreakgames.com";
/**
 * Ids per batched call. 120 ids → URL ~2.6 KB; tested live 2026-10-09 with all
 * three calls (stat / by_faction / names + outfit resolve) at 120 and 250 ids:
 * 200 OK in ~0.3–2 s. The player + OPPONENT_TOP_N opponents = 2 batches.
 */
export const CENSUS_BATCH = 120;
/**
 * Opponents per player in the scored sample (top by kills + deaths). ONE shared
 * value for the browser (app.js) and the shared-cache refresh. Player files
 * saved before 2026-10-09 used LEGACY_TOP_N (50) and are upgraded when the
 * weekly refresh next re-fetches them. Above 200 the graph lines move ≤ ~5%
 * (measured on JustV6me / YEEZY / ShloDog) for 3–4× the calls.
 */
export const OPPONENT_TOP_N = 200;
export const LEGACY_TOP_N = 50;

/** Opponent count a saved player was built from (missing → LEGACY_TOP_N). */
export function sampleTopN(raw) {
  const v = raw && (raw.top != null ? raw.top : raw.player && raw.player.top);
  const n = +v;
  return Number.isFinite(n) && n > 0 ? n : LEGACY_TOP_N;
}
const FACTION_STATS = ["weapon_kills", "weapon_headshots"];
const PLAIN_STATS = ["weapon_deaths", "weapon_play_time", "weapon_fire_count", "weapon_hit_count"];

/** "https://census.daybreakgames.com/s:<id>/get/ps2:v2/" (id with or without "s:"). */
export function censusBase(serviceId = "example") {
  const id = String(serviceId || "example").trim().replace(/^s:/, "") || "example";
  return `${CENSUS_HOST}/s:${encodeURIComponent(id)}/get/ps2:v2/`;
}

/** Census answered with an error object instead of a list (throttled / bad service ID / down). */
export class CensusError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "CensusError";
    this.kind = "census-busy"; // analyze-run FAIL_REASONS kind
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------ resilience */

/**
 * Classify one Census answer.
 *  - "ok":    usable JSON with a *_list
 *  - "retry": network error, timeout, 429, 5xx, 200 + {error|errorCode}
 *             (service_unavailable, throttling), non-JSON body, or an empty
 *             list when the caller expects data (Census returns returned:0
 *             when overloaded)
 *  - "fail":  other 4xx (retrying won't help)
 * @param {{status?:number, body?:any, error?:any, expectData?:boolean}} r
 * @returns {{action:"ok"|"retry"|"fail", reason:string}}
 */
export function classifyCensus({ status = 0, body = undefined, error = null, expectData = false } = {}) {
  if (error) {
    if (error.name === "AbortError") return { action: "fail", reason: "aborted" };
    if (error.name === "TimeoutError") return { action: "retry", reason: "timeout" };
    if (error.name === "SyntaxError") return { action: "retry", reason: "bad JSON" };
    return { action: "retry", reason: "network" };
  }
  if (status === 429) return { action: "retry", reason: "rate limited (429)" };
  if (status >= 500) return { action: "retry", reason: `HTTP ${status}` };
  if (status >= 400) return { action: "fail", reason: `HTTP ${status}` };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { action: "retry", reason: "empty response" };
  const listKey = Object.keys(body).find((k) => k.endsWith("_list"));
  if (!listKey) {
    const msg = String(body.error || body.errorCode || body.errorMessage || "no list");
    return { action: "retry", reason: msg.slice(0, 80) };
  }
  if (expectData && (!Array.isArray(body[listKey]) || body[listKey].length === 0)) {
    return { action: "retry", reason: "empty list" };
  }
  return { action: "ok", reason: "" };
}

/**
 * Exponential backoff with full jitter: random in [0.5, 1] x min(cap, base x 2^attempt).
 * A Retry-After header (seconds) wins when larger (capped at 2 x cap).
 */
export function backoffDelay(attempt, { baseMs = 1000, capMs = 20000, retryAfter = null, random = Math.random } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const jittered = Math.round(exp * (0.5 + 0.5 * random()));
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.max(jittered, Math.min(ra * 1000, capMs * 2));
  return jittered;
}

function abortError() {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * GET a Census URL with per-request timeout, pacing, retries (exponential
 * backoff + jitter) and error classification. Throws CensusError
 * (kind "census-busy") when Census stays busy/down, or with fatal:true on a
 * non-retryable 4xx. Works in browsers and Node 18+.
 * @param {string} url
 * @param {{
 *   fetchImpl?: typeof fetch, timeoutMs?: number, retries?: number,
 *   expectData?: boolean, emptyRetries?: number, signal?: AbortSignal,
 *   bucket?: {take:()=>Promise<void>, pause:(ms:number)=>void},
 *   sleep?: (ms:number)=>Promise<void>, random?: ()=>number,
 *   onRetry?: (info:{attempt:number, retries:number, reason:string, waitMs:number})=>void,
 *   headers?: object, baseMs?: number, capMs?: number,
 * }} [o]
 */
export async function censusRequest(url, o = {}) {
  const {
    fetchImpl = (...a) => fetch(...a),
    timeoutMs = 20000,
    retries = 4,
    expectData = false,
    emptyRetries = 1,
    signal = null,
    bucket = null,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    random = Math.random,
    onRetry = null,
    headers = undefined,
    baseMs = 1000,
    capMs = 20000,
  } = o;
  let empties = 0;
  let last = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw abortError();
    if (bucket) await bucket.take();
    if (signal && signal.aborted) throw abortError();
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timedOut = false;
    const timer = ctl ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs) : 0;
    const onOuter = () => ctl && ctl.abort();
    if (signal && ctl) signal.addEventListener("abort", onOuter, { once: true });
    let verdict;
    let retryAfter = null;
    let body;
    try {
      const res = await fetchImpl(url, { headers, signal: ctl ? ctl.signal : undefined, cache: "no-cache" });
      retryAfter = res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
      if (res.ok) {
        try {
          body = await res.json();
        } catch (e) {
          if (timedOut) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
          if (signal && signal.aborted) throw abortError();
          verdict = classifyCensus({ error: { name: "SyntaxError" } });
        }
      }
      if (!verdict) verdict = classifyCensus({ status: res.ok ? 0 : res.status, body, expectData: expectData && empties < emptyRetries });
    } catch (e) {
      if (signal && signal.aborted) throw abortError();
      verdict = classifyCensus({ error: timedOut ? { name: "TimeoutError" } : e });
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && ctl) signal.removeEventListener("abort", onOuter);
    }
    if (verdict.action === "ok") return body;
    if (verdict.reason === "empty list") {
      empties++;
      if (expectData && empties >= emptyRetries + 1) return body; // genuinely empty
    }
    last = verdict.reason;
    if (verdict.action === "fail") throw new CensusError(`Census: ${verdict.reason}`, { fatal: true });
    if (attempt >= retries) break;
    const waitMs = backoffDelay(attempt, { baseMs, capMs, retryAfter, random });
    if (bucket && (verdict.reason.includes("429") || /busy|unavailable|service id|throttl/i.test(verdict.reason))) {
      bucket.pause(waitMs); // everyone slows down, not just this request
    }
    if (onRetry) onRetry({ attempt: attempt + 1, retries, reason: verdict.reason, waitMs });
    await sleep(waitMs);
  }
  throw new CensusError(`Census is busy or down (${last || "no answer"})`);
}

/**
 * Tiny semaphore: at most `n` tasks in flight (browser: keep concurrent
 * Census requests low even with several tabs/players).
 */
export function limitConcurrency(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(res, rej)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((res, rej) => {
    queue.push({ fn, res, rej });
    next();
  });
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
    let statRows;
    let facRows;
    try {
      statRows = listOf(await getJson(u.stat), "characters_stat_list");
      facRows = listOf(await getJson(u.faction), "characters_stat_by_faction_list");
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      // Graceful partial result: these opponents are skipped, the player still loads.
      for (const id of part) out.set(id, { pace: null, failed: true, name: "", outfitTag: "" });
      continue;
    }
    let nameRows = [];
    if (names) {
      try {
        nameRows = listOf(await getJson(u.names), "character_list");
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        nameRows = []; // names are cosmetic: fall back to ids
      }
    }
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
export async function fetchPlayerCensus(charID, { base, getJson, topN = OPPONENT_TOP_N, memo = null }) {
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
  let skipped = 0;
  const rows = [];
  for (const pair of sample) {
    const oid = String(pair.otherCharacterID);
    if (oid === "0") {
      rows.push({ name: oid, kills: +pair.kills || 0, deaths: +pair.deaths || 0, kpm: 0 });
      continue;
    }
    const v = info(oid) || { pace: null, name: "", outfitTag: "" };
    if (v.failed) {
      skipped++; // Census busy for this batch: leave the opponent out (no fake 0-KPM row)
      continue;
    }
    lookups++;
    if (!v.pace) paceFails++; // not in Census (deleted): kept as 0 KPM, same as before
    const tag = v.outfitTag ? `[${v.outfitTag}] ` : "";
    rows.push({
      name: tag + (v.name || oid),
      kills: +pair.kills || 0,
      deaths: +pair.deaths || 0,
      kpm: (v.pace && v.pace.kpm) || 0,
    });
  }
  return {
    own: (ownInfo && ownInfo.pace) || null,
    ownFailed: !!(ownInfo && ownInfo.failed),
    board,
    rows,
    lookups,
    paceFails,
    skipped,
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
