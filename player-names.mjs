/**
 * 🪪 Player name checker (player-names.html): pure, DOM-free helpers.
 *
 * Availability, measured 2026-11-14 — read this before "fixing" it:
 * - A character NAME is PC-wide, not per server or per faction. Census holds
 *   one global `character` collection per namespace: `character?name.first_lower`
 *   returns the character whatever server they are on. Proved with one-row
 *   answers for common single words: "Sniper", "Killer", "Alex", "John",
 *   "Ghost" each exist exactly once on all of PC. So the PC check is ONE
 *   lookup, no server filter; a name taken anywhere on PC is taken everywhere.
 * - PlayStation is two namespaces (rooms.mjs): ps2ps4us (Genudine) and
 *   ps2ps4eu (Ceres). Names CAN repeat across them — "Sniper" exists on both —
 *   and even twice on one server ("Sniper" twice on Ceres, both VS, BR 3 and
 *   BR 2). So the PS check is TWO lookups and reports per server, with all
 *   holders, never a single global verdict.
 * - Name shape, measured from the site's own data (data/ranks.json, 17,497
 *   ranked PC names): 3–32 letters and digits, no spaces, no other
 *   characters. Shortest in the wild: "4UA", "086", "1N4"; longest: 32 chars
 *   ("mmnmnmnmnmnmnmnmnmnmnmnmnmnmnmnm"). 1–2 char probes ("a", "ab", "zz",
 *   "q7") return nothing on Census, consistent with a 3-char minimum. The
 *   checker enforces that shape and leaves the Naming Policy to the game.
 * - The holder's world comes from `c:resolve=world`, which injects world_id
 *   into the character row (a plain `c:show=world_id` returns nothing — it is
 *   not a direct character field).
 */

import { censusBase } from "./census-fetch.mjs";
import { CENSUS_SERVICE_ID } from "./config.mjs";
import { censusNsBase, nsOfBase } from "./rooms.mjs";

/** Census base for the PC check (same registered ID as the site). */
export const PLAYER_CENSUS_BASE = censusBase(CENSUS_SERVICE_ID);

/** Shortest / longest character name seen in data/ranks.json (17,497 rows). */
export const MIN_PLAYER_NAME_LEN = 3;
export const MAX_PLAYER_NAME_LEN = 32;

/** Faction id → label (Census character.faction_id). */
export const FACTION_BY_ID = Object.freeze({ 1: "VS", 2: "NC", 3: "TR", 4: "NSO" });

/**
 * Census world_id → current server label. PC worlds from server-rating.mjs
 * WORLD_SERVER (1/17 → Osprey, 10/13 → Wainwright); Jaeger / SolTech and the
 * PS worlds from outfit-tags.mjs WORLD_NAMES. Unknown id → "".
 */
export const WORLD_LABELS = Object.freeze({
  1: "Osprey", 17: "Osprey", 10: "Wainwright", 13: "Wainwright",
  19: "Jaeger", 40: "SolTech", 1000: "Genudine", 2000: "Ceres",
});

export const worldLabel = (worldId) => WORLD_LABELS[+worldId] || "";

/** "  Fantom220TR " → "fantom220tr". Names have no spaces; trim is belt-and-braces. */
export function normalizePlayerName(name) {
  return String(name || "").trim().toLowerCase();
}

/** Shape a name must have to be creatable: 3–32 letters/digits, nothing else. */
export function validPlayerName(name) {
  const n = String(name || "").trim();
  return (
    n.length >= MIN_PLAYER_NAME_LEN &&
    n.length <= MAX_PLAYER_NAME_LEN &&
    /^[A-Za-z0-9]+$/.test(n)
  );
}

/** Census: the character(s) with this exact (lower-cased) name. Pass a valid name. */
export function playerLookupUrl(base, name) {
  return (
    `${base}character?name.first_lower=${encodeURIComponent(normalizePlayerName(name))}` +
    "&c:show=character_id,name.first,faction_id,battle_rank.value,times.last_login" +
    "&c:resolve=world&c:limit=5"
  );
}

/**
 * One Census character lookup answer → { taken, rows }.
 * taken = the list is non-empty; rows carry name, faction label, battle rank,
 * world_id and last-login epoch. An error object / no list → taken is null
 * (unknown, not free: a failed check must never report "available").
 */
export function parsePlayerLookup(json) {
  const list = json && Array.isArray(json.character_list) ? json.character_list : null;
  if (!list) return { taken: null, rows: [] };
  const rows = list
    .filter((r) => r && r.character_id)
    .map((r) => ({
      id: String(r.character_id),
      name: String((r.name && r.name.first) || ""),
      faction: FACTION_BY_ID[+r.faction_id] || "",
      br: +(r.battle_rank && r.battle_rank.value) || null,
      world: String(r.world_id || ""),
      lastLogin: +(r.times && r.times.last_login) || 0,
    }));
  return { taken: rows.length > 0, rows };
}

/** "Fantom220TR · TR · Wainwright · BR 100"; unknown parts are left out. */
export function holderLabel(r) {
  if (!r) return "";
  const bits = [r.name];
  if (r.faction) bits.push(r.faction);
  const server = worldLabel(r.world);
  if (server) bits.push(server);
  if (Number.isFinite(r.br)) bits.push(`BR ${r.br}`);
  return bits.filter(Boolean).join(" · ");
}

/** All holders of a name, first one in full, the rest counted ("(+1 more)"). */
export function holdersLabel(rows) {
  if (!rows || !rows.length) return "";
  const first = holderLabel(rows[0]);
  return rows.length > 1 ? `${first} (+${rows.length - 1} more)` : first;
}

/**
 * Deterministic variations of a taken name to try next: digit suffixes and an
 * x-prefix / X-suffix. Only variants that are themselves creatable (3–32
 * alphanumerics) come back, so a 32-char name yields none.
 */
export function variantNames(name) {
  const base = String(name || "").trim();
  if (!base) return [];
  const out = [];
  const seen = new Set();
  for (const v of [`${base}7`, `${base}99`, `x${base}`, `${base}X`]) {
    if (!validPlayerName(v)) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * What the checker asks, per room: PC is one Census namespace (ps2), PS is
 * two (ps2ps4us Genudine, ps2ps4eu Ceres). Unknown room → PC.
 */
export function checkTargets(room) {
  if (String(room || "").toLowerCase() === "ps") {
    return [
      { key: "us", label: "Genudine", base: censusNsBase("ps2ps4us", CENSUS_SERVICE_ID) },
      { key: "eu", label: "Ceres", base: censusNsBase("ps2ps4eu", CENSUS_SERVICE_ID) },
    ];
  }
  return [{ key: "pc", label: "PC", base: PLAYER_CENSUS_BASE }];
}

/** The same namespace on Daybreak's casual ID — the fallback when the registered ID goes quiet. */
export function exampleBaseFor(base) {
  return censusNsBase(nsOfBase(base), "example");
}
