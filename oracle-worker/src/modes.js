/**
 * Commander modes, shared orders (owner t691u): ATTACK orders come from the plan aimed
 * a few minutes ahead (a squad needs time to get there), DEFEND orders from the plan
 * for right now, and only when the enemy is actually attacking that base. Solo then
 * keeps one order (oracle/js/sticky.js); Big squad shows #1-#3 and may switch each minute.
 * Pure functions: the Worker (index.js) and the backtest both import this file.
 */
const FACN = { VS: 1, NC: 2, TR: 3 };
export const UNDERWAY_MIN = 10;   // "attack underway" window (backtest 2026-10-26, see CHANGELOG)

const ev = (x) => (x.kind === "push" || x.kind === "guard" ? 0.01 * ((x.heat || 0) / 100) : (+x.p || 0) * Math.abs((+x.then || 0) - (+x.now || 0)));
const list = (p) => (p && !p.quiet && p.focus ? [p.focus, ...(p.backups || [])] : []);

/**
 * Is an enemy attack underway on our base `name`? Yes when the attacker (x.target) — or,
 * without one, any enemy — took a base next to it in the last `win` minutes, or the base
 * itself changed hands in that window (a fight there). own: Map fid -> 0..3;
 * flips [[ts, newFac, oldFac, fid]] (Worker shape).
 */
export function underwayCheck({ own, lattice, flips = [], nowTs, win = UNDERWAY_MIN }) {
  const fidOf = new Map(Object.entries(lattice.names).map(([fid, n]) => [n, String(fid)]));
  const recent = flips.filter((y) => y[0] > nowTs - win * 60 && y[0] <= nowTs);
  return (f, x) => {
    const fid = fidOf.get(x && x.bases && x.bases[0]);
    if (fid == null) return false;
    const nbs = new Set((lattice.adj.get(fid) || lattice.adj.get(+fid) || []).map(String));
    const by = FACN[x.target] ? [x.target] : Object.keys(FACN).filter((g) => g !== f);
    return recent.some((y) => (String(y[3]) === fid) || (nbs.has(String(y[3])) && by.includes(y[1]) && own.get(String(y[3])) !== FACN[f]));
  };
}

/**
 * attack: focusPlan(..., t + ahead, only: "attack"); defend: focusPlan(..., t, only: "defend");
 * underway(f, entry) -> bool. Returns the usual {VS: {focus, backups, quiet}} shape, up to 3
 * entries, best expected value first.
 */
export function mixPlan(attack, defend, underway) {
  const out = {};
  for (const f of new Set([...Object.keys(attack || {}), ...Object.keys(defend || {})])) {
    const a = list(attack && attack[f]);
    const d = list(defend && defend[f]).filter((x) => underway(f, x));
    const all = [...a, ...d].map((x, i) => ({ x, i, v: ev(x) })).sort((u, w) => w.v - u.v || u.i - w.i).map((o) => o.x);
    out[f] = all.length ? { focus: all[0], backups: all.slice(1, 3), quiet: false } : { focus: null, backups: [], quiet: true };
  }
  return out;
}
