/**
 * 🗺️ Live map: who is where right now, from the Census event stream, IN MEMORY ONLY.
 *
 * Fed by every socket the KillMonitor holds (PC since the paid plan, PlayStation
 * since #60). Nothing here is written to storage: after a restart it refills
 * within minutes. Two read paths:
 *   - activity(env, w)  → per-base totals for the Oracle (#78): rough crowd per
 *                         faction, kills, point-capture XP. Never a player id. Public.
 *   - locate(env, cid)  → one player's continent and base. INTERNAL ONLY (key-protected
 *                         route; owner 2026-10-29: not a public feature, privacy).
 *
 * Where a player is (no Census event names the base of a kill):
 *   - exact: PlayerFacilityCapture / PlayerFacilityDefend (their base), and
 *     VehicleDestroy with a facility_id (both players);
 *   - near: a Death between someone placed exactly in the last FRESH_MS and
 *     someone not placed puts the second one at the same base (one hop only:
 *     a "near" position never places anyone else).
 * The continent comes from any event's zone_id. PlayerLogout ends it.
 *
 * 🚐 Forward spawns (owner 2026-10-30): the spawn XP (Sunderer, Router, squad beacon,
 * Galaxy / Valkyrie, ANT, Deliverer) counts each spawn point per base and per faction
 * in the last SPAWN_MS. A vehicle is told apart by its own id in the event (other_id),
 * a beacon by its owner. The base is the majority of where its owner (or the one who
 * killed it) was placed at each event. Only faction totals ever leave this file.
 */
import { FACILITY } from "./facility-names.js";

export const FRESH_MS = 3 * 60e3;   // a base position counts this long for crowds and "near"
export const SHOW_BASE_MS = 15 * 60e3; // the locator still names the base this long, with its age
export const WINDOW_MS = 5 * 60e3;  // per-base and per-zone crowd window
export const ONLINE_MS = 30 * 60e3; // no event for this long → not shown as active
export const KEEP_MS = 60 * 60e3;   // positions forgotten after this
export const FAC = Object.freeze({ 1: "VS", 2: "NC", 3: "TR", 4: "NSO" });
export const POINT_XP = Object.freeze({ 272: "conv", 557: "tick", 556: "dtick" });
export const SPAWN_MS = 10 * 60e3; // 🚐 a spawn point counts this long after its last spawn
/** 🚐 Spawn XP → kind: su Sunderer, ro Router, be squad beacon, ga Galaxy, sv squad vehicle (Valkyrie or Galaxy), an ANT, de Deliverer. */
export const SPAWN_XP = Object.freeze({ 233: "su", 1542: "su", 1410: "ro", 56: "be", 201: "ga", 1543: "ga", 355: "sv", 1988: "an", 1737: "de" });
/** 🚐 XP for killing / helping to kill one (other_id = that vehicle): marks it lost and helps place it. */
export const SPAWN_HIT_XP = Object.freeze({ 68: "su", 2151: "su", 113: "su", 2154: "su", 1409: "ro" });
export const SPAWN_KINDS = Object.freeze(["su", "ro", "be", "ga", "sv", "an", "de"]);
export const ZONE_NAME = Object.freeze({ 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 14: "Koltyr", 344: "Oshur", 361: "Desolation", 362: "Sanctuary", 96: "VR", 97: "VR", 98: "VR" });
/** Worlds each environment may report (anything else is ignored). */
export const ENV_WORLDS = Object.freeze({ ps2: ["1", "10", "40"], ps2ps4us: ["1000"], ps2ps4eu: ["2000"] });

export const zoneDef = (z) => (+z || 0) & 0xffff;
const ID = /^\d{5,25}$/;
const okId = (x) => typeof x === "string" ? ID.test(x) && x !== "0" : false;
const secs = (p, now) => { const t = +p.timestamp; return Number.isFinite(t) && t > 0 ? Math.min(t * 1000, now) : now; };

