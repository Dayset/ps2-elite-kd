/**
 * 👥 Names and iVi for the Live fights scoreboard (owner-approved exception 2026-10-30: named
 * players can show live; shown only, never read by the odds).
 *
 * The cache Worker sends character ids only. Names come from the site's own files
 * (data/cid-names.json) and iVi from data/ranks-lite.json, fetched at most every DATA_TTL_MS
 * per isolate through Cloudflare's cache. A player missing from cid-names gets ONE batched
 * Census name lookup a cycle (≤ 50 ids, remembered); iVi is null ("–") when the site has none.
 */
export const SITE = "https://dayset.github.io/ps2-elite-kd/data/";
export const DATA_TTL_MS = 6 * 3600e3;
const NAME_CACHE_MAX = 5000;
const FACS = ["VS", "NC", "TR", "NSO"];

let data = null;          // { at, names: Map cid → name, ivi: Map lower name → iVi }
const extra = new Map();  // cid → name | "" (Census lookups, "" = not found)

export function _reset() { data = null; extra.clear(); }

/** Site data → maps (pure). */
export function buildMaps(cidNames, ranksLite) {
  const names = new Map(), ivi = new Map();
  for (const [cid, v] of Object.entries(cidNames || {})) {
    const n = Array.isArray(v) ? v[0] : v;
    if (typeof n === "string" && n) names.set(cid, n);
  }
  const cols = (ranksLite && ranksLite.cols) || [];
  const ni = cols.indexOf("name"), ii = cols.indexOf("ivi");
  if (ni >= 0 && ii >= 0) for (const r of ranksLite.rows || []) {
    const v = +r[ii];
    if (typeof r[ni] === "string" && Number.isFinite(v) && v > 0) ivi.set(r[ni].toLowerCase(), Math.round(v));
  }
  return { names, ivi };
}

async function getJson(url, fetchFn) {
  try {
    const r = await fetchFn(url, { cf: { cacheTtl: 3600 }, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function loadData(fetchFn, now) {
  if (data && now - data.at < DATA_TTL_MS) return data;
  const [c, r] = await Promise.all([getJson(SITE + "cid-names.json", fetchFn), getJson(SITE + "ranks-lite.json", fetchFn)]);
  if (c || r || !data) {
    const m = buildMaps(c, r);
    data = { at: now, names: c ? m.names : (data ? data.names : m.names), ivi: r ? m.ivi : (data ? data.ivi : m.ivi) };
  } else data.at = now - DATA_TTL_MS + 10 * 60e3; // retry in 10 min
  return data;
}

/**
 * bases[].top = [[cid, fac, k, d]] → [{ n: name|null, f, k, d, i: iVi|null }] in place (cids dropped).
 */
export async function namePlayers(env, bases, { fetchFn = (u, o) => fetch(u, o), now = Date.now() } = {}) {
  const tops = (bases || []).filter((b) => Array.isArray(b.top) && b.top.length);
  if (!tops.length) return;
  const d = await loadData(fetchFn, now);
  const want = [...new Set(tops.flatMap((b) => b.top.map((p) => p[0])))].filter((id) => !d.names.has(id) && !extra.has(id)).slice(0, 50);
  if (want.length) {
    const sid = ((env && env.CENSUS_SERVICE_ID) || "daysetps2legends").replace(/^s:/, "");
    try {
      const r = await fetchFn(`https://census.daybreakgames.com/s:${sid}/get/ps2:v2/character?character_id=${want.join(",")}&c:show=character_id,name.first&c:limit=50`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const j = await r.json();
        for (const ch of (j && j.character_list) || []) if (ch && ch.character_id && ch.name && ch.name.first) extra.set(String(ch.character_id), String(ch.name.first));
        for (const id of want) if (!extra.has(id)) extra.set(id, "");
      }
    } catch {}
    if (extra.size > NAME_CACHE_MAX) extra.clear();
  }
  for (const b of tops) {
    b.top = b.top.map(([cid, fac, k, dd]) => {
      const n = d.names.get(cid) || extra.get(cid) || null;
      const i = n ? d.ivi.get(n.toLowerCase()) ?? null : null;
      return { n: n ? n.slice(0, 32) : null, f: FACS.includes(fac) ? fac : null, k, d: dd, i };
    });
  }
}
