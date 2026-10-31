/**
 * 🌐 Server rating (t798u / t799u, owner: the server version of the 🏳️ Faction section).
 *
 * PC servers today are Osprey and Wainwright (Connery, Miller, Emerald and Cobalt were merged into them, SolTech is
 * closed); the PlayStation room has Genudine (US) and Ceres (EU). Each player's home world comes from Census
 * (character world_id): PC player files carry `world` since t798u, older files use data/server-backfill.json (filled
 * once from Census). Census already lists merged characters on their current world; the old ids map as well, just in case.
 *
 * Built once per ranks build (scripts/build-ranks.mjs → data/servers.json, data-ps/servers.json), no network.
 * Per server: player count, median / mean / p90 ⚔️ iVi, median K/D, KPM and play time, its share of the top 10% and
 * of the top 100 by ⚔️ iVi, and the top players (up to 50) for the name-box alias ("osprey", "wainwright", …).
 * Left out, and counted: hidden players (not in ranks.json), confirmed padders, rows with no ⚔️ iVi, and players on
 * other worlds (Jaeger event server, SolTech, unknown). Same rules as faction-rating.mjs. DOM-free.
 */
import { FACTION_TOP_N, TOP_SHARE_Q, ACTIVE_DAYS } from "./faction-rating.mjs?v=20261031-fr1";

export const SERVERS_PC = Object.freeze(["osprey", "wainwright"]);
export const SERVERS_PS = Object.freeze(["genudine", "ceres"]);
export const SERVERS = Object.freeze([...SERVERS_PC, ...SERVERS_PS]);
export const SERVER_LABEL = Object.freeze({ osprey: "Osprey", wainwright: "Wainwright", genudine: "Genudine", ceres: "Ceres" });
/** Bar colours (no meaning beyond telling the two apart). */
export const SERVER_COLOR = Object.freeze({ osprey: "#0ea5e9", wainwright: "#f59e0b", genudine: "#0ea5e9", ceres: "#f59e0b" });
/** Census world_id → current server. 17 Emerald → Osprey, 13 Cobalt → Wainwright (merged; Connery 1 and Miller 10 kept their ids). */
export const WORLD_SERVER = Object.freeze({ 1: "osprey", 17: "osprey", 10: "wainwright", 13: "wainwright", 1000: "genudine", 2000: "ceres" });
export const SERVER_TOP_N = FACTION_TOP_N;

export function serversOfRoom(isPs) { return isPs ? SERVERS_PS : SERVERS_PC; }

/**
 * Typed alias → server. Census has no active character with these exact names (checked 2026-10-31 on PC, PS4 US and
 * PS4 EU: the newest login of any of them is 2017-06-07), so the words are aliases in the room they belong to.
 */
export function serverAlias(token, isPs = false) {
  const k = String(token || "").trim().toLowerCase();
  return serversOfRoom(isPs).includes(k) ? k : null;
}

/**
 * Pull stand-alone server words out of raw name-field text ("Osprey, Sarleyy" → ["osprey"], "Sarleyy").
 * Only whole tokens (split on space, comma, semicolon) count; "[osprey]" stays an outfit tag.
 * @returns {{ servers: string[], rest: string }}
 */
export function extractServerAliases(raw, isPs = false) {
  const servers = [];
  const rest = String(raw || "").replace(/(^|[\s,;])([A-Za-z]{5,10})(?=$|[\s,;])/g, (all, lead, w) => {
    const s = serverAlias(w, isPs);
    if (!s) return all;
    if (!servers.includes(s)) servers.push(s);
    return lead;
  });
  return { servers, rest: servers.length ? rest.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/([,;])\s*[,;]+/g, "$1") : String(raw || "").trim() };
}

/** Server of a world id (number or string); null for other worlds. */
export function serverOfWorld(w) {
  const k = String(w == null ? "" : w).trim();
  return Object.prototype.hasOwnProperty.call(WORLD_SERVER, k) ? WORLD_SERVER[k] : null;
}

