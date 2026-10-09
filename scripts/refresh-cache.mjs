#!/usr/bin/env node
/**
 * Refresh shared player cache under data/players/ and rebuild data/index.json.
 * Used by GitHub Actions (.github/workflows/refresh-cache.yml), hourly.
 *
 * Rotation: with no explicit names, each run refreshes only the stalest
 * BATCH_SIZE players (watchlist + index; never-fetched first, then oldest
 * savedAt / last attempt). Over several runs every name gets refreshed.
 * A time budget stops starting new players after TIME_BUDGET_MIN minutes.
 *
 * Usage:
 *   node scripts/refresh-cache.mjs              # stalest BATCH_SIZE names
 *   node scripts/refresh-cache.mjs "JustV6me ChrisJTTR"
 *   NAMES="JustV6me" node scripts/refresh-cache.mjs
 *   BATCH_SIZE=10 TIME_BUDGET_MIN=5 node scripts/refresh-cache.mjs
 *
 * Exit code: 0 unless nothing at all refreshed AND at least one failure looked
 * like an outage (network / 5xx / 429 / Census error). Misspelled or unknown
 * names are logged and skipped; their existing files are never touched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { censusQueryName } from "../analyze-run.mjs";
import {
  CENSUS_HOST,
  CensusError,
  censusBase,
  censusRequest,
  defaultCensusRate,
  fetchPlayerCensus,
  tokenBucket,
} from "../census-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PLAYERS_DIR = path.join(DATA_DIR, "players");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const WATCHLIST_PATH = path.join(DATA_DIR, "watchlist.txt");
const STATE_PATH = path.join(DATA_DIR, "refresh-state.json");
const STATUS_PATH = path.join(DATA_DIR, "status.json");
const TOP_KILLERS_PATH = path.join(DATA_DIR, "top-killers.txt");
const SCHEDULE_PATH = path.join(DATA_DIR, "schedule.json");

const HONU = "https://wt.honu.pw/api/character/";
/** Census service ID: env CENSUS_SERVICE_ID (workflow), else the site's registered ID. */
const CENSUS_SERVICE_ID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const CENSUS = censusBase(CENSUS_SERVICE_ID);
const TOP_N = 50;
const OPP_CONCURRENCY = 4;
const BETWEEN_PLAYERS_MS = 1500;
const FETCH_TIMEOUT_MS = 20_000;
/** Census killboards of very active players are ~100k rows (several MB). */
const CENSUS_TIMEOUT_MS = 90_000;
const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
/** Stale = last saved more than this long ago; background runs re-fetch stale players, oldest first. */
const REFRESH_AFTER_MS = 24 * 3600 * 1000;
/** Stop the run early after this many outage-type failures in a row (be polite). */
const MAX_CONSECUTIVE_OUTAGES = 4;
/** On-demand runs (inputs.names, e.g. from the site's Worker) refresh at most this many. */
const MAX_EXPLICIT = 40;

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Name could not be found (misspelled / deleted / no killboard). Not an outage. */
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Non-retryable HTTP 4xx (other than 429). */
class HttpClientError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "HttpClientError";
    this.status = status;
  }
}

export function isOutageError(e) {
  return !(e instanceof NotFoundError);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseNames(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const tokens = [];
  const re = /(?:\[[^\]]*\]\s*)?[^\s,;]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = m[0].trim();
    if (t) tokens.push(t);
  }
  return tokens;
}

/**
 * Client-side token buckets. Census: s:example is throttled to 10 req/min per
 * IP (registered IDs get more; CENSUS_RPM overrides). Honu (fallback only, for
 * history_stats Census lacks): far below its 60/min per-IP API limit.
 */
const censusRate = defaultCensusRate(CENSUS_SERVICE_ID);
if (Number(process.env.CENSUS_RPM) > 0) censusRate.perMinute = Number(process.env.CENSUS_RPM);
const censusBucket = tokenBucket(censusRate);
const honuBucket = tokenBucket({ capacity: 3, perMinute: 20 });

export function backoffMs(attempt, retryAfterHeader) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  // 1s, 2s, 4s, 8s … capped, with a little jitter.
  return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
}

/**
 * GitHub-hosted runners can't connect to Census (TCP connect timeouts), so the
 * workflow sets CENSUS_PROXY (the cache Worker) + CENSUS_PROXY_KEY (shared
 * secret header). Unset = direct Census (local runs).
 */
const CENSUS_PROXY = String(process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const CENSUS_PROXY_KEY = String(process.env.CENSUS_PROXY_KEY || "");

/** Census URL -> proxy URL (`${proxy}/census/s:…/get/ps2:v2/…`); anything else unchanged. */
export function viaCensusProxy(url, proxy = CENSUS_PROXY) {
  if (!proxy || !url.startsWith(CENSUS_HOST + "/")) return url;
  return `${proxy}/census${url.slice(CENSUS_HOST.length)}`;
}

async function fetchJson(url, { retries = 4 } = {}) {
  if (url.startsWith(CENSUS_HOST)) {
    const proxied = viaCensusProxy(url);
    const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (proxied !== url && CENSUS_PROXY_KEY) headers["X-Proxy-Key"] = CENSUS_PROXY_KEY;
    // Census: timeouts, exponential backoff + jitter, busy/overload detection (census-fetch.mjs).
    return censusRequest(proxied, {
      bucket: censusBucket,
      retries,
      timeoutMs: url.includes("characters_event_grouped") ? CENSUS_TIMEOUT_MS : FETCH_TIMEOUT_MS,
      expectData: url.includes("characters_event_grouped") || url.includes("character?name.first_lower="),
      headers,
      baseMs: 2000,
      capMs: 30000,
      onRetry: ({ attempt, retries: n, reason, waitMs }) =>
        console.warn(`  Census retry ${attempt}/${n} in ${waitMs}ms (${reason})`),
    });
  }
  let lastErr;
  const isHonu = url.startsWith("https://wt.honu.pw/");
  const bucket = isHonu ? honuBucket : null;
  for (let attempt = 0; attempt < retries; attempt++) {
    let wait = backoffMs(attempt);
    if (bucket) await bucket.take();
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        wait = backoffMs(attempt, res.headers.get("retry-after"));
        if (bucket && res.status === 429) {
          bucket.pause(wait); // slow everyone down, not just this request (honors Retry-After)
          wait = 0;
        }
        lastErr = new Error(`${res.status} ${res.statusText} for ${url}`);
        console.warn(`  retry ${res.status} in ${wait}ms: ${url}`);
      } else if (!res.ok) {
        throw new HttpClientError(`${res.status} ${res.statusText} for ${url}`, res.status);
      } else if (res.status === 204) {
        return null;
      } else {
        return await res.json();
      }
    } catch (e) {
      if (e instanceof HttpClientError) throw e; // 4xx: retrying won't help
      lastErr = e;
      // undici's "fetch failed" hides the real reason in e.cause.
      const cause = e && e.cause && (e.cause.code || e.cause.message);
      if (cause && e.message === "fetch failed") {
        lastErr = new Error(`fetch failed (${String(cause).slice(0, 80)}) for ${new URL(url).host}`);
      }
      console.warn(`  retry after error (${attempt + 1}/${retries}): ${String(lastErr.message).slice(0, 160)}`);
    }
    if (attempt + 1 < retries && wait > 0) await sleep(wait);
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}

