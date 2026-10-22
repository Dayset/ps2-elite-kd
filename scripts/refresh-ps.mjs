#!/usr/bin/env node
/**
 * PlayStation room refresh (#55). Grows and refreshes data-ps/ only.
 *
 * The PC pipeline (scripts/refresh-cache.mjs → data/) is not touched: this
 * script never reads or writes data/, and refuses to run with ROOM=pc.
 *
 * Same method as PC, per PlayStation server (Census namespace ps2ps4us =
 * Genudine, ps2ps4eu = Ceres; PS5 players are on the same two servers):
 *  - discovery: Census login sweep + 7-day fight filter (scripts/discovery.mjs,
 *    unchanged), one resumable sweep per server;
 *  - per player: the same ~8 batched Census calls as PC (census-fetch.mjs:
 *    killboard, own + opponent stats, names) + the 🪖 infantry split;
 *  - refresh tiers by last activity (weekly / 2 weeks / monthly / never 🪦).
 * No Honu: whether Honu covers the PS servers is unverified, so PS players
 * have no 🤝 assists / 🪳 zerg yet (the site already shows "—" for that).
 *
 * Identity = server + Census character id. Player files are
 * data-ps/players/<us|eu>-<cid>.json; names are labels. Every Census call
 * for a player goes to that player's own namespace, and opponent lookups are
 * memoized per namespace, so the two servers can't mix either.
 *
 * Usage (Actions: .github/workflows/refresh-ps.yml):
 *   node scripts/refresh-ps.mjs                       # background: discovery + tiered refresh
 *   NAMES="Shadow us-5428452358028858337" node scripts/refresh-ps.mjs   # on demand
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  censusRequest,
  CensusError,
  fetchPlayerCensus,
  OPPONENT_TOP_N,
  tokenBucket,
} from "../census-fetch.mjs";
import { fetchInfantry } from "../infantry.mjs";
import { accountTimes } from "../flairs.mjs";
import { ROOMS, PS_SERVERS, censusNsBase, psKey, parsePsKey, psPlayerFile } from "../rooms.mjs";
import {
  isNewAccount,
  lastActiveMs,
  nextCap,
  normalizeDiscovery,
  rankQueue,
  refreshIntervalMs,
  sweepDue,
  sweepDueAt,
  sweepSlice,
} from "./discovery.mjs";
import {
  CACHE_FORMAT,
  MAX_OPP_FAIL_RATIO,
  NotFoundError,
  PARTIAL_SHIP_AFTER,
  PARTIAL_SHIP_MIN_OK,
  REFRESH_RUN_GAP_MS,
  computeSchedule,
  hist,
  isOutageError,
  kpmCurve,
  retryable,
  viaCensusProxy,
} from "./refresh-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const ROOM = ROOMS.ps;
const DATA_DIR = path.join(ROOT, ROOM.dataDir);
const P = {
  players: path.join(DATA_DIR, "players"),
  index: path.join(DATA_DIR, "index.json"),
  state: path.join(DATA_DIR, "refresh-state.json"),
  status: path.join(DATA_DIR, "status.json"),
  discovery: path.join(DATA_DIR, "discovery.json"),
  schedule: path.join(DATA_DIR, "schedule.json"),
};

/** PS cap ladder: the PC style (stay until the index reaches a step), smaller steps for a smaller population. */
export const PS_CAP_STEPS = [1000, 2000, 4000, 8000, 16000];
/** Modest cadence: at least this long between PS runs while growing (shares the Census service id with PC). */
export const PS_GROWTH_GAP_MS = 30 * 60 * 1000;
const BETWEEN_PLAYERS_MS = 1500;
const MAX_CONSECUTIVE_OUTAGES = 4;
const MAX_EXPLICIT = 40;
const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset; room ps)";
const CENSUS_SERVICE_ID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const CENSUS_PROXY = String(process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const CENSUS_PROXY_KEY = String(process.env.CENSUS_PROXY_KEY || "");
const censusBucket = tokenBucket({ capacity: 5, perMinute: Number(process.env.CENSUS_RPM) > 0 ? Number(process.env.CENSUS_RPM) : 40 });

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bare name → slug (same rule as the site: no outfit tag, lowercase letters/digits only). */
export function slugKey(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

async function getCensus(url, { retries = 4 } = {}) {
  const proxied = viaCensusProxy(url, CENSUS_PROXY);
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (proxied !== url && CENSUS_PROXY_KEY) headers["X-Proxy-Key"] = CENSUS_PROXY_KEY;
  const big = url.includes("characters_event_grouped");
  return censusRequest(proxied, {
    bucket: censusBucket,
    retries,
    timeoutMs: big ? 90_000 : 20_000,
    expectData: big || url.includes("character?name.first_lower="),
    headers,
    baseMs: 2000,
    capMs: 30000,
    onRetry: ({ attempt, retries: n, reason, waitMs }) => console.warn(`  Census retry ${attempt}/${n} in ${waitMs}ms (${reason})`),
  });
}

/* ------------------------------------------------------------- pure parts */

/**
 * Insert / update one PS index entry, keyed by `key` (server + cid). The slug is
 * the bare name's slug; if another character already holds that slug (same name
 * on the other server, or a rename), this one gets "<slug>-<us|eu>", which no
 * real name can produce, so two people never share a slug, a file or a row.
 */
export function upsertPsEntry(index, { key, ns, cid, display, savedAt, top, last }) {
  const server = PS_SERVERS[ns];
  const bare = String(display || "").replace(/^\[[^\]]*\]\s*/, "").trim();
  const base = slugKey(bare);
  if (!server || !base || !key) throw new Error(`bad PS entry ${key}`);
  const players = (index.players || []).slice();
  const i = players.findIndex((p) => p && p.key === key);
  const taken = new Set(players.filter((p, j) => p && j !== i).map((p) => p.slug));
  const slug = !taken.has(base) ? base : `${base}-${server.key}`;
  if (taken.has(slug)) throw new Error(`PS slug collision ${slug} (${key})`);
  const entry = {
    name: display,
    file: psPlayerFile(ns, cid),
    slug,
    key,
    ns,
    server: server.name,
    savedAt,
    fmt: CACHE_FORMAT,
    ...(top ? { top } : {}),
    ...(last ? { last } : {}),
    aliases: slug === base ? [slug, bare.toLowerCase()].filter((v, k, a) => v && a.indexOf(v) === k) : [slug],
  };
  if (i >= 0) players[i] = { ...players[i], ...entry };
  else players.push(entry);
  players.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.key).localeCompare(String(b.key)));
  index.players = players;
  index.updatedAt = new Date().toISOString();
  return entry;
}

