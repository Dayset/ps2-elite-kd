/**
 * 🥊 PlayStation scrims runner (owner 2026-10-28: "group that event into single chunk and tell the
 * winner. Write down the date and the result somewhere … as deep into playstation history as possible").
 *
 *   node scripts/ps-scrims.mjs --run
 *     One background round over the PS room (data-ps/index.json), inside TIME_BUDGET_MIN:
 *       1. players never visited and players seen since their last visit: their newest history;
 *       2. the rest of the time: older history, shallowest players first, PAGES Census pages each.
 *     Each Census page = 1,000 KILL / DEATH events (characters_event). History is cut only at a
 *     silence of SCRIM_RULE.GAP (scrims.mjs finalWindow), so no scrim is split between rounds.
 *     Writes data-ps/scrims/<key>.json (date + result of every scrim found, and how far back the
 *     history has been read) and data-ps/scrims-state.json (per-player cursors).
 *     NAMES="a,b" (names or keys): those players' whole history first (up to half the run).
 *
 *   node scripts/ps-scrims.mjs --probe "Name1,Name2" [--pages 20]
 *     Measurement only: the compact events of the named players into scrim-probe/<key>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { censusRequest, tokenBucket } from "../census-fetch.mjs";
import { PS_SERVERS, censusNsBase, parsePsKey, psKey } from "../rooms.mjs";
import { eventsUrl, compactEvent, mergeEvents, EVENT_PAGE, SCRIM_RULE, detectScrims, finalWindow, scrimRow, mirrorRow, upsertScrims } from "../scrims.mjs";
import { removedList, REMOVED_NAME } from "../opt-out.mjs";
import { viaCensusProxy } from "./refresh-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data-ps");
const SCRIM_DIR = path.join(DATA_DIR, "scrims");
const STATE_FILE = path.join(DATA_DIR, "scrims-state.json");
const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset; room ps scrims)";
const SERVICE_ID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const PROXY = String(process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const PROXY_KEY = String(process.env.CENSUS_PROXY_KEY || "");
const bucket = tokenBucket({ capacity: 3, perMinute: Number(process.env.CENSUS_RPM) > 0 ? Number(process.env.CENSUS_RPM) : 30 });
/** Census pages per older-history visit (1,000 events each). */
export const BACK_PAGES = Math.max(1, Number(process.env.PAGES) || 3);
/** Share of the run spent on newest history before older history gets the rest. */
const NEW_SHARE = 0.6;
/** A player seen again is re-read at most this often (seconds). */
const REVISIT_SEC = 6 * 3600;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const arg = (name, d = "") => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] || d : d; };
const slugKey = (s) => String(s || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "-");

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj) + "\n");
  fs.renameSync(tmp, file);
}

let calls = 0;
async function getCensus(url) {
  const proxied = viaCensusProxy(url, PROXY);
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (proxied !== url && PROXY_KEY) headers["X-Proxy-Key"] = PROXY_KEY;
  calls++;
  return censusRequest(proxied, { bucket, retries: 4, timeoutMs: 60_000, headers, baseMs: 2000, capMs: 30000,
    onRetry: ({ attempt, retries, reason, waitMs }) => console.warn(`  Census retry ${attempt}/${retries} in ${waitMs}ms (${reason})`) });
}

const hasSilence = (desc, gap) => { for (let i = 0; i + 1 < desc.length; i++) if (desc[i][0] - desc[i + 1][0] > gap) return true; return false; };

/**
 * Page back through one player's events.
 *   before: start below this timestamp (0 = now); until: stop once a page reaches it;
 *   minPages / maxPages; needCut: keep going (≤ maxPages) until the events hold a silence.
 * → { events newest first, done (start of the account reached), pages }
 */
