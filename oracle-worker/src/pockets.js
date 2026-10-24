/**
 * 🥶 pockets (owner 2026-10-24): groups of our bases whose only warpgate link runs through
 * a chokepoint under attack. The freeze check (history/freeze-check.mjs, 6,552 alerts) found
 * such bases are cut off within 10 minutes 8.6 % of the time (front line 0.3 %) and gone
 * 29.7 % (13.9 %); a pocket falls when its chokepoint falls, so the order is "hold the
 * chokepoint". Worker-only.
 *   pockets: {VS: [{chokepoint, cp_fid, bases: [name], fids: [fid], n, hold_drop}]} (worst first, ≤ 3)
 *   frozen:  {VS: Set(fid)} every base inside a threatened pocket
 */
import { findCutPoints, threatenedChokepoints } from "./commander.js";

const FACS = ["VS", "NC", "TR"];

export function computePockets({ own, lattice, flips = [], nowTs, holds = {} }) {
  const { adj, names } = lattice;
  const recent = flips.filter((x) => x[0] >= nowTs - 600);
  const cuts = findCutPoints(own, adj, names);
  const pockets = {}, frozen = {};
  for (const f of FACS) {
    const list = [], fz = new Set();
    for (const [ap, severed] of threatenedChokepoints(f, cuts, adj, recent, nowTs)) {
      severed.forEach((s) => fz.add(s));
      const h = holds[f] && holds[f].get(ap);
      list.push({ chokepoint: names[ap] || `#${ap}`, cp_fid: ap, bases: severed.map((s) => names[s] || `#${s}`).slice(0, 6), fids: severed, n: severed.length,
        hold_drop: h ? Math.round(Math.max(0, h.loss) * 10) / 10 : null });
    }
    list.sort((a, b) => (b.hold_drop || 0) - (a.hold_drop || 0) || b.n - a.n);
    pockets[f] = list.slice(0, 3);
    frozen[f] = fz;
  }
  return { pockets, frozen };
}
