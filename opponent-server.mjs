/**
 * 🌍 Server from a player's opponents (owner 2026-11-01): the last fallback after the player's own world and their
 * outfit's. Fights happen on one world, so the players someone killed / died to are on their server. Each distinct
 * opponent with a known server is one vote; a server is assigned only with >= OPP_MIN_N votes and >= OPP_MIN_SHARE of
 * them on one server. Measured on the 16,772 PC players whose own world is known (2026-11-01): the rule covers
 * 16,711 of them and agrees with the own world on all 16,711 (100%); with 1 vote it was wrong 1 time in 8.
 * DOM-free and Node-free (scripts/build-ranks.mjs and rank-row.mjs use the same code).
 */
export const OPP_MIN_N = 10;
export const OPP_MIN_SHARE = 0.9;

/** Opponent name ("[TAG] Name") → the same key as slugKey (lower-case, tag and symbols dropped). */
export function oppKey(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * @param rows   opponent rows of a player file ([{ name, kills, deaths }])
 * @param srvOf  key → server group of an opponent whose OWN server is known ("osprey", "wainwright", "jaeger", …), else null
 * @param self   the player's own key (never a vote)
 * @returns { srv, n, share } — srv null when the evidence is too thin or split
 */
export function serverFromOpponents(rows, srvOf, self = "", { minN = OPP_MIN_N, minShare = OPP_MIN_SHARE } = {}) {
  const votes = new Map();
  const seen = new Set();
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = oppKey(r && r.name);
    if (!k || k === self || seen.has(k)) continue;
    seen.add(k);
    const g = srvOf(k);
    if (!g) continue;
    votes.set(g, (votes.get(g) || 0) + 1);
    n++;
  }
  let best = null, bv = 0;
  for (const [g, v] of votes) if (v > bv) { best = g; bv = v; }
  const share = n ? bv / n : 0;
  return { srv: n >= minN && share >= minShare ? best : null, n, share };
}
