/**
 * One Rankings row from a player JSON — DOM-free and Node-free, so the build
 * (scripts/build-ranks.mjs → data/ranks.json) and ranks.html (a player's own
 * fresher browser copy after "Fetch fresh", t338u) use the SAME code.
 */
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261027-z79";
import { markNote, statMark } from "./padding.mjs?v=20261023-short1";
import { pickNewest, entryFetchedAt } from "./cache-pick.mjs?v=20261010-sav1";
import { serverOfWorld } from "./server-rating.mjs?v=20261031-sr1";
import { serverFromOpponents, oppKey } from "./opponent-server.mjs?v=20261101-opsrv1";

const PS_SRV_KEY = { genudine: "us", ceres: "eu" };
/**
 * 🌍 "srv" value for a browser copy (ranks.json column): the player's own world first (PC: Census world_id, merged NA
 * worlds → Osprey; PS: its server), else the outfit's world (outfit-tags.mjs readOutfitWorlds, owner: an outfit lives on
 * one server). → { srv, by } with by = "o" when the server came from the outfit, else null.
 */
export function localSrv(player, key, outfitWorlds = null, oppSrv = null) {
  const p = player || {};
  if (p.room === "ps") return { srv: PS_SRV_KEY[String(p.server || "").toLowerCase()] || null, by: null };
  const own = serverOfWorld(p.world);
  if (own) return { srv: own, by: null };
  const ow = outfitWorlds && key ? serverOfWorld(outfitWorlds[key]) : null;
  if (ow) return { srv: ow, by: "o" };
  // 🌍 Last: the server most of the player's opponents are on (opponent-server.mjs; oppSrv = key → their own server).
  const op = oppSrv ? serverFromOpponents(p.rows, oppSrv, oppKey(p.display) || key).srv : null;
  return op ? { srv: op, by: "e" } : { srv: null, by: null };
}

/** key → own server of the ranked PC rows (srvBy empty: never an inferred server as a vote). */
function ownSrvIndex(rows, ix) {
  if (ix.srv == null) return null;
  const m = new Map();
  for (const r of rows) {
    if (!r[ix.srv] || (ix.srvBy != null && r[ix.srvBy])) continue;
    const k = oppKey(r[ix.name] != null ? r[ix.name] : r[0]);
    if (k && !m.has(k)) m.set(k, r[ix.srv]);
  }
  return (k) => m.get(k) || null;
}

/** Metric ids (same ids as the app.js stats columns). */
export const METRIC_COLS = Object.freeze([
  // ✨ Adjusted (visible by default, main-table order)
  "adjs", "rf", "act", "pvs", "rkd", "mech", "cons", "inflation",
  // older debug columns
  "adj", "ekpm", "own", "coi", "slope",
  // 📊 Public
  "kd", "kpm", "ownKpm", "acc", "hsr", "ivi",
]);
/**
 * Values are stored as SHOWN on the main page (shownValue): opponent-sample
 * metrics (THIN_METRICS) are null below MIN_FIGHTS, so ranks / sorting /
 * distributions skip them. Trailing "thin" = 1 when the sample is below
 * MIN_FIGHTS (ranks.html hover text). "mark" = "padding" ("*") / "adjusted" ("†") / null
 * (padding.mjs statMark); "farm" = note on farm-account kills excluded (null when none).
 * "top" = opponents in the sample (50 for older files, 200 for new fetches).
 * "created" / "last" = Census account creation / last activity, UNIX seconds
 * (not shown on Rankings; null when the cache file has no times yet).
 */
export const RANK_COLS = Object.freeze(["name", "query", "slug", "savedAt", ...METRIC_COLS, "thin", "mark", "farm", "top", "created", "last"]);

const round6 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