function hist(c, stat) {
  for (const row of ((c.stats || {}).stat_history) || []) {
    if (row.stat_name === stat) return +row.all_time || 0;
  }
  return 0;
}

function pooled(sl) {
  let tk = 0;
  let td = 0;
  for (const r of sl) {
    tk += r.kills || 0;
    td += r.deaths || 0;
  }
  let kd = null;
  if (td) kd = tk / td;
  else if (tk) kd = tk;
  return { kills: tk, deaths: td, kd };
}

function kpmCurve(rows, start = 2.5, end = 0.0, step = 0.05) {
  const pts = [];
  for (let t = start; t >= end - 1e-9; t -= step) {
    const cut = Math.round(t * 100) / 100;
    const sl = rows.filter((r) => (r.kpm || 0) >= cut);
    const { kills, deaths, kd } = pooled(sl);
    pts.push({ kpm: cut, kd, kills, deaths, n: sl.length });
  }
  return pts;
}

export function isConnectFailure(e) {
  const m = String((e && e.message) || e);
  return /fetch failed|UND_ERR_CONNECT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|aborted due to timeout|Census unavailable|^5\d\d /.test(m);
}

async function resolveCensus(name) {
  // Census matches first name only; watchlist/index names may carry "[TAG] ".
  const raw = censusQueryName(name);
  if (!raw) throw new NotFoundError(`Census: empty name ${JSON.stringify(name)}`);
  const c = await resolveCensusOnly(raw);
  if (!hasHistory(c)) await honuHistoryFallback(c);
  return c;
}

function hasHistory(c) {
  return ["kills", "deaths", "time"].every((t) => (((c.stats || {}).stat_history) || []).some((r) => r && r.stat_name === t));
}

/** Honu /history_stats rows -> Census stat_history rows (kills, deaths, time). */
export function honuHistoryToStatHistory(history) {
  const pick = (t) => {
    const r = (history || []).find((x) => x && x.type === t);
    return r ? String(r.allTime || 0) : "0";
  };
  return ["kills", "deaths", "time"].map((t) => ({ stat_name: t, all_time: pick(t) }));
}

/**
 * Honu fallback, ONLY for history Census lacks (character without
 * stat_history). Documented API: GET /api/character/{id}/history_stats, paced.
 */
async function honuHistoryFallback(c) {
  try {
    const history = await fetchJson(`${HONU}${c.character_id}/history_stats`, { retries: 2 });
    if (!Array.isArray(history) || !history.length) return;
    c.stats = { ...(c.stats || {}), stat_history: honuHistoryToStatHistory(history) };
    console.log(`  (history_stats from Honu: Census had none for ${c.character_id})`);
  } catch (e) {
    console.warn(`  Honu history_stats fallback failed: ${String(e.message).slice(0, 80)}`);
  }
}

/**
 * Assists (Census has no such stat). Honu session summaries carry no assists,
 * so they are counted from Honu exp events, incrementally, via documented API:
 *   1 call  GET /api/character/{id}/sessions               (session list)
 *   <= 3    GET /api/exp/{id}/period2?start&end&interestedEvents=2,3,371,372
 *           (one per new finished session with kills > 0; <= 24 h windows)
 * All paced by honuBucket (20/min) and 429-aware. Stored per session so each
 * session is only ever counted once; nothing here is shown in the UI.
 */
const HONU_API = "https://wt.honu.pw/api/";
/** Honu Experience.IsAssist: ASSIST, SPAWN_ASSIST, PRIORITY_ASSIST, HIGH_PRIORITY_ASSIST. */
export const ASSIST_EXP_IDS = [2, 3, 371, 372];
/**
 * Assist XP encodes the damage share (Varunda; Honu SessionActionLog.vue /
 * outfitreport/InfantryDamage.ts): share = (amount / scoreMult) / base, base
 * ASSIST 100, PRIORITY_ASSIST 150, HIGH_PRIORITY_ASSIST 300 (SPAWN_ASSIST has
 * none). scoreMult is the EARNER's multiplier, derived like Honu's Report.ts
 * from fixed-XP kill events (KILL 100, PRIORITY_KILL 150, HIGH_PRIORITY_KILL 300).
 * Share > 1 means unseen double XP: halve (Honu's heuristic), then cap at 1.
 */
export const ASSIST_BASE_XP = { 2: 100, 371: 150, 372: 300 };
export const KILL_BASE_XP = { 1: 100, 278: 150, 279: 300 };
export const ASSIST_NEW_SESSIONS_PER_REFRESH = 3;
export const ASSIST_MAX_SESSIONS_KEPT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-window assist stats from an exp block holding the player's assist + kill
 * events: { assists, shareSum, shareN, mult }.
 */
export function assistStatsFromBlock(block, cid) {
  const evs = (block && Array.isArray(block.events) ? block.events : [])
    .filter((e) => e && (!cid || String(e.sourceID) === String(cid)));
  const ratios = evs
    .filter((e) => KILL_BASE_XP[+e.experienceID] && +e.amount > 0)
    .map((e) => +e.amount / KILL_BASE_XP[+e.experienceID])
    .sort((a, b) => a - b);
  const mult = ratios.length ? Math.max(1, ratios[ratios.length >> 1]) : 1;
  let assists = 0, shareSum = 0, shareN = 0;
  for (const e of evs) {
    const id = +e.experienceID;
    if (!ASSIST_EXP_IDS.includes(id)) continue;
    assists++;
    const base = ASSIST_BASE_XP[id];
    if (!base || !(+e.amount >= 0)) continue;
    let share = +e.amount / mult / base;
    if (share > 1) share /= 2;
    shareSum += Math.min(1, share);
    shareN++;
  }
  return { assists, shareSum, shareN, mult };
}

