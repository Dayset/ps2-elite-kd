/**
 * "All moves" defend list, priced the way the game scores (#63).
 *
 * The Python-parity commander (commander.js rankedLive) values a lost base on raw
 * territory, so a chokepoint whose loss cuts bases off from the warpgate looks
 * like any other base. Measured over 6,539 alerts (claude/cut-cost-measurement.md):
 * at the same raw-map margin, factions that just got cut win about 2 fewer alerts
 * in 100; at the same game-scored margin (cut bases count for nobody) the gap is
 * gone. So the defend list uses the same cut-aware win drop as Commander focus
 * (src/focus.js "hold"): no extra cut constant, which would count the cut twice.
 *
 * Rows keep the shape runCommander gives them (name, vs, win_drop, p_loss, ev,
 * priority, heat, pred_heat, freezing, cut_off, hold_factor, resistance,
 * median_hold_min) plus cuts (how many of our bases losing it cuts off) and
 * cut_names (up to three). Rows whose loss cuts ours off (and moves the odds at
 * least 2 %) first, then ev = capture chance × win drop × hold factor.
 * Worker-only: the parity port stays untouched.
 */
import { pyRound, heatScore, predHeatMap, freezingSet, findCutPoints, warpgateConnected, holdFactor, refHold } from "./commander.js";

const FACS = ["VS", "NC", "TR"];
const INV = { VS: 1, NC: 2, TR: 3 };
const SHOW = 3;
const MIN_SWING = 2;   // focus.js: win-chance change below which a move is noise

/**
 * holds: from focusPlan({holds}) — holds[f] = Map fid -> {fid, base, vs, p, loss, cuts}.
 * own: Map fid -> 0..3, lattice {adj, names}, flips [[ts, new, old, fid]], nowTs (s), res: resistance model.
 * Returns {VS: rows, ...} for factions with threatened bases; others are left out.
 */
export function cutAwareDefends({ holds, own, lattice, flips = [], nowTs, res = {} }) {
  if (!holds) return {};
  const { adj, names } = lattice;
  const recent = flips.filter((x) => x[0] >= nowTs - 600);
  const conn = warpgateConnected(own, adj, names);
  const cuts = findCutPoints(own, adj, names);
  const predHeat = predHeatMap(own, adj, recent, nowTs);
  const ref = refHold(res);
  const out = {};
  for (const f of FACS) {
    const h = holds[f];
    if (!h || !h.size) continue;
    const myConn = conn.get(INV[f]);
    const freezing = freezingSet(f, cuts, adj, recent, nowTs);
    const rows = [];
    for (const x of h.values()) {
      const isolated = myConn !== undefined && !myConn.has(x.fid);
      const drop = Math.max(0, x.loss);
      const rf = holdFactor(res, x.fid, ref);
      const re = res[String(x.fid)] || {};
      rows.push({
        name: x.base, vs: x.vs, win_drop: pyRound(drop, 1), p_loss: pyRound(x.p, 2), ev: pyRound(x.p * drop * rf, 2),
        priority: isolated ? 0 : pyRound(Math.max(0, Math.min(100, 10 * drop))),
        heat: isolated ? 0 : heatScore(x.fid, recent, nowTs, adj), pred_heat: predHeat.get(x.fid) || 0,
        freezing: freezing.has(x.fid) || isolated, cut_off: isolated,
        hold_factor: pyRound(rf, 2), resistance: re.class ?? null, median_hold_min: re.median_hold_min ?? null,
        cuts: x.cuts.length, cut_names: x.cuts.slice(0, 3), _ev: x.p * drop * rf,
      });
    }
    // Bases whose loss cuts ours off come first, like the attack list, when the cut
    // moves our odds by at least MIN_SWING; within each group, expected loss. (Not by
    // cut size: on the Osprey Hossin fixture TR's Cairn Station cuts 4 but rarely
    // falls, while Roothouse Distillery cuts 1 and decided the alert.)
    const cutKey = (r) => (r.cuts > 0 && r.win_drop >= MIN_SWING ? 1 : 0);
    rows.sort((a, b) => cutKey(b) - cutKey(a) || b._ev - a._ev || b.win_drop - a.win_drop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out[f] = rows.slice(0, SHOW).map(({ _ev, ...r }) => r);
  }
  return out;
}
