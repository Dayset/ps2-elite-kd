// 🎬 Replay crowd opponents (#103): real killboard opponents in the enemy slots.
// Pure (no DOM, no fetch): the page resolves rows + factions, this module decides.

/** One weighted pick: weightOf maps an item to a non-negative weight. null when
 * the pool is empty or every weight is 0 (the caller falls back to uniform). */
export function pickWeighted(items, weightOf, rng) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightOf(it) || 0);
  if (!items.length || !(total > 0)) return null;
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weightOf(it) || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Weighted draw without replacement, weight = kills + deaths, in draw order.
 * Fewer candidates than n → all of them, ranked order kept. */
export function drawOpponents(cands, n, rng) {
  const pool = (cands || []).filter((c) => c.kills + c.deaths > 0);
  if (pool.length <= n) return pool.slice();
  const rest = pool.slice(), out = [];
  while (out.length < n && rest.length) {
    const it = pickWeighted(rest, (c) => c.kills + c.deaths, rng);
    if (!it) break;
    out.push(it);
    rest.splice(rest.indexOf(it), 1);
  }
  return out;
}