/** Count assist events earned by `cid` in an exp block ({events:[…]}). */
export function countAssistEvents(block, cid) {
  let n = 0;
  for (const e of (block && Array.isArray(block.events) ? block.events : [])) {
    if (e && ASSIST_EXP_IDS.includes(+e.experienceID) && (!cid || String(e.sourceID) === String(cid))) n++;
  }
  return n;
}

/** Finished sessions with kills > 0 not counted yet, newest first, capped. */
export function pickNewSessions(sessions, known, cap = ASSIST_NEW_SESSIONS_PER_REFRESH) {
  const have = known || {};
  return (Array.isArray(sessions) ? sessions : [])
    .filter((x) => x && x.id != null && x.end && x.kills > 0 && !(String(x.id) in have)
      && Number.isFinite(Date.parse(x.start)) && Date.parse(x.end) > Date.parse(x.start))
    .sort((p, q) => Date.parse(q.start) - Date.parse(p.start))
    .slice(0, cap);
}

/** <= 24 h windows covering [start, end] (Honu's period2 limit). */
export function dayWindows(startIso, endIso) {
  const out = [];
  const end = Date.parse(endIso);
  for (let t = Date.parse(startIso); t < end; t += DAY_MS) {
    out.push([new Date(t).toISOString(), new Date(Math.min(t + DAY_MS, end)).toISOString()]);
  }
  return out;
}

/**
 * Merge newly counted sessions into the stored record and recompute totals.
 * sessions: { [sessionId]: [assists, kills, seconds, startMs] }; oldest pruned
 * past `maxKept`. Returns null when there is nothing counted at all.
 */
export function mergeAssists(prev, counted, { maxKept = ASSIST_MAX_SESSIONS_KEPT } = {}) {
  const sessions = { ...((prev && prev.sessions) || {}) };
  for (const c of counted || []) {
    sessions[String(c.id)] = [c.assists, c.kills, c.seconds, c.startMs,
      Math.round((c.shareSum || 0) * 1000) / 1000, c.shareN || 0, Math.round((c.mult || 1) * 100) / 100];
  }
  let ids = Object.keys(sessions).filter((id) => Array.isArray(sessions[id]) && sessions[id].length >= 4);
  ids.sort((x, y) => sessions[y][3] - sessions[x][3]);
  for (const id of ids.slice(maxKept)) delete sessions[id];
  ids = ids.slice(0, maxKept);
  if (!ids.length) return null;
  let total = 0, kills = 0, secs = 0, first = Infinity, last = -Infinity, shareSum = 0, shareN = 0;
  for (const id of ids) {
    const [a, k, sec, st, ss = 0, sn = 0] = sessions[id];
    total += a; kills += k; secs += sec; shareSum += ss; shareN += sn;
    first = Math.min(first, st);
    last = Math.max(last, st + sec * 1000);
  }
  const kept = {};
  for (const id of ids) kept[id] = sessions[id];
  shareSum = Math.round(shareSum * 1000) / 1000;
  return {
    total,
    assist_count: total,
    // Damage-share "equivalent kills" from assists; avg over share-able assists (not SPAWN_ASSIST).
    assist_share_sum: shareSum,
    assist_share_n: shareN,
    avg_share: shareN ? Math.round((shareSum / shareN) * 1000) / 1000 : null,
    kills_counted: kills,
    seconds_counted: secs,
    sessions_counted: ids.length,
    first: new Date(first).toISOString(),
    last: new Date(last).toISOString(),
    source: "honu-exp",
    sessions: kept,
  };
}

/**
 * One refresh step for one player. Never throws: on any Honu problem the
 * previous record is returned unchanged (or null = field absent).
 */
export async function updateHonuAssists(cid, prev, {
  getJson = (u) => fetchJson(u, { retries: 2 }),
  cap = ASSIST_NEW_SESSIONS_PER_REFRESH,
} = {}) {
  const keep = prev && prev.sessions ? prev : null;
  if (!/^\d+$/.test(String(cid || ""))) return keep;
  try {
    const list = await getJson(`${HONU_API}character/${cid}/sessions`);
    const todo = pickNewSessions(list, keep && keep.sessions, cap);
    const counted = [];
    for (const sess of todo) {
      let assists = 0, shareSum = 0, shareN = 0, mult = 1;
      for (const [w0, w1] of dayWindows(sess.start, sess.end)) {
        // Kill events too: they give the score multiplier needed for damage share.
        const q = [...ASSIST_EXP_IDS, ...Object.keys(KILL_BASE_XP)].map((id) => `&interestedEvents=${id}`).join("");
        const block = await getJson(`${HONU_API}exp/${cid}/period2?start=${encodeURIComponent(w0)}&end=${encodeURIComponent(w1)}` +
          `&includeCharacters=false&includeExpTypes=false${q}`);
        const st = assistStatsFromBlock(block, cid);
        assists += st.assists; shareSum += st.shareSum; shareN += st.shareN; mult = st.mult;
      }
      const startMs = Date.parse(sess.start);
      counted.push({ id: sess.id, assists, kills: sess.kills, seconds: Math.round((Date.parse(sess.end) - startMs) / 1000), startMs, shareSum, shareN, mult });
    }
    return counted.length ? mergeAssists(keep, counted) : keep;
  } catch (e) {
    console.warn(`  Honu assists skipped: ${String(e && e.message).slice(0, 80)}`);
    return keep;
  }
}

/** Previously stored assists for a cached player (file may not exist yet). */
function readPrevAssists(slug) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "players", `${slug}.json`), "utf8"));
    const a = p && p.player && p.player.assists;
    return a && a.source === "honu-exp" ? a : null;
  } catch {
    return null;
  }
}

async function resolveCensusOnly(raw) {
  let url;
  if (/^\d{16,}$/.test(raw)) {
    url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
  } else {
    url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
  }
  const data = await fetchJson(url, { retries: 3 });
  if (data && !Array.isArray(data.character_list) && (data.error || data.errorCode)) {
    throw new Error(`Census unavailable: ${data.error || data.errorCode}`);
  }
  const chars = (data && data.character_list) || [];
  if (!chars.length || !chars[0] || !chars[0].character_id) {
    throw new NotFoundError(`Census: no character ${raw}`);
  }
  return chars[0];
}

/** Opponents repeat a lot between players: reuse Census lookups within a run. */
const oppMemo = new Map();

