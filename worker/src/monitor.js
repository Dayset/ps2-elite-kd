/**
 * Pilot live kill recorder (t372u). One SQLite-backed Durable Object holds ONE
 * outbound WebSocket to the Census event stream, subscribed to Death +
 * VehicleDestroy for the 10 characters in monitor-ids.js only, and stores every
 * event compactly. Stops by itself after MONITOR_DAYS.
 *
 * Free-plan budget (Workers Free, Durable Objects): one object in memory all day
 * = 0.125 GB x 86,400 s = 10,800 GB-s of the 13,000/day; a 60 s alarm = 1,440
 * requests + incoming messages at 1/20 of a request; row writes capped at
 * DAILY_ROW_CAP (free 100,000/day). Census etiquette: one connection, service id,
 * reconnect with backoff, no polling.
 *
 * Since #60 the same object also runs the PlayStation 🤝 assists collector
 * (ps-assists.js: two more sockets, ps2ps4us + ps2ps4eu). It shares this one
 * instance on purpose — a second always-on object would not fit the free plan —
 * and keeps the object (and its 60 s alarm) alive after the pilot finishes.
 */
import { MONITOR_IDS, MONITOR_DAYS } from "./monitor-ids.js";
import { PsAssists } from "./ps-assists.js";
import { Meter } from "./meter.js";
import { LiveMap, ENV_WORLDS } from "./live-map.js";
import { PcStream } from "./pc-stream.js";
import { PlanSwitch } from "./plan.js";
import { CaptureTags } from "./capture-tags.js";
import { Rosters } from "./rosters.js";
import { removedKeys } from "./duel-store.js";

/*
 * Workers Paid plan (2026-10-29): the same object now also holds the PC live stream
 * (pc-stream.js), keeps the in-memory live map (live-map.js: per-base fight totals for the
 * Oracle, per-player positions for internal use only) and meters everything it does
 * (meter.js, GET /monitor/usage).
 */
const METER_SAVE_MS = 5 * 60e3;

const STREAM = (sid) => `https://push.planetside2.com/streaming?environment=ps2&service-id=s:${sid}`;
const DAILY_ROW_CAP = 60000;
const ALARM_MS = 60e3;
export const LOCATE_MAX = 50;
const CAPS_ACTIVITY_S = 30 * 60;     // captures riding along with /live/activity
const CAPS_HISTORY_S = 7 * 86400;    // /live/captures?since= reaches back this far