/** When a cached PS player is next due (ms): tier by last activity, Infinity for 🪦. */
export function psDueAt(p, state, now = Date.now()) {
  const every = refreshIntervalMs(lastActiveMs(p), now);
  if (every === Infinity) return Infinity;
  const st = (state && state.players && state.players[p.key]) || {};
  return Math.max(+p.savedAt || 0, +st.lastAttemptAt || 0) + every;
}

/** Keys of cached PS players due now, oldest first. */
export function psStale(index, state, now = Date.now()) {
  return ((index && index.players) || [])
    .filter((p) => p && parsePsKey(p.key) && psDueAt(p, state, now) <= now)
    .sort((a, b) => psDueAt(a, state, now) - psDueAt(b, state, now) || String(a.key).localeCompare(String(b.key)))
    .map((p) => p.key);
}

export function psNextStaleAt(index, state, now = Date.now()) {
  let min = Infinity;
  for (const p of (index && index.players) || []) if (p && parsePsKey(p.key)) min = Math.min(min, psDueAt(p, state, now));
  return Number.isFinite(min) ? min : null;
}

/** data-ps/discovery.json → { cap, servers: { ns: discovery state } } (one sweep per server). */
export function normalizePsDiscovery(raw, now = Date.now()) {
  const servers = {};
  for (const ns of ROOM.namespaces) servers[ns] = normalizeDiscovery(raw && raw.servers && raw.servers[ns], now);
  const cap = Math.max(PS_CAP_STEPS[0], +(raw && raw.cap) || 0);
  return { cap, servers, updatedAt: (raw && raw.updatedAt) || null };
}

/** One growth queue over both servers: [{ key, ns, cid, name, fights, created }], PC ranking (new-and-playing first). */
export function psGrowQueue(disc, index, state, now = Date.now()) {
  const known = new Set(((index && index.players) || []).map((p) => p && p.key));
  const all = [];
  for (const ns of ROOM.namespaces) {
    for (const q of (disc.servers[ns] && disc.servers[ns].queue) || []) {
      let key;
      try { key = psKey(ns, q.cid); } catch { continue; }
      if (known.has(key) || !retryable(state.players[key], now)) continue;
      all.push({ ...q, ns, key });
    }
  }
  return rankQueue(all, now);
}

