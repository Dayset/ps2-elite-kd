/**
 * Predicted heat, live (owner 2026-10-24): the chance each front-line base changes hands
 * in the next 10 minutes, from the table history/heat-model.mjs builds on the alert archive
 * (per-base capture chance × captures next door in the last 10 min × own recent flip × fronts).
 * Held-out check on 6,579 alerts: AUC 0.656 vs 0.625 for the capture chance alone.
 * Used to order moves that are worth the same, and to point newcomers at the fight when
 * no move changes the result. Worker-only; never in the odds.
 */
export const pBucket = (p) => (p < 0.2 ? 0 : p < 0.3 ? 1 : p < 0.4 ? 2 : p < 0.5 ? 3 : 4);
export const nbBucket = (n) => Math.min(3, n);
export const cellKey = (x) => `${pBucket(x.p)}|${nbBucket(x.nb)}|${x.self ? 1 : 0}|${x.fronts > 1 ? 2 : 1}`;
export const midKey = (x) => `${pBucket(x.p)}|${nbBucket(x.nb)}`;

export function predictHeat(model, x) {
  if (!model) return x.p;
  const c = model.cells[cellKey(x)] || model.mid[midKey(x)] || model.pb[String(pBucket(x.p))];
  return c ? c.p : x.p;
}

/**
 * own: Map fid -> 0..3; lattice {adj, names}; flips [[ts, newFac, oldFac, fid]] (Worker shape);
 * nowTs seconds; pf capture model per_facility. Returns Map fid -> chance (front-line bases only).
 */
export function liveHeat({ model, own, lattice, flips = [], nowTs, pf = {} }) {
  const { adj, names } = lattice;
  const recent = new Map();
  for (const [ts, , , fid] of flips) if (ts > nowTs - 600 && ts <= nowTs) recent.set(String(fid), (recent.get(String(fid)) || 0) + 1);
  const out = new Map();
  for (const [f, o] of own) {
    if (!o || /warpgate/i.test(names[f] || "")) continue;
    const nbs = adj.get(f) || [];
    const enemies = new Set(nbs.map((n) => own.get(n)).filter((x) => x && x !== o));
    if (!enemies.size) continue;
    const e = pf[`${f}|P1:pressured`];
    let nb = 0; for (const n of nbs) nb += recent.get(String(n)) || 0;
    out.set(f, predictHeat(model, { p: e ? e.p : 0.33, nb, self: (recent.get(f) || 0) > 0, fronts: enemies.size }));
  }
  return out;
}