export class LiveMap {
  constructor() { this.envs = {}; }
  E(env) {
    return (this.envs[env] ||= { pos: new Map(), bases: new Map(), zones: new Map(), spawns: new Map() });
  }
  /** Stream payload → state. Returns false when the payload was ignored. */
  onEvent(env, p, now = Date.now()) {
    if (!p || typeof p !== "object" || !ENV_WORLDS[env]) return false;
    const w = String(p.world_id ?? "");
    if (w && !ENV_WORLDS[env].includes(w)) return false;
    const E = this.E(env);
    const t = secs(p, now);
    const z = p.zone_id != null ? +p.zone_id : null;
    const ev = p.event_name;
    const cid = String(p.character_id || "");
    if (ev === "PlayerLogout") {
      const r = E.pos.get(cid);
      if (r) { this.leaveBase(E, cid, r); this.leaveZone(E, cid, r); r.on = false; r.t = Math.max(r.t, t); }
      return true;
    }
    if (ev === "PlayerLogin") {
      if (!okId(cid)) return false;
      const r = this.touch(E, cid, w, null, t, null);
      r.on = true;
      return true;
    }
    if (ev === "Death") {
      const a = String(p.attacker_character_id || "");
      const fa = FAC[+p.attacker_team_id] || null, fv = FAC[+p.team_id] || null;
      const ra = okId(a) && a !== cid ? this.touch(E, a, w, z, t, fa) : null;
      const rv = okId(cid) ? this.touch(E, cid, w, z, t, fv) : null;
      const pa = this.fresh(ra, z, t), pv = this.fresh(rv, z, t);
      const f = pa ? ra.f : pv ? rv.f : 0;
      if (f) {
        // One hop: only an exact position places the other player.
        if (ra && !pa && pv && rv.src === 0) this.place(E, a, ra, f, t, 1);
        if (rv && !pv && pa && ra.src === 0) this.place(E, cid, rv, f, t, 1);
        const b = this.base(E, w, z, f);
        const tk = fa && fv && fa === fv;
        b.k.push([t, tk ? "tk" : fa || "?"]);
      }
      return true;
    }
    if (ev === "VehicleDestroy") {
      const f = String(p.facility_id || "0");
      const a = String(p.attacker_character_id || "");
      const fa = FAC[+p.attacker_team_id] || null, fv = FAC[+p.team_id] || FAC[+p.faction_id] || null;
      const ra = okId(a) ? this.touch(E, a, w, z, t, fa) : null;
      const rv = okId(cid) && cid !== a ? this.touch(E, cid, w, z, t, fv) : null;
      if (f !== "0" && /^\d+$/.test(f)) {
        if (ra) this.place(E, a, ra, f, t, 0);
        if (rv) this.place(E, cid, rv, f, t, 0);
        this.base(E, w, z, f).vk.push([t, fa || "?"]);
      }
      return true;
    }
    if (ev === "PlayerFacilityCapture" || ev === "PlayerFacilityDefend") {
      const f = String(p.facility_id || "0");
      if (!okId(cid) || f === "0" || !/^\d+$/.test(f)) return false;
      const r = this.touch(E, cid, w, z, t, null);
      this.place(E, cid, r, f, t, 0);
      return true;
    }
    if (ev === "GainExperience" && (SPAWN_XP[+p.experience_id] || SPAWN_HIT_XP[+p.experience_id])) {
      if (!okId(cid)) return false;
      const x = +p.experience_id, fac = FAC[+p.team_id] || null;
      const r = this.touch(E, cid, w, z, t, fac);
      const o = String(p.other_id || "");
      if (SPAWN_XP[x]) {
        const kind = SPAWN_XP[x];
        if (kind !== "be" && !okId(o)) return false;
        if (!fac || fac === "NSO") return false;
        const key = kind === "be" ? `b${cid}` : `v${o}`;
        let s = E.spawns.get(key);
        if (!s || s.k !== kind || s.fac !== fac) { s = { k: kind, fac, w, z: zoneDef(z), own: cid, votes: new Map(), t, n: 0, lost: 0 }; E.spawns.set(key, s); }
        s.t = Math.max(s.t, t); s.n++; s.own = cid; if (w) s.w = w;
        if (this.fresh(r, z, t)) s.votes.set(r.f, (s.votes.get(r.f) || 0) + 1);
      } else {
        const s = okId(o) && E.spawns.get(`v${o}`);
        if (!s) return true;
        if (x !== 113 && x !== 2154) s.lost = t;
        if (this.fresh(r, z, t)) s.votes.set(r.f, (s.votes.get(r.f) || 0) + 1);
      }
      return true;
    }
    if (ev === "GainExperience") {
      const kind = POINT_XP[+p.experience_id];
      if (!kind || !okId(cid)) return false;
      const r = this.touch(E, cid, w, z, t, FAC[+p.team_id] || null);
      if (this.fresh(r, z, t)) this.base(E, w, z, r.f)[kind].push([t, r.fac || "?"]);
      return true;
    }
    return false;
  }
  touch(E, cid, w, z, t, fac) {
    let r = E.pos.get(cid);
    if (!r) { r = { w: w || null, z: null, t, fac: null, f: null, ft: 0, src: 1, on: true }; E.pos.set(cid, r); }
    if (w) r.w = w;
    if (fac) r.fac = fac;
    if (z != null && r.z !== z) { this.leaveBase(E, cid, r); this.leaveZone(E, cid, r); r.z = z; r.f = null; r.ft = 0; }
    r.t = Math.max(r.t, t);
    r.on = true;
    if (r.z != null && r.w) {
      const zk = this.zone(E, r.w, r.z);
      zk.crowd.set(cid, [r.t, r.fac]);
      if (this.fresh(r, r.z, r.t)) { const b = E.bases.get(`${r.w}|${r.f}`); if (b) b.crowd.set(cid, [r.t, r.fac]); }
    }
    return r;
  }
  fresh(r, z, t) { return !!(r && r.f && (z == null || r.z === z) && t - r.ft <= FRESH_MS); }
  place(E, cid, r, f, t, src) {
    // An exact position is not overwritten by a guess while it is fresh.
    if (src === 1 && r.src === 0 && r.f && r.f !== f && t - r.ft <= FRESH_MS) return;
    const same = r.f === f;
    if (r.f && !same) this.leaveBase(E, cid, r);
    r.f = f; r.ft = same ? Math.max(r.ft, t) : t; r.src = same ? Math.min(r.src, src) : src;
    if (r.w && r.z != null) this.base(E, r.w, r.z, f).crowd.set(cid, [t, r.fac]);
  }
  leaveBase(E, cid, r) {
    if (!r.f || !r.w) return;
    const b = E.bases.get(`${r.w}|${r.f}`);
    if (b) b.crowd.delete(cid);
  }
  leaveZone(E, cid, r) {
    if (r.z == null || !r.w) return;
    const zk = E.zones.get(`${r.w}|${zoneDef(r.z)}`);
    if (zk) zk.crowd.delete(cid);
  }
  base(E, w, z, f) {
    const k = `${w}|${f}`;
    let b = E.bases.get(k);
    if (!b) { b = { w, z: zoneDef(z), f: String(f), crowd: new Map(), k: [], vk: [], conv: [], tick: [], dtick: [] }; E.bases.set(k, b); }
    return b;
  }
  zone(E, w, z) {
    const k = `${w}|${zoneDef(z)}`;
    let zk = E.zones.get(k);
    if (!zk) { zk = { w, z: zoneDef(z), crowd: new Map() }; E.zones.set(k, zk); }
    return zk;
  }

