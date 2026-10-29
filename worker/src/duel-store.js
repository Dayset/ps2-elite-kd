/**
 * 🤺 Duel pair cache (#83, owner 2026-10-28: "quickly get the last 3 duels, then ask for more, see the
 * progress and don't lose it after fetch; the same fetch on other devices served quickly").
 *
 * One SQLite-backed Durable Object per PLAYER HISTORY (name "<ns>:<cid>"), not per pair: every
 * pair that reads this player's KILL / DEATH history shares the same stored pages.
 *  - blk: one row per Census characters_event page (≤ 1,000 events): t0, t1, n, opps (",id,id,…,"
 *    for matching the other player) and the compact events, gzipped.
 *  - meta: segs (stored time ranges without gaps, newest first, normally one), done (the start of
 *    the history was reached), at (last top-up), last (last request).
 * Census is read on demand by the object itself (4 pages / ~20 s per call at most). A second
 * request for the same player waits for the running read instead of paging Census twice.
 * Creation floor (owner note on #83): a pair history cannot start before the newer of the two
 * characters was created, so reading older pages stops at max(created_p, created_q) − GAP (the
 * margin keeps the 10-minute context of a first fight). Creation dates come from one Census
 * character lookup per player, kept in meta ("cr:<cid>"). `done` = the start of the PAIR history.
 *
 * GET /duels/pair?ns=&p=<history cid>&q=<other cid>&want=<fights>&seen=<rev>
 *   → { v: 1, pid, qid, events, rev, segs, lo, hi, done, fights, kills, pages, error? }
 *   events = p's compact events (scrims.mjs compactEvent tuple): every kill with q plus p's other
 *   kills & deaths within GAP of them, only what is new since `seen` (the client's last rev).
 *
 * Retention: a history nobody asked for in KEEP_MS is deleted (alarm). Removed players (#61) are
 * refused by the route and their object wiped.
 */

export const DUEL_NS = ["ps2", "ps2ps4us", "ps2ps4eu"];
export const GAP = 600; // s: a fight breaks after 10 min without a kill between the two (duels.mjs DUEL_GAP)
export const PAGE = 1000; // Census characters_event page size
export const MAX_PAGES = 4; // Census pages per call
export const BUDGET_MS = 20e3; // stop reading after this long in one call
export const STALE_MS = 10 * 60e3; // newer kills are read again after this long
export const KEEP_MS = 120 * 86400e3; // unused histories are deleted after this long
const CENSUS = "https://census.daybreakgames.com";
const UA = "ps2-elite-kd-cache-worker (+https://dayset.github.io/ps2-elite-kd/)";

const n = (v) => Number(v) || 0;

/** Same tuple as scrims.mjs compactEvent: [ts, kill, otherId, weaponId, hs, zone, myLoadout, otherLoadout, vehicle]. */
export function compactEvent(e, cid) {
  if (!e) return null;
  const me = String(cid);
  const kill = e.table_type === "kills" ? 1 : e.table_type === "deaths" ? 0 : String(e.attacker_character_id) === me ? 1 : 0;
  const other = String((kill ? e.character_id : e.attacker_character_id) || "0");
  return [
    n(e.timestamp), kill, other, n(e.attacker_weapon_id),
    e.is_headshot === "1" || e.is_headshot === 1 || e.is_headshot === true ? 1 : 0,
    n(e.zone_id),
    n(kill ? e.attacker_loadout_id : e.character_loadout_id),
    n(kill ? e.character_loadout_id : e.attacker_loadout_id),
    n(e.attacker_vehicle_id),
  ];
}
const eventKey = (x) => `${x[0]}|${x[1]}|${x[2]}|${x[3]}|${x[6]}|${x[7]}`;

/** Census character lookup: creation time (unix s) of up to 2 characters. */
export function createdUrl(sid, ns, cids) {
  return `${CENSUS}/s:${sid}/get/${ns}:v2/character/?character_id=${cids.map(encodeURIComponent).join(",")}&c:show=character_id,times.creation&c:limit=${cids.length}`;
}

