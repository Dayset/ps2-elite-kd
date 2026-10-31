/**
 * 👥 Base rosters (owner 2026-10-30, Oracle scoreboard): the full list of players seen at a
 * base when it is captured or defended, for a later check of whether stronger players take
 * more bases and of how accurate the live map is.
 *
 * On each FacilityControl (PC only; instanced zones and mass flips of 4+ bases in one second
 * skipped) it waits CAP_SETTLE_MS for the point events, then stores ONE SQLite row:
 *   { t, w, z, f, fn, r: "cap" | "def", old, fac, pl: [[cid, fac, kills, deaths, onPoint]] }
 * from live-map.js roster() (everyone placed at the base in the last 5 minutes, kills and
 * deaths there) plus the players on the point (PlayerFacilityCapture / -Defend).
 * Names and iVi are not stored: scripts/roster-report.mjs joins them from the site's data.
 * Players on the removal list (#61) are left out. Kept ROSTER_KEEP_DAYS days.
 * INTERNAL ONLY: read with GET /live/rosters (proxy key). Not used by the odds.
 */
import { FACILITY } from "./facility-names.js";

export const ROSTER_SETTLE_MS = 15e3;
export const ROSTER_ORPHAN_MS = 90e3;
export const ROSTER_MASS = 4;
export const ROSTER_KEEP_DAYS = 30;
export const ROSTER_MAX = 300;          // players kept per row
const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const num = (x) => (x == null || x === "" ? NaN : +x);

export class Rosters {
  constructor(sql = null, { meter = null, roster = null, removed = null } = {}) {
    this.sql = sql;
    this.meter = meter;
    this.roster = roster;        // (w, f) → [[cid, fac, k, d]] (live-map.js)
    this.removed = removed;      // async () → Set of removed cids, or null
    this.pending = new Map();    // "w|f" → { point: Set, fc }
    this.burst = new Map();
    this.stats = { rows: 0, mass: 0, skipped: 0, orphan: 0, players: 0 };
    this.lastPurge = 0;
    if (sql) {
      sql.exec("CREATE TABLE IF NOT EXISTS roster (t INTEGER, w INTEGER, z INTEGER, f INTEGER, d TEXT)");
      sql.exec("CREATE INDEX IF NOT EXISTS roster_t ON roster (t)");
    }
  }
  onEvent(envName, p, now = Date.now()) {
    if (envName !== "ps2" || !p) return;
    const ev = p.event_name;
    if (ev === "PlayerFacilityCapture" || ev === "PlayerFacilityDefend") {
      const w = String(p.world_id), f = String(p.facility_id), cid = String(p.character_id || "");
      if (!/^\d{5,25}$/.test(cid) || !f) return;
      this.open(w, f, now).point.add(cid);
      return;
    }
    if (ev === "FacilityControl") {
      const w = String(p.world_id), f = String(p.facility_id), z = num(p.zone_id), ts = num(p.timestamp);
      const bk = `${w}|${z}|${ts}`;
      this.burst.set(bk, (this.burst.get(bk) || 0) + 1);
      const c = this.open(w, f, now);
      c.fc = { ts, z, old: String(p.old_faction_id), nw: String(p.new_faction_id), bk };
    }
  }
  open(w, f, now) {
    const k = `${w}|${f}`;
    let c = this.pending.get(k);
    if (!c) this.pending.set(k, (c = { w: +w, f: +f, point: new Set(), fc: null, first: now }));
    c.touch = now;
    return c;
  }
  /** Store the settled rows (from the 60 s alarm). Returns them. */
  async settle(now = Date.now()) {
    const ready = [];
    for (const [k, c] of this.pending) {
      if (!c.fc) { if (now - c.first > ROSTER_ORPHAN_MS) { this.pending.delete(k); this.stats.orphan++; } continue; }
      if (now - c.touch < ROSTER_SETTLE_MS) continue;
      this.pending.delete(k);
      const r = this.build(c);
      if (r) ready.push(r);
    }
    if (ready.length) {
      let gone = null;
      if (this.removed) { try { gone = await this.removed(); } catch {} }
      for (const r of ready) {
        if (gone && gone.size) r.pl = r.pl.filter((p) => !gone.has(p[0]));
        this.store(r);
      }
    }
    this.prune(now);
    return ready;
  }
  build(c) {
    const { fc } = c;
    if ((this.burst.get(fc.bk) || 0) >= ROSTER_MASS) { this.stats.mass++; return null; }
    if (!FAC[fc.old] || !FAC[fc.nw] || !(fc.z > 0 && fc.z < 1000)) { this.stats.skipped++; return null; }
    let list = [];
    try { list = (this.roster && this.roster(String(c.w), String(c.f))) || []; } catch {}
    const seen = new Set(list.map((p) => p[0]));
    const pl = list.map(([cid, fac, k, d]) => [cid, fac || null, k, d, c.point.has(cid) ? 1 : 0]);
    for (const cid of c.point) if (!seen.has(cid)) pl.push([cid, null, 0, 0, 1]);
    if (!pl.length) { this.stats.skipped++; return null; }
    const fx = FACILITY[String(c.f)];
    return { t: fc.ts, w: c.w, z: fc.z, f: c.f, fn: fx ? fx[0] : null, r: fc.old === fc.nw ? "def" : "cap", old: FAC[fc.old], fac: FAC[fc.nw], pl: pl.slice(0, ROSTER_MAX) };
  }
  store(r) {
    this.stats.rows++; this.stats.players += r.pl.length;
    if (!this.sql) return;
    try {
      this.sql.exec("INSERT INTO roster VALUES (?,?,?,?,?)", r.t, r.w, r.z, r.f, JSON.stringify(r));
      if (this.meter) this.meter.op("rows");
    } catch {}
  }
  prune(now = Date.now()) {
    const s = now / 1000;
    for (const k of this.burst.keys()) if (+k.split("|")[2] < s - 600) this.burst.delete(k);
    if (this.sql && now - this.lastPurge > 3600e3) {
      this.lastPurge = now;
      try { this.sql.exec("DELETE FROM roster WHERE t < ?", Math.floor(s - ROSTER_KEEP_DAYS * 86400)); } catch {}
    }
  }
  /** Stored rows from sinceSec (oldest first), optionally one world. */
  read(sinceSec, world = null, limit = 500) {
    if (!this.sql) return [];
    const q = world == null ? ["SELECT d FROM roster WHERE t>=? ORDER BY t LIMIT ?", sinceSec, limit]
      : ["SELECT d FROM roster WHERE t>=? AND w=? ORDER BY t LIMIT ?", sinceSec, +world, limit];
    try { return this.sql.exec(...q).toArray().map((r) => JSON.parse(r.d)); } catch { return []; }
  }
  /** Rows and bytes stored (for the size estimate). */
  size() {
    if (!this.sql) return null;
    try {
      const r = this.sql.exec("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(d)),0) AS b, MIN(t) AS t0 FROM roster").toArray()[0];
      return { rows: r.n, bytes: r.b, since: r.t0 };
    } catch { return null; }
  }
  info() { return { ...this.stats, pending: this.pending.size }; }
}
