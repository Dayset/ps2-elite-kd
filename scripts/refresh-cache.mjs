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
import { PC_WORLDS, worldTopKillers } from "./honu-live.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PLAYERS_DIR = path.join(DATA_DIR, "players");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const WATCHLIST_PATH = path.join(DATA_DIR, "watchlist.txt");
const STATE_PATH = path.join(DATA_DIR, "refresh-state.json");
const STATUS_PATH = path.join(DATA_DIR, "status.json");
const TOP_KILLERS_PATH = path.join(DATA_DIR, "top-killers.txt");

const HONU = "https://wt.honu.pw/api/character/";
const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
const TOP_N = 50;
const OPP_CONCURRENCY = 4;
const BETWEEN_PLAYERS_MS = 1500;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "ps2-elite-kd-cache-bot/1.1 (+https://github.com/Dayset/ps2-elite-kd)";
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
 * Honu rate-limits per IP (Actions runners hit 429 + Retry-After: 60 after
 * ~300 requests in a minute). All Honu calls go through one paced queue:
 * at most HONU_RPS requests/second, and a 429 pauses every worker.
 */
const HONU_RPS = Number(process.env.HONU_RPS) > 0 ? Number(process.env.HONU_RPS) : 2;
let honuNextSlot = 0;
async function honuSlot() {
  const now = Date.now();
  const at = Math.max(now, honuNextSlot);
  honuNextSlot = at + Math.ceil(1000 / HONU_RPS);
  if (at > now) await sleep(at - now);
}
function honuPause(ms) {
  honuNextSlot = Math.max(honuNextSlot, Date.now() + ms);
}

export function backoffMs(attempt, retryAfterHeader) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  // 1s, 2s, 4s, 8s … capped, with a little jitter.
  return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
}