/** World id of a PC player file: its own "world" (since t798u), else the Census backfill by character id. */
export function worldOf(pl, backfill) {
  if (pl && /^\d+$/.test(String(pl.world == null ? "" : pl.world))) return +pl.world;
  const b = backfill && pl && pl.cid != null ? backfill[String(pl.cid)] : null;
  return /^\d+$/.test(String(b == null ? "" : b)) ? +b : null;
}

const fin = Number.isFinite;
const median = (xs) => { const s = xs.filter(fin).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const mean = (xs) => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const quantile = (xs, q) => { const s = xs.filter(fin).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : null; };
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);

/**
 * @param {{ slug:string, name:string, server:string|null, world?:number|null, adjs:number|null, kd:number|null,
 *           kpm:number|null, playH:number|null, last?:number|null, thin?:boolean, padder?:boolean }[]} players
 * @param {{ servers?: readonly string[], now?:number, topN?:number }} [o]
 */
export function buildServerRating(players, { servers = SERVERS_PC, now = Date.now(), topN = SERVER_TOP_N } = {}) {
  const all = (players || []).filter(Boolean);
  const rated = all.filter((p) => servers.includes(p.server) && !p.padder && !p.thin && fin(p.adjs));
  const otherWorlds = {};
  for (const p of all) if (!servers.includes(p.server)) { const k = fin(p.world) ? String(p.world) : "?"; otherWorlds[k] = (otherWorlds[k] || 0) + 1; }
  const left = { padders: all.filter((p) => p.padder).length, noServer: all.filter((p) => !servers.includes(p.server)).length, thin: all.filter((p) => !p.padder && (p.thin || !fin(p.adjs))).length, worlds: otherWorlds };
  const byIvi = [...rated].sort((a, b) => b.adjs - a.adjs);
  const topCut = Math.max(1, Math.round(byIvi.length * TOP_SHARE_Q));
  const top = byIvi.slice(0, topCut);
  const top100 = byIvi.slice(0, 100);
  const out = {};
  for (const s of servers) {
    const g = rated.filter((p) => p.server === s);
    const nTop = top.filter((p) => p.server === s).length;
    out[s] = {
      n: g.length,
      medIvi: r1(median(g.map((p) => p.adjs))),
      meanIvi: r1(mean(g.map((p) => p.adjs))),
      p90Ivi: r1(quantile(g.map((p) => p.adjs), 0.9)),
      medKd: r2(median(g.map((p) => p.kd))),
      medKpm: r3(median(g.map((p) => p.kpm))),
      medH: r1(median(g.map((p) => p.playH))),
      top: nTop,
      topShare: byIvi.length ? r3(nTop / top.length) : null,
      topRate: g.length ? r3(nTop / g.length) : null,
      top100: top100.filter((p) => p.server === s).length,
    };
  }
  // Alias lists: best ⚔️ iVi first, players active in the last ACTIVE_DAYS before the rest (as the faction alias).
  const cutSec = now / 1000 - ACTIVE_DAYS * 86400;
  const lists = {};
  for (const s of servers) {
    const g = byIvi.filter((p) => p.server === s);
    const act = g.filter((p) => fin(p.last) && p.last >= cutSec);
    const rest = g.filter((p) => !(fin(p.last) && p.last >= cutSec));
    lists[s] = [...act, ...rest].slice(0, topN).map((p) => p.name);
  }
  return { v: 1, servers: [...servers], rated: rated.length, topCut, left, stats: out, top: lists };
}

/** Server with the highest value of pick(sr, s) (ties: first listed). */
export function serverLeader(sr, pick) {
  let b = null, bv = -Infinity;
  for (const s of (sr && sr.servers) || []) { const x = pick(sr, s); if (fin(x) && x > bv) { bv = x; b = s; } }
  return b;
}
