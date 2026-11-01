/**
 * 📦 Continuous collection outside alerts (owner t831u, 2026-11-01: "enable mid alert data
 * collection for the map states and other events"). Decision note with the measured volumes
 * and the cost estimate: docs/decisions/2026-11-01-continuous-data-collection.md.
 *
 * Everything here comes from the PC live stream the KillMonitor already holds open all day
 * (pc-stream.js) — no extra socket, no Honu, no Census REST calls — and lives in the same
 * SQLite-backed Durable Object. Each kind is buffered in memory and written as ONE SQLite row
 * per alarm (a blob of compact tuples), so a busy hour costs ~60 rows, not one per event.
 *
 *   vd   🚗 vehicle kills (VehicleDestroy), PC worlds, every one:
 *        [t, w, z, a, v, av, vv, wpn, al, at, vt, f] — a/v attacker/owner character ids,
 *        av/vv attacker/destroyed vehicle, wpn weapon, al attacker loadout, at/vt factions,
 *        f facility (0 = none).
 *   wev  🗺️ world events: base control (FacilityControl, captures AND defenses), alerts
 *        (MetagameEvent) and continent locks / unlocks:
 *        F: [t, "F", w, z, f, old, new, outfit, held]
 *        M: [t, "M", w, z, instance, event, state, vs, nc, tr, bonus]
 *        L / U: [t, "L"|"U", w, z, trig, prev, vsPop, ncPop, trPop]
 *   ms   📸 map state every MS_EVERY_MS: per world, per continent the active players per
 *        faction (5-minute window) and per base the crowd, kills, vehicle kills, point XP and
 *        spawn points (live-map.js activity()). Faction totals only — the 👥 `top` players
 *        are dropped here, no player id is stored.
 *
 * Kill switches (Cloudflare → Worker → Settings → Variables, no deploy needed):
 *   VEHICLE_KILLS = "off", WORLD_EVENTS = "off", MAP_STATES = "off"; KILL_CLASSES is in
 *   kill-classes.js ("all" | "alerts" | "off"). Each kind also stops writing by itself when
 *   its table passes MAX_MB (override: <KIND>_MAX_MB, e.g. VD_MAX_MB = "300").
 * Kept KEEP_DAYS (30) days, purged hourly. Players on the removal list (#61) are dropped at
 * write time. PRIVATE: read only with GET /live/collect?kind=vd|wev|ms&since= (proxy key).
 */
export const KEEP_DAYS = 30;
export const MS_EVERY_MS = 5 * 60e3;
export const PC_WORLDS = Object.freeze(["1", "10", "40"]);
export const MAX_MB = Object.freeze({ vd: 600, wev: 100, ms: 500 });
const ENV_KEY = Object.freeze({ vd: "VEHICLE_KILLS", wev: "WORLD_EVENTS", ms: "MAP_STATES" });
const BUF_MAX = 50000;
const ID = /^\d{5,25}$/;
const i = (x) => (x == null || x === "" ? 0 : +x || 0);
const zoneDef = (z) => (+z || 0) & 0xffff;
const pcWorld = (p) => PC_WORLDS.includes(String(p && p.world_id));

/** Is this kind switched on? Default on; "off" (any case) turns it off. */
export function kindOn(env, kind) {
  const v = env && env[ENV_KEY[kind]];
  return String(v == null ? "" : v).trim().toLowerCase() !== "off";
}
export function maxBytes(env, kind) {
  const v = Number(env && env[`${kind.toUpperCase()}_MAX_MB`]);
  return (Number.isFinite(v) && v > 0 ? v : MAX_MB[kind]) * 1e6;
}

/** VehicleDestroy → tuple, or null. */
export function vehicleTuple(p) {
  if (!p || p.event_name !== "VehicleDestroy" || !pcWorld(p)) return null;
  const a = String(p.attacker_character_id || ""), v = String(p.character_id || "");
  return [i(p.timestamp), i(p.world_id), zoneDef(p.zone_id), ID.test(a) ? a : "0", ID.test(v) ? v : "0",
    i(p.attacker_vehicle_id), i(p.vehicle_id), i(p.attacker_weapon_id), i(p.attacker_loadout_id),
    i(p.attacker_team_id), i(p.team_id || p.faction_id), i(p.facility_id)];
}

/** FacilityControl / MetagameEvent / ContinentLock / ContinentUnlock → tuple, or null. */
export function worldTuple(p) {
  if (!p || !pcWorld(p)) return null;
  const t = i(p.timestamp), w = i(p.world_id), z = zoneDef(p.zone_id);
  switch (p.event_name) {
    case "FacilityControl":
      return [t, "F", w, z, i(p.facility_id), i(p.old_faction_id), i(p.new_faction_id), String(p.outfit_id || "0"), i(p.duration_held)];
    case "MetagameEvent":
      return [t, "M", w, z, i(p.instance_id), i(p.metagame_event_id), String(p.metagame_event_state_name || p.metagame_event_state || ""),
        +p.faction_vs || 0, +p.faction_nc || 0, +p.faction_tr || 0, +p.experience_bonus || 0];
    case "ContinentLock":
    case "ContinentUnlock":
      return [t, p.event_name === "ContinentLock" ? "L" : "U", w, z, i(p.triggering_faction), i(p.previous_faction),
        +p.vs_population || 0, +p.nc_population || 0, +p.tr_population || 0];
    default:
      return null;
  }
}

/** live-map activity() of one world → compact map state, faction totals only (no `top`). */
export function mapState(act) {
  const zones = {};
  for (const [z, v] of Object.entries((act && act.zones) || {})) zones[z] = v.n;
  const bases = ((act && act.bases) || []).map((b) => {
    const r = { f: b.f, z: b.z, n: b.n, k: b.k, vk: b.vk, conv: b.conv, tick: b.tick };
    if (b.sp) r.sp = b.sp;
    return r;
  });
  return { zones, bases };
}

