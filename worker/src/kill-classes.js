/**
 * 🎯 Class vs class kills (owner t828u, 2026-11-01): during PC alerts, every Death from the
 * existing PC live stream is kept with both classes (loadouts), both character ids (so
 * scripts/class-kills-report.mjs can join each side's iVi from the site's data), world, zone,
 * time, weapon, the killer's vehicle and headshot. No extra stream subscription, no Honu.
 *
 * Alerts: Census world_event?type=METAGAME for the PC worlds, polled every POLL_MS from the
 * 60 s alarm (≈720 Census calls a day). A world+continent is "on" from a started event until
 * ended / canceled, or MAX_ALERT_S after the start. ALL = true would keep every Death instead
 * (not switched on: owner's go-ahead needed; worker variable KILL_CLASSES = "all").
 *
 * Storage: kills are buffered in memory and written as ONE SQLite row per alarm (blob of
 * compact tuples), so a busy alert costs ~1 written row a minute, not one per kill.
 *   kc (t0 INTEGER, t1 INTEGER, n INTEGER, d TEXT) — d = JSON [[t, w, z, a, v, al, vl, wpn, av, hs, at, vt], …]
 * Kept KC_KEEP_DAYS days. Players on the removal list (#61) are dropped at write time.
 * PRIVATE: read only with GET /live/killclasses (proxy key). Only class-level totals may ever be public.
 */
export const KC_KEEP_DAYS = 30;
export const KC_POLL_MS = 120e3;
export const KC_MAX_ALERT_S = 2 * 3600;
export const KC_WORLDS = Object.freeze(["1", "10", "40"]);
const ID = /^\d{5,25}$/;
const i = (x) => (x == null || x === "" ? 0 : +x || 0);
const zoneDef = (z) => (+z || 0) & 0xffff;

/** Census world_event rows (newest first) → Map "w|z" → { s (start sec), id }. */
export function activeAlerts(rows, nowSec) {
  const seen = new Set(), on = new Map();
  for (const e of rows || []) {
    const k = `${e.world_id}|${zoneDef(e.zone_id)}`;
    if (seen.has(k)) continue;           // the newest event per continent decides
    seen.add(k);
    const t = i(e.timestamp);
    if (e.metagame_event_state_name === "started" && nowSec - t < KC_MAX_ALERT_S) on.set(k, { s: t, id: i(e.metagame_event_id) });
  }
  return on;
}

/** Death payload → compact tuple, or null. */
export function killTuple(p) {
  if (!p || p.event_name !== "Death") return null;
  const a = String(p.attacker_character_id || ""), v = String(p.character_id || "");
  if (!ID.test(v)) return null;
  return [i(p.timestamp), i(p.world_id), zoneDef(p.zone_id), ID.test(a) ? a : "0", v, i(p.attacker_loadout_id), i(p.character_loadout_id),
    i(p.attacker_weapon_id), i(p.attacker_vehicle_id), i(p.is_headshot) ? 1 : 0, i(p.attacker_team_id), i(p.team_id)];
}

export class KillClasses {
  constructor(sql = null, { meter = null, removed = null, fetchFn = null, sid = "daysetps2legends", all = false } = {}) {
    this.sql = sql; this.meter = meter; this.removed = removed; this.all = !!all;
    this.fetchFn = fetchFn || ((u, o) => fetch(u, o));
    this.sid = sid;
    this.on = new Map(); this.polled = 0; this.pollOk = 0;
    this.buf = []; this.lastPurge = 0;
    this.stats = { kept: 0, rows: 0, dropped: 0, polls: 0, pollFails: 0 };
    if (sql) {
      sql.exec("CREATE TABLE IF NOT EXISTS kc (t0 INTEGER, t1 INTEGER, n INTEGER, d TEXT)");
      sql.exec("CREATE INDEX IF NOT EXISTS kc_t ON kc (t1)");
    }
  }
  live(w, z, tSec) {
    const a = this.on.get(`${w}|${z}`);
    return !!a && tSec >= a.s - 5 && tSec - a.s < KC_MAX_ALERT_S;
  }
  onEvent(envName, p) {
    if (envName !== "ps2" || !p || p.event_name !== "Death") return;
    const k = killTuple(p);
    if (!k || !KC_WORLDS.includes(String(k[1]))) return;
    if (!this.all && !this.live(k[1], k[2], k[0])) return;
    if (this.buf.length >= 50000) { this.stats.dropped++; return; }
    this.buf.push(k);
  }
  async poll(now = Date.now()) {
    if (now - this.polled < KC_POLL_MS) return;
    this.polled = now; this.stats.polls++;
    const u = `https://census.daybreakgames.com/s:${this.sid}/get/ps2:v2/world_event?type=METAGAME&world_id=${KC_WORLDS.join(",")}&c:limit=40`;
    try {
      const r = await this.fetchFn(u);
      const j = r.ok ? await r.json() : null;
      if (!j || !Array.isArray(j.world_event_list)) throw new Error("bad reply");
      this.on = activeAlerts(j.world_event_list, Math.floor(now / 1000));
      this.pollOk = now;
    } catch { this.stats.pollFails++; }
  }
  /** From the 60 s alarm: refresh alerts, write the buffer as one row, purge old rows. */
  async settle(now = Date.now()) {
    await this.poll(now);
    if (this.buf.length) {
      let rows = this.buf; this.buf = [];
      if (this.removed) {
        try { const gone = await this.removed(); if (gone && gone.size) rows = rows.filter((k) => !gone.has(k[3]) && !gone.has(k[4])); } catch {}
      }
      if (rows.length && this.sql) {
        try {
          this.sql.exec("INSERT INTO kc VALUES (?,?,?,?)", rows[0][0], rows[rows.length - 1][0], rows.length, JSON.stringify(rows));
          this.stats.rows++; this.stats.kept += rows.length;
          if (this.meter) this.meter.op("rows");
        } catch {}
      }
    }
    if (this.sql && now - this.lastPurge > 3600e3) {
      this.lastPurge = now;
      try { this.sql.exec("DELETE FROM kc WHERE t1 < ?", Math.floor(now / 1000 - KC_KEEP_DAYS * 86400)); } catch {}
    }
  }
  /** Stored kills since sinceSec (oldest first, up to limit rows of blobs). */
  read(sinceSec, limit = 200) {
    if (!this.sql) return [];
    try { return this.sql.exec("SELECT t0, t1, n, d FROM kc WHERE t1 >= ? ORDER BY t1 LIMIT ?", sinceSec, limit).toArray().map((r) => ({ t0: r.t0, t1: r.t1, n: r.n, k: JSON.parse(r.d) })); } catch { return []; }
  }
  size() {
    if (!this.sql) return null;
    try { const r = this.sql.exec("SELECT COUNT(*) AS rows, COALESCE(SUM(n),0) AS kills, COALESCE(SUM(LENGTH(d)),0) AS bytes, MIN(t0) AS since FROM kc").toArray()[0]; return { ...r }; } catch { return null; }
  }
  /** Public status: counts and which continents are on (no player data). */
  info(now = Date.now()) {
    return { mode: this.all ? "all" : "alerts", alertsOn: [...this.on.keys()], lastPollAgoS: this.pollOk ? Math.round((now - this.pollOk) / 1000) : null, buffered: this.buf.length, ...this.stats, stored: this.size() };
  }
}
