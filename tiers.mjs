/**
 * ⚔️ iVi tiers for the Rankings table: collapsible groups so the long list can
 * be browsed tier by tier. A player's tier comes from where their adjusted iVi
 * sits in the whole cached population (share of players strictly below them),
 * so "Top 1%" means the same thing however big the cache grows.
 *
 * DOM-free; used by rankings.mjs and test/tiers.test.mjs.
 */

/** Ordered best → worst. `min` = smallest share of players below to qualify. */
export const IVI_TIERS = Object.freeze([
  { id: "top1", min: 0.99, label: "🏆 Top 1%" },
  { id: "top5", min: 0.95, label: "💎 Top 1–5%" },
  { id: "top10", min: 0.9, label: "🥇 Top 5–10%" },
  { id: "top25", min: 0.75, label: "🥈 Top 10–25%" },
  { id: "top50", min: 0.5, label: "🥉 Top 25–50%" },
  { id: "lower", min: -Infinity, label: "Lower half" },
]);
/** adjusted iVi ≤ 0: shown as 0, "below the rating scale". */
export const BELOW_TIER = Object.freeze({ id: "below", label: "Below the rating scale (iVi 0)" });
/** No adjusted iVi (too few fights). */
export const UNRATED_TIER = Object.freeze({ id: "unrated", label: "Unrated (too few fights)" });

const TIER_ORDER = [...IVI_TIERS.map((t) => t.id), BELOW_TIER.id, UNRATED_TIER.id];
const TIER_BY_ID = new Map([...IVI_TIERS, BELOW_TIER, UNRATED_TIER].map((t) => [t.id, t]));

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Number of values in an ascending array strictly below v. */
function countBelow(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Tier id for one adjusted iVi value against the population pool (ascending,
 * finite values only).
 */
export function tierOf(adjs, pool) {
  if (!fin(adjs)) return UNRATED_TIER.id;
  if (adjs <= 0) return BELOW_TIER.id;
  const n = pool && pool.length ? pool.length : 0;
  const share = n ? countBelow(pool, adjs) / n : 0;
  for (const t of IVI_TIERS) if (share >= t.min) return t.id;
  return "lower";
}

export function tierInfo(id) {
  return TIER_BY_ID.get(id) || null;
}

/**
 * Split an already-sorted list into consecutive tier groups.
 * Returns [{ id, label, start, end, count, lo, hi }] in list order; `start`
 * and `end` are list indices (end exclusive), lo/hi the iVi range present.
 * Assumes the list is sorted by adjusted iVi (either direction), so each tier
 * forms one run; a tier that reappears later starts a new group.
 */
export function groupByTier(list, pool, key = "adjs") {
  const groups = [];
  let cur = null;
  for (let i = 0; i < list.length; i++) {
    const v = list[i][key];
    const id = tierOf(v, pool);
    if (!cur || cur.id !== id) {
      cur = { id, label: tierInfo(id).label, start: i, end: i, count: 0, lo: Infinity, hi: -Infinity };
      groups.push(cur);
    }
    cur.end = i + 1;
    cur.count++;
    if (fin(v)) {
      if (v < cur.lo) cur.lo = v;
      if (v > cur.hi) cur.hi = v;
    }
  }
  return groups;
}

/**
 * Which tiers are open. Manual choices (header clicks this session) win;
 * otherwise a tier is open when it holds a selected player, or when a name
 * filter is active (the filter's matches should show).
 * @param {Array<{id:string,start:number,end:number}>} groups
 * @param {{ list: Array<{query:string}>, picked: Set<string>|Map<string,any>,
 *           filtering?: boolean, manual?: Map<string, boolean> }} opts
 * @returns {Set<string>} open tier ids
 */
export function openTierIds(groups, { list, picked, filtering = false, manual = new Map() }) {
  const open = new Set();
  for (const g of groups) {
    if (manual.has(g.id)) {
      if (manual.get(g.id)) open.add(g.id);
      continue;
    }
    if (filtering) {
      open.add(g.id);
      continue;
    }
    for (let i = g.start; i < g.end; i++) {
      if (picked.has(list[i].query)) {
        open.add(g.id);
        break;
      }
    }
  }
  return open;
}

/** Selected players inside a group (for the collapsed header). */
export function pickedInGroup(group, list, picked) {
  const out = [];
  for (let i = group.start; i < group.end; i++) if (picked.has(list[i].query)) out.push(list[i]);
  return out;
}

/** Index of the group containing list index i, or -1. */
export function groupIndexAt(groups, i) {
  for (let k = 0; k < groups.length; k++) if (i >= groups[k].start && i < groups[k].end) return k;
  return -1;
}

export { TIER_ORDER };