export async function fetchSpan(base, cid, { before = 0, until = null, minPages = 1, maxPages = 1, needCut = false, gap = SCRIM_RULE.GAP, get = getCensus } = {}) {
  let events = [];
  let cursor = before;
  let done = false, pages = 0;
  while (pages < maxPages) {
    const j = await get(eventsUrl(base, cid, { before: cursor }));
    pages++;
    const list = (j && j.characters_event_list) || [];
    const page = list.map((e) => compactEvent(e, cid)).filter(Boolean);
    events = mergeEvents(events, page);
    if (list.length < EVENT_PAGE || !page.length) { done = true; break; }
    const oldest = page.reduce((m, x) => Math.min(m, x[0]), Infinity);
    if (until != null && oldest <= until) break;
    if (pages >= minPages && (!needCut || hasSilence(events, gap))) break;
    // The edge second is asked again (+1) so a second split across two pages is never lost; mergeEvents dedupes.
    cursor = cursor && oldest + 1 >= cursor ? oldest : oldest + 1;
  }
  return { events, done, pages };
}

/** Back-compat name used by the probe. */
export async function pageBack(base, cid, { before = 0, pages = 1, get = getCensus } = {}) {
  const r = await fetchSpan(base, cid, { before, minPages: pages, maxPages: pages, get });
  return { events: r.events, oldest: r.events.length ? r.events[r.events.length - 1][0] : 0, done: r.done };
}

/**
 * One visit of one player. mode: "first" (newest history, first time), "new" (everything since
 * st.fwd), "back" (older than st.old). Mutates st; → { scrims, events, pages, skipped? }.
 */
export async function visit(st, { base, cid, mode, now, get = getCensus, gap = SCRIM_RULE.GAP, pages = BACK_PAGES }) {
  let r, asc, oldOpen, newOpen;
  if (mode === "new") {
    r = await fetchSpan(base, cid, { until: st.fwd, minPages: 1, maxPages: 50, gap, get });
    asc = r.events.filter((x) => x[0] > st.fwd).reverse();
    const reached = r.done || (r.events.length && r.events[r.events.length - 1][0] <= st.fwd);
    oldOpen = !reached; // only if 50 pages were not enough (a hole, logged)
    if (!reached) console.log(`  ::warning::${cid}: 50 pages did not reach ${day(st.fwd)}; older part left for the back rounds`);
  } else if (mode === "back") {
    r = await fetchSpan(base, cid, { before: st.old, minPages: pages, maxPages: pages + 8, needCut: true, gap, get });
    asc = r.events.filter((x) => x[0] < st.old).reverse();
    oldOpen = !r.done;
  } else {
    r = await fetchSpan(base, cid, { minPages: pages, maxPages: pages + 8, needCut: true, gap, get });
    asc = r.events.slice().reverse();
    oldOpen = !r.done;
  }
  newOpen = mode !== "back" && asc.length > 0 && now - asc[asc.length - 1][0] <= gap;
  st.at = now;
  if (!asc.length) {
    if (mode === "first") Object.assign(st, { old: 0, fwd: 0, done: true });
    if (mode === "back") st.done = true;
    return { scrims: [], events: 0, pages: r.pages };
  }
  let w = finalWindow(asc, { oldOpen, newOpen, gap });
  // One session longer than all the pages (no silence anywhere) going back: cut at the page edge.
  if (!w && mode === "back") w = { lo: 0, hi: asc.length };
  if (!w && mode === "new" && !newOpen) w = { lo: 0, hi: asc.length };
  if (!w) return { scrims: [], events: asc.length, pages: r.pages, skipped: true };
  const { lo, hi } = w;
  if (mode === "first") Object.assign(st, { old: asc[lo][0], fwd: asc[hi - 1][0], done: !oldOpen });
  else if (mode === "new") { if (hi > 0) st.fwd = asc[hi - 1][0]; }
  else Object.assign(st, { old: asc[lo][0], done: !oldOpen });
  return { scrims: detectScrims(asc.slice(lo, hi), cid), events: asc.length, pages: r.pages };
}

