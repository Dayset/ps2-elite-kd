/**
 * 🛡️ Outfits page (#90): per-outfit ⚔️ iVi aggregates. Pure and DOM-free; used by
 * scripts/build-outfits.mjs (writes data/outfits.json) and outfits-page.mjs (sorting).
 *
 * Definitions (issue #90, build exactly these):
 *   - iVi = the main ⚔️ iVi (ranks.json "adjs", evened-out), never the aim-based "ivi" column.
 *   - known members = the outfit's members who are in the PC rankings with a ⚔️ iVi. Hidden players
 *     (not in ranks.json) and confirmed padders are left out, the same as the faction / server ratings.
 *   - median = the middle known member's iVi (even count: mean of the two middle values).
 *   - top 10% avg = the mean of the best 10% of known members, at least one member (ceil).
 *   - members always read "known of total" (total = Census member_count), so a half-known outfit is
 *     shown as an estimate.
 *   - floor: only outfits with at least OUTFIT_FLOOR known members are listed.
 */

/** Fewest known members an outfit needs to be listed. */
export const OUTFIT_FLOOR = 5;
/** Share of known members averaged for "Top 10% avg". */
export const TOP_SHARE = 0.1;
/** data/outfits.json row layout. */
export const OUTFIT_COLS = Object.freeze(["id", "tag", "name", "fac", "srv", "known", "total", "med", "top"]);

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);

/** Median of the finite values (even count: mean of the two middle ones); null when none. */
export function median(xs) {
  const s = (xs || []).filter(fin).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** How many of n members make the top share: ceil(n × share), at least 1 (0 when n is 0). */
export function topCount(n, share = TOP_SHARE) {
  if (!(n > 0)) return 0;
  return Math.max(1, Math.ceil(n * share - 1e-9));
}

/** Mean of the best `share` of the finite values (topCount of them); null when none. */
export function topShareMean(xs, share = TOP_SHARE) {
  const s = (xs || []).filter(fin).sort((a, b) => b - a);
  const k = topCount(s.length, share);
  if (!k) return null;
  let sum = 0;
  for (let i = 0; i < k; i++) sum += s[i];
  return sum / k;
}

/**
 * Known-of-total coverage. Census member_count can lag behind a join; total never reads below known.
 * @returns {{ known:number, total:number, share:number|null }}
 */
export function coverage(known, total) {
  const k = Math.max(0, Math.floor(+known || 0));
  const t = Math.max(k, Math.floor(+total || 0));
  return { known: k, total: t, share: t ? k / t : null };
}

/** True when an outfit has enough known members to be listed. */
export function clearsFloor(known, floor = OUTFIT_FLOOR) {
  return (+known || 0) >= floor;
}

/** Most common non-empty value (ties: the first seen); null when none. */
export function majority(values) {
  const n = new Map();
  for (const v of values || []) if (v) n.set(v, (n.get(v) || 0) + 1);
  let best = null, bc = 0;
  for (const [v, c] of n) if (c > bc) { best = v; bc = c; }
  return best;
}

/**
 * One outfit's stats from its known members' scores, or null below the floor.
 * @param {{ id:string, tag?:string, name?:string, total?:number }} outfit
 * @param {{ adjs:number, fac?:string|null, srv?:string|null }[]} members known members (finite adjs)
 */
export function outfitStats(outfit, members, { floor = OUTFIT_FLOOR, share = TOP_SHARE } = {}) {
  const known = (members || []).filter((m) => m && fin(m.adjs));
  if (!clearsFloor(known.length, floor)) return null;
  const scores = known.map((m) => m.adjs);
  const cov = coverage(known.length, outfit && outfit.total);
  return {
    id: String(outfit.id),
    tag: String((outfit && outfit.tag) || ""),
    name: String((outfit && outfit.name) || ""),
    fac: majority(known.map((m) => m.fac)),
    srv: majority(known.map((m) => m.srv)),
    known: cov.known,
    total: cov.total,
    med: r1(median(scores)),
    top: r1(topShareMean(scores, share)),
  };
}

/**
 * All listed outfits, sorted by median iVi (then top 10% avg, then known members, then tag).
 * @param {{ cid:string, adjs:number, fac?:string, srv?:string }[]} players ranked players with a score
 * @param {Map<string,string>|Record<string,string>} membership character id → outfit id (players in no outfit absent)
 * @param {Map<string,{tag?:string,name?:string,total?:number}>|Record<string,object>} outfits outfit id → info
 */
export function buildOutfitRows(players, membership, outfits, opts = {}) {
  const mem = membership instanceof Map ? membership : new Map(Object.entries(membership || {}));
  const info = outfits instanceof Map ? outfits : new Map(Object.entries(outfits || {}));
  const groups = new Map();
  for (const p of players || []) {
    if (!p || !fin(p.adjs)) continue;
    const id = mem.get(String(p.cid));
    if (!id || id === "0") continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  const rows = [];
  for (const [id, members] of groups) {
    const o = info.get(id) || {};
    const s = outfitStats({ id, tag: o.tag, name: o.name, total: o.total }, members, opts);
    if (s) rows.push(s);
  }
  return sortOutfits(rows, "med", "desc");
}

/** Sort keys the page offers; "members" sorts by total members (then known). */
export const SORT_KEYS = Object.freeze(["med", "top", "members", "known", "tag"]);

/** Stable sort of outfit rows by a key; nulls always last. Returns a new array. */
export function sortOutfits(rows, key = "med", dir = "desc") {
  const sgn = dir === "asc" ? 1 : -1;
  const val = (r) => (key === "members" ? r.total : r[key]);
  const out = [...(rows || [])];
  const byTag = (a, b) => String(a.tag || a.name).localeCompare(String(b.tag || b.name)) || String(a.id).localeCompare(String(b.id));
  out.sort((a, b) => {
    if (key === "tag") return sgn * byTag(a, b);
    const va = val(a), vb = val(b);
    const na = !fin(va), nb = !fin(vb);
    if (na !== nb) return na ? 1 : -1;
    if (!na && va !== vb) return sgn * (va - vb);
    if (key === "members" && a.known !== b.known) return sgn * (a.known - b.known);
    if (key !== "med" && fin(a.med) && fin(b.med) && a.med !== b.med) return b.med - a.med;
    if (key !== "top" && fin(a.top) && fin(b.top) && a.top !== b.top) return b.top - a.top;
    if (key !== "members" && key !== "known" && a.known !== b.known) return b.known - a.known;
    return byTag(a, b);
  });
  return out;
}

/** data/outfits.json rows (arrays in OUTFIT_COLS order) → objects. Unknown layout → []. */
export function readOutfitRows(json) {
  const cols = json && Array.isArray(json.cols) ? json.cols : null;
  if (!cols || !Array.isArray(json.rows)) return [];
  const ix = OUTFIT_COLS.map((c) => cols.indexOf(c));
  if (ix.some((i) => i < 0)) return [];
  return json.rows.map((r) => Object.fromEntries(OUTFIT_COLS.map((c, j) => [c, r[ix[j]]])));
}

/** Objects → rows in OUTFIT_COLS order (for writing data/outfits.json). */
export function toOutfitArrays(rows) {
  return (rows || []).map((r) => OUTFIT_COLS.map((c) => (r[c] === undefined ? null : r[c])));
}