/** "[TAG] Name" → "Name" (what ?names= / Analyze expects). */
export function bareName(display) {
  return String(display || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

/** Same key as app.js slugKey / the browser cache keys: tag stripped, lowercase a–z0–9. */
export function slugKey(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * One ranks row from a raw cached player JSON (same shape as data/players/*.json).
 * Returns null when the file has no usable player.
 */
export function rankRow(raw, { slug = "", savedAt = null, confirmed = false } = {}) {
  if (!raw) return null;
  const p = normalizePlayer(raw);
  if (!p || !p.display || p.display === "?") return null;
  const m = playerMetrics(p);
  const t = savedAt != null ? +savedAt : +raw.savedAt || null;
  return [p.display, bareName(p.display) || p.display, slug, t, ...METRIC_COLS.map((k) => round6(shownValue(m, k))), m.thin ? 1 : 0, statMark(m.farm, undefined, { confirmed }).kind || null, markNote(m.farm, { confirmed }) || null, p.top, (p.times && p.times.created) || null, (p.times && p.times.last) || null];
}

/**
 * Rankings rows with this browser's own fresher copies swapped in (t338u).
 * After "Fetch fresh" on Analyze the browser keeps the new copy (localStorage
 * store `{ slugKey: { player, savedAt, fetchedAt } }`); the shared ranks.json
 * still has the older one until the background refresh catches up. For every
 * ranked player whose browser copy is newer (cache-pick.mjs pickNewest, same
 * rule as Analyze), the row is recomputed from that copy with rankRow.
 * Ranked players are recomputed in place; unranked ones only join via `extra`.
 * @param payload  ranks.json ({ cols, rows })
 * @param store    the browser cache object (or null)
 * @param opts.confirmed  Set of confirmed-padder slugs (data/reviewed.json)
 * t359u: `extra` = slug keys of players on the graph right now. Any of them
 * missing from ranks.json but in the browser cache (a brand-new name from a
 * quick fetch) is APPENDED as a local-only row, so the 📊 chart, 🏅 positions
 * and percentiles include them in this browser. `skip(entry, key)` → true
 * keeps one out (the 🙈 hide list).
 * @param opts.extra  Iterable of slug keys to add when unranked
 * @param opts.skip   (entry, key) => boolean
 * @returns {{ rows, fresh: Map<slug, fetchedAtMs>, localOnly: Set<slug> }}
 */
export function mergeFreshRows(payload, store, { confirmed = new Set(), maxAgeMs = 30 * 24 * 3600 * 1000, now = Date.now(), extra = [], skip = null, outfitWorlds = null } = {}) {
  const fresh = new Map();
  const localOnly = new Set();
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  if (!store || typeof store !== "object" || !rows.length) return { rows, fresh, localOnly };
  const cols = payload.cols || RANK_COLS;
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const local = new Map();
  for (const [k, e] of Object.entries(store)) {
    if (!e || !e.player || !e.savedAt || now - e.savedAt > maxAgeMs) continue;
    const key = slugKey((e.player && e.player.display) || e.name || k) || k;
    local.set(key, e);
    if (!local.has(k)) local.set(k, e);
  }
  if (!local.size) return { rows, fresh, localOnly };
  // PS namesakes (owner 2026-10-23, Furkancimen3NS0): a row keyed "us-<cid>" /
  // "eu-<cid>" takes only a browser copy of THAT character (same cid), never
  // the other server's copy that happens to share its slug or name.
  let oppIdx; // built on first use
  const oppSrv = (k) => { if (oppIdx === undefined) oppIdx = ownSrvIndex(rows, ix); return oppIdx ? oppIdx(k) : null; };
  const byCid = new Map();
  for (const e of local.values()) if (e.player && e.player.cid != null) byCid.set(String(e.player.cid), e);
  const out = rows.map((r) => {
    const slug = r[ix.slug];
    const km = /^(?:us|eu)-(\d{5,25})$/i.exec(String(r[ix.query] || ""));
    const e = km ? byCid.get(km[1]) : local.get(slugKey(r[ix.query])) || local.get(String(slug || ""));
    if (!e) return r;
    const pick = pickNewest([
      { player: r, fetchedAt: +r[ix.savedAt] || 0, top: ix.top != null ? +r[ix.top] || 50 : 0, kind: "shared" },
      { player: e.player, fetchedAt: entryFetchedAt(e), top: +e.player.top || 0, kind: "local" },
    ]);
    if (!pick || pick.kind !== "local") return r;
    const nr = rankRow({ player: e.player }, { slug, savedAt: pick.fetchedAt, confirmed: confirmed.has(slug) });
    if (!nr) return r;
    // Same column order as the payload (older payloads may lack trailing columns).
    // The pick key (query) stays the built one: unique per room (one tick = one player).
    const row = cols.map((c) => { if (c === "query") return r[ix.query]; const i = RANK_COLS.indexOf(c); return i >= 0 ? nr[i] : r[ix[c]]; });
    // 🌍 A ranked row with no server yet takes the browser copy's (own world, else the outfit's).
    if (ix.srv != null && row[ix.srv] == null) {
      const ls = localSrv(e.player, slug, outfitWorlds, oppSrv);
      if (ls.srv) { row[ix.srv] = ls.srv; if (ix.srvBy != null) row[ix.srvBy] = ls.by; }
    }
    fresh.set(slug, pick.fetchedAt);
    return row;
  });
  // t359u: graphed players the shared file doesn't have yet → local-only rows.
  const ranked = new Set();
  for (const r of rows) { ranked.add(slugKey(r[ix.query])); if (r[ix.slug]) ranked.add(String(r[ix.slug])); }
  for (const key of new Set([...(extra || [])].map((k) => slugKey(k)).filter(Boolean))) {
    if (ranked.has(key)) continue;
    const e = local.get(key);
    if (!e || (skip && skip(e, key))) continue;
    const f = entryFetchedAt(e);
    const at = f > 1 ? f : +e.savedAt || now; // 1 = undated shared copy
    const nr = rankRow({ player: e.player }, { slug: key, savedAt: at, confirmed: confirmed.has(key) });
    if (!nr) continue;
    ranked.add(key);
    // 🌍 Server for the 🌍 table (owner, [CP0x]): own world, else the outfit's; null → "?" (no server rank).
    const ls = localSrv(e.player, key, outfitWorlds, oppSrv);
    out.push(cols.map((c) => { if (c === "srv") return ls.srv; if (c === "srvBy") return ls.by; const i = RANK_COLS.indexOf(c); return i >= 0 ? nr[i] : null; }));
    fresh.set(key, at);
    localOnly.add(key);
  }
  return { rows: out, fresh, localOnly };
}