async function fetchJson(url, { retries = 4 } = {}) {
  let lastErr;
  const isHonu = url.startsWith(HONU);
  for (let attempt = 0; attempt < retries; attempt++) {
    let wait = backoffMs(attempt);
    if (isHonu) await honuSlot();
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        wait = backoffMs(attempt, res.headers.get("retry-after"));
        if (isHonu && res.status === 429) {
          honuPause(wait); // slow everyone down, not just this request
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

/**
 * Census is unreachable from some GitHub runner IPs (connect timeouts) and is
 * flaky in general. After one such failure, skip Census for the rest of the run
 * and resolve characters through Honu instead (same data, Census-shaped).
 */
let censusDown = process.env.CENSUS_DISABLED === "1";
export function isConnectFailure(e) {
  const m = String((e && e.message) || e);
  return /fetch failed|UND_ERR_CONNECT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|aborted due to timeout|Census unavailable|^5\d\d /.test(m);
}

/** Build the Census-shaped character object loadLive needs from Honu REST. */
export function honuToCensusShape(ch, history) {
  const pick = (t) => {
    const r = (history || []).find((x) => x && x.type === t);
    return r ? String(r.allTime || 0) : "0";
  };
  return {
    character_id: String(ch.id),
    name: { first: ch.name },
    outfit: ch.outfitTag ? { alias: ch.outfitTag } : {},
    stats: { stat_history: ["kills", "deaths", "time"].map((t) => ({ stat_name: t, all_time: pick(t) })) },
  };
}

async function resolveHonu(raw) {
  const isId = /^\d{16,}$/.test(raw);
  let ch;
  if (isId) {
    ch = await fetchJson(`${HONU}${raw}`);
  } else {
    let list = [];
    try {
      list = await fetchJson(`${HONU.replace(/character\/$/, "characters/")}name/${encodeURIComponent(raw)}`);
    } catch (e) {
      if (!(e instanceof HttpClientError && e.status === 404)) throw e;
    }
    ch = (Array.isArray(list) ? list : []).find((x) => x && String(x.name).toLowerCase() === raw.toLowerCase()) || null;
  }
  if (!ch || !ch.id) throw new NotFoundError(`Honu: no character ${raw}`);
  const history = await fetchJson(`${HONU}${ch.id}/history_stats`);
  return honuToCensusShape(ch, Array.isArray(history) ? history : []);
}

async function resolveCensus(name) {
  // Census matches first name only; watchlist/index names may carry "[TAG] ".
  const raw = censusQueryName(name);
  if (!raw) throw new NotFoundError(`Census: empty name ${JSON.stringify(name)}`);
  if (censusDown) return resolveHonu(raw);
  try {
    return await resolveCensusOnly(raw);
  } catch (e) {
    if (e instanceof NotFoundError || !isConnectFailure(e)) throw e;
    censusDown = true;
    console.warn(`  Census unreachable (${String(e.message).slice(0, 80)}); using Honu for the rest of this run`);
    return resolveHonu(raw);
  }
}

async function resolveCensusOnly(raw) {
  let url;
  if (/^\d{16,}$/.test(raw)) {
    url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
  } else {
    url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
  }
  const data = await fetchJson(url, { retries: 2 });
  if (data && !Array.isArray(data.character_list) && (data.error || data.errorCode)) {
    throw new Error(`Census unavailable: ${data.error || data.errorCode}`);
  }
  const chars = (data && data.character_list) || [];
  if (!chars.length || !chars[0] || !chars[0].character_id) {
    throw new NotFoundError(`Census: no character ${raw}`);
  }
  return chars[0];
}

async function honuKillboard(cid) {
  let board;
  try {
    board = await fetchJson(`${HONU}${cid}/killboard`);
  } catch (e) {
    if (e instanceof HttpClientError && e.status === 404) {
      throw new NotFoundError(`Honu: no killboard for ${cid}`);
    }
    throw e;
  }
  if (board == null) board = [];
  if (!Array.isArray(board)) throw new Error(`Honu: unexpected killboard for ${cid}`);
  // Never overwrite existing good data with an empty curve.
  if (!board.length) throw new NotFoundError(`Honu: empty killboard for ${cid}`);
  return board;
}

async function honuMeta(cid) {
  try {
    return (await fetchJson(`${HONU}${cid}`)) || {};
  } catch {
    return null;
  }
}

/** Opponents repeat a lot between players on one server: memoize per run. */
const oppMemo = new Map();
/** Opponent display names from one batched Census call (saves ~50 Honu calls per player). */
const nameMemo = new Map();
function opponentInfo(oid) {
  if (!oppMemo.has(oid)) {
    const known = nameMemo.get(oid);
    const metaP = known ? Promise.resolve(known) : honuMeta(oid);
    const p = Promise.all([metaP, honuWeaponPace(oid)]).then(([meta, pace]) => {
      if (!meta || !pace) oppMemo.delete(oid); // don't memoize failures
      return { meta, pace };
    });
    oppMemo.set(oid, p);
  }
  return oppMemo.get(oid);
}

/** Fill nameMemo for ids via Census (best effort; Honu meta is the fallback). */
async function censusOpponentNames(ids) {
  if (censusDown) return;
  const want = [...new Set(ids)].filter((id) => id && id !== "0" && !nameMemo.has(id) && !oppMemo.has(id));
  for (let i = 0; i < want.length; i += 50) {
    const chunk = want.slice(i, i + 50);
    try {
      const url =
        `${CENSUS}character?character_id=${chunk.join(",")}` +
        `&c:show=character_id,name.first&c:resolve=outfit(alias)&c:limit=${chunk.length}`;
      const data = await fetchJson(url, { retries: 2 });
      for (const ch of (data && data.character_list) || []) {
        if (ch && ch.character_id && ch.name && ch.name.first) {
          nameMemo.set(String(ch.character_id), { name: ch.name.first, outfitTag: (ch.outfit && ch.outfit.alias) || "" });
        }
      }
    } catch (e) {
      /* Census flaky: fall back to Honu per-opponent meta */
      if (isConnectFailure(e)) censusDown = true;
    }
  }
}

/** Refuse to save a curve if more than this share of opponent KPM lookups failed. */
export const MAX_OPP_FAIL_RATIO = 0.1;

/** @returns stats, or null if Honu could not be read (not the same as zeros). */
async function honuWeaponPace(cid) {
  try {
    const stats = await fetchJson(`${HONU}${cid}/stats`);
    if (!Array.isArray(stats)) throw new Error("stats not a list");
    let wk = 0;
    let wd = 0;
    let wt = 0;
    let fire = 0;
    let hitc = 0;
    let hs = 0;
    for (const row of stats) {
      const n = row.statName;
      const v = +row.valueForever || 0;
      if (n === "weapon_kills") wk = v;
      else if (n === "weapon_deaths") wd = v;
      else if (n === "weapon_play_time") wt = v;
      else if (n === "weapon_fire_count") fire = v;
      else if (n === "weapon_hit_count") hitc = v;
      else if (n === "weapon_headshots") hs = v;
    }
    const kpm = wt ? wk / (wt / 60) : 0;
    const acc = fire ? (100 * hitc) / fire : 0;
    const hsr = wk ? (100 * hs) / wk : 0;
    const ivi = acc * hsr;
    return { wk, wd, kpm, acc, hsr, ivi };
  } catch {
    return null;
  }
}

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

async function loadLive(name) {
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

  const own = (await honuWeaponPace(cid)) || { kpm: 0, acc: 0, hsr: 0, ivi: 0 };
  const board = await honuKillboard(cid);
  board.sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths));
  const sample = board.slice(0, TOP_N);
  await censusOpponentNames(sample.map((p) => String(p.otherCharacterID)));

  const rows = [];
  let i = 0;
  let paceFails = 0;
  let lookups = 0;
  async function worker() {
    while (i < sample.length) {
      const idx = i++;
      const pair = sample[idx];
      const oid = String(pair.otherCharacterID);
      // "0" = environment / unknown attacker: nothing to look up.
      const { meta, pace } = oid === "0" ? { meta: {}, pace: { kpm: 0 } } : await opponentInfo(oid);
      if (oid !== "0") {
        lookups++;
        if (!pace) paceFails++;
      }
      rows[idx] = opponentRow(pair, meta, pace);
    }
  }
  await Promise.all(Array.from({ length: OPP_CONCURRENCY }, () => worker()));
  // A curve with many fake 0-KPM opponents is worse than yesterday's data.
  if (lookups && paceFails / lookups > MAX_OPP_FAIL_RATIO) {
    throw new Error(`Honu: ${paceFails}/${lookups} opponent stats failed (rate-limited?); keeping old data`);
  }

  const curve = kpmCurve(rows);
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

/** Pull top killers from every PC world with players online (~5 paced requests per world). */
async function discoverLive() {
  const out = { worlds: [], entries: [], errors: [] };
  let active = PC_WORLDS;
  try {
    await honuSlot();
    const res = await fetch("https://wt.honu.pw/api/world/overview", {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json();
      const list = Array.isArray(body) ? body : (body && body.data) || [];
      const online = new Map(list.map((w) => [+w.worldID, +w.playersOnline || 0]));
      active = PC_WORLDS.filter((w) => (online.get(w.id) || 0) > 0);
    }
  } catch {
    /* overview failed: try every PC world */
  }
  for (const w of active) {
    try {
      const r = await worldTopKillers(w.id, { userAgent: USER_AGENT, timeoutMs: 40_000, beforeRequest: honuSlot });
      out.worlds.push({ name: w.name, online: r.onlineCount, killers: r.killers.length });
      for (const k of r.killers) out.entries.push({ ...k, world: w.name });
    } catch (e) {
      out.errors.push(`${w.name}: ${String((e && e.message) || e).slice(0, 80)}`);
    }
  }
  return out;
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
      const payload = await loadLive(name);
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
  const SRC_LABEL = { live: "top-killers", crawl: "opponent-crawl", retry: "retry", "on-demand": "on-demand" };
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
  if (!explicit) {
    live = await discoverLive();
    const tk = parseTopKillers(fs.existsSync(TOP_KILLERS_PATH) ? fs.readFileSync(TOP_KILLERS_PATH, "utf8") : "");
    mergeTopKillers(tk, live.entries);
    writeFileAtomic(TOP_KILLERS_PATH, formatTopKillers(tk));
    console.log(
      `Live: ${live.worlds.map((w) => `${w.name} ${w.online} online/${w.killers} top`).join(", ") || "no worlds"}` +
      `${live.errors.length ? `; errors: ${live.errors.join("; ")}` : ""}; list has ${tk.size} names`
    );
    const liveNames = liveCandidates(tk, index, state);
    const room = Math.max(0, Math.min(crawlMax, crawlIndexCap - index.players.length));
    const seen = new Set();
    const queue = [];
    for (const n of liveNames) if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "live" }); }
    const liveCount = queue.length;
    for (const n of retryCandidates(index, state)) if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "retry" }); }
    const retryCount = queue.length - liveCount;
    // Fallback only needs a few names; computing it reads every cached file.
    if (queue.length < room) {
      for (const n of crawlCandidates(readAllPayloads(), index, state)) {
        if (queue.length >= room * 2 + 10) break;
        if (!seen.has(slugKey(n))) { seen.add(slugKey(n)); queue.push({ name: n, src: "crawl" }); }
      }
    }
    console.log(`New-player queue: ${liveCount} live + ${retryCount} retry + ${queue.length - liveCount - retryCount} opponent fallback; room ${room} (cap ${crawlIndexCap}). Next: ${queue.slice(0, 12).map((q) => q.name).join(", ")}`);
    queue.slice(0, Math.min(room, 20)).forEach((q) => plan(q.name, q.src));
    writeStatus({ running: true, current: { kind: "discovery", runId: process.env.GITHUB_RUN_ID || null, startedAt, batch } });
    if (!room) console.log(`Index has ${index.players.length} ≥ CRAWL_INDEX_CAP=${crawlIndexCap}; nothing to add.`);
    let tried = 0;
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
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${c.ok}\nnew=${discovered.length}\n`);
    } catch {
      /* ignore */
    }
  }
  // Bad / misspelled names are logged and skipped; their existing files and
  // index entries are left untouched. Only a run where nothing refreshed and
  // something looked like a real outage fails the job.
  if (c.ok === 0 && c.outage > 0) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