/** Names for opponent ids of one namespace (≤ 100 per call): "[TAG] Name". */
async function lookupNames(ns, ids, get = getCensus) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const url = `${censusNsBase(ns, SERVICE_ID)}character/?character_id=${part.join(",")}&c:show=character_id,name.first` +
      `&c:join=outfit_member_extended^on:character_id^to:character_id^inject_at:of^show:alias&c:limit=100`;
    try {
      const j = await get(url);
      for (const c of (j && j.character_list) || []) {
        const nm = c && c.name && c.name.first;
        if (nm) out.set(String(c.character_id), c.of && c.of.alias ? `[${c.of.alias}] ${nm}` : nm);
      }
    } catch (e) { console.warn(`  names: ${e.message || e}`); }
  }
  return out;
}

const fileOf = (key) => path.join(SCRIM_DIR, `${key}.json`);
function loadFile(key, fallback) {
  const f = readJson(fileOf(key), null);
  return f && f.v === 1 && Array.isArray(f.scrims) ? f : { v: 1, ...fallback, from: null, to: null, done: false, scrims: [] };
}

/** Blank removed opponents in a row list; true when something changed. */
function scrubRemoved(rows, gone) {
  let n = 0;
  for (const r of rows) for (const o of r.o) {
    if (o[0] && gone.has(o[0])) { o[0] = ""; o[1] = REMOVED_NAME; n++; }
  }
  return n > 0;
}

