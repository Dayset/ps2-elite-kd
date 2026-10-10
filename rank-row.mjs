/**
 * One Rankings row from a player JSON — DOM-free and Node-free, so the build
 * (scripts/build-ranks.mjs → data/ranks.json) and ranks.html (a player's own
 * fresher browser copy after "Fetch fresh", t338u) use the SAME code.
 */
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261010-type1";
import { markNote, statMark } from "./padding.mjs?v=20261010-type1";
import { pickNewest, entryFetchedAt } from "./cache-pick.mjs?v=20261010-type1";

/** Metric ids (same ids as the app.js stats columns). */
export const METRIC_COLS = Object.freeze([
  // ✨ Adjusted (visible by default, main-table order)
  "adjs", "rf", "act", "pvs", "rkd", "mech", "inflation",
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
 * Only players already ranked are touched (hidden / unranked names stay out).
 * @param payload  ranks.json ({ cols, rows })
 * @param store    the browser cache object (or null)
 * @param opts.confirmed  Set of confirmed-padder slugs (data/reviewed.json)
 * @returns {{ rows, fresh: Map<slug, fetchedAtMs> }}
 */
export function mergeFreshRows(payload, store, { confirmed = new Set(), maxAgeMs = 30 * 24 * 3600 * 1000, now = Date.now() } = {}) {
  const fresh = new Map();
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  if (!store || typeof store !== "object" || !rows.length) return { rows, fresh };
  const cols = payload.cols || RANK_COLS;
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const local = new Map();
  for (const [k, e] of Object.entries(store)) {
    if (!e || !e.player || !e.savedAt || now - e.savedAt > maxAgeMs) continue;
    const key = slugKey((e.player && e.player.display) || e.name || k) || k;
    local.set(key, e);
    if (!local.has(k)) local.set(k, e);
  }
  if (!local.size) return { rows, fresh };
  const out = rows.map((r) => {
    const slug = r[ix.slug];
    const e = local.get(slugKey(r[ix.query])) || local.get(String(slug || ""));
    if (!e) return r;
    const pick = pickNewest([
      { player: r, fetchedAt: +r[ix.savedAt] || 0, top: ix.top != null ? +r[ix.top] || 50 : 0, kind: "shared" },
      { player: e.player, fetchedAt: entryFetchedAt(e), top: +e.player.top || 0, kind: "local" },
    ]);
    if (!pick || pick.kind !== "local") return r;
    const nr = rankRow({ player: e.player }, { slug, savedAt: pick.fetchedAt, confirmed: confirmed.has(slug) });
    if (!nr) return r;
    // Same column order as the payload (older payloads may lack trailing columns).
    const row = cols.map((c) => { const i = RANK_COLS.indexOf(c); return i >= 0 ? nr[i] : r[ix[c]]; });
    fresh.set(slug, pick.fetchedAt);
    return row;
  });
  return { rows: out, fresh };
}
