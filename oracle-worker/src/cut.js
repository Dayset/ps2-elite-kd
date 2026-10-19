/**
 * Cut-aware territory. In PlanetSide 2 a base that has lost its lattice link to
 * its faction's warpgate ("cut off") stops counting toward that faction's
 * territory score, while the Census map keeps showing it as owned. So a cut
 * changes the alert score at once, before any capture. The odds engine reads the
 * raw map; this module removes cut bases from their owner (shown as neutral "0",
 * which keeps the denominator) so the engine sees what the game scores.
 *
 * Evidence (2026-10-18, D1 data): 10-4-46315 ended with 4 VS bases cut; Census
 * scored VS 21.2 % against 26.1 % raw and 21.6 % connected-only. The rescan job
 * (oracle/backend/rescan.mjs) checks this over every stored alert before the
 * live odds switch to it; until then it is logged as the "_cut" benchmark slice.
 */
import { regionMap, latticeFor } from "./models.js";
import { ownership, warpgateConnected } from "./commander.js";

const FAC = { 1: "VS", 2: "NC", 3: "TR" };

/**
 * Bases cut off from their owner's warpgate. Returns [{region, fid, name, fac}]
 * or null when the continent has no lattice data. Factions without a warpgate on
 * the map (Meltdown locks, Oshur's layout gaps) are left alone.
 */
export function cutBases(snap, zone) {
  const r2f = regionMap(zone), L = latticeFor(zone);
  if (!snap || !r2f || !L) return null;
  const own = ownership(snap, r2f);
  const conn = warpgateConnected(own, L.adj, L.names);
  const f2r = new Map();
  for (const [r, f] of Object.entries(r2f)) f2r.set(f, r);
  const out = [];
  for (const [fid, o] of own) {
    if (!FAC[o] || !conn.has(o) || conn.get(o).has(fid)) continue;
    const region = f2r.get(fid);
    if (region != null && String(region) in snap) out.push({ region: String(region), fid, name: L.names[fid] || fid, fac: FAC[o] });
  }
  return out;
}

/** Snapshot copy with cut bases set to "0" (no owner). {snap, cut} — snap is the input when nothing is cut. */
export function cutAwareSnap(snap, zone) {
  const cut = cutBases(snap, zone);
  if (!cut || !cut.length) return { snap, cut: cut || [] };
  const s = { ...snap };
  for (const c of cut) s[c.region] = "0";
  return { snap: s, cut };
}
