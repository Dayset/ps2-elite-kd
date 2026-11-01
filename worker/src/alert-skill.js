/**
 * ⚔️ Current-alert skill medians (#89, 2026-11-01): per-faction median ⚔️ iVi of one zone's
 * placed players (the live map's 5-min crowd), as aggregates only — no player ids leave here.
 *
 * Skill comes from the site's own public files (same source as the Oracle's players.js, which
 * reads the `ivi` column for the scoreboard; this reads `adjs`, the ⚔️ iVi the pinned bar's
 * global row uses, so the two rows are comparable). Fetched at most every DATA_TTL_MS per
 * isolate through Cloudflare's cache. Players missing from cid-names.json are left out (no
 * Census fallback here: the fallback would only add players the site has no score for, and
 * the median is robust to a few missing players); the dashboard tip says "players with a
 * known score" for exactly that reason. Ephemeral only: medians are computed from the
 * in-memory live map per activity call and never stored.
 */
export const SITE = "https://dayset.github.io/ps2-elite-kd/data/";
export const DATA_TTL_MS = 6 * 3600e3;
const FACS = ["VS", "NC", "TR", "NSO"];

let data = null; // { at, names: Map cid → name, adjs: Map lower name → adjs }

/** Site data → maps (pure). */
export function buildSkillMaps(cidNames, ranksLite) {
  const names = new Map(), adjs = new Map();
  for (const [cid, v] of Object.entries(cidNames || {})) {
    const n = Array.isArray(v) ? v[0] : v;
    if (typeof n === "string" && n) names.set(cid, n);
  }
  const cols = (ranksLite && ranksLite.cols) || [];
  const ni = cols.indexOf("name"), ai = cols.indexOf("adjs");
  if (ni >= 0 && ai >= 0) for (const r of ranksLite.rows || []) {
    const v = +r[ai];
    if (typeof r[ni] === "string" && Number.isFinite(v) && v > 0) adjs.set(r[ni].toLowerCase(), Math.round(v));
  }
  return { names, adjs };
}

async function getJson(url, fetchFn) {
  try {
    const r = await fetchFn(url, { cf: { cacheTtl: 3600 }, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Cached skill maps (null when neither file has ever loaded). */
export async function loadSkillMaps(fetchFn, now = Date.now()) {
  if (data && now - data.at < DATA_TTL_MS) return data;
  const [c, r] = await Promise.all([getJson(SITE + "cid-names.json", fetchFn), getJson(SITE + "ranks-lite.json", fetchFn)]);
  if (c || r || !data) {
    const m = buildSkillMaps(c, r);
    data = { at: now, names: c ? m.names : (data ? data.names : m.names), adjs: r ? m.adjs : (data ? data.adjs : m.adjs) };
  } else data.at = now - DATA_TTL_MS + 10 * 60e3; // retry in 10 min
  return data;
}

/** Median of a non-empty number list (even count: mean of the two middles, rounded). */
export function medianOf(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Zone crowd [[cid, fac]] → per-faction { med, n } (⚔️ iVi median, players counted), lowercase
 * faction keys (vs/nc/tr/nso, matching the dashboard's FAC_ORDER). Factions with no known
 * player are left out (a median over zero players is undefined, not 0); players with an
 * unknown faction or no known score are left out of every faction. Pure.
 */
export function zoneSkillMedians(crowd, maps) {
  const by = {};
  if (!Array.isArray(crowd) || !maps) return by;
  for (const [cid, fac] of crowd) {
    if (!FACS.includes(fac)) continue;
    const n = maps.names.get(String(cid));
    const v = n ? maps.adjs.get(n.toLowerCase()) : undefined;
    if (v == null) continue;
    (by[fac.toLowerCase()] ||= []).push(v);
  }
  const out = {};
  for (const [f, vals] of Object.entries(by)) {
    const med = medianOf(vals);
    if (med != null) out[f] = { med, n: vals.length };
  }
  return out;
}
