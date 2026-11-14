/**
 * 🆓 Available outfit names (outfit-names.html): pure, DOM-free helpers, used by
 * outfit-names-page.mjs (the page) and scripts/verify-outfit-names.mjs (the build-time check).
 *
 * Availability, measured 2026-11-14 — read this before "fixing" it:
 * - An outfit NAME is PC-wide, not per server or per faction. Census holds one
 *   global `outfit` collection: `outfit?name_lower=<exact>` returns the outfit
 *   whatever server its leader is on (Trident → world 10, Mercenaries → world 1).
 *   The same normalised name is reused in the wild only with space tricks:
 *   "Recursion" exists as "Recursion", "Recursion " and "Recursion       "
 *   (one per faction, all Osprey), "Alpha" as 0–4 trailing spaces across worlds
 *   1 and 10, "Void Guardians" as "Void Guardians" and " Void Guardians".
 *   So a name counts as TAKEN when its normalised form (trimmed, inner
 *   whitespace collapsed, lower-cased) collides with any taken name — suggesting
 *   a trailing-space twin would be a confusing duplicate, not a free name.
 * - An outfit TAG (alias) is likewise PC-wide and unique (outfit-tags.mjs):
 *   `outfit?alias_lower=<tag>` returns at most one row on PC.
 * - Faction and Server on a suggestion are the outfit it fits / where it would
 *   be founded, NOT a separate availability: a name free on PC is free on both
 *   servers, a name taken anywhere is taken everywhere. They exist so the table
 *   sorts and filters by faction and server, the way outfits.html does.
 * - Names in the wild are letters, digits and spaces only (data/outfits.json,
 *   347 rows, max 32 chars); tags are 1–4 letters/digits. The checker enforces
 *   that shape and leaves the Naming Policy itself to the game.
 */

import { censusBase } from "./census-fetch.mjs";
import { CENSUS_SERVICE_ID } from "./config.mjs";

/** Census base for the browser / Node check (same registered ID as the site). */
export const OUTFIT_CENSUS_BASE = censusBase(CENSUS_SERVICE_ID);

/** Longest outfit name seen in data/outfits.json (347 rows). */
export const MAX_NAME_LEN = 32;
/** Outfit tags are 1–4 letters/digits (outfit-tags.mjs TAG). */
export const MAX_TAG_LEN = 4;

/** data/outfit-names.json row layout. */
export const OUTFIT_NAME_COLS = Object.freeze(["name", "tag", "fac", "srv"]);
/** Factions a suggestion can be themed for (same keys as faction-rating.mjs). */
export const NAME_FACTIONS = Object.freeze(["vs", "nc", "tr", "nso"]);
/** PC servers today (server-rating.mjs SERVERS_PC: SolTech is closed). */
export const NAME_SERVERS = Object.freeze(["osprey", "wainwright"]);

/** "  Aurora   Relay  Division " → "aurora relay division". */
export function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** "[ARD]" / " ard " → "ard". */
export function normalizeTag(tag) {
  return String(tag || "").trim().replace(/^\[|\]$/g, "").trim().toLowerCase();
}

/** Shape a name must have to be creatable: 1–32 chars, letters/digits/spaces only. */
export function validName(name) {
  const n = String(name || "").trim();
  return n.length >= 1 && n.length <= MAX_NAME_LEN && /^[A-Za-z0-9 ]+$/.test(n);
}

/** Shape a tag must have: 1–4 letters/digits. Empty is allowed (tag-less outfits exist). */
export function validTag(tag) {
  const t = String(tag || "").trim().replace(/^\[|\]$/g, "");
  return t === "" || (/^[A-Za-z0-9]{1,4}$/.test(t) && t.length <= MAX_TAG_LEN);
}

/** Census: the outfit(s) with this exact (lower-cased) name. Pass a normalised name. */
export function nameLookupUrl(base, name) {
  return (
    `${base}outfit?name_lower=${encodeURIComponent(normalizeName(name))}` +
    "&c:show=outfit_id,name,alias,member_count,leader_character_id&c:limit=10" +
    "&c:join=characters_world^on:leader_character_id^to:character_id^inject_at:leader"
  );
}