/** Refuse to save a curve if more than this share of opponent KPM lookups failed. */
export const MAX_OPP_FAIL_RATIO = 0.1;

/**
 * One killboard row. Null-safe: Honu answers 204 / null for some characters
 * (deleted, no outfit, not tracked); that once crashed with
 * "Cannot read properties of null (reading 'outfitTag')".
 */
export function opponentRow(pair, meta, pace) {
  const p = pair || {};
  const m = meta || {};
  const oid = String(p.otherCharacterID == null ? "" : p.otherCharacterID);
  const tag = m.outfitTag || (m.outfit && m.outfit.alias) || "";
  return {
    name: (tag ? `[${tag}] ` : "") + (m.name || oid),
    kills: +p.kills || 0,
    deaths: +p.deaths || 0,
    kpm: (pace && pace.kpm) || 0,
  };
}

async function loadLive(name, { prevAssists = null } = {}) {
  const c = await resolveCensus(name);
  const cid = c.character_id;
  const outfit = c.outfit || {};
  const gk = hist(c, "kills");
  const gd = hist(c, "deaths");
  const gt = hist(c, "time");
  const gkd = gd ? gk / gd : gk;
  const gkpm = gt ? gk / (gt / 60) : 0;
  const tag = outfit.alias ? `[${outfit.alias}] ` : "";
  const display = `${tag}${(c.name && c.name.first) || censusQueryName(name)}`;

  // Census errors propagate as outages (old data is kept).
  const r = await fetchPlayerCensus(cid, { base: CENSUS, getJson: (u) => fetchJson(u), topN: TOP_N, memo: oppMemo });
  if (!r.board.length) throw new NotFoundError(`Census: empty killboard for ${cid}`);
  // The shared cache never stores a partial curve: keep the old file, retry later.
  if (r.ownFailed || r.skipped) {
    throw new CensusError(`Census busy: ${r.skipped} opponent(s)${r.ownFailed ? " + own stats" : ""} not fetched; keeping old data`);
  }
  const own = r.own || { kpm: 0, acc: 0, hsr: 0, ivi: 0 };
  const rows = r.rows;
  // A curve with many fake 0-KPM opponents is worse than yesterday's data.
  if (r.lookups && r.paceFails / r.lookups > MAX_OPP_FAIL_RATIO) {
    throw new Error(`Census: ${r.paceFails}/${r.lookups} opponent stats missing; keeping old data`);
  }

  const curve = kpmCurve(rows);
  // Collected for later (assists per minute / per kill); not shown in the UI.
  const assists = await updateHonuAssists(cid, prevAssists);
  return {
    query: String(name).trim(),
    top: TOP_N,
    savedAt: Date.now(),
    player: {
      display,
      cid,
      global_kd: gkd,
      global_kpm: gkpm,
      own_kpm: own.kpm || gkpm,
      acc: own.acc,
      hsr: own.hsr,
      ivi: own.ivi,
      n_scored: rows.length,
      honu: `https://wt.honu.pw/c/${cid}/killboard`,
      source: "census",
      ...(assists ? { assists } : {}),
      rows,
      curve,
    },
  };
}

function readWatchlist() {
  if (!fs.existsSync(WATCHLIST_PATH)) return [];
  const lines = fs.readFileSync(WATCHLIST_PATH, "utf8").split(/\r?\n/);
  const names = [];
  for (const line of lines) {
    const t = line.replace(/#.*$/, "").trim();
    if (!t) continue;
    names.push(...parseNames(t));
  }
  return names;
}

/**
 * Names (successfully fetched) not yet in the watchlist, deduped by tag-less
 * slug against the watchlist and each other.
 */
export function newWatchlistNames(existingNames, added) {
  const seen = new Set(existingNames.map(slugKey).filter(Boolean));
  const out = [];
  for (const n of added) {
    const k = slugKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(n).trim());
  }
  return out;
}

function appendToWatchlist(names) {
  const fresh = newWatchlistNames(readWatchlist(), names);
  if (!fresh.length) return [];
  let text = fs.existsSync(WATCHLIST_PATH) ? fs.readFileSync(WATCHLIST_PATH, "utf8") : "";
  if (text && !text.endsWith("\n")) text += "\n";
  writeFileAtomic(WATCHLIST_PATH, text + fresh.join("\n") + "\n");
  return fresh;
}