  /** One player (null when not seen in the last KEEP_MS). Internal only, never on a public page. */
  locate(env, cid, now = Date.now()) {
    const E = this.envs[env];
    const r = E && E.pos.get(String(cid));
    if (!r || now - r.t > KEEP_MS) return null;
    const z = r.z == null ? null : zoneDef(r.z);
    const out = { w: r.w ? +r.w : null, z, zn: z != null ? ZONE_NAME[z] || null : null, ago: Math.max(0, Math.round((now - r.t) / 1000)), on: r.on && now - r.t <= ONLINE_MS, fac: r.fac || null };
    if (r.f && now - r.ft <= SHOW_BASE_MS && r.on) {
      const fx = FACILITY[r.f];
      out.f = +r.f;
      out.fn = fx ? fx[0] : null;
      out.fago = Math.max(0, Math.round((now - r.ft) / 1000));
      out.how = r.src === 0 ? "exact" : "near";
    }
    return out;
  }

  /** 🚐 Where a spawn point is: the base most of its events were placed at, else its owner's fresh base. */
  spawnBase(E, s, now) {
    let best = null, bn = 0;
    for (const [f, n] of s.votes) if (n > bn) { best = f; bn = n; }
    if (best) return best;
    const r = E.pos.get(s.own);
    return r && r.f && now - r.ft <= FRESH_MS ? r.f : null;
  }
  /** 🚐 Spawn points per base for one world: Map fid → { VS: { su: 3, ro: 2 }, … } (faction totals only). */
  spawnIndex(env, world, now = Date.now()) {
    const E = this.envs[env], out = new Map();
    if (!E || !E.spawns) return out;
    const w = String(world), since = now - SPAWN_MS;
    for (const s of E.spawns.values()) {
      if (s.w !== w || s.t < since) continue;
      const f = this.spawnBase(E, s, now);
      if (!f) continue;
      const b = out.get(String(f)) || {};
      const q = (b[s.fac] ||= {});
      q[s.k] = (q[s.k] || 0) + 1;
      out.set(String(f), b);
    }
    return out;
  }
  /** 🚐 One base's spawn points (null when none were seen). */
  spawnsAt(env, world, f, now = Date.now()) {
    return this.spawnIndex(env, world, now).get(String(f)) || null;
  }

