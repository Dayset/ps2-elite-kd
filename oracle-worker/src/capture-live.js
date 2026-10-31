/**
 * 🎯 Live capture chance (#87, owner 2026-10-31: "build it"): P(attacker B captures base f
 * within 15 min), from the map (the fixed per-base capture chance, pressure, heat, time since
 * the base last flipped, B's linked neighbours, alert phase) and, when the PC stream is live,
 * the ⚔️ fights row of that base (crowds, kills, capture-point signal).
 *
 * Measured on 15 alerts (oracle-worker/history/fights-backtest.mjs, claude/fights-backtest.md):
 * the fixed chance the focus used before is 12 % worse (Brier) than the map-only model at
 * 15 min; fights take another 0.9 % off (3.8 % at 3 min, 20 % on lopsided crowds), and the
 * commander's orders came true 34 % vs 28 %. Coefficients are fitted by the backtest's
 * --fit step into capture-live.gen.js and re-fitted as data grows.
 *
 * Pure functions: the Worker (index.js commanderFor) and the backtest both import this file,
 * so the features are the same in both places.
 */
import { warpgateConnected, heatScore } from "./commander.js";
import { spawnTotals, topIvi } from "./fights.js";

const FI = { VS: 1, NC: 2, TR: 3 };
const FACS = ["VS", "NC", "TR"];
const l1p = Math.log1p;
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };

/** The fixed per-base capture chance (capture model "Model B"), as focusPlan used it. */
export function capP(pf, fid, pressured = true) {
  const e = pf && pf[`${fid}|${pressured ? "P1:pressured" : "P0:none"}`];
  return e ? e.p : pressured ? 0.33 : 0.18;
}

/**
 * Front-line pairs: base fid owned by A (1..3, not a warpgate) with a neighbour owned by B that is
 * linked to B's warpgate. flips: [[ts, newFac, oldFac, fid]] (Worker shape, names), any order.
 * → [{fid, A, B, nbB, pressured}] (pressured = B took a neighbour in the last 15 min).
 */
export function capturePairs({ own, lattice, flips = [], nowTs }) {
  const reach = warpgateConnected(own, lattice.adj, lattice.names);
  const recent = flips.filter((x) => x[0] <= nowTs && x[0] > nowTs - 900);
  const out = [];
  for (const [fid, A] of own) {
    if (!(A >= 1 && A <= 3) || /warpgate/i.test(lattice.names[fid] || "")) continue;
    const nbs = lattice.adj.get(fid) || [];
    for (const B of [1, 2, 3]) {
      if (B === A) continue;
      const linked = nbs.filter((nb) => own.get(nb) === B && reach.has(B) && reach.get(B).has(nb));
      if (!linked.length) continue;
      const nbSet = new Set(nbs.map(String));
      const pressured = recent.some((x) => FI[x[1]] === B && nbSet.has(String(x[3])));
      out.push({ fid: String(fid), A, B, nbB: linked.length, pressured });
    }
  }
  return out;
}

/**
 * One state.fights base (fights.js fightsOf, after players.js) → the stored-row shape the model
 * was fitted on: {n: [vs, nc, tr], k, cf: 0..3, ca: s | null, sp: [6] | null, iv: [3] | null}.
 */
export function rowFromBase(b) {
  if (!b) return null;
  const n = FACS.map((f) => Math.max(0, +((b.n || {})[f]) || 0));
  const k = FACS.reduce((s, f) => s + (+((b.k || {})[f]) || 0), 0);
  const conv = b.conv || {};
  const cf = FACS.reduce((m, q) => ((+conv[q] || 0) > (m ? +conv[m] || 0 : 0) ? q : m), null);
  return { n, k, cf: cf ? FI[cf] : 0, ca: b.convAgo == null ? null : +b.convAgo, sp: spawnTotals(b.sp), iv: topIvi(b.top) };
}

/**
 * Feature groups for one pair (same order the backtest fitted). row: rowFromBase() of the base
 * when it is among the fights (else undefined). t: alert minute, dur: alert length.
 */
