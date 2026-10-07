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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PLAYERS_DIR = path.join(DATA_DIR, "players");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const WATCHLIST_PATH = path.join(DATA_DIR, "watchlist.txt");
const STATE_PATH = path.join(DATA_DIR, "refresh-state.json");

const HONU = "https://wt.honu.pw/api/character/";
const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
const TOP_N = 50;
const OPP_CONCURRENCY = 4;
const BETWEEN_PLAYERS_MS = 1500;
const BETWEEN_BATCH_MS = 200;
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

export function backoffMs(attempt, retryAfterHeader) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  // 1s, 2s, 4s, 8s … capped, with a little jitter.
  return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
}

async function fetchJson(url, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    let wait = backoffMs(attempt);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        wait = backoffMs(attempt, res.headers.get("retry-after"));
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
    }
    if (attempt + 1 < retries) await sleep(wait);
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

async function resolveCensus(name) {
  // Census matches first name only; watchlist/index names may carry "[TAG] ".
  const raw = censusQueryName(name);
  if (!raw) throw new NotFoundError(`Census: empty name ${JSON.stringify(name)}`);
  let url;
  if (/^\d{16,}$/.test(raw)) {
    url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
  } else {
    url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
  }
  const data = await fetchJson(url);
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
    return {};
  }
}

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
    return { wk: 0, wd: 0, kpm: 0, acc: 0, hsr: 0, ivi: 0 };
  }
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

  const own = await honuWeaponPace(cid);
  await sleep(BETWEEN_BATCH_MS);
  const board = await honuKillboard(cid);
  board.sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths));
  const sample = board.slice(0, TOP_N);

  const rows = [];
  let i = 0;
  async function worker() {
    while (i < sample.length) {
      const idx = i++;
      const pair = sample[idx];
      const oid = String(pair.otherCharacterID);
      const [meta, pace] = await Promise.all([honuMeta(oid), honuWeaponPace(oid)]);
      const etag = meta.outfitTag ? `[${meta.outfitTag}] ` : "";
      rows[idx] = {
        name: etag + (meta.name || oid),
        kills: +pair.kills || 0,
        deaths: +pair.deaths || 0,
        kpm: pace.kpm || 0,
      };
      if (idx % OPP_CONCURRENCY === 0) await sleep(BETWEEN_BATCH_MS);
    }
  }
  await Promise.all(Array.from({ length: OPP_CONCURRENCY }, () => worker()));

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

async function main() {
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
  const batchSize = envInt("BATCH_SIZE", 30);
  const t0 = Date.now();

  const { names: all, explicit } = collectNames(process.argv.slice(2));
  // On-demand runs stay short so they don't hold the concurrency queue.
  const budgetMs = envInt(explicit ? "ON_DEMAND_BUDGET_MIN" : "TIME_BUDGET_MIN", explicit ? 10 : 35) * 60_000;
  const added = [];
  if (!all.length) {
    console.error("No names to refresh. Add data/watchlist.txt or pass names.");
    process.exit(1);
  }
  const index = readIndex();
  const state = readState();
  const names = explicit ? all : pickBatch(all, index, state, batchSize);

  console.log(
    explicit
      ? `Refreshing ${names.length} explicit name(s): ${names.join(", ")}`
      : `Rotation: ${names.length} stalest of ${all.length} name(s) (BATCH_SIZE=${batchSize}): ${names.join(", ")}`
  );
  let ok = 0;
  let notFound = 0;
  let outage = 0;
  let consecutiveOutage = 0;
  let stoppedEarly = "";

  for (let i = 0; i < names.length; i++) {
    if (Date.now() - t0 > budgetMs) {
      stoppedEarly = `time budget ${Math.round(budgetMs / 60000)} min reached`;
      break;
    }
    const name = names[i];
    const slug = slugKey(name);
    if (!slug) {
      console.warn(`Skip empty slug for ${JSON.stringify(name)}`);
      notFound++;
      continue;
    }
    console.log(`[${i + 1}/${names.length}] ${name} (${slug})…`);
    const prev = state.players[slug] || {};
    const now = Date.now();
    try {
      if (!isPlausibleName(name)) throw new NotFoundError(`not a valid character name ${JSON.stringify(name)}`);
      const payload = await loadLive(name);
      const fileRel = `players/${slug}.json`;
      writeFileAtomic(path.join(DATA_DIR, fileRel), JSON.stringify(payload) + "\n");
      upsertIndexEntry(index, {
        name,
        display: payload.player.display,
        slug,
        file: fileRel,
        savedAt: payload.savedAt,
      });
      writeIndex(index);
      state.players[slug] = { lastAttemptAt: now, lastOkAt: payload.savedAt, fails: 0 };
      ok++;
      added.push(payload.player.display || name);
      consecutiveOutage = 0;
      console.log(`  wrote data/${fileRel} (${payload.player.display})`);
    } catch (e) {
      const msg = String((e && e.message) || e);
      state.players[slug] = {
        lastAttemptAt: now,
        lastOkAt: prev.lastOkAt || null,
        fails: (prev.fails || 0) + 1,
        lastError: msg.slice(0, 200),
      };
      if (isOutageError(e)) {
        outage++;
        consecutiveOutage++;
        console.error(`  FAIL (outage?) ${name}: ${msg}`);
      } else {
        notFound++;
        console.error(`  SKIP (not found) ${name}: ${msg}`);
      }
    }
    state.updatedAt = new Date().toISOString();
    writeState(state);
    if (consecutiveOutage >= MAX_CONSECUTIVE_OUTAGES) {
      stoppedEarly = `${consecutiveOutage} outage-type failures in a row (Census/Honu down?)`;
      break;
    }
    if (i + 1 < names.length) await sleep(BETWEEN_PLAYERS_MS);
  }

  // On-demand names that fetched OK join the hourly rotation (failures don't).
  let joined = [];
  if (explicit && added.length) {
    joined = appendToWatchlist(added);
    if (joined.length) console.log(`Added to watchlist: ${joined.join(", ")}`);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const summary = `Done in ${secs}s. ok=${ok} notFound=${notFound} outage=${outage} index=${index.players.length}${joined.length ? ` watchlist+=${joined.length}` : ""}${stoppedEarly ? ` (stopped early: ${stoppedEarly})` : ""}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Shared cache refresh\n\n${summary}\n`);
    } catch {
      /* ignore */
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\n`);
    } catch {
      /* ignore */
    }
  }
  // Bad / misspelled names are logged and skipped; their existing files and
  // index entries are left untouched. Only a run where nothing refreshed and
  // something looked like a real outage fails the job.
  if (ok === 0 && outage > 0) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