export function eventsUrl(sid, ns, cid, { before = 0, after = 0 } = {}) {
  return `${CENSUS}/s:${sid}/get/${ns}:v2/characters_event/?character_id=${encodeURIComponent(cid)}&type=KILL,DEATH&c:limit=${PAGE}` +
    (before ? `&before=${Math.floor(before)}` : "") + (after ? `&after=${Math.floor(after)}` : "");
}

export async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function gunzip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}

/** Pair kill times → number of fights (GAP rule). */
export function countFights(times) {
  const t = [...times].sort((a, b) => a - b);
  let f = 0, last = -Infinity;
  for (const x of t) { if (x - last > GAP) f++; last = x; }
  return f;
}

/** Merge a new [lo, hi] range into segs (newest first), joining ranges that touch or overlap. */
export function addSeg(segs, lo, hi) {
  const all = [...segs.map((s) => s.slice()), [lo, hi]].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s[1] >= last[0]) last[0] = Math.min(last[0], s[0]);
    else out.push(s);
  }
  return out;
}

export class DuelStore {
  constructor(ctx, env, { fetchFn = (u, o) => fetch(u, o), now = () => Date.now(), blob = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) } = {}) {
    this.ctx = ctx;
    this.blob = blob; // Durable Object SQL takes BLOBs as ArrayBuffer
    this.env = env || {};
    this.fetchFn = fetchFn;
    this.now = now;
    this.running = null;
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS blk (id INTEGER PRIMARY KEY AUTOINCREMENT, t0 INTEGER, t1 INTEGER, n INTEGER, opps TEXT, ev BLOB)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
  }
  meta(k, v) {
    const sql = this.ctx.storage.sql;
    if (v === undefined) { const r = sql.exec("SELECT v FROM meta WHERE k=?", k).toArray()[0]; return r ? r.v : null; }
    sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, String(v));
  }
  get segs() { try { return JSON.parse(this.meta("segs") || "[]"); } catch { return []; } }
  set segs(s) { this.meta("segs", JSON.stringify(s)); }

  /** One Census page → stored block. Returns { events, full } or throws "census". */
  async page(ns, cid, opts) {
    const sid = this.env.CENSUS_SERVICE_ID || "daysetps2legends";
    const one = async () => {
      let j = null;
      try {
        const r = await this.fetchFn(eventsUrl(sid, ns, cid, opts), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15e3) });
        j = r.ok ? await r.json() : null;
      } catch { j = null; }
      if (!j || j.error || !Array.isArray(j.characters_event_list)) throw new Error("census");
      return j.characters_event_list;
    };
    let list = await one();
    // Same one-retry rule as the panel (owner 2026-10-28): a short page is the end of
    // history only if a second fetch of the same window corroborates it. A full retry
    // means the first page was a blip; a SHORTER retry means Census is flapping, and
    // throwing (the caller retries, nothing sealed) beats sealing a gap as done.
    let ev = list.map((e) => compactEvent(e, cid)).filter(Boolean);
    // No retry on top-up (after=) reads: a short top-up never sets done, so re-asking
    // it would only double every 10-minute refresh. Backward reads retry (above).
    if (list.length < PAGE && !opts.after) {
      const retry = await one();
      if (retry.length < list.length) throw new Error("census");
      const seen = new Set(ev.map(eventKey));
      for (const x of retry.map((e) => compactEvent(e, cid)).filter(Boolean)) if (!seen.has(eventKey(x))) ev.push(x);
      list = retry;
    }
    ev.sort((a, b) => b[0] - a[0]);
    if (ev.length) {
      const opps = "," + [...new Set(ev.map((x) => x[2]))].join(",") + ",";
      this.ctx.storage.sql.exec("INSERT INTO blk (t0, t1, n, opps, ev) VALUES (?, ?, ?, ?, ?)",
        ev[ev.length - 1][0], ev[0][0], ev.length, opps, this.blob(await gzip(JSON.stringify(ev))));
    }
    return { events: ev, full: list.length >= PAGE };
  }

  /** Creation times (unix s, 0 = unknown) of the characters, from meta or one Census lookup. */
  async created(ns, ids) {
    const out = new Map(), miss = [];
    for (const id of ids) { const v = this.meta(`cr:${id}`); if (v != null) out.set(id, +v || 0); else miss.push(id); }
    if (miss.length) {
      try {
        const sid = this.env.CENSUS_SERVICE_ID || "daysetps2legends";
        const r = await this.fetchFn(createdUrl(sid, ns, miss), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10e3) });
        const j = r.ok ? await r.json() : null;
        if (j && Array.isArray(j.character_list)) {
          const got = new Map(j.character_list.map((c) => [String(c.character_id), +(c.times && c.times.creation) || 0]));
          for (const id of miss) { const t = got.get(id) || 0; this.meta(`cr:${id}`, t); out.set(id, t); }
        }
      } catch { /* no floor this time; asked again next call */ }
    }
    for (const id of ids) if (!out.has(id)) out.set(id, 0);
    return out;
  }

  /** Oldest time a kill between cid and q can have (minus the context margin), or 0 when unknown. */
  async floor(ns, cid, q) {
    const cr = await this.created(ns, [cid, q]);
    this.cr = [cr.get(cid) || 0, cr.get(q) || 0];
    const f = Math.max(...this.cr);
    return f ? f - GAP : 0;
  }

  /** Read Census until `want` fights with q are stored in the newest gap-free range, or the budget runs out. */
  async read(ns, cid, q, want, pairTimes, floor = 0) {
    const t0 = this.now();
    let pages = 0;
    const room = () => pages < MAX_PAGES && this.now() - t0 < BUDGET_MS;
    const note = (ev) => { for (const x of ev) if (x[2] === q) pairTimes.push(x[0]); };
    const fightsNewest = () => { const s = this.segs[0]; return s ? countFights(pairTimes.filter((t) => t >= s[0])) : 0; };
    // 1. Newer kills first (empty store: the newest page).
    const segs = this.segs;
    const at = +this.meta("at") || 0;
    if (!segs.length || this.now() - at > STALE_MS) {
      const hi = segs.length ? segs[0][1] : 0;
      const r = await this.page(ns, cid, hi ? { after: hi } : {});
      pages++;
      note(r.events);
      this.meta("at", this.now());
      if (r.events.length) this.segs = addSeg(this.segs, r.full ? r.events[r.events.length - 1][0] : (hi || r.events[r.events.length - 1][0]), r.events[0][0]);
      else if (!segs.length) this.segs = [[this.now() / 1e3 | 0, this.now() / 1e3 | 0]];
      if (!segs.length && !r.full) this.meta("done", 1);
    }
    // 2. Older pages: fill a gap under the newest range first, then extend the oldest range.
    let stuck = 0;
    while (room() && fightsNewest() < want) {
      const s = this.segs;
      const done = this.meta("done") === "1";
      if (s.length < 2 && done) {
        // Done flags written before the short-page retry (owner 2026-10-28) may be false:
        // one page below the oldest range re-checks. Events there clear done and extend
        // the range; an empty page confirms it. Skipped when the creation floor already
        // ends the history (its done does not come from a page). The probe uses a STRICT
        // cursor (before = lo, not lo + 1): the +1 edge-second rule would re-read the
        // already-stored oldest second and falsely clear done on every call.
        if (s.length && !(floor && s[0][0] <= floor)) {
          const r = await this.page(ns, cid, { before: s[0][0] });
          pages++;
          note(r.events);
          if (r.events.length) {
            this.meta("done", "0");
            this.segs = addSeg(s, r.events[r.events.length - 1][0], s[0][0]);
            continue;
          }
        }
        break;
      }
      if (floor && s.length && s[0][0] <= floor) break; // older than the newer character: no kills between them there
      const i = s.length > 1 ? 0 : s.length - 1;
      const lo = s[i][0];
      const r = await this.page(ns, cid, { before: stuck ? lo : lo + 1 }); // +1: the edge second again (dupes are dropped on read)
      pages++;
      note(r.events);
      const min = r.events.length ? r.events[r.events.length - 1][0] : lo;
      if (r.full && min >= lo) { if (++stuck > 1) break; continue; } // a whole page inside the edge second: ask strictly older
      stuck = 0;
      // A short page = nothing older exists: the history starts here (it also covers any older range, so they merge).
      if (!r.full) this.meta("done", 1);
      this.segs = addSeg(s, min, lo);
    }
    return pages;
  }

  /** Kill times with q in every stored block (only the blocks that hold q are opened). */
  async pairTimes(q) {
    const sql = this.ctx.storage.sql;
    const out = new Set();
    for (const row of sql.exec("SELECT ev FROM blk WHERE instr(opps, ?) > 0", `,${q},`).toArray()) {
      for (const x of JSON.parse(await gunzip(row.ev))) if (x[2] === q) out.add(`${x[0]}|${eventKey(x)}`);
    }
    return [...out].map((k) => +k.split("|")[0]);
  }

  /** Pair + context events from stored blocks (only blocks newer than `seen` count as new). */
  async answer(q, seen) {
    const sql = this.ctx.storage.sql;
    const metas = sql.exec("SELECT id, t0, t1, instr(opps, ?) > 0 AS hit FROM blk ORDER BY t1 DESC", `,${q},`).toArray();
    const rev = metas.reduce((m, b) => Math.max(m, b.id), 0);
    const hits = metas.filter((b) => b.hit);
    // Blocks within GAP of a block holding q (context for the 1v1 focus), plus the hits themselves.
    const near = metas.filter((b) => hits.some((h) => b.t1 >= h.t0 - GAP && b.t0 <= h.t1 + GAP));
    const load = new Map();
    for (const b of near) {
      const row = sql.exec("SELECT ev FROM blk WHERE id=?", b.id).toArray()[0];
      if (row) load.set(b.id, JSON.parse(await gunzip(row.ev)));
    }
    const seenIds = new Set();
    const all = [];
    const isNew = new Map();
    for (const [id, ev] of load) for (const x of ev) {
      const k = eventKey(x);
      if (seenIds.has(k)) { if (id > seen) isNew.set(k, true); continue; }
      seenIds.add(k);
      all.push(x);
      isNew.set(k, id > seen);
    }
    all.sort((a, b) => a[0] - b[0]);
    const pair = all.filter((x) => x[2] === q);
    const pt = pair.map((x) => x[0]);
    const near2 = (t, list) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < t - GAP) lo = m + 1; else hi = m; } return lo < list.length && list[lo] <= t + GAP; };
    const newPt = pair.filter((x) => isNew.get(eventKey(x))).map((x) => x[0]);
    const events = all.filter((x) => {
      if (x[2] === q) return isNew.get(eventKey(x));
      if (isNew.get(eventKey(x))) return near2(x[0], pt);
      return near2(x[0], newPt);
    });
    return { events: events.reverse(), rev, kills: pair.length, fights: countFights(pt), pairTimes: pt };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;
    if (url.pathname.endsWith("/wipe")) { await this.ctx.storage.deleteAll(); return Response.json({ ok: true }); }
    const ns = url.searchParams.get("ns"), cid = url.searchParams.get("p"), q = url.searchParams.get("q");
    const want = Math.max(0, Math.min(1e6, +url.searchParams.get("want") || 0));
    const seen = Math.max(0, +url.searchParams.get("seen") || 0);
    this.meta("last", this.now());
    try { await this.ctx.storage.setAlarm(this.now() + KEEP_MS); } catch {}
    let pages = 0, error = null;
    // One Census reader per player at a time: a second request waits for it, then reads storage.
    while (this.running) { try { await this.running; } catch {} }
    let floor = 0;
    const job = (async () => {
      floor = await this.floor(ns, cid, q);
      pages = await this.read(ns, cid, q, want, await this.pairTimes(q), floor);
    })();
    this.running = job;
    try { await job; } catch (e) { error = "census_busy"; } finally { this.running = null; }
    const a = await this.answer(q, seen);
    const segs = this.segs;
    const blocks = sql.exec("SELECT COUNT(*) AS c FROM blk").toArray()[0].c;
    return Response.json({
      v: 1, pid: cid, qid: q, events: a.events, rev: a.rev, segs,
      lo: segs.length ? segs[0][0] : 0, hi: segs.length ? segs[0][1] : 0,
      // done = nothing older can hold a kill between them: the start of p's history, or the newer character's creation.
      done: (this.meta("done") === "1" && segs.length < 2) || !!(floor && segs.length && segs[0][0] <= floor),
      floor, floorHit: !!(floor && segs.length && segs[0][0] <= floor), created: this.cr || [0, 0], fights: a.fights, kills: a.kills, pages, blocks,
      ...(error ? { error } : {}),
    });
  }
  async alarm() {
    const last = +this.meta("last") || 0;
    if (this.now() - last >= KEEP_MS - 60e3) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(last + KEEP_MS);
  }
}