/** Lowercase names already cached on one server (the sweep's "known" set). */
export function knownNames(index, ns) {
  const s = new Set();
  for (const p of (index && index.players) || []) {
    if (p && p.ns === ns) s.add(String(p.name || "").replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase());
  }
  return s;
}

/** Lowercase names discovery must not retry on one server (failed for good / too often). */
export function skipNames(state, ns, now = Date.now()) {
  const s = new Set();
  for (const e of Object.values((state && state.players) || {})) {
    if (e && e.ns === ns && e.nameLower && !retryable(e, now)) s.add(e.nameLower);
  }
  return s;
}

/**
 * The player file (same shape as a PC file, plus room / ns / server / key), from
 * the Census character row, fetchPlayerCensus's result and the infantry summary.
 */
export function buildPsPayload({ c, ns, r, infantry = null, topN = OPPONENT_TOP_N, now = Date.now() }) {
  const server = PS_SERVERS[ns];
  const cid = String(c.character_id);
  const outfit = c.outfit || {};
  const gk = hist(c, "kills");
  const gd = hist(c, "deaths");
  const gt = hist(c, "time");
  const own = r.own || { kpm: 0, acc: 0, hsr: 0, ivi: 0 };
  const display = `${outfit.alias ? `[${outfit.alias}] ` : ""}${(c.name && c.name.first) || cid}`;
  const times = accountTimes(c);
  return {
    query: (c.name && c.name.first) || cid,
    top: topN,
    savedAt: now,
    room: "ps",
    ns,
    server: server.name,
    key: psKey(ns, cid),
    player: {
      display,
      cid,
      global_kd: gd ? gk / gd : gk,
      global_kpm: gt ? gk / (gt / 60) : 0,
      own_kpm: own.kpm || (gt ? gk / (gt / 60) : 0),
      acc: own.acc,
      hsr: own.hsr,
      ivi: own.ivi,
      n_scored: r.rows.length,
      source: "census",
      room: "ps",
      ns,
      server: server.name,
      ...(infantry ? { infantry } : {}),
      ...(times ? { times } : {}),
      rows: r.rows,
      curve: kpmCurve(r.rows),
    },
  };
}

/* --------------------------------------------------------------- network */

const memos = new Map(); // ns → opponent memo (never shared between servers)
const memoFor = (ns) => (memos.has(ns) ? memos.get(ns) : (memos.set(ns, new Map()), memos.get(ns)));

async function characterRow(ns, cid) {
  const base = censusNsBase(ns, CENSUS_SERVICE_ID);
  const data = await getCensus(`${base}character?character_id=${encodeURIComponent(cid)}&c:resolve=outfit,stat_history`, { retries: 3 });
  if (data && !Array.isArray(data.character_list) && (data.error || data.errorCode)) throw new Error(`Census unavailable: ${data.error || data.errorCode}`);
  const c = ((data && data.character_list) || [])[0];
  if (!c || String(c.character_id) !== String(cid)) throw new NotFoundError(`Census: no character ${cid} on ${PS_SERVERS[ns].name}`);
  return c;
}

/** Character ids for one name on each PS server (a name may exist on both: two people). */
async function findByName(name) {
  const lower = String(name || "").replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase();
  if (!/^[a-z0-9]{1,32}$/.test(lower)) return [];
  const out = [];
  for (const ns of ROOM.namespaces) {
    const base = censusNsBase(ns, CENSUS_SERVICE_ID);
    try {
      const d = await getCensus(`${base}character?name.first_lower=${encodeURIComponent(lower)}&c:show=character_id,name`, { retries: 3 });
      for (const c of (d && d.character_list) || []) {
        if (c && c.character_id && String((c.name && (c.name.first_lower || c.name.first)) || "").toLowerCase() === lower) out.push({ ns, cid: String(c.character_id) });
      }
    } catch (e) {
      console.warn(`  name lookup ${name} on ${PS_SERVERS[ns].name} failed: ${String(e && e.message).slice(0, 80)}`);
    }
  }
  return out;
}