export class KillMonitor {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = null;
    this.lastMsg = 0;
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS ev (
      t INTEGER, k TEXT, a TEXT, v TEXT, w INTEGER, av INTEGER, vv INTEGER, al INTEGER, vl INTEGER, hs INTEGER, z INTEGER, wd INTEGER)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
    this.meter = Meter.load(this.meta("meter"));
    this.meterSaved = Date.now();
    this.live = new LiveMap();
    // 🏴 Capture tags (capture-tags.js): one row per base capture, outfit tags only.
    this.caps = new CaptureTags(sql, { meter: this.meter, spawns: (w, f) => this.live.spawnsAt("ps2", w, f) });
    // 👥 Base rosters (rosters.js): who was at a base when it was captured or defended. Internal only.
    this.rost = new Rosters(sql, { meter: this.meter, roster: (w, f) => this.live.roster("ps2", w, f), removed: () => removedKeys("ps2", (u, o) => fetch(u, o)) });
    const feed = (envName, p, now) => { try { this.live.onEvent(envName, p, now); } catch {} try { this.caps.onEvent(envName, p, now); } catch {} try { this.rost.onEvent(envName, p, now); } catch {} };
    this.ps = new PsAssists(ctx, env, { meter: this.meter, onPayload: feed });
    this.pc = new PcStream(ctx, env, { meter: this.meter, onPayload: feed });
    // 🔀 paid | free (plan.js): plan.json or the PLAN variable; the last known value survives restarts.
    this.planSw = new PlanSwitch({ initial: this.meta("plan") });
  }
  streamOn(ns) {
    if (ns === "ps2") return !!this.pc.ws;
    return !!(this.ps.ws && this.ps.ws[ns]);
  }
  meta(k, v) {
    const sql = this.ctx.storage.sql;
    if (v === undefined) { const r = sql.exec("SELECT v FROM meta WHERE k=?", k).toArray()[0]; return r ? r.v : null; }
    sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, String(v));
    if (this.meter) this.meter.op("rows");
  }
  saveMeter(now = Date.now(), force = false) {
    if (!force && now - this.meterSaved < METER_SAVE_MS) return;
    this.meter.prune(now);
    this.meterSaved = now;
    this.meta("meter", JSON.stringify(this.meter));
  }
  expired(now = Date.now()) {
    let s = +this.meta("startedAt");
    if (!s) { s = now; this.meta("startedAt", s); }
    return now - s > MONITOR_DAYS * 86400e3;
  }
  async ensure() {
    let psOn = false, pcOn = false;
    const plan = await this.planSw.get(this.env);
    if (plan !== this.lastPlan) { this.lastPlan = plan; if (this.meta("plan") !== plan) this.meta("plan", plan); }
    try { psOn = await this.ps.ensure(plan); } catch (e) { this.meta("psError", String(e && e.message).slice(0, 160)); }
    try { pcOn = await this.pc.ensure(Date.now(), plan); } catch (e) { this.meta("pcError", String(e && e.message).slice(0, 160)); }
    try { this.live.prune(); } catch {}
    try { await this.caps.settle(this.env); } catch {}
    try { await this.rost.settle(); } catch {}
    this.saveMeter();
    const done = this.expired();
    if ((psOn || pcOn || !done) && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    if (done) { try { this.ws && this.ws.close(); } catch {} this.ws = null; this.meta("state", "finished"); return; }
    if (this.ws && Date.now() - this.lastMsg < 120e3) return;
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null;
    const sid = (this.env && this.env.CENSUS_SERVICE_ID) || "daysetps2legends";
    const res = await fetch(STREAM(sid), { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    if (!ws) { this.meta("lastError", `upgrade ${res.status} @${new Date().toISOString()}`); return; }
    ws.accept();
    this.ws = ws;
    this.lastMsg = Date.now();
    this.meta("connects", (+this.meta("connects") || 0) + 1);
    this.meta("state", "connected");
    ws.addEventListener("message", (m) => this.onMessage(m.data));
    ws.addEventListener("close", () => { if (this.ws === ws) this.ws = null; });
    ws.addEventListener("error", () => { if (this.ws === ws) this.ws = null; });
    ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: MONITOR_IDS, eventNames: ["Death", "VehicleDestroy"] }));
  }
  onMessage(data) {
    this.lastMsg = Date.now();
    let j;
    try { j = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    const p = j && j.type === "serviceMessage" && j.payload;
    if (!p || (p.event_name !== "Death" && p.event_name !== "VehicleDestroy")) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = "rows:" + day;
    const n = +this.meta(key) || 0;
    if (n >= DAILY_ROW_CAP) return;
    const i = (x) => (x == null || x === "" ? null : +x);
    this.ctx.storage.sql.exec("INSERT INTO ev VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      i(p.timestamp), p.event_name === "Death" ? "D" : "V", p.attacker_character_id || null, p.character_id || null,
      i(p.attacker_weapon_id), i(p.attacker_vehicle_id), i(p.vehicle_id), i(p.attacker_loadout_id), i(p.character_loadout_id),
      i(p.is_headshot), i(p.zone_id), i(p.world_id));
    this.meta(key, n + 1);
  }
  async alarm() {
    this.meter.op("alarm");
    try { await this.ensure(); }
    catch (e) {
      // 🔀 A free-tier limit (account back on free): PC stream off for a day at once (plan.js trip).
      this.planSw.check(e);
      try { if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS); } catch {}
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    this.meter.op("fetch");
    // Live map reads answer from memory: no reconnect work on the hot path (the alarm does that).
    if (url.pathname === "/live/locate") {
      const ns = url.searchParams.get("ns");
      const ids = (url.searchParams.get("ids") || "").split(",").filter((x) => /^\d{5,25}$/.test(x)).slice(0, LOCATE_MAX);
      if (!ENV_WORLDS[ns]) return Response.json({ error: "bad_request" }, { status: 400 });
      const now = Date.now();
      const players = {};
      for (const id of ids) { const r = this.live.locate(ns, id, now); if (r) players[id] = r; }
      return Response.json({ v: 1, ns, at: Math.floor(now / 1000), stream: this.streamOn(ns), players });
    }
    if (url.pathname === "/live/activity") {
      const ns = url.searchParams.get("ns") || "ps2";
      const w = url.searchParams.get("world");
      if (!ENV_WORLDS[ns] || !ENV_WORLDS[ns].includes(String(w))) return Response.json({ error: "bad_request" }, { status: 400 });
      const z = url.searchParams.get("zone");
      const zn = z && /^\d+$/.test(z) ? +z : null, now = Date.now();
      const caps = ns === "ps2" ? this.caps.recent(w, Math.floor(now / 1000) - CAPS_ACTIVITY_S, zn) : [];
      return Response.json({ v: 1, ns, world: +w, stream: this.streamOn(ns), ...this.live.activity(ns, w, now, zn), caps });
    }
    if (url.pathname === "/live/rosters") {
      const now = Math.floor(Date.now() / 1000);
      const since = Math.max(now - 31 * 86400, +url.searchParams.get("since") || now - 3600);
      const w = url.searchParams.get("world");
      const rows = this.rost.read(since, w && ENV_WORLDS.ps2.includes(w) ? w : null, Math.min(2000, +url.searchParams.get("limit") || 500));
      return Response.json({ v: 1, at: now, info: this.rost.info(), size: this.rost.size(), rows });
    }
    if (url.pathname === "/live/captures") {
      const w = url.searchParams.get("world");
      if (!ENV_WORLDS.ps2.includes(String(w))) return Response.json({ error: "bad_request" }, { status: 400 });
      const z = url.searchParams.get("zone"), now = Math.floor(Date.now() / 1000);
      const since = Math.max(now - CAPS_HISTORY_S, +url.searchParams.get("since") || now - 3600);
      const zn = z && /^\d+$/.test(z) ? +z : null;
      const caps = since >= now - 7000 ? this.caps.recent(w, since, zn, 200) : this.caps.history(w, since, zn, 200);
      return Response.json({ v: 1, ns: "ps2", world: +w, at: now, stream: this.streamOn("ps2"), caps });
    }
    await this.ensure();
    const sql = this.ctx.storage.sql;
    if (url.pathname === "/monitor/usage") {
      const now = Date.now();
      const u = this.meter.usage(now);
      return Response.json({ v: 1, at: Math.floor(now / 1000), plan: this.planSw.state(now), ...u, today: { ps2: this.meter.today("ps2", now), ps2ps4us: this.meter.today("ps2ps4us", now), ps2ps4eu: this.meter.today("ps2ps4eu", now) },
        pc: this.pc.status(now), ps: Object.fromEntries(Object.entries(this.ps.status().envs).map(([k, v]) => [k, { connected: v.connected, lastMsgAgoS: v.lastMsgAgoS }])), live: this.live.stats(), rosters: this.rost.info(), caps: this.caps.info() });
    }
    if (url.pathname === "/ps-assists/status") return Response.json(this.ps.status());
    if (url.pathname === "/ps-assists/export") {
      let body = {};
      try { body = await request.json(); } catch {}
      return Response.json(this.ps.exportRows(body || {}));
    }
    if (url.pathname.endsWith("/export")) {
      const since = +url.searchParams.get("since") || 0;
      const rows = sql.exec("SELECT * FROM ev WHERE t > ? ORDER BY t LIMIT 20000", since).toArray();
      return Response.json({ cols: ["t", "k", "a", "v", "w", "av", "vv", "al", "vl", "hs", "z", "wd"], rows: rows.map((r) => Object.values(r)) });
    }
    const total = sql.exec("SELECT COUNT(*) AS n FROM ev").toArray()[0].n;
    const today = "rows:" + new Date().toISOString().slice(0, 10);
    return Response.json({
      ids: MONITOR_IDS.length, days: MONITOR_DAYS, startedAt: +this.meta("startedAt") || null, state: this.meta("state"),
      connected: !!this.ws, lastMsgAgoS: this.lastMsg ? Math.round((Date.now() - this.lastMsg) / 1000) : null,
      connects: +this.meta("connects") || 0, lastError: this.meta("lastError"), events: total, today: +this.meta(today) || 0,
    });
  }
}

