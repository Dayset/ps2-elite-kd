// Two-way selection sync between the main page (comparison names) and
// ranks.html (✅ picks) — t289u. Pure helpers, shared by app.js, ranks.html
// and tests.
//
//   main → Rankings: the 🏆 link carries the field's names as ?pick=a,b;
//                    ranks.html replaces its saved picks with the ones it can
//                    find (hidden / uncached / unknown names are skipped).
//   Rankings → main: "Compare" opens index.html?names=… and drops the main
//                    page's saved field, so the picks replace it (no merge).
//
// The lone default "ShloDog" starter is not a selection: [ShloDog] carries
// nothing (Rankings keeps its own picks). ShloDog typed next to other names
// is a deliberate comparison and is carried.

export const PICK_PARAM = "pick";
export const DEFAULT_STARTER = "ShloDog";

const clean = (list) =>
  (Array.isArray(list) ? list : [])
    .map((s) => String(s == null ? "" : s).trim())
    .filter(Boolean);

/** Names the 🏆 link should carry ([] = carry nothing). Dedupe (case-insensitive), max. */
export function namesToCarry(names, { starter = DEFAULT_STARTER, max = 10 } = {}) {
  const out = [];
  const seen = new Set();
  for (const n of clean(names)) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  if (out.length === 1 && starter && out[0].toLowerCase() === String(starter).toLowerCase()) return [];
  return out.slice(0, max);
}

/** "ranks.html" or "ranks.html?pick=a,b" (commas kept readable). */
export function ranksHref(names, opts = {}, base = "ranks.html") {
  const list = namesToCarry(names, opts);
  if (!list.length) return base;
  return `${base}?${PICK_PARAM}=${list.map((n) => encodeURIComponent(n)).join(",")}`;
}

/** ?pick= value → names (null when absent/empty). */
export function picksFromSearch(search) {
  try {
    const raw = new URLSearchParams(search || "").get(PICK_PARAM);
    if (!raw) return null;
    const list = clean(raw.split(","));
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** Strip an outfit tag: "[00] Foo" → "foo". */
const bareName = (s) => String(s || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();

/**
 * Map carried names to ranks rows (case-insensitive on query / slug / name
 * with or without outfit tag). Returns [{query,name}] in carried order, unique,
 * max; names with no row are skipped.
 */
// One name index per rows array (13k rows: rebuilding it on every chip change cost ~25 ms).
const pickIdx = new WeakMap();
function pickIndex(rows) {
  let idx = rows && pickIdx.get(rows);
  if (idx && idx.n === rows.length) return idx.map;
  const map = new Map();
  // Exact query first, then slug, then name (PS namesakes, owner 2026-10-23
  // Furkancimen3NS0: a bare name must not land on the other server's row just
  // because that row came first; query and slug are unique, names are not).
  const add = (k, r) => { const key = String(k || "").trim().toLowerCase(); if (key && !map.has(key)) map.set(key, r); };
  const ok = (rows || []).filter((r) => r && r.query);
  for (const r of ok) add(r.query, r);
  const byQuery = new Map(map);
  for (const r of ok) add(r.slug, r);
  for (const r of ok) { add(r.name, r); add(bareName(r.name), r); }
  const cid = new Map();
  for (const r of ok) { const m = /^(?:us|eu)-(\d{5,25})$/i.exec(String(r.query)); if (m) cid.set(m[1], r); }
  map.cid = cid;
  map.query = byQuery;
  if (rows && typeof rows === "object") pickIdx.set(rows, { map, n: rows.length });
  return map;
}

/**
 * cidOf(name) (optional): character id the page already resolved that name to
 * (browser cache). A PS namesake row is keyed "us-<cid>" / "eu-<cid>", so the
 * resolved cid picks the exact character instead of the first same-name row.
 * Each hit carries src = the names-box entry it came from, so unticking the
 * row removes exactly that entry (owner 2026-10-23: ticked namesake stuck).
 */
export function matchPicks(names, rows, max = 10, { cidOf = null } = {}) {
  const idx = pickIndex(rows);
  const out = [];
  const seen = new Set();
  for (const n of clean(names)) {
    if (out.length >= max) break;
    const key = n.toLowerCase();
    // Exact pick key → the character the page resolved this name to → slug / name.
    let r = idx.query.get(key) || null;
    if (!r && cidOf && idx.cid.size) {
      const c = cidOf(n);
      if (c != null) r = idx.cid.get(String(c)) || null;
    }
    if (!r) r = idx.get(key) || idx.get(bareName(n));
    if (!r || seen.has(r.query)) continue;
    seen.add(r.query);
    out.push({ query: r.query, name: r.name, src: n });
  }
  return out;
}

/** Main-page link for the picks: "index.html?names=a,b", or plain base when none. */
export function analyzeHref(queries, base = "index.html") {
  const list = clean(queries);
  if (!list.length) return base;
  return `${base}?names=${list.map((n) => encodeURIComponent(n)).join(",")}`;
}

/** localStorage key of the main page's saved field (app.js LS_PENDING). */
export const MAIN_PENDING_KEY = "ps2-elite-kd-pending-names";