async function loadPs(ns, cid, { acceptPartial = false, prevInfantry = null } = {}) {
  const base = censusNsBase(ns, CENSUS_SERVICE_ID);
  const c = await characterRow(ns, cid);
  const r = await fetchPlayerCensus(cid, { base, getJson: (u) => getCensus(u), topN: OPPONENT_TOP_N, memo: memoFor(ns) });
  if (!r.board.length) throw new NotFoundError(`Census: empty killboard for ${cid}`);
  if (r.ownFailed || r.skipped) throw new CensusError(`Census busy: ${r.skipped} opponent(s)${r.ownFailed ? " + own stats" : ""} not fetched; keeping old data`);
  const failRatio = r.lookups ? r.paceFails / r.lookups : 0;
  const shipAnyway = acceptPartial && failRatio <= 1 - PARTIAL_SHIP_MIN_OK;
  if (!shipAnyway && r.lookups && failRatio > MAX_OPP_FAIL_RATIO) throw new Error(`Census: ${r.paceFails}/${r.lookups} opponent stats missing; keeping old data`);
  let infantry = prevInfantry;
  try {
    const inf = await fetchInfantry(cid, { base, getJson: (u) => getCensus(u, { retries: 2 }) });
    if (inf) infantry = inf;
  } catch (e) {
    console.warn(`  infantry split skipped: ${String(e && e.message).slice(0, 80)}`);
  }
  return buildPsPayload({ c, ns, r, infantry });
}

/* ------------------------------------------------------------------ main */

