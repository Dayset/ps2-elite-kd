/**
 * Rooms (#55): PC and PlayStation are two separate worlds that never mix.
 *
 * - PC: Census namespace ps2 (all PC servers), data under data/ (unchanged).
 * - PlayStation: Census namespaces ps2ps4us (Genudine) and ps2ps4eu (Ceres);
 *   PS5 players play on the same two servers. Data under data-ps/.
 *
 * Identity inside a room is server + Census character_id, never the name.
 * Character ids are namespace-local (a Genudine id is not found on Ceres or
 * PC; checked live 2026-10-21), so a PS player file is players/<us|eu>-<cid>.json.
 * Percentile pools, rankings and searches only ever read their own room's tree.
 *
 * Pure module: used by the browser (app.js and friends) and by Node scripts.
 * The cache Worker keeps its own copy of the namespace allowlist
 * (worker/src/worker.js CENSUS_NAMESPACES; a test keeps the two equal).
 */

export const CENSUS_HOST = "https://census.daybreakgames.com";

export const ROOMS = Object.freeze({
  pc: Object.freeze({ id: "pc", label: "PC", dataDir: "data", namespaces: Object.freeze(["ps2"]) }),
  ps: Object.freeze({ id: "ps", label: "PlayStation", dataDir: "data-ps", namespaces: Object.freeze(["ps2ps4us", "ps2ps4eu"]) }),
});

export const DEFAULT_ROOM = "pc";

/** PlayStation servers: one Census namespace each. */
export const PS_SERVERS = Object.freeze({
  ps2ps4us: Object.freeze({ ns: "ps2ps4us", key: "us", name: "Genudine", worldId: 1000 }),
  ps2ps4eu: Object.freeze({ ns: "ps2ps4eu", key: "eu", name: "Ceres", worldId: 2000 }),
});

/** Every Census namespace any room reads. */
export const ALL_NAMESPACES = Object.freeze([...new Set(Object.values(ROOMS).flatMap((r) => r.namespaces))]);

export function isRoomId(id) {
  return Object.prototype.hasOwnProperty.call(ROOMS, id);
}

export function roomById(id) {
  return isRoomId(id) ? ROOMS[id] : ROOMS[DEFAULT_ROOM];
}

/** Room from a query string: only an explicit room=ps opens the PlayStation room. */
export function parseRoom(search) {
  let v = "";
  try {
    v = new URLSearchParams(String(search || "")).get("room") || "";
  } catch {
    v = "";
  }
  return v.trim().toLowerCase() === "ps" ? "ps" : "pc";
}

/** The page's room. live.html is always PC (Live stays PC-only, owner 2026-10-21). */
export function pageRoom(loc = typeof location !== "undefined" ? location : null) {
  if (!loc) return DEFAULT_ROOM;
  if (/(^|\/)live\.html$/.test(String(loc.pathname || ""))) return DEFAULT_ROOM;
  return parseRoom(loc.search);
}

/** "data/" or "data-ps/". */
export function dataPrefix(roomId) {
  return `${roomById(roomId).dataDir}/`;
}

/** Census base for one namespace: ".../s:<id>/get/<ns>:v2/". Unknown namespaces throw. */
export function censusNsBase(ns, serviceId = "example") {
  if (!ALL_NAMESPACES.includes(ns)) throw new Error(`unknown Census namespace ${JSON.stringify(ns)}`);
  const id = String(serviceId || "example").trim().replace(/^s:/, "") || "example";
  return `${CENSUS_HOST}/s:${encodeURIComponent(id)}/get/${ns}:v2/`;
}

/** Namespace of a Census base URL ("ps2", "ps2ps4us", …) or "". */
export function nsOfBase(base) {
  const m = /\/get\/([a-z0-9]+):v2\//.exec(String(base || ""));
  return m ? m[1] : "";
}

/** The PS server entry for a namespace or a short key ("us" / "eu"), or null. */
export function psServer(nsOrKey) {
  const k = String(nsOrKey || "");
  return PS_SERVERS[k] || Object.values(PS_SERVERS).find((s) => s.key === k) || null;
}

/** PS identity key: "us-<cid>" / "eu-<cid>". */
export function psKey(ns, cid) {
  const s = psServer(ns);
  const id = String(cid || "");
  if (!s || !/^\d{5,25}$/.test(id)) throw new Error(`bad PS identity ${ns}/${cid}`);
  return `${s.key}-${id}`;
}

/** "us-<cid>" → { ns, cid, server } or null. */
export function parsePsKey(key) {
  const m = /^(us|eu)-(\d{5,25})$/.exec(String(key || ""));
  if (!m) return null;
  const s = psServer(m[1]);
  return { ns: s.ns, cid: m[2], server: s.name };
}

/** Player file of a PS character, relative to data-ps/. */
export function psPlayerFile(ns, cid) {
  return `players/${psKey(ns, cid)}.json`;
}

/** Absolute URL with room=ps set (PS room) or removed (PC). */
export function withRoom(href, roomId) {
  const u = new URL(String(href));
  if (roomId === "ps") u.searchParams.set("room", "ps");
  else u.searchParams.delete("room");
  return u.toString();
}