/* ------------------------------------------------------------- route (main Worker) */

const OPT_OUT = { ps2: "https://dayset.github.io/ps2-elite-kd/data/opt-out.json", ps2ps4us: "https://dayset.github.io/ps2-elite-kd/data-ps/opt-out.json", ps2ps4eu: "https://dayset.github.io/ps2-elite-kd/data-ps/opt-out.json" };
const PREFIX = { ps2: "", ps2ps4us: "us-", ps2ps4eu: "eu-" };
const optOutCache = new Map(); // url → { at, keys }

async function removedKeys(ns, fetchFn) {
  const u = OPT_OUT[ns];
  const c = optOutCache.get(u);
  if (c && Date.now() - c.at < 10 * 60e3) return c.keys;
  let keys = c ? c.keys : new Set();
  try {
    const r = await fetchFn(u, { headers: { "User-Agent": UA }, cf: { cacheTtl: 600 } });
    if (r.ok) keys = new Set(Object.keys((await r.json()) || {}).filter((k) => !k.startsWith("_")));
  } catch {}
  optOutCache.set(u, { at: Date.now(), keys });
  return keys;
}

const hits = new Map(); // best-effort per-isolate limit: ipTag → [count, windowStart]
export const IP_CALLS_PER_10MIN = 240;

/** GET /duels/pair → the player's DuelStore object. */
export async function duelRoute(request, env, cors, { fetchFn = (u, o) => fetch(u, o), ip = "" } = {}) {
  const hdr = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors };
  const reply = (body, status) => new Response(JSON.stringify(body), { status, headers: hdr });
  if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
  if (!env.DUEL_STORE) return reply({ error: "duel_store_not_bound" }, 503);
  const url = new URL(request.url);
  const ns = url.searchParams.get("ns"), p = url.searchParams.get("p"), q = url.searchParams.get("q");
  if (!DUEL_NS.includes(ns) || !/^\d{5,25}$/.test(p || "") || !/^\d{5,25}$/.test(q || "") || p === q) return reply({ error: "bad_request" }, 400);
  if (ip) {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h[1] > 10 * 60e3) hits.set(ip, [1, now]);
    else if (++h[0] > IP_CALLS_PER_10MIN) return reply({ error: "rate_limited" }, 429);
  }
  const gone = await removedKeys(ns, fetchFn);
  const stub = env.DUEL_STORE.get(env.DUEL_STORE.idFromName(`${ns}:${p}`));
  if (gone.has(PREFIX[ns] + p)) { await stub.fetch("https://duel/wipe").catch(() => {}); return reply({ error: "removed" }, 404); }
  if (gone.has(PREFIX[ns] + q)) return reply({ error: "removed" }, 404);
  const qs = new URLSearchParams({ ns, p, q, want: String(Math.max(0, Math.min(1e6, +url.searchParams.get("want") || 3))), seen: String(Math.max(0, +url.searchParams.get("seen") || 0)) });
  const r = await stub.fetch(`https://duel/pair?${qs}`);
  return new Response(r.body, { status: r.status, headers: hdr });
}