/** PS2 character names: letters/digits only, up to 32 chars (tag prefix allowed). */
export function isPlausibleName(name) {
  return /^[A-Za-z0-9]{1,32}$/.test(censusQueryName(name)) || /^\d{16,}$/.test(censusQueryName(name));
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { updatedAt: null, players: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    // migrate legacy { demos: [...] }
    if (Array.isArray(raw.demos) && !raw.players) {
      return {
        updatedAt: null,
        players: raw.demos.map((d) => ({
          name: d.name,
          file: d.file?.startsWith("players/") ? d.file : `players/${d.file}`,
          slug: slugKey(d.name),
          savedAt: 0,
          aliases: d.aliases || [],
        })),
      };
    }
    return {
      updatedAt: raw.updatedAt || null,
      players: Array.isArray(raw.players) ? raw.players : [],
    };
  } catch {
    return { updatedAt: null, players: [] };
  }
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function writeIndex(index) {
  writeFileAtomic(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

/** Per-name attempt bookkeeping so failing names don't hog the front of the rotation. */
function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return { updatedAt: raw.updatedAt || null, players: raw.players && typeof raw.players === "object" ? raw.players : {} };
  } catch {
    return { updatedAt: null, players: {} };
  }
}

function writeState(state) {
  const players = {};
  for (const k of Object.keys(state.players).sort()) players[k] = state.players[k];
  writeFileAtomic(STATE_PATH, JSON.stringify({ updatedAt: state.updatedAt, players }, null, 2) + "\n");
}

/**
 * Pick the stalest `size` names. Staleness = max(index savedAt, last attempt).
 * Never fetched and never attempted (0) come first; ties keep input order.
 */
export function pickBatch(names, index, state, size) {
  const savedBySlug = new Map();
  for (const p of (index && index.players) || []) {
    const k = p.slug || slugKey(p.name);
    if (k) savedBySlug.set(k, Math.max(savedBySlug.get(k) || 0, +p.savedAt || 0));
  }
  const st = (state && state.players) || {};
  return names
    .map((name, i) => {
      const k = slugKey(name);
      const last = Math.max(savedBySlug.get(k) || 0, +(st[k] && st[k].lastAttemptAt) || 0);
      return { name, i, last };
    })
    .sort((a, b) => a.last - b.last || a.i - b.i)
    .slice(0, Math.max(0, size))
    .map((x) => x.name);
}

function upsertIndexEntry(index, { name, display, slug, file, savedAt, aliases }) {
  const players = index.players.slice();
  const i = players.findIndex((p) => p.slug === slug || slugKey(p.name) === slug);
  const entry = {
    name: display || name,
    file,
    slug,
    savedAt,
    aliases: aliases && aliases.length ? aliases : [slug, String(name).trim().toLowerCase()].filter(
      (v, idx, a) => v && a.indexOf(v) === idx
    ),
  };
  if (i >= 0) players[i] = { ...players[i], ...entry };
  else players.push(entry);
  players.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  index.players = players;
  index.updatedAt = new Date().toISOString();
}

function collectNames(cliArgs) {
  const fromEnv = process.env.NAMES || "";
  const fromCli = cliArgs.join(" ");
  const explicit = parseNames(fromCli || fromEnv);
  if (explicit.length) {
    // On-demand (Worker / manual) list: dedupe by slug, cap to keep runs short.
    const seen = new Set();
    const out = [];
    for (const n of explicit) {
      const k = slugKey(n);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    if (out.length > MAX_EXPLICIT) {
      console.warn(`Capping on-demand list at ${MAX_EXPLICIT} (got ${out.length}); dropped: ${out.slice(MAX_EXPLICIT).join(", ")}`);
    }
    return { names: out.slice(0, MAX_EXPLICIT), explicit: true };
  }

  const watch = readWatchlist();
  const index = readIndex();
  const fromIndex = index.players.map((p) => p.name).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const n of [...watch, ...fromIndex]) {
    const k = slugKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return { names: out, explicit: false };
}

/* ---------------- live top killers (data/top-killers.txt) ---------------- */

const TK_KEEP_MS = 7 * 24 * 3600 * 1000;
const TK_MAX_ROWS = 5000;
const TK_HEADER =
  "# Top killers seen live on Honu (120-min window), merged by every background run.\n" +
  "# Kept 7 days. seen = runs that saw the player; kpm = best kills/min (>=10 min online).\n" +
  "# name\tworld\tfirstSeen\tlastSeen\tseen\tkills\tdeaths\tminutes\tkpm";

export function parseTopKillers(text) {
  const map = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [name, world, firstSeen, lastSeen, seen, kills, deaths, minutes, kpm] = line.split("\t");
    const k = slugKey(name);
    if (!k) continue;
    map.set(k, {
      name, world: world || "", firstSeen: firstSeen || "", lastSeen: lastSeen || "",
      seen: +seen || 0, kills: +kills || 0, deaths: +deaths || 0, minutes: +minutes || 0, kpm: +kpm || 0,
    });
  }
  return map;
}

export function formatTopKillers(map) {
  const rows = [...map.values()].sort((a, b) => b.seen - a.seen || b.kpm - a.kpm || a.name.localeCompare(b.name));
  return (
    TK_HEADER + "\n" +
    rows.map((r) => [r.name, r.world, r.firstSeen, r.lastSeen, r.seen, r.kills, r.deaths, r.minutes, r.kpm.toFixed(2)].join("\t")).join("\n") +
    (rows.length ? "\n" : "")
  );
}

/**
 * Merge one discovery snapshot. Each player counts once per run (seen += 1).
 * @param {Map} map  slug -> row (mutated)
 * @param {{name:string, world:string, kills:number, deaths:number, secondsOnline:number}[]} entries
 */
export function mergeTopKillers(map, entries, now = Date.now()) {
  const iso = new Date(now).toISOString();
  const seenNow = new Set();
  for (const e of entries || []) {
    const k = slugKey(e.name);
    if (!k || seenNow.has(k)) continue;
    seenNow.add(k);
    const minutes = Math.round((+e.secondsOnline || 0) / 60);
    const kpm = minutes >= 10 ? (+e.kills || 0) / minutes : 0;
    const prev = map.get(k);
    map.set(k, {
      name: String(e.name).replace(/^\[\]\s*/, "").trim(),
      world: e.world || (prev && prev.world) || "",
      firstSeen: (prev && prev.firstSeen) || iso,
      lastSeen: iso,
      seen: ((prev && prev.seen) || 0) + 1,
      kills: +e.kills || 0,
      deaths: +e.deaths || 0,
      minutes,
      kpm: Math.max(kpm, (prev && prev.kpm) || 0),
    });
  }
  for (const [k, r] of map) {
    if (!r.lastSeen || now - Date.parse(r.lastSeen) > TK_KEEP_MS) map.delete(k);
  }
  if (map.size > TK_MAX_ROWS) {
    const keep = [...map.entries()].sort((a, b) => Date.parse(b[1].lastSeen) - Date.parse(a[1].lastSeen)).slice(0, TK_MAX_ROWS);
    map.clear();
    for (const [k, r] of keep) map.set(k, r);
  }
  return map;
}

/** Live players not cached yet: most-seen first, then best KPM. Recent failures skipped. */
export function liveCandidates(map, index, state, now = Date.now()) {
  const known = new Set(((index && index.players) || []).map((p) => p.slug || slugKey(p.name)));
  const st = (state && state.players) || {};
  return [...map.entries()]
    .filter(([k, r]) => {
      if (known.has(k) || !isPlausibleName(r.name)) return false;
      const prev = st[k];
      return retryable(prev, now);
    })
    .sort((a, b) => b[1].seen - a[1].seen || b[1].kpm - a[1].kpm || a[1].name.localeCompare(b[1].name))
    .map(([, r]) => r.name);
}

const NOT_FOUND_RE = /not found|not a valid|no character|empty killboard|unknown character/i;
const MAX_TRANSIENT_TRIES = 3;
const TRANSIENT_RETRY_AFTER_MS = 15 * 60 * 1000;

/**
 * May discovery try this (uncached) name now? Never after a real not-found
 * (no character / invalid name / empty killboard); other errors (timeouts,
 * outages, code bugs) at most MAX_TRANSIENT_TRIES times, 15 min apart.
 */
export function retryable(prev, now = Date.now()) {
  if (!prev || !prev.lastAttemptAt) return true;
  if (prev.kind === "notfound" || (prev.kind !== "transient" && NOT_FOUND_RE.test(prev.lastError || ""))) return false;
  if ((prev.fails || 0) >= MAX_TRANSIENT_TRIES) return false;
  return now - prev.lastAttemptAt >= TRANSIENT_RETRY_AFTER_MS;
}

/**
 * Names whose last fetch failed transiently (timeout, outage, code bug) and may
 * be retried now: new names, and cached players whose own refresh attempt broke
 * (their old file is kept until a retry succeeds). Not a scheduled re-fetch:
 * only failed attempts, max 3 tries. The slug works as a Census name.
 */
export function retryCandidates(index, state, now = Date.now()) {
  return Object.entries((state && state.players) || {})
    .filter(([slug, p]) => p && p.fails > 0 && retryable(p, now) && isPlausibleName(slug) &&
      !(p.lastOkAt && p.lastOkAt >= p.lastAttemptAt))
    .sort((a, b) => a[1].lastAttemptAt - b[1].lastAttemptAt)
    .map(([slug]) => slug);
}

/**
 * Discovery candidates: opponents that show up in already-cached players'
 * killboards but are not in the index yet. Ranked by how many cached players
 * met them, then by total kills+deaths. Unresolved ids, implausible names and
 * names that failed in the last 7 days are skipped.
 * @param {{player:{rows:{name:string,kills:number,deaths:number}[]}}[]} payloads
 */
export function crawlCandidates(payloads, index, state, now = Date.now()) {
  const known = new Set(((index && index.players) || []).map((p) => p.slug || slugKey(p.name)));
  const st = (state && state.players) || {};
  const agg = new Map();
  for (const pl of payloads || []) {
    const seenHere = new Set();
    for (const r of (pl && pl.player && pl.player.rows) || []) {
      const name = String((r && r.name) || "").trim();
      if (!name || /^\d+$/.test(censusQueryName(name)) || !isPlausibleName(name)) continue;
      if (/^RenamedPlayer\d*$/i.test(censusQueryName(name))) continue; // Honu placeholder for renamed chars
      const k = slugKey(name);
      if (!k || known.has(k)) continue;
      const prev = st[k];
      if (!retryable(prev, now)) continue;
      const a = agg.get(k) || { name, seen: 0, volume: 0 };
      a.volume += (+r.kills || 0) + (+r.deaths || 0);
      if (!seenHere.has(k)) {
        seenHere.add(k);
        a.seen++;
      }
      a.name = name; // latest tag wins
      agg.set(k, a);
    }
  }
  return [...agg.values()]
    .sort((x, y) => y.seen - x.seen || y.volume - x.volume || x.name.localeCompare(y.name))
    .map((x) => x.name);
}

function readAllPayloads() {
  const out = [];
  for (const f of fs.existsSync(PLAYERS_DIR) ? fs.readdirSync(PLAYERS_DIR) : []) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(PLAYERS_DIR, f), "utf8")));
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/** data/status.json: what the current run plans to fetch + last run summary (read by status.html). */
export function readStatus() {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

export function writeStatus(patch) {
  const next = { ...readStatus(), ...patch };
  writeFileAtomic(STATUS_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function runPlan(argv) {
  const batchSize = envInt("BATCH_SIZE", 40);
  const crawlMax = Number.isFinite(parseInt(process.env.CRAWL_MAX, 10)) ? Math.max(0, parseInt(process.env.CRAWL_MAX, 10)) : 10;
  const { names: all, explicit } = collectNames(argv);
  const index = readIndex();
  const state = readState();
  const names = explicit ? all : pickBatch(all, index, state, batchSize);
  const crawl = explicit || !crawlMax ? [] : crawlCandidates(readAllPayloads(), index, state).slice(0, crawlMax * 2);
  return { kind: explicit ? "on-demand" : "rotation", names, crawlCandidates: crawl };
}

async function main() {
  if (process.argv.includes("--plan")) {
    // Used by the workflow at flag-raise time; no network.
    const plan = runPlan(process.argv.slice(2).filter((a) => a !== "--plan"));
    writeStatus({
      running: true,
      runId: process.env.GITHUB_RUN_ID || null,
      startedAt: new Date().toISOString(),
      current: plan,
    });
    console.log(JSON.stringify(plan));
    return;
  }
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
  const crawlMax = Number.isFinite(parseInt(process.env.CRAWL_MAX, 10)) ? Math.max(0, parseInt(process.env.CRAWL_MAX, 10)) : 50;
  const crawlIndexCap = envInt("CRAWL_INDEX_CAP", 1500);
  const t0 = Date.now();

  const { names: all, explicit } = collectNames(process.argv.slice(2));
  // On-demand runs stay short so they don't hold the concurrency queue.
  const budgetMs = envInt(explicit ? "ON_DEMAND_BUDGET_MIN" : "TIME_BUDGET_MIN", explicit ? 10 : 9) * 60_000;
  if (!all.length) {
    console.error("No names to refresh. Add data/watchlist.txt or pass names.");
    process.exit(1);
  }
  const index = readIndex();
  const state = readState();
  const names = explicit ? all : [];
  if (explicit) console.log(`Refreshing ${names.length} explicit name(s): ${names.join(", ")}`);
  else console.log(`Background discovery run (cached players are not re-fetched). Index: ${index.players.length}.`);
  console.log(CENSUS_PROXY ? `Census via proxy ${new URL(CENSUS_PROXY).host}${CENSUS_PROXY_KEY ? "" : " (WARNING: no CENSUS_PROXY_KEY)"}.` : "Census direct.");
  const c = { ok: 0, notFound: 0, outage: 0, consecutiveOutage: 0, stoppedEarly: "" };
  const added = []; // explicit names that fetched OK → watchlist
  const discovered = []; // crawl successes → watchlist
  const updated = []; // every name saved this run
  const failed = []; // { name, reason, outage }
  const startedAt = new Date(t0).toISOString();
  if (explicit) {
    // On-demand runs have no flag-on commit; record the plan for status.html.
    writeStatus({ current: { kind: "on-demand", names, crawlCandidates: [] } });
  }

  const overBudget = (reserveMs = 0) => Date.now() - t0 + reserveMs > budgetMs;

  /** Fetch + save one player. Returns display name on success, else null. */
  async function refreshOne(name, label) {
    const slug = slugKey(name);
    if (!slug) {
      console.warn(`Skip empty slug for ${JSON.stringify(name)}`);
      c.notFound++;
      return null;
    }
    console.log(`${label} ${name} (${slug})…`);
    const prev = state.players[slug] || {};
    const now = Date.now();
    let display = null;
    try {
      if (!isPlausibleName(name)) throw new NotFoundError(`not a valid character name ${JSON.stringify(name)}`);
      const payload = await loadLive(name, { prevAssists: readPrevAssists(slug) });
      const fileRel = `players/${slug}.json`;
      writeFileAtomic(path.join(DATA_DIR, fileRel), JSON.stringify(payload) + "\n");
      upsertIndexEntry(index, { name, display: payload.player.display, slug, file: fileRel, savedAt: payload.savedAt });
      writeIndex(index);
      state.players[slug] = { lastAttemptAt: now, lastOkAt: payload.savedAt, fails: 0 };
      c.ok++;
      c.consecutiveOutage = 0;
      display = payload.player.display || name;
      updated.push(display);
      console.log(`  wrote data/${fileRel} (${display})`);
    } catch (e) {
      const msg = String((e && e.message) || e);
      state.players[slug] = {
        lastAttemptAt: now,
        lastOkAt: prev.lastOkAt || null,
        fails: (prev.fails || 0) + 1,
        kind: isOutageError(e) ? "transient" : "notfound",
        lastError: msg.slice(0, 200),
      };
      failed.push({ name, reason: msg.slice(0, 120), outage: isOutageError(e) });
      if (isOutageError(e)) {
        c.outage++;
        c.consecutiveOutage++;
        console.error(`  FAIL (outage?) ${name}: ${msg}`);
      } else {
        c.notFound++;
        console.error(`  SKIP (not found) ${name}: ${msg}`);
      }
    }
    state.updatedAt = new Date().toISOString();
    writeState(state);
    if (c.consecutiveOutage >= MAX_CONSECUTIVE_OUTAGES) {
      c.stoppedEarly = `${c.consecutiveOutage} outage-type failures in a row (Census/Honu down?)`;
    }
    return display;
  }

  // On-demand (Worker / manual names): refresh exactly those names.
  // Background: growth only. Never re-fetch cached players. Discover who is
  // playing well right now (Honu live top killers), fetch the ones not cached
  // yet, then fall back to frequent opponents of cached players.
  const reserveMs = envInt("PLAYER_RESERVE_SEC", explicit ? 0 : 60) * 1000;
  const deadline = t0 + budgetMs;
  let ri = 0;
  // Per-name view of this run for status.html: planned batch with its source,
  // then done / failed / not-found / pending. Committed with the run's data.
  const SRC_LABEL = { live: "top-killers", crawl: "opponent-crawl", retry: "retry", "on-demand": "on-demand", refresh: "daily-refresh" };
  const batch = [];
  const plan = (name, src) => batch.push({ name, src: SRC_LABEL[src] || src, status: "pending" });
  const settle = (name, display) => {
    const row = batch.find((b) => b.name === name) || (plan(name, "?"), batch[batch.length - 1]);
    if (display) {
      row.status = "done";
      row.name = display;
    } else {
      const f = [...failed].reverse().find((x) => x.name === name);
      row.status = f && !f.outage ? "not-found" : "failed";
      if (f) row.reason = f.reason;
    }
  };
  if (explicit) names.forEach((n) => plan(n, "on-demand"));
  if (explicit) {
    while (ri < names.length && !c.stoppedEarly && Date.now() < deadline) {
      if (ri > 0) await sleep(BETWEEN_PLAYERS_MS);
      const d = await refreshOne(names[ri], `[name ${ri + 1}/${names.length}]`);
      settle(names[ri], d);
      ri++;
      if (d) added.push(d);
    }
    if (ri < names.length && !c.stoppedEarly) c.stoppedEarly = `time budget ${Math.round(budgetMs / 60000)} min reached`;
  }

  const crawlFrom = Date.now();

  let live = null;
  let fromLive = 0;
  let more = false; // worth chaining another background run right away?
  let growthLeft = false; // background: uncached names left with room under the cap
  let refreshed = 0; // background: stale cached players re-fetched this run
  if (!explicit) {
    // No live scraping any more (Honu's /ws/data feed is not an API). The
    // top-killers list is read as a static seed; discovery is otherwise the
    // opponents of cached players (their killboards come from Census).
    const tk = parseTopKillers(fs.existsSync(TOP_KILLERS_PATH) ? fs.readFileSync(TOP_KILLERS_PATH, "utf8") : "");
    const liveNames = liveCandidates(tk, index, state);
    const room = Math.max(0, Math.min(crawlMax, crawlIndexCap - index.players.length));
    if (!room) {
      console.log(`Index has ${index.players.length} >= CRAWL_INDEX_CAP=${crawlIndexCap}: no discovery, no network.`);
    }
    const seen = new Set();
    const queue = [];
    for (const n of room ? liveNames : []) if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "live" }); }
    const liveCount = queue.length;
    for (const n of room ? retryCandidates(index, state) : []) if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "retry" }); }
    const retryCount = queue.length - liveCount;
    // Fallback only needs a few names; computing it reads every cached file.
    if (room && queue.length < room) {
      for (const n of crawlCandidates(readAllPayloads(), index, state)) {
        if (queue.length >= room * 2 + 10) break;
        if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "crawl" }); }
      }
    }
    console.log(`New-player queue: ${liveCount} live + ${retryCount} retry + ${queue.length - liveCount - retryCount} opponent fallback; room ${room} (cap ${crawlIndexCap}). Next: ${queue.slice(0, 12).map((q) => q.name).join(", ")}`);
    queue.slice(0, Math.min(room, 20)).forEach((q) => plan(q.name, q.src));
    writeStatus({ running: true, current: { kind: "discovery", runId: process.env.GITHUB_RUN_ID || null, startedAt, batch } });
    let tried = 0;
    // Chain the next run if there were more names than this run could take.
    more = room > 0 && queue.length > 0;
    growthLeft = more;
    for (const q of queue) {
      if (discovered.length >= room || c.stoppedEarly) break;
      if (Date.now() + reserveMs > deadline) {
        c.stoppedEarly = `time budget ${Math.round(budgetMs / 60000)} min reached`;
        break;
      }
      if (tried) await sleep(BETWEEN_PLAYERS_MS);
      tried++;
      const wasCached = index.players.some((p) => (p.slug || slugKey(p.name)) === slugKey(q.name));
      if (!batch.some((b) => b.name === q.name)) plan(q.name, q.src);
      const d = await refreshOne(q.name, wasCached ? `[repair ${q.src}]` : `[new ${discovered.length + 1}/${room} ${q.src}]`);
      settle(q.name, d);
      if (d && !wasCached) {
        discovered.push(d);
        if (q.src === "live") fromLive++;
      }
    }

    // Daily refresh: cached players last saved (or tried) > 24 h ago, oldest first.
    const stale = staleCandidates(index, state, Date.now());
    if (stale.length) console.log(`Stale cached players (> 24 h): ${stale.length}; refreshing oldest first.`);
    for (const name of stale) {
      if (c.stoppedEarly) break;
      if (Date.now() + reserveMs > deadline) {
        c.stoppedEarly = `time budget ${Math.round(budgetMs / 60000)} min reached`;
        break;
      }
      if (tried) await sleep(BETWEEN_PLAYERS_MS);
      tried++;
      if (!batch.some((b) => b.name === name)) plan(name, "refresh");
      const d = await refreshOne(name, `[refresh ${tried}/${stale.length}]`);
      settle(name, d);
      if (d) refreshed++;
    }
  }
  const crawlSecs = Math.round((Date.now() - crawlFrom) / 1000);

  // Successful on-demand + discovered names join the watchlist (failures don't).
  let joined = [];
  const toJoin = [...(explicit ? added : []), ...discovered];
  if (toJoin.length) {
    joined = appendToWatchlist(toJoin);
    if (joined.length) console.log(`Added to watchlist: ${joined.join(", ")}`);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const summary =
    `Done in ${secs}s. ok=${c.ok} notFound=${c.notFound} outage=${c.outage} index=${index.players.length}` +
    `${discovered.length ? ` new=${discovered.length} (live ${fromLive}, opponents ${discovered.length - fromLive}; ${crawlSecs}s)` : ""}` +
    `${refreshed ? ` refreshed=${refreshed}` : ""}` +
    `${joined.length ? ` watchlist+=${joined.length}` : ""}` +
    `${c.stoppedEarly ? ` (stopped early: ${c.stoppedEarly})` : ""}`;
  console.log(summary);
  writeStatus({
    lastRun: {
      runId: process.env.GITHUB_RUN_ID || null,
      event: process.env.GITHUB_EVENT_NAME || "local",
      kind: explicit ? "on-demand" : "discovery",
      startedAt,
      endedAt: new Date().toISOString(),
      seconds: secs,
      updated: updated.filter((n) => !discovered.includes(n) && !(explicit && joined.includes(n))),
      added: [...discovered, ...(explicit ? joined : [])].filter((n, i, a) => a.indexOf(n) === i),
      failed,
      stoppedEarly: c.stoppedEarly || null,
      indexSize: index.players.length,
      newFromLive: fromLive,
      liveWorlds: live ? live.worlds : [],
      liveErrors: live ? live.errors : [],
      batch,
    },
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Shared cache refresh\n\n${summary}\n`);
    } catch {
      /* ignore */
    }
  }
  if (!explicit) {
    // data/schedule.json tells the Worker cron whether a background run is due
    // (it polls this static file instead of dispatching blindly every 5 min).
    // Deterministic when idle, so idle runs produce no diff and no commit.
    const after = staleCandidates(index, state, Date.now());
    writeScheduleFile(computeSchedule({
      growthLeft,
      staleLeft: after.length,
      nextStaleAt: nextStaleAt(index, state),
      outageStop: !!c.stoppedEarly && c.outage > 0,
      now: Date.now(),
    }));
  }
  if (process.env.GITHUB_OUTPUT) {
    try {
      // Chain only after real progress (never loop on an outage), while names remain.
      const chain = more && discovered.length > 0 && index.players.length < crawlIndexCap;
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${c.ok}\nnew=${discovered.length}\nmore=${chain}\n`);
    } catch {
      /* ignore */
    }
  }
  // Bad / misspelled names are logged and skipped; their existing files and
  // index entries are left untouched. Only a run where nothing refreshed and
  // something looked like a real outage fails the job.
  if (c.ok === 0 && c.outage > 0) process.exit(1);
}