const liveHits = new Map(); // best-effort per-isolate limit: ipTag → [count, windowStart]
export const LIVE_CALLS_PER_10MIN = 240;

/**
 * Live map reads, answered from the KillMonitor's memory:
 *   GET /live/activity?ns=ps2&world=1[&zone=2]  → per-base totals (public: the Oracle's ⚔️ Live
 *       fights, #78) and `top`, the 👥 scoreboard's 3 players per base (owner-approved
 *       2026-10-30; players on the removal list dropped)
 *   GET /live/rosters?since=<unix s>[&world=1]  → 👥 stored base rosters. INTERNAL ONLY (proxy key).
 *   GET /live/captures?world=1[&zone=2][&since=<unix s>] → 🏴 recent base captures with the
 *       leading outfit's tag (public; outfit tags only, no player ids)
 *   GET /live/locate?ns=ps2&ids=<cid>,…  (≤ 50) → where each player is now. INTERNAL ONLY:
 *       needs the proxy key (X-Proxy-Key). Owner 2026-10-29: per-player positions are not a
 *       public feature (privacy). Players on the removal list (#61) are never located.
 */
export async function liveRoute(request, env, cors, { ip = "", fetchFn = (u, o) => fetch(u, o), removed = null } = {}) {
  const hdr = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: hdr });
  if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
  if (!env.KILL_MONITOR) return reply({ error: "monitor_not_bound" }, 503);
  const url = new URL(request.url);
  const ns = url.searchParams.get("ns") || "ps2";
  if (!ENV_WORLDS[ns]) return reply({ error: "bad_request" }, 400);
  if (ip) {
    const now = Date.now();
    const h = liveHits.get(ip);
    if (!h || now - h[1] > 10 * 60e3) liveHits.set(ip, [1, now]);
    else if (++h[0] > LIVE_CALLS_PER_10MIN) return reply({ error: "rate_limited" }, 429);
  }
  const stub = env.KILL_MONITOR.get(env.KILL_MONITOR.idFromName("pilot"));
  if (url.pathname === "/live/captures") {
    const r = await stub.fetch(new Request(url.toString(), { method: "GET" }));
    return new Response(r.body, { status: r.status, headers: hdr });
  }
  if (url.pathname === "/live/activity") {
    // 👥 The scoreboard's player ids: players on the removal list (#61) never leave here.
    const r = await stub.fetch(new Request(url.toString(), { method: "GET" }));
    if (!r.ok) return new Response(r.body, { status: r.status, headers: hdr });
    const j = await r.json();
    const gone = removed ? await removed(ns, fetchFn) : new Set();
    const pre = { ps2: "", ps2ps4us: "us-", ps2ps4eu: "eu-" }[ns];
    for (const b of (j && j.bases) || []) if (b.top) { b.top = b.top.filter((p) => !gone.has(pre + p[0])); if (!b.top.length) delete b.top; }
    return reply(j);
  }
  const key = typeof env.CENSUS_PROXY_KEY === "string" ? env.CENSUS_PROXY_KEY : "";
  if (!key || request.headers.get("X-Proxy-Key") !== key) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (url.pathname === "/live/rosters") {
    const r = await stub.fetch(new Request(url.toString(), { method: "GET" }));
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter((x) => /^\d{5,25}$/.test(x)))].slice(0, LOCATE_MAX);
  if (!ids.length) return reply({ error: "bad_request" }, 400);
  const gone = removed ? await removed(ns, fetchFn) : new Set();
  const pre = { ps2: "", ps2ps4us: "us-", ps2ps4eu: "eu-" }[ns];
  const keep = ids.filter((id) => !gone.has(pre + id));
  if (!keep.length) return reply({ v: 1, ns, at: Math.floor(Date.now() / 1000), players: {} });
  const qs = new URLSearchParams({ ns, ids: keep.join(",") });
  const r = await stub.fetch(new Request(`https://monitor/live/locate?${qs}`, { method: "GET" }));
  return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Router hook from the main Worker. */
export async function monitorRoute(request, env, url) {
  if (!env.KILL_MONITOR) return Response.json({ error: "monitor_not_bound" }, { status: 503 });
  if (url.pathname === "/monitor/export" || url.pathname === "/ps-assists/export") {
    const key = typeof env.CENSUS_PROXY_KEY === "string" ? env.CENSUS_PROXY_KEY : "";
    if (!key || request.headers.get("X-Proxy-Key") !== key) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const stub = env.KILL_MONITOR.get(env.KILL_MONITOR.idFromName("pilot"));
  if (url.pathname === "/ps-assists/export") {
    return stub.fetch(new Request(url.toString(), { method: "POST", body: await request.text(), headers: { "Content-Type": "application/json" } }));
  }
  return stub.fetch(new Request(url.toString(), { method: "GET" }));
}

export function monitorTick(env) {
  if (!env.KILL_MONITOR) return Promise.resolve();
  const stub = env.KILL_MONITOR.get(env.KILL_MONITOR.idFromName("pilot"));
  return stub.fetch("https://monitor/monitor/status").then(() => {}, () => {});
}