function parseExplicit(text) {
  const out = [];
  const seen = new Set();
  for (const t of String(text || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, MAX_EXPLICIT);
}

async function main() {
  if (String(process.env.ROOM || "ps").toLowerCase() !== "ps") {
    console.error("refresh-ps.mjs only refreshes the PlayStation room (data-ps/). PC is scripts/refresh-cache.mjs.");
    process.exit(2);
  }
  fs.mkdirSync(P.players, { recursive: true });
  const t0 = Date.now();
  const explicit = parseExplicit(process.env.NAMES || process.argv.slice(2).join(" "));
  const budgetMs = envInt(explicit.length ? "ON_DEMAND_BUDGET_MIN" : "TIME_BUDGET_MIN", explicit.length ? 10 : 20) * 60_000;
  const deadline = t0 + budgetMs;
  const reserveMs = 45_000;
  const index = readJson(P.index, null) || { updatedAt: null, players: [] };
  if (!Array.isArray(index.players)) index.players = [];
  const state = readJson(P.state, null) || { updatedAt: null, players: {} };
  if (!state.players || typeof state.players !== "object") state.players = {};
  const c = { ok: 0, notFound: 0, outage: 0, consecutiveOutage: 0, stoppedEarly: "" };
  const updated = [];
  const added = [];
  const failed = [];
  console.log(`PlayStation room (${ROOM.namespaces.map((n) => PS_SERVERS[n].name).join(" + ")}). Index ${index.players.length}. ${CENSUS_PROXY ? `Census via proxy ${new URL(CENSUS_PROXY).host}` : "Census direct"}.`);

  const saveState = () => {
    const players = {};
    for (const k of Object.keys(state.players).sort()) players[k] = state.players[k];
    state.updatedAt = new Date().toISOString();
    writeFileAtomic(P.state, JSON.stringify({ updatedAt: state.updatedAt, players }, null, 1) + "\n");
  };

  async function refreshKey(key, label, nameHint = "") {
    const id = parsePsKey(key);
    if (!id) return null;
    const prev = state.players[key] || {};
    const now = Date.now();
    console.log(`${label} ${nameHint || key} (${key})…`);
    try {
      const prevFile = readJson(path.join(DATA_DIR, psPlayerFile(id.ns, id.cid)), null);
      const acceptPartial = prev.kind === "partial" && (prev.fails || 0) >= PARTIAL_SHIP_AFTER;
      const payload = await loadPs(id.ns, id.cid, { acceptPartial, prevInfantry: prevFile && prevFile.player && prevFile.player.infantry });
      const wasCached = index.players.some((p) => p.key === key);
      writeFileAtomic(path.join(DATA_DIR, psPlayerFile(id.ns, id.cid)), JSON.stringify(payload) + "\n");
      upsertPsEntry(index, { key, ns: id.ns, cid: id.cid, display: payload.player.display, savedAt: payload.savedAt, top: payload.top, last: payload.player.times && payload.player.times.last });
      writeFileAtomic(P.index, JSON.stringify(index, null, 1) + "\n");
      state.players[key] = { lastAttemptAt: now, lastOkAt: payload.savedAt, fails: 0, ns: id.ns, nameLower: String(payload.query).toLowerCase() };
      c.ok++;
      c.consecutiveOutage = 0;
      (wasCached ? updated : added).push(payload.player.display);
      console.log(`  wrote ${ROOM.dataDir}/${psPlayerFile(id.ns, id.cid)} (${payload.player.display}, ${id.server})`);
      return payload.player.display;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const partial = /opponent stats missing/i.test(msg);
      state.players[key] = {
        lastAttemptAt: now,
        lastOkAt: prev.lastOkAt || null,
        fails: (prev.fails || 0) + 1,
        kind: partial ? "partial" : isOutageError(e) ? "transient" : "notfound",
        lastError: msg.slice(0, 200),
        ns: id.ns,
        ...(prev.nameLower || nameHint ? { nameLower: prev.nameLower || nameHint.toLowerCase() } : {}),
      };
      failed.push({ name: nameHint || key, key, reason: msg.slice(0, 120), outage: isOutageError(e) && !partial });
      if (partial) console.warn(`  PARTIAL (kept old data) ${key}: ${msg}`);
      else if (isOutageError(e)) { c.outage++; c.consecutiveOutage++; console.error(`  FAIL (outage?) ${key}: ${msg}`); }
      else { c.notFound++; console.error(`  SKIP (not found) ${key}: ${msg}`); }
      if (c.consecutiveOutage >= MAX_CONSECUTIVE_OUTAGES) {
        c.outageStop = true;
        c.stoppedEarly = `${c.consecutiveOutage} outage-type failures in a row (Census down?)`;
      }
      return null;
    } finally {
      saveState();
    }
  }

  let disc = null;
  let growthLeft = false;
  let refreshed = 0;
  const slices = {};
  let tried = 0;
  const step = async () => { if (tried++) await sleep(BETWEEN_PLAYERS_MS); };

  if (explicit.length) {
    // On demand: "us-<cid>" / "eu-<cid>" keys, or names (looked up on both servers).
    for (const t of explicit) {
      if (c.stoppedEarly || Date.now() + reserveMs > deadline) break;
      const keys = parsePsKey(t.toLowerCase()) ? [t.toLowerCase()] : (await findByName(t)).map((x) => psKey(x.ns, x.cid));
      if (!keys.length) { failed.push({ name: t, reason: "no character with that name on Genudine or Ceres", outage: false }); c.notFound++; continue; }
      for (const k of keys) { await step(); await refreshKey(k, "[on-demand]", parsePsKey(t.toLowerCase()) ? "" : t); }
    }
  } else {
    disc = normalizePsDiscovery(readJson(P.discovery, null));
    // 1) One sweep slice per server (resumable).
    const sliceMs = envInt("SWEEP_SLICE_SEC", 120) * 1000;
    for (const ns of ROOM.namespaces) {
      const d = disc.servers[ns];
      if (!sweepDue(d)) continue;
      const known = knownNames(index, ns);
      const skip = skipNames(state, ns);
      let touched = 0;
      try {
        slices[ns] = await sweepSlice(d, {
          base: censusNsBase(ns, CENSUS_SERVICE_ID),
          getJson: (u) => getCensus(u, { retries: 3 }),
          known,
          skip: (slug) => skip.has(slug),
          until: Math.min(deadline - reserveMs, Date.now() + sliceMs / ROOM.namespaces.length),
          onCached: (nameLower, lastS) => {
            const p = index.players.find((x) => x.ns === ns && String(x.name).replace(/^\[[^\]]*\]\s*/, "").toLowerCase() === nameLower);
            if (p && lastS > (+p.last || 0)) { p.last = lastS; touched++; }
          },
          log: (m) => console.log(`[${PS_SERVERS[ns].name}] ${m}`),
        });
        if (touched) writeFileAtomic(P.index, JSON.stringify(index, null, 1) + "\n");
        const s = slices[ns];
        console.log(`[${PS_SERVERS[ns].name}] discovery slice: ${s.calls} call(s), swept ${s.swept}, checked ${s.checked}, qualified ${s.qualified} (${s.newPlaying} new accounts), activity updated ${touched}${s.done ? "; sweep complete" : "; continues next run"}.`);
      } catch (e) {
        slices[ns] = { error: String(e && e.message).slice(0, 160) };
        console.warn(`[${PS_SERVERS[ns].name}] discovery sweep paused: ${slices[ns].error}`);
      }
    }
    // 2) Cap ladder (same rule as PC: next step once the index reaches the current one).
    disc.cap = nextCap({ cap: disc.cap, indexSize: index.players.length, steps: PS_CAP_STEPS });
    const room = Math.max(0, Math.min(envInt("GROW_MAX", 100), disc.cap - index.players.length));
    const grow = room ? psGrowQueue(disc, index, state) : [];
    const due0 = psStale(index, state);
    console.log(`Cap ${disc.cap} (steps ${PS_CAP_STEPS.join(" → ")}), index ${index.players.length}, room ${room}; queue ${grow.length}; due refreshes ${due0.length}.`);
    const runRefresh = async (until) => {
      for (const key of psStale(index, state)) {
        if (c.stoppedEarly || Date.now() + reserveMs > until) break;
        await step();
        if (await refreshKey(key, "[refresh]", (index.players.find((p) => p.key === key) || {}).name || "")) refreshed++;
      }
    };
    const runGrowth = async (until) => {
      while (grow.length && added.length < room && !c.stoppedEarly && Date.now() + reserveMs <= until) {
        const q = grow.shift();
        await step();
        await refreshKey(q.key, `[new ${added.length + 1}/${room} ${PS_SERVERS[q.ns].name}${isNewAccount(q.created) ? " new account" : ""} ${q.fights || 0} fights/wk]`, q.name);
        disc.servers[q.ns].queue = disc.servers[q.ns].queue.filter((x) => String(x.cid) !== String(q.cid));
      }
    };
    if (due0.length && grow.length) {
      await runRefresh(Date.now() + (deadline - Date.now()) / 2);
      await runGrowth(deadline);
      await runRefresh(deadline);
    } else {
      await runGrowth(deadline);
      await runRefresh(deadline);
    }
    growthLeft = index.players.length < disc.cap && psGrowQueue(disc, index, state).length > 0;
    disc.cap = nextCap({ cap: disc.cap, indexSize: index.players.length, steps: PS_CAP_STEPS });
    disc.updatedAt = new Date().toISOString();
    writeFileAtomic(P.discovery, JSON.stringify(disc) + "\n");
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const summary = `Done in ${secs}s. ok=${c.ok} new=${added.length} refreshed=${refreshed} notFound=${c.notFound} outage=${c.outage} index=${index.players.length}${c.stoppedEarly ? ` (stopped early: ${c.stoppedEarly})` : ""}`;
  console.log(summary);
  const status = readJson(P.status, {}) || {};
  status.room = "ps";
  status.running = false;
  status.lastRun = {
    runId: process.env.GITHUB_RUN_ID || null,
    kind: explicit.length ? "on-demand" : "discovery",
    startedAt: new Date(t0).toISOString(),
    endedAt: new Date().toISOString(),
    seconds: secs,
    added,
    updated,
    failed,
    stoppedEarly: c.stoppedEarly || null,
    indexSize: index.players.length,
    servers: Object.fromEntries(ROOM.namespaces.map((ns) => [PS_SERVERS[ns].name, index.players.filter((p) => p.ns === ns).length])),
    ...(disc ? { discovery: { cap: disc.cap, queues: Object.fromEntries(ROOM.namespaces.map((ns) => [PS_SERVERS[ns].name, disc.servers[ns].queue.length])), slices } } : {}),
  };
  writeFileAtomic(P.status, JSON.stringify(status, null, 1) + "\n");
  if (!explicit.length) {
    const now = Date.now();
    const sweepAt = Math.min(...ROOM.namespaces.map((ns) => sweepDueAt(disc.servers[ns], now)));
    let sched = computeSchedule({
      growthLeft,
      sweepAt,
      staleLeft: psStale(index, state, now).length,
      nextStaleAt: psNextStaleAt(index, state, now),
      outageStop: !!c.outageStop,
      now,
    });
    // Modest cadence: never chain PS runs back to back (PC shares the Census service id).
    if (sched.nextDueAt && Date.parse(sched.nextDueAt) < now + PS_GROWTH_GAP_MS && sched.reason !== "retry after outage") {
      sched = { nextDueAt: new Date(now + PS_GROWTH_GAP_MS).toISOString(), reason: sched.reason };
    }
    writeFileAtomic(P.schedule, JSON.stringify(sched, null, 2) + "\n");
    console.log(`Next PS run: ${sched.nextDueAt || "idle"} (${sched.reason}).`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### PlayStation room refresh\n\n${summary}\n`); } catch { /* ignore */ }
  }
  if (process.env.GITHUB_OUTPUT) {
    try { fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${c.ok}\nnew=${added.length}\n`); } catch { /* ignore */ }
  }
  console.log(`::notice title=PS room::${summary}`);
  if (c.ok === 0 && c.outage > 0) console.warn("::warning::Census unreachable for the PS room; nothing refreshed. Retry scheduled.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { REFRESH_RUN_GAP_MS };
