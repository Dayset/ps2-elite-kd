/**
 * 🏴 Capture tags (owner 2026-10-30, "cheap capture tag", Option A): which outfit did most of
 * the work on each base capture, from events the PC live stream already receives — no extra
 * XP subscription (never the whole GainExperience firehose).
 *
 * Per capture (FacilityControl with a faction change):
 *   - people on the point = the PlayerFacilityCapture events for that flip (each carries the
 *     player's outfit_id);
 *   - point XP = Convert Capture Point (272) + Objective Pulse Capture (557) those same players
 *     earned in the capture's own window: from their first point XP (at most 6 minutes back)
 *     to the flip; a quick cap with no point XP uses the last 60 seconds;
 *   - each outfit's share = half its share of the people + half its share of the point XP
 *     (only the people share when nobody earned point XP); players with no outfit count in
 *     the total but never lead;
 *   - a clear lead = top outfit ≥ 50 %.
 * Mass flips (continent lock / unlock: 4+ bases of one continent in the same second, or a
 * flip to / from no faction) and instanced zones are skipped.
 *
 * One SQLite row per capture (≈ 2k a day), kept 7 days. Public output: outfit ids and tags,
 * base, factions, share and the head count only — never a player id or name, and not used by
 * the odds.
 */
import { FACILITY } from "./facility-names.js";

export const CAP_WINDOW_MAX_S = 360;   // first point XP at most 6 min before the flip
export const CAP_QUICK_S = 60;         // quick caps (no point XP): last 60 s
export const CAP_LEAD = 0.5;           // clear lead from 50 %
export const CAP_SETTLE_MS = 15e3;     // participants arrive within ~5 s of the flip
export const CAP_ORPHAN_MS = 90e3;     // participants with no FacilityControl: dropped
export const CAP_MASS = 4;             // ≥ 4 flips on one continent in the same second = mass flip
export const CAP_KEEP_DAYS = 7;
export const CAP_RECENT_MS = 2 * 3600e3; // kept in memory for the live reads
const POINT_XP = new Set(["272", "557"]);
const XP_KEEP = 120;                   // point-XP entries per player (557 ticks ~every 10–20 s)
const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const CENSUS = (sid) => `https://census.daybreakgames.com/s:${sid}/get/ps2:v2/`;
const TAG_CACHE_MAX = 20000;

const num = (x) => (x == null || x === "" ? NaN : +x);

/** Rank the outfits of one capture. parts: [[outfitId, pointXp]] (one per player). Pure. */
export function rankCapture(parts) {
  const people = parts.length;
  if (!people) return null;
  const xpTot = parts.reduce((s, p) => s + (p[1] > 0 ? p[1] : 0), 0);
  const by = new Map();
  for (const [o, xp] of parts) {
    const k = o && o !== "0" ? String(o) : "0";
    const e = by.get(k) || { n: 0, xp: 0 };
    e.n++; e.xp += xp > 0 ? xp : 0;
    by.set(k, e);
  }
  const share = (e) => (xpTot > 0 ? 0.5 * e.n / people + 0.5 * e.xp / xpTot : e.n / people);
  const list = [...by].filter(([k]) => k !== "0").map(([k, e]) => ({ id: k, n: e.n, xp: e.xp, share: share(e) }))
    .sort((a, b) => b.share - a.share || b.n - a.n || b.xp - a.xp);
  const top = list[0] || null;
  return { people, xp: xpTot, top, second: list[1] || null, lead: !!(top && top.share >= CAP_LEAD) };
}

