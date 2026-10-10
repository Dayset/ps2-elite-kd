/**
 * Which stored copy of a player to show on a normal (non-"Fetch fresh") load
 * (t300u). Before: the shared data/players/*.json file always won over the
 * browser's own copy, so after "Fetch fresh" a page reload (F5) went back to
 * the older shared file. Rule now: the copy fetched most recently wins; on a
 * tie the bigger opponent sample (top 200 over top 50) wins; still tied, the
 * shared file wins (it is what everyone else sees).
 */

/** When a browser-cache entry's data was fetched (ms). Older entries have no
 *  fetchedAt: their savedAt (when the copy was stored) is the best guess. */
export function entryFetchedAt(entry) {
  if (!entry) return 0;
  const f = Number(entry.fetchedAt);
  if (Number.isFinite(f) && f > 0) return f;
  const s = Number(entry.savedAt);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * candidates: [{ player, fetchedAt, top, kind: "shared" | "local" }] (nulls skipped).
 * Returns the chosen candidate or null.
 */
export function pickNewest(candidates) {
  const list = (candidates || []).filter((c) => c && c.player);
  if (!list.length) return null;
  const rank = (c) => (c.kind === "shared" ? 1 : 0);
  return list.reduce((best, c) => {
    const bf = +best.fetchedAt || 0, cf = +c.fetchedAt || 0;
    if (cf !== bf) return cf > bf ? c : best;
    const bt = +best.top || 0, ct = +c.top || 0;
    if (ct !== bt) return ct > bt ? c : best;
    return rank(c) > rank(best) ? c : best;
  });
}

/**
 * Store with a size limit: when the write fails (localStorage quota), drop the
 * oldest entries one at a time and retry, never the one just written.
 * store: { key: entry }, write(store) → boolean.
 */
export function writeWithEviction(store, keepKey, write) {
  if (write(store)) return true;
  const order = Object.keys(store)
    .filter((k) => k !== keepKey)
    .sort((a, b) => (+(store[a] && store[a].savedAt) || 0) - (+(store[b] && store[b].savedAt) || 0));
  for (const k of order) {
    delete store[k];
    if (write(store)) return true;
  }
  return false;
}