/** Census: the outfit with this tag (alias), if any. */
export function tagLookupUrl(base, tag) {
  return (
    `${base}outfit?alias_lower=${encodeURIComponent(normalizeTag(tag))}` +
    "&c:show=outfit_id,name,alias,member_count,leader_character_id&c:limit=10" +
    "&c:join=characters_world^on:leader_character_id^to:character_id^inject_at:leader"
  );
}

/**
 * One Census outfit lookup answer → { taken, rows }.
 * taken = the list is non-empty; rows carry name, alias, member_count and the
 * leader's world_id ("" when Census gave none). An error object / no list → taken
 * is null (unknown, not free: a failed check must never report "available").
 */
export function parseLookup(json) {
  const list = json && Array.isArray(json.outfit_list) ? json.outfit_list : null;
  if (!list) return { taken: null, rows: [] };
  const rows = list
    .filter((r) => r && r.outfit_id)
    .map((r) => ({
      id: String(r.outfit_id),
      name: String(r.name || ""),
      tag: String(r.alias || ""),
      members: +(r.member_count || 0) || 0,
      world: String((r.leader && r.leader.world_id) || ""),
    }));
  return { taken: rows.length > 0, rows };
}

/**
 * Taken-name / taken-tag sets from the listed outfits (data/outfits.json rows in
 * OUTFIT_COLS order, or already-read objects). Normalised, so "Recursion " and
 * "Recursion" collide — the same rule the live check applies.
 */
export function localTaken(outfitRows) {
  const names = new Set(), tags = new Set();
  for (const r of outfitRows || []) {
    const name = Array.isArray(r) ? r[2] : r.name;
    const tag = Array.isArray(r) ? r[1] : r.tag;
    const n = normalizeName(name);
    if (n) names.add(n);
    const t = normalizeTag(tag);
    if (t) tags.add(t);
  }
  return { names, tags };
}

export const isNameTakenLocal = (name, taken) => !!taken && taken.names.has(normalizeName(name));
export const isTagTakenLocal = (tag, taken) => !!taken && taken.tags.has(normalizeTag(tag));

/** Sort keys the page offers; "name" sorts by name, then tag. */
export const NAME_SORT_KEYS = Object.freeze(["name", "tag", "fac", "srv"]);

/** Stable sort of suggestion rows by a key; direction "asc" / "desc". */
export function sortNames(rows, key = "name", dir = "asc") {
  const sgn = dir === "asc" ? 1 : -1;
  const out = [...(rows || [])];
  const byName = (a, b) =>
    String(a.name).localeCompare(String(b.name)) ||
    String(a.tag || "").localeCompare(String(b.tag || ""));
  out.sort((a, b) => {
    if (key === "name") return sgn * byName(a, b);
    if (key === "tag") {
      return (
        sgn * String(a.tag || "").localeCompare(String(b.tag || "")) || byName(a, b)
      );
    }
    const va = String(a[key] || ""), vb = String(b[key] || "");
    if (va !== vb) return sgn * va.localeCompare(vb);
    return byName(a, b);
  });
  return out;
}

/**
 * Filter rows by a free-text query (tag or name, case-insensitive) and optional
 * faction / server picks ("all" = no filter).
 */
export function filterNames(rows, { q = "", fac = "all", srv = "all" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (fac !== "all" && r.fac !== fac) return false;
    if (srv !== "all" && r.srv !== srv) return false;
    if (!needle) return true;
    return (
      String(r.name || "").toLowerCase().includes(needle) ||
      String(r.tag || "").toLowerCase().includes(needle)
    );
  });
}

/** data/outfit-names.json rows (arrays in OUTFIT_NAME_COLS order) → objects. Unknown layout → []. */
export function readNameRows(json) {
  const cols = json && Array.isArray(json.cols) ? json.cols : null;
  if (!cols || !Array.isArray(json.rows)) return [];
  const ix = OUTFIT_NAME_COLS.map((c) => cols.indexOf(c));
  if (ix.some((i) => i < 0)) return [];
  return json.rows.map((r) => Object.fromEntries(OUTFIT_NAME_COLS.map((c, j) => [c, r[ix[j]]])));
}

/** Objects → rows in OUTFIT_NAME_COLS order (for writing data/outfit-names.json). */
export function toNameArrays(rows) {
  return (rows || []).map((r) => OUTFIT_NAME_COLS.map((c) => (r[c] === undefined ? null : r[c])));
}