  /** Per-base and per-zone totals for one world (no player ids). */
  activity(env, world, now = Date.now(), zone = null) {
    const E = this.envs[env];
    const out = { at: Math.floor(now / 1000), window: WINDOW_MS / 1000, zones: {}, bases: [] };
    if (!E) return out;
    const w = String(world);
    const since = now - WINDOW_MS;
    const tally = (crowd) => {
      const n = { VS: 0, NC: 0, TR: 0, NSO: 0, "?": 0 };
      for (const [, [t, fac]] of crowd) if (t >= since) n[fac || "?"]++;
      return n;
    };
    const byFac = (arr) => {
      const n = {};
      for (const [t, fac] of arr) if (t >= since) n[fac] = (n[fac] || 0) + 1;
      return n;
    };
    const spi = this.spawnIndex(env, w, now);
    const last = (arr) => { let m = 0; for (const [t] of arr) if (t > m) m = t; return m ? Math.round((now - m) / 1000) : null; };
    for (const zk of E.zones.values()) {
      if (zk.w !== w || (zone != null && zk.z !== +zone)) continue;
      const n = tally(zk.crowd);
      if (n.VS + n.NC + n.TR + n.NSO + n["?"] === 0) continue;
      out.zones[zk.z] = { n, zn: ZONE_NAME[zk.z] || null };
    }
    for (const b of E.bases.values()) {
      if (b.w !== w || (zone != null && b.z !== +zone)) continue;
      const n = tally(b.crowd);
      const k = byFac(b.k), vk = byFac(b.vk), conv = byFac(b.conv), tick = byFac(b.tick);
      const total = n.VS + n.NC + n.TR + n.NSO + n["?"];
      const kills = Object.values(k).reduce((s, v) => s + v, 0);
      if (!total && !kills && !Object.keys(conv).length) continue;
      const fx = FACILITY[b.f];
      const row = { f: +b.f, fn: fx ? fx[0] : null, z: b.z, n, k, vk, conv, tick, convAgo: last(b.conv.filter(([t]) => t >= since)), killAgo: last(b.k) };
      if (spi.has(String(b.f))) row.sp = spi.get(String(b.f));
      out.bases.push(row);
    }
    out.bases.sort((x, y) => (y.n.VS + y.n.NC + y.n.TR + y.n.NSO) - (x.n.VS + x.n.NC + x.n.TR + x.n.NSO) || Object.values(y.k).reduce((s, v) => s + v, 0) - Object.values(x.k).reduce((s, v) => s + v, 0));
    return out;
  }

  /** Forget old positions and trim the windows (call every minute). */
  prune(now = Date.now()) {
    const since = now - WINDOW_MS;
    for (const E of Object.values(this.envs)) {
      for (const [cid, r] of E.pos) if (now - r.t > KEEP_MS) { this.leaveBase(E, cid, r); this.leaveZone(E, cid, r); E.pos.delete(cid); }
      for (const [k, b] of E.bases) {
        for (const [cid, [t]] of b.crowd) if (t < since) b.crowd.delete(cid);
        for (const key of ["k", "vk", "conv", "tick", "dtick"]) b[key] = b[key].filter(([t]) => t >= since);
        if (!b.crowd.size && !b.k.length && !b.vk.length && !b.conv.length && !b.tick.length && !b.dtick.length) E.bases.delete(k);
      }
      if (E.spawns) for (const [k, s] of E.spawns) if (now - s.t > SPAWN_MS) E.spawns.delete(k);
      for (const [k, zk] of E.zones) {
        for (const [cid, [t]] of zk.crowd) if (t < since) zk.crowd.delete(cid);
        if (!zk.crowd.size) E.zones.delete(k);
      }
    }
  }
  stats() {
    const out = {};
    for (const [env, E] of Object.entries(this.envs)) {
      let placed = 0;
      for (const r of E.pos.values()) if (r.f) placed++;
      out[env] = { players: E.pos.size, placed, bases: E.bases.size, zones: E.zones.size, spawns: E.spawns ? E.spawns.size : 0 };
    }
    return out;
  }
}