async function run() {
  const t0 = Date.now();
  const budgetMs = (Number(process.env.TIME_BUDGET_MIN) || 20) * 60_000;
  const now = () => Math.floor(Date.now() / 1000);
  const index = readJson(path.join(DATA_DIR, "index.json"), { players: [] });
  const optText = (() => { try { return fs.readFileSync(path.join(DATA_DIR, "opt-out.json"), "utf8"); } catch { return ""; } })();
  const removed = removedList(optText ? JSON.parse(optText) : null);
  const goneKeys = new Set(removed.entries.map((e) => e.key || e.id).filter((k) => /^(us|eu)-\d+$/.test(String(k))));
  const isGone = (e) => goneKeys.has(e.key) || !!removed.match({ cid: parsePsKey(e.key)?.cid, server: e.server, slug: e.slug, name: e.name });
  const state = readJson(STATE_FILE, null) || { v: 1, players: {} };
  state.players = state.players || {};
  const byKey = new Map(index.players.map((e) => [e.key, e]));

  // Removal list changed: delete removed players' files, blank them as opponents everywhere.
  if (state.optLen !== optText.length) {
    let files = [];
    try { files = fs.readdirSync(SCRIM_DIR).filter((f) => f.endsWith(".json")); } catch {}
    for (const f of files) {
      const key = f.slice(0, -5);
      if (goneKeys.has(key)) { fs.unlinkSync(fileOf(key)); delete state.players[key]; continue; }
      const j = readJson(fileOf(key), null);
      if (j && Array.isArray(j.scrims) && scrubRemoved(j.scrims, goneKeys)) writeJson(fileOf(key), j);
    }
    state.optLen = optText.length;
  }

  const players = index.players.filter((e) => e && parsePsKey(e.key) && !isGone(e));
  const tally = { first: 0, new: 0, back: 0, scrims: 0, events: 0, fails: 0, skipped: 0 };
  const touched = new Set();
  let outages = 0;
  const names = new Map(); // key → display name
  for (const e of index.players) names.set(e.key, e.name);

  async function one({ e, mode }) {
    const { ns, cid } = parsePsKey(e.key);
    const base = censusNsBase(ns, SERVICE_ID);
    const st = state.players[e.key] || {};
    const before = JSON.stringify(st);
    let r;
    try {
      r = await visit(st, { base, cid, mode, now: now() });
      outages = 0;
    } catch (err) {
      tally.fails++;
      outages++;
      Object.keys(st).length && (st.at = now());
      console.warn(`  ${e.name}: ${err.message || err}`);
      return;
    }
    state.players[e.key] = st;
    tally[mode]++;
    tally.events += r.events;
    if (r.skipped) tally.skipped++;
    const srv = PS_SERVERS[ns].key;
    const unknown = [...new Set(r.scrims.flatMap((s) => s.opp.map((o) => o.id)).filter((id) => !names.has(`${srv}-${id}`)))];
    if (unknown.length) for (const [id, nm] of await lookupNames(ns, unknown)) names.set(`${srv}-${id}`, nm);
    const oppOf = (id) => {
      const key = psKey(ns, id);
      const gone = goneKeys.has(key) || removed.match({ cid: id, server: srv, name: names.get(key) || "" });
      return gone ? { key: "", name: REMOVED_NAME } : { key, name: names.get(key) || "" };
    };
    const rows = r.scrims.map((s) => scrimRow(s, oppOf));
    const me = { key: e.key, name: e.name };
    const file = loadFile(e.key, { key: e.key, name: e.name, server: e.server });
    const changed = upsertScrims(file.scrims, rows);
    if (changed || JSON.stringify(st) !== before) {
      Object.assign(file, { name: e.name, from: st.old || null, to: st.fwd || null, done: !!st.done, at: st.at });
      writeJson(fileOf(e.key), file);
      touched.add(e.key);
    }
    tally.scrims += rows.length;
    // The opponent's file gets the same 1v1 scrim from their side (their own history may come much later).
    for (const row of rows) {
      if (row.o.length !== 1 || !row.o[0][0]) continue;
      const ok = row.o[0][0];
      const oe = byKey.get(ok);
      const of = loadFile(ok, { key: ok, name: row.o[0][1], server: PS_SERVERS[ns].name });
      if (upsertScrims(of.scrims, [mirrorRow(row, me)])) {
        if (oe) of.name = oe.name;
        writeJson(fileOf(ok), of);
        touched.add(ok);
      }
    }
    if (rows.length) console.log(`  ${e.name} [${mode}] ${day(st.old)} → ${day(st.fwd)}: ${rows.map((x) => `${x.o.map((o) => o[1] || "?").join("+")} ${x.k}–${x.d}`).slice(0, 5).join(", ")}${rows.length > 5 ? ` (+${rows.length - 5})` : ""}`);
  }

  // Asked for by name (workflow input "names"): their whole history first, up to half the run.
  const want = String(process.env.NAMES || "").split(",").map((x) => x.trim()).filter(Boolean);
  const wanted = players.filter((e) => want.some((w) => w === e.key || slugKey(w) === e.slug));
  for (const e of wanted) {
    if (!state.players[e.key]) await one({ e, mode: "first" });
    else if ((e.last || 0) > (state.players[e.key].fwd || 0) + SCRIM_RULE.GAP) await one({ e, mode: "new" });
    while (state.players[e.key] && !state.players[e.key].done && Date.now() - t0 < budgetMs / 2 && outages < 4) await one({ e, mode: "back" });
  }

  const fresh = [], back = [];
  const tnow = now();
  for (const e of players) {
    const st = state.players[e.key];
    if (!st) fresh.push({ e, mode: "first" });
    else if ((e.last || 0) > (st.fwd || 0) + SCRIM_RULE.GAP && tnow - (st.at || 0) > REVISIT_SEC) fresh.push({ e, mode: "new" });
    if (st && !st.done) back.push({ e, mode: "back" });
  }
  fresh.sort((a, b) => (b.e.last || 0) - (a.e.last || 0));
  back.sort((a, b) => (state.players[b.e.key].old || 0) - (state.players[a.e.key].old || 0));
  console.log(`🥊 PS scrims: ${players.length} players, ${fresh.length} newest-history visits due, ${back.length} with older history left. Census ${PROXY ? `via ${new URL(PROXY).host}` : "direct"}.`);

  const queue = [...fresh.map((x) => ({ ...x, phase: 0 })), ...back.map((x) => ({ ...x, phase: 1 }))];
  const seenBack = new Set();
  for (const job of queue) {
    const used = Date.now() - t0;
    if (used > budgetMs) break;
    if (job.phase === 0 && used > budgetMs * NEW_SHARE && back.length) continue;
    if (job.phase === 1) {
      const st = state.players[job.e.key];
      if (!st || st.done || seenBack.has(job.e.key)) continue;
      seenBack.add(job.e.key);
    }
    if (outages >= 4) { console.log("::warning::Census keeps failing; stopping this round early"); break; }
    await one(job);
  }

  // Keep visiting older history while time is left (the shallowest player again first).
  while (Date.now() - t0 < budgetMs && outages < 4) {
    const left = players.filter((e) => state.players[e.key] && !state.players[e.key].done);
    if (!left.length) break;
    left.sort((a, b) => (state.players[b.key].old || 0) - (state.players[a.key].old || 0));
    await one({ e: left[0], mode: "back" });
  }

  const sts = Object.values(state.players);
  const depths = sts.filter((s) => s.old).map((s) => s.old).sort((a, b) => a - b);
  state.updatedAt = new Date().toISOString();
  state.rule = SCRIM_RULE;
  writeJson(STATE_FILE, state);
  const msg = `🥊 PS scrims: ${calls} Census calls, visits ${tally.first} first / ${tally.new} new / ${tally.back} older, ${tally.events.toLocaleString("en")} events, ${tally.scrims} scrims found, ${touched.size} files written, ${tally.fails} failed. ` +
    `${sts.length}/${players.length} players started, ${sts.filter((s) => s.done).length} read to the start; median depth ${day(depths[Math.floor(depths.length / 2)])}, deepest ${day(depths[0])}.`;
  console.log(`::notice::${msg}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `files=${touched.size}\nscrims=${tally.scrims}\n`);
}

async function probe() {
  const names = arg("--probe").split(",").map((s) => s.trim()).filter(Boolean);
  const pages = Math.max(1, Math.min(200, Number(arg("--pages", "20")) || 20));
  const budgetMs = (Number(process.env.TIME_BUDGET_MIN) || 25) * 60_000;
  const t0 = Date.now();
  const index = readJson(path.join(DATA_DIR, "index.json"), { players: [] });
  const outDir = path.join(ROOT, "scrim-probe");
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const want of names) {
    if (Date.now() - t0 > budgetMs) { console.log(`time budget reached before ${want}`); break; }
    const e = index.players.find((p) => p.key === want) || index.players.find((p) => p.slug === slugKey(want));
    if (!e) { console.log(`::warning::${want}: not in data-ps/index.json`); continue; }
    const { ns, cid } = parsePsKey(e.key);
    const base = censusNsBase(ns, SERVICE_ID);
    try {
      const r = await pageBack(base, cid, { pages });
      fs.writeFileSync(path.join(outDir, `${e.key}.json`), JSON.stringify({ name: e.name, key: e.key, server: PS_SERVERS[ns].name, cid, done: r.done, events: r.events }));
      const line = `${e.name} (${e.key}): ${r.events.length} events back to ${day(r.oldest)}${r.done ? " (whole history)" : ""}`;
      console.log(line);
      summary.push(line);
    } catch (err) {
      console.log(`::warning::${e.name}: ${err.message || err}`);
    }
  }
  console.log(`::notice::scrim probe: ${summary.length} players. ${summary.slice(0, 6).join(" | ")}`.slice(0, 3900));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--probe")) await probe();
  else if (process.argv.includes("--run")) await run();
  else { console.error("usage: node scripts/ps-scrims.mjs --run | --probe \"Name1,Name2\" [--pages 20]"); process.exit(2); }
}