export class CaptureTags {
  constructor(sql = null, { meter = null } = {}) {
    this.sql = sql;
    this.meter = meter;
    this.xp = new Map();       // cid → [[tSec, amount]] point XP (memory only, never exposed)
    this.pending = new Map();  // "w|f" → open capture
    this.burst = new Map();    // "w|z|ts" → flips in that second
    this.tags = new Map();     // outfit id → tag ("" when it has none)
    this.recentList = [];
    this.stats = { caps: 0, mass: 0, skipped: 0, orphan: 0, lookups: 0 };
    this.lastPurge = 0;
    if (sql) {
      sql.exec("CREATE TABLE IF NOT EXISTS cap (t INTEGER, w INTEGER, z INTEGER, f INTEGER, d TEXT)");
      sql.exec("CREATE INDEX IF NOT EXISTS cap_t ON cap (t)");
      try {
        const since = Math.floor((Date.now() - CAP_RECENT_MS) / 1000);
        this.recentList = sql.exec("SELECT d FROM cap WHERE t >= ? ORDER BY t", since).toArray().map((r) => JSON.parse(r.d));
      } catch {}
    }
  }
  onEvent(envName, p, now = Date.now()) {
    if (envName !== "ps2" || !p) return;
    const ev = p.event_name;
    if (ev === "GainExperience") {
      if (!POINT_XP.has(String(p.experience_id))) return;
      const t = num(p.timestamp), amt = num(p.amount), cid = p.character_id;
      if (!cid || !Number.isFinite(t)) return;
      let a = this.xp.get(cid);
      if (!a) this.xp.set(cid, (a = []));
      a.push([t, Number.isFinite(amt) ? amt : 0]);
      if (a.length > XP_KEEP) a.shift();
      return;
    }
    if (ev === "PlayerFacilityCapture") {
      const w = String(p.world_id), f = String(p.facility_id), cid = p.character_id;
      if (!cid || !f) return;
      const c = this.open(w, f, p, now);
      c.parts.set(cid, String(p.outfit_id || "0"));
      return;
    }
    if (ev === "FacilityControl") {
      const w = String(p.world_id), f = String(p.facility_id), z = num(p.zone_id), ts = num(p.timestamp);
      const bk = `${w}|${z}|${ts}`;
      this.burst.set(bk, (this.burst.get(bk) || 0) + 1);
      if (String(p.old_faction_id) === String(p.new_faction_id)) return; // a defense
      const c = this.open(w, f, p, now);
      c.fc = { ts, z, old: String(p.old_faction_id), nw: String(p.new_faction_id), credit: String(p.outfit_id || "0"), bk };
    }
  }
  open(w, f, p, now) {
    const k = `${w}|${f}`;
    let c = this.pending.get(k);
    if (!c) this.pending.set(k, (c = { w: +w, f: +f, z: num(p.zone_id), t0: num(p.timestamp), parts: new Map(), fc: null, first: now }));
    c.touch = now;
    return c;
  }
  /** Close settled captures (from the 60 s alarm). fetchFn for the outfit tags. */
  async settle(env, now = Date.now(), fetchFn = (u, o) => fetch(u, o)) {
    const ready = [];
    for (const [k, c] of this.pending) {
      if (!c.fc) { if (now - c.first > CAP_ORPHAN_MS) { this.pending.delete(k); this.stats.orphan++; } continue; }
      if (now - c.touch < CAP_SETTLE_MS) continue;
      this.pending.delete(k);
      const r = this.build(c);
      if (r) ready.push(r);
    }
    if (ready.length) {
      const need = [...new Set(ready.flatMap((r) => [r.oid, r.co]).filter((id) => id && id !== "0" && !this.tags.has(id)))];
      if (need.length) await this.lookup(env, need, fetchFn);
      for (const r of ready) {
        if (r.oid) r.tag = this.tags.get(r.oid) ?? null;
        if (r.co) r.cr = this.tags.get(r.co) ?? null;
        this.store(r);
      }
    }
    this.prune(now);
    return ready;
  }
  build(c) {
    const { fc } = c;
    const mass = (this.burst.get(fc.bk) || 0) >= CAP_MASS;
    if (mass) { this.stats.mass++; return null; }
    if (!FAC[fc.old] || !FAC[fc.nw] || !(fc.z > 0 && fc.z < 1000) || !c.parts.size) { this.stats.skipped++; return null; }
    const ts = fc.ts;
    let start = Infinity;
    for (const cid of c.parts.keys()) for (const [t] of this.xp.get(cid) || []) if (t >= ts - CAP_WINDOW_MAX_S && t <= ts + 5 && t < start) start = t;
    const quick = !Number.isFinite(start);
    if (quick) start = ts - CAP_QUICK_S;
    const parts = [...c.parts].map(([cid, o]) => {
      let xp = 0;
      for (const [t, a] of this.xp.get(cid) || []) if (t >= start && t <= ts + 5) xp += a;
      return [o, xp];
    });
    const rk = rankCapture(parts);
    const fx = FACILITY[String(c.f)];
    this.stats.caps++;
    return {
      t: ts, w: c.w, z: fc.z, f: c.f, fn: fx ? fx[0] : null, old: FAC[fc.old], fac: FAC[fc.nw],
      oid: rk.top ? rk.top.id : null, tag: null, share: rk.top ? Math.round(rk.top.share * 100) : 0, lead: rk.lead,
      co: fc.credit !== "0" ? fc.credit : null, cr: null, same: !!(rk.top && rk.top.id === fc.credit),
      n: rk.people, quick, win: Math.max(0, Math.round(ts - start)),
    };
  }
  async lookup(env, ids, fetchFn) {
    const sid = (env && env.CENSUS_SERVICE_ID) || "daysetps2legends";
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        this.stats.lookups++;
        const r = await fetchFn(`${CENSUS(sid)}outfit?outfit_id=${chunk.join(",")}&c:show=outfit_id,alias&c:limit=${chunk.length}`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) continue;
        const j = await r.json();
        for (const o of (j && j.outfit_list) || []) if (o && o.outfit_id) this.tags.set(String(o.outfit_id), String(o.alias || ""));
      } catch {}
    }
    if (this.tags.size > TAG_CACHE_MAX) this.tags.clear();
  }
  store(r) {
    this.recentList.push(r);
    if (!this.sql) return;
    try {
      this.sql.exec("INSERT INTO cap VALUES (?,?,?,?,?)", r.t, r.w, r.z, r.f, JSON.stringify(r));
      if (this.meter) this.meter.op("rows");
    } catch {}
  }
  prune(now = Date.now()) {
    const s = now / 1000;
    for (const [cid, a] of this.xp) {
      while (a.length && a[0][0] < s - CAP_WINDOW_MAX_S - 60) a.shift();
      if (!a.length) this.xp.delete(cid);
    }
    for (const k of this.burst.keys()) if (+k.split("|")[2] < s - 600) this.burst.delete(k);
    const cut = (now - CAP_RECENT_MS) / 1000;
    if (this.recentList.length && this.recentList[0].t < cut) this.recentList = this.recentList.filter((r) => r.t >= cut);
    if (this.sql && now - this.lastPurge > 3600e3) {
      this.lastPurge = now;
      try { this.sql.exec("DELETE FROM cap WHERE t < ?", Math.floor(s - CAP_KEEP_DAYS * 86400)); } catch {}
    }
  }
  /** Captures of one world (newest first) since sinceSec, optionally one continent. */
  recent(world, sinceSec, zone = null, limit = 50) {
    const w = +world;
    const out = [];
    for (let i = this.recentList.length - 1; i >= 0 && out.length < limit; i--) {
      const r = this.recentList[i];
      if (r.t < sinceSec) break;
      if (r.w === w && (zone == null || r.z === +zone)) out.push(r);
    }
    return out;
  }
  /** Older reads (up to the 7 days kept) from SQLite. */
  history(world, sinceSec, zone = null, limit = 200) {
    if (!this.sql) return this.recent(world, sinceSec, zone, limit);
    const q = zone == null ? ["SELECT d FROM cap WHERE w=? AND t>=? ORDER BY t DESC LIMIT ?", +world, sinceSec, limit]
      : ["SELECT d FROM cap WHERE w=? AND t>=? AND z=? ORDER BY t DESC LIMIT ?", +world, sinceSec, +zone, limit];
    try { return this.sql.exec(...q).toArray().map((r) => JSON.parse(r.d)); } catch { return []; }
  }
  info() { return { ...this.stats, pending: this.pending.size, players: this.xp.size, tags: this.tags.size, recent: this.recentList.length }; }
}