/** Gap between refresh-only runs (keeps Census load and Pages commits ~hourly). */
export const REFRESH_RUN_GAP_MS = 55 * 60 * 1000;

/** Last time a cached player was saved or tried (ms; 0 = never). */
function lastTouched(p, state) {
  const k = p.slug || slugKey(p.name);
  const st = (state && state.players && state.players[k]) || {};
  return Math.max(+p.savedAt || 0, +st.lastAttemptAt || 0);
}

/**
 * Cached players due for their (at most daily) refresh, oldest first.
 * Uses the index name (Census resolves "[TAG] Name" by first name).
 */
export function staleCandidates(index, state, now = Date.now(), maxAgeMs = REFRESH_AFTER_MS) {
  return ((index && index.players) || [])
    .map((p, i) => ({ p, i, last: lastTouched(p, state) }))
    .filter((x) => x.p && x.p.name && now - x.last >= maxAgeMs && isPlausibleName(x.p.name))
    .sort((a, b) => a.last - b.last || a.i - b.i)
    .map((x) => x.p.name);
}

/** When the next cached player becomes stale (ms), or null with an empty index. */
export function nextStaleAt(index, state, maxAgeMs = REFRESH_AFTER_MS) {
  let min = Infinity;
  for (const p of (index && index.players) || []) {
    if (p && p.name && isPlausibleName(p.name)) min = Math.min(min, lastTouched(p, state) + maxAgeMs);
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * When should the next background run start? null = nothing to do (idle).
 * Growth: right away. Stale players left: in ~an hour. Otherwise when the
 * next cached player turns 24 h old (deterministic, so idle runs don't commit).
 * @returns {{ nextDueAt: string|null, reason: string }}
 */
export function computeSchedule({ growthLeft = false, staleLeft = 0, nextStaleAt: nextStale = null, outageStop = false, now = Date.now() } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  if (outageStop && (growthLeft || staleLeft)) return { nextDueAt: iso(now + 30 * 60_000), reason: "retry after outage" };
  if (growthLeft) return { nextDueAt: iso(now), reason: "growth" };
  if (staleLeft > 0) return { nextDueAt: iso(now + REFRESH_RUN_GAP_MS), reason: `daily refresh (${staleLeft} left)` };
  if (nextStale != null) return { nextDueAt: iso(nextStale), reason: "daily refresh" };
  return { nextDueAt: null, reason: "idle" };
}

function writeScheduleFile(sched) {
  writeFileAtomic(SCHEDULE_PATH, JSON.stringify(sched, null, 2) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
