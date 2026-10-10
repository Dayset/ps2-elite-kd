/**
 * 🙈 Rankings hide list (data/hidden.json), owner-edited only (no public UI).
 *
 *   { "players": { "<name or character id>": { "reason": "…", "at": "YYYY-MM-DD" } } }
 *
 * Keys match a cached player by tag-less slug ("[TAG] Name" → "name") or by
 * Census character id. A hidden player is left out of data/ranks.json (so the
 * ranks.html tables, percentiles and distributions) and the outlier-guard
 * population, but its cache file is kept: it can still be analyzed on the main
 * page and it is listed on build-log.html under "🙈 Hidden from rankings".
 * DOM-free; used by scripts/build-ranks.mjs and its tests.
 */

/** Same slug as app.js / refresh-cache.mjs ("[TAG] Name" → "name"). */
export function hiddenKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Parse hidden.json content into a lookup.
 * @returns {{ size:number, match:(p:{slug?:string,name?:string,cid?:string})=>null|{key:string,reason:string,at:string} }}
 */
export function hiddenList(json) {
  const players = (json && typeof json === "object" && json.players && typeof json.players === "object") ? json.players : {};
  const byKey = new Map();
  for (const [k, v] of Object.entries(players)) {
    const raw = String(k).trim();
    const key = /^\d{5,25}$/.test(raw) ? raw : hiddenKey(raw);
    if (!key) continue;
    byKey.set(key, { key: raw, reason: String((v && v.reason) || ""), at: String((v && v.at) || "") });
  }
  return {
    size: byKey.size,
    match({ slug = "", name = "", cid = "" } = {}) {
      if (cid && byKey.has(String(cid))) return byKey.get(String(cid));
      for (const k of [slug, hiddenKey(slug), hiddenKey(name)]) {
        if (k && byKey.has(k)) return byKey.get(k);
      }
      return null;
    },
  };
}

/** True when a hide-list entry is a confirmed cheater (reason starts "confirmed cheater"; t323u). */
export function isConfirmedCheater(hit) {
  return !!hit && /^\s*confirmed cheater/i.test(String(hit.reason || ""));
}
