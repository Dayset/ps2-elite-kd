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

const STREAM = (sid) => `https://push.planetside2.com/streaming?environment=ps2&service-id=s:${sid}`;
const DAILY_ROW_CAP = 60000;
const ALARM_MS = 60e3;

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
    this.ps = new PsAssists(ctx, env);
  }
  meta(k, v) {
    const sql = this.ctx.storage.sql;
    if (v === undefined) { const r = sql.exec("SELECT v FROM meta WHERE k=?", k).toArray()[0]; return r ? r.v : null; }
    sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, String(v));
  }
  expired(now = Date.now()) {
    let s = +this.meta("startedAt");
    if (!s) { s = now; this.meta("startedAt", s); }
    return now - s > MONITOR_DAYS * 86400e3;
  }
  async ensure() {
    let psOn = false;
    try { psOn = await this.ps.ensure(); } catch (e) { this.meta("psError", String(e && e.message).slice(0, 160)); }
    const done = this.expired();
    if ((psOn || !done) && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
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
  async alarm() { await this.ensure(); }
  async fetch(request) {
    const url = new URL(request.url);
    await this.ensure();
    const sql = this.ctx.storage.sql;
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
