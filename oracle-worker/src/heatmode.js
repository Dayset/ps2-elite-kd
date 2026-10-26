/**
 * 🔥 Heat mode (owner t692u): ignore the alert / win math and send each faction to the
 * fight. Fight heat is the Commander's own heatScore (src/commander.js): flips AT the base
 * in the last 4 minutes count 100, flips next to it 40, both fading over the 4 minutes.
 *   - Defend: one of our bases with heat.
 *   - Attack: an enemy base next to one of ours, with heat (a base we just lost scores
 *     highest here: retake it).
 * One direction; a second one only when its heat is at least CLOSE × the first one.
 * Uses the flip list the Commander already reads: in the archive every map-snapshot change
 * had a flip event, and the flip came a median 28 s earlier (57 alerts, 6,477 changes), so
 * snapshot diffs would add nothing. No extra reads or writes.
 */
import { heatScore } from "./commander.js";

const FAC = { VS: 1, NC: 2, TR: 3 }, NAME = { 1: "VS", 2: "NC", 3: "TR" };
// Second direction only when its heat is ≥ CLOSE × the first. Backtest on 57 past alerts
// (2026-10-26, /workspace/modes/heat4.mjs, CHANGELOG): a second pick with ≥ 0.6 × the heat
// still had a fight 5 min later as often as #1 (46% / 40% vs 39% / 40%); below 0.6 it was
// 9-11 points worse. 0.6 shows two directions about a third of the time.
export const CLOSE = 0.6;

/** Every hot candidate for faction f, hottest first: {kind, fid, name, target, heat}. */
export function heatCandidates({ own, lattice, flips, nowTs }, f) {
  const me = FAC[f], { adj, names } = lattice, out = [];
  const recent = flips.filter((x) => x[0] >= nowTs - 240 && x[0] <= nowTs);
  if (!recent.length) return out;
  const nb = (fid) => (adj.get(String(fid)) || []).map(String);
  for (const [fid, o] of own) {
    const name = names[fid];
    if (!name || /warpgate/i.test(name) || !o) continue;
    if (o === me) {
      const h = heatScore(fid, recent, nowTs, adj);
      if (h <= 0) continue;
      // Who is attacking: the latest enemy flip at or next to it.
      const near = new Set([String(fid), ...nb(fid)]);
      let target = null;
      for (const x of recent) if (near.has(String(x[3])) && x[1] !== f) target = x[1];
      if (!target) for (const n of nb(fid)) { const on = own.get(n); if (on && on !== me) { target = NAME[on]; break; } }
      out.push({ kind: "hold", fid: String(fid), name, target, heat: h });
    } else if (nb(fid).some((n) => own.get(n) === me)) {
      const h = heatScore(fid, recent, nowTs, adj);
      if (h > 0) out.push({ kind: "take", fid: String(fid), name, target: NAME[o], heat: h });
    }
  }
  return out.sort((a, b) => b.heat - a.heat || (a.kind === "hold" ? -1 : 1) - (b.kind === "hold" ? -1 : 1) || (a.name < b.name ? -1 : 1));
}

/** {VS: {focus, backups, quiet, heat_mode: true}, ...}: 1 order, 2 when the second is close. */
export function heatPlan(args, close = CLOSE) {
  const out = {};
  for (const f of Object.keys(FAC)) {
    if (![...args.own.values()].includes(FAC[f])) continue;
    const c = heatCandidates(args, f);
    const e = (x) => ({ kind: x.kind, bases: [x.name], target: x.target, heat: x.heat, hot: true });
    if (!c.length) { out[f] = { focus: null, backups: [], quiet: true, heat_mode: true }; continue; }
    out[f] = { focus: e(c[0]), backups: c[1] && c[1].heat >= close * c[0].heat ? [e(c[1])] : [], quiet: false, heat_mode: true };
  }
  return out;
}