/** One buffered, blob-per-alarm SQLite table. */
export class BlobLog {
  constructor(sql, kind, { meter = null } = {}) {
    this.sql = sql; this.kind = kind; this.meter = meter;
    this.buf = []; this.lastPurge = 0; this.bytes = null; this.sizedAt = 0;
    this.stats = { kept: 0, rows: 0, dropped: 0, full: 0 };
    if (sql) {
      sql.exec(`CREATE TABLE IF NOT EXISTS ${kind} (t0 INTEGER, t1 INTEGER, n INTEGER, b INTEGER, d TEXT)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS ${kind}_t ON ${kind} (t1)`);
    }
  }
  push(tuple) {
    if (!tuple) return;
    if (this.buf.length >= BUF_MAX) { this.stats.dropped++; return; }
    this.buf.push(tuple);
  }
  size(now = Date.now(), force = false) {
    if (!this.sql) return null;
    if (!force && this.bytes != null && now - this.sizedAt < 3600e3) return this.bytes;
    try {
      const r = this.sql.exec(`SELECT COUNT(*) AS rows, COALESCE(SUM(n),0) AS n, COALESCE(SUM(b),0) AS bytes, MIN(t0) AS since FROM ${this.kind}`).toArray()[0];
      this.bytes = r ? +r.bytes || 0 : 0; this.sizedAt = now; this.sizeRow = r ? { ...r } : null;
    } catch { /* keep the last value */ }
    return this.bytes;
  }
  /** Write the buffer as one row (unless the table is full), purge old rows hourly. */
  write(rows, maxB, now = Date.now()) {
    if (!rows.length || !this.sql) return;
    if ((this.size(now) || 0) >= maxB) { this.stats.full++; return; }
    const d = JSON.stringify(rows);
    try {
      this.sql.exec(`INSERT INTO ${this.kind} (t0, t1, n, b, d) VALUES (?,?,?,?,?)`, rows[0][0], rows[rows.length - 1][0], rows.length, d.length, d);
      this.stats.rows++; this.stats.kept += rows.length;
      if (this.bytes != null) this.bytes += d.length;
      if (this.meter) this.meter.op("rows");
    } catch { /* next alarm */ }
  }
  purge(now = Date.now()) {
    if (!this.sql || now - this.lastPurge < 3600e3) return;
    this.lastPurge = now;
    try { this.sql.exec(`DELETE FROM ${this.kind} WHERE t1 < ?`, Math.floor(now / 1000 - KEEP_DAYS * 86400)); } catch {}
    this.size(now, true);
  }
  read(sinceSec, limit = 100) {
    if (!this.sql) return [];
    try { return this.sql.exec(`SELECT t0, t1, n, d FROM ${this.kind} WHERE t1 >= ? ORDER BY t1 LIMIT ?`, sinceSec, limit).toArray().map((r) => ({ t0: r.t0, t1: r.t1, n: r.n, k: JSON.parse(r.d) })); } catch { return []; }
  }
}

export class Collect {
  /** live: () => LiveMap (for map states); removed: async () → Set of removed cids. */
  constructor(sql = null, env = {}, { meter = null, live = null, removed = null } = {}) {
    this.env = env || {}; this.live = live; this.removed = removed;
    this.logs = { vd: new BlobLog(sql, "vd", { meter }), wev: new BlobLog(sql, "wev", { meter }), ms: new BlobLog(sql, "ms", { meter }) };
    this.lastMs = 0;
  }
  on(kind) { return kindOn(this.env, kind); }
  onEvent(envName, p) {
    if (envName !== "ps2" || !p) return;
    if (p.event_name === "VehicleDestroy") { if (this.on("vd")) this.logs.vd.push(vehicleTuple(p)); return; }
    if (this.on("wev")) this.logs.wev.push(worldTuple(p));
  }
  /** One map-state tuple for all PC worlds: [t, { "<world>": { zones, bases } }]. */
  snapshot(now = Date.now()) {
    const map = this.live && this.live();
    if (!map) return null;
    const out = {};
    for (const w of PC_WORLDS) {
      const s = mapState(map.activity("ps2", w, now));
      if (Object.keys(s.zones).length || s.bases.length) out[w] = s;
    }
    return Object.keys(out).length ? [Math.floor(now / 1000), out] : null;
  }
  /** From the 60 s alarm (only while the PC stream is on). */
  async settle(now = Date.now()) {
    if (this.on("ms") && now - this.lastMs >= MS_EVERY_MS) { this.lastMs = now; try { this.logs.ms.push(this.snapshot(now)); } catch {} }
    let gone = null;
    if (this.removed && this.logs.vd.buf.length) { try { gone = await this.removed(); } catch {} }
    for (const [kind, log] of Object.entries(this.logs)) {
      let rows = log.buf; log.buf = [];
      if (kind === "vd" && gone && gone.size) rows = rows.filter((k) => !gone.has(k[3]) && !gone.has(k[4]));
      log.write(rows, maxBytes(this.env, kind), now);
      log.purge(now);
    }
  }
  read(kind, sinceSec, limit) { return this.logs[kind] ? this.logs[kind].read(sinceSec, limit) : null; }
  /** Status for /monitor/usage: counts only, no player data. */
  info(now = Date.now()) {
    const out = {};
    for (const [kind, log] of Object.entries(this.logs)) {
      log.size(now);
      out[kind] = { on: this.on(kind), maxMB: maxBytes(this.env, kind) / 1e6, buffered: log.buf.length, ...log.stats, stored: log.sizeRow || null };
    }
    return out;
  }
}