export function pairFeatures({ pair, lattice, flips = [], nowTs, t, dur, pf, row }) {
  const { fid, A, B } = pair;
  const past = flips.filter((x) => x[0] <= nowTs);
  let last = null; for (const x of past) if (String(x[3]) === fid && (last == null || x[0] > last)) last = x[0];
  const since = last == null ? 60 : Math.min(60, (nowTs - last) / 60);
  const map = [logit(capP(pf, fid, pair.pressured)), pair.pressured ? 1 : 0, heatScore(fid, past, nowTs, lattice.adj, 4) / 100, l1p(since), pair.nbB, t / dur];
  const r = row || null;
  const n = r ? r.n : [0, 0, 0];
  const nA = n[A - 1], nB = n[B - 1], nC = n[6 - A - B - 1];
  const crowd = [r ? 1 : 0, l1p(nB), l1p(nA), l1p(nC), (nB - nA) / (nB + nA + 2), l1p(r ? r.k : 0)];
  const ca = r && r.ca != null ? r.ca : null;
  const point = [r && r.cf === B && ca != null && ca <= 120 ? 1 : 0, r && r.cf === B && ca != null && ca <= 300 ? 1 : 0,
    r && r.cf === A && ca != null && ca <= 300 ? 1 : 0, r && r.cf === B && ca != null ? Math.exp(-ca / 120) : 0];
  const sp = r && r.sp ? r.sp : null, iv = r && r.iv ? r.iv : null;
  const spawn = [sp ? 1 : 0, l1p(sp ? sp[B - 1] : 0), l1p(sp ? sp[A - 1] : 0), l1p(sp ? sp[B + 2] : 0), l1p(sp ? sp[A + 2] : 0)];
  const skill = [iv ? 1 : 0, (iv ? iv[B - 1] : 0) / 100, (iv ? iv[A - 1] : 0) / 100];
  return { map, crowd, point, spawn, skill };
}

/** Feature vector of a variant (the groups it was fitted on). */
export const VARIANT_GROUPS = {
  map: ["map"], crowd: ["map", "crowd"], point: ["map", "point"], both: ["map", "crowd", "point"],
  spawn: ["map", "crowd", "point", "spawn"], skill: ["map", "crowd", "point", "skill"],
};
export const vectorOf = (variant, X) => VARIANT_GROUPS[variant].flatMap((g) => X[g]);

/** Logistic model {w: [intercept, ...], mu, sd} → probability. */
export function predict(m, x) {
  let s = m.w[0];
  for (let j = 0; j < x.length; j++) s += m.w[j + 1] * ((x[j] - m.mu[j]) / (m.sd[j] || 1));
  return 1 / (1 + Math.exp(-s));
}

/**
 * Live capture chances for every front-line pair: Map "fid|B" (B = 1..3) → p, plus which variant
 * was used. model: capture-live.gen.js CAPTURE_LIVE ({map, both}); without it → null (callers keep
 * the fixed chance). fights: state.fights (≤ 8 bases) or null; fightsLive: the stream is on —
 * the "both" model reads a missing base as "no fight there", so it is only used when it is.
 */
export function liveChances({ model, own, lattice, flips = [], nowTs, t, dur, pf, fights = null, fightsLive = false }) {
  if (!model || !model.map) return null;
  const useFights = !!(fightsLive && model.both && Array.isArray(fights));
  const rows = new Map();
  if (useFights) for (const b of fights) if (b && b.fid != null) rows.set(String(b.fid), rowFromBase(b));
  const variant = useFights ? "both" : "map";
  const m = model[variant];
  const out = new Map();
  for (const pair of capturePairs({ own, lattice, flips, nowTs })) {
    const X = pairFeatures({ pair, lattice, flips, nowTs, t, dur, pf, row: rows.get(pair.fid) });
    out.set(`${pair.fid}|${pair.B}`, predict(m, vectorOf(variant, X)));
  }
  return { variant, p: out };
}

/**
 * focusPlan's pf(fid, by): the live chance for attacker `by` (faction name) when known, else the
 * fixed one. by missing → the likeliest attacker.
 */
export function livePf(live, pf) {
  const fixed = (fid) => capP(pf, fid, true);
  if (!live) return fixed;
  return (fid, by) => {
    if (by && FI[by]) { const q = live.p.get(`${fid}|${FI[by]}`); return q == null ? fixed(fid) : q; }
    let best = null;
    for (const B of [1, 2, 3]) { const q = live.p.get(`${fid}|${B}`); if (q != null && (best == null || q > best)) best = q; }
    return best == null ? fixed(fid) : best;
  };
}
