#!/usr/bin/env node
/**
 * ⚔️ Fights backtest (#87 = #78 steps 2–3): do live per-base crowds make the odds or the
 * commander better? Read-only; runs in GitHub Actions (oracle-fights-backtest.yml).
 *
 * Data: archive bundles that carry per-minute `fights` rows (fights.js fightRow:
 * [fid, vs, nc, tr, kills, convFac, convAgo], top 8 bases per minute), exact captures
 * (`flips` [ts, fid, old, new]) and the map frames. Optional: the internal base rosters
 * (cache Worker rosters.js, proxy key) for the player-skill check.
 *
 * Four parts, all on the same alerts:
 *  A. Base flips. For every front-line pair (base owned by A, attacker B next to it and linked
 *     to B's warpgate) at every minute with a fights row: P(B captures it within 3 / 15 min).
 *     Map-only logistic model (the commander's own capture chance, pressure, heat, time since
 *     the base last flipped, B neighbours, alert phase) vs the same + crowds, + point signal,
 *     + both, + both under ~15 % placement noise. Folds group whole alerts (no leakage).
 *  B. Win chance. Production odds (frames map) vs the exact map ("fresh") vs the map projected
 *     3 minutes ahead with map-only flip chances vs with fights-aware flip chances.
 *     Brier per alert phase and alert length; per-alert deltas with a bootstrap interval.
 *  C. Commander. focusPlan with today's fixed capture chance vs the live one (part A, 15 min,
 *     out-of-fold): how often the order changes, and how well each order's chance came true.
 *  D. Player skill (rosters): at a base that was captured or held, does the iVi of the people
 *     there predict the result beyond the head counts?
 *
 * Pre-registered bar (#87): keep fights only if Brier improves in every bucket (not one
 * alert, not one bucket) AND the gain survives the noise test.
 *
 *   ORACLE_API=https://ps2-oracle.dayset.workers.dev [CENSUS_PROXY_KEY=… CACHE_URL=…] \
 *     node oracle-worker/history/fights-backtest.mjs --out oracle/backend/fights_backtest.json
 * Pure parts are exported for tests.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { forecast, brier, FACS, MELTDOWN, territory } from "../src/engine.js";
import { binGetter, hasTree, regionMap, latticeFor, captureModel } from "../src/models.js";
import { cutAwareSnap } from "../src/cut.js";
import { warpgateConnected, heatScore } from "../src/commander.js";
import { focusPlan } from "../src/focus.js";

const FN = { 1: "VS", 2: "NC", 3: "TR" };
const FI = { VS: 1, NC: 2, TR: 3 };
export const HORIZONS = [3, 15];
export const LAG_MIN = 3;          // projection: the map is ~3 min behind the fight (guess 1)
export const NOISE = 0.15;         // placement ~82–85 % right-base (guess 6)
const K_SAMPLES = 24;              // projected maps per minute (part B)
const FOLDS = 6;

// ---------- small math ----------
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const sig = (z) => 1 / (1 + Math.exp(-z));
const l1p = Math.log1p;

/** Solve A x = b (small dense, Gaussian elimination with pivoting). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

/** L2 logistic regression (Newton). X rows of numbers (no intercept column), y 0/1 → model. */
export function fitLogit(X, y, l2 = 1, iters = 12) {
  const d = X[0].length, n = X.length;
  const mu = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mu[j] += r[j] / n;
  for (const r of X) for (let j = 0; j < d; j++) sd[j] += (r[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
  const D = d + 1;
  let w = new Array(D).fill(0);
  const pbar = y.reduce((s, v) => s + v, 0) / n;
  w[0] = logit(Math.min(0.99, Math.max(0.01, pbar)));
  // Penalized negative log-likelihood (for the step-halving line search).
  const loss = (w2) => {
    let L = 0;
    for (let i = 0; i < n; i++) { const z = Z[i]; let s = 0; for (let j = 0; j < D; j++) s += w2[j] * z[j]; L += s > 0 ? (1 - y[i]) * s + Math.log1p(Math.exp(-s)) : -y[i] * s + Math.log1p(Math.exp(s)); }
    for (let j = 1; j < D; j++) L += 0.5 * l2 * w2[j] * w2[j];
    return L;
  };
  let cur = loss(w);
  for (let it = 0; it < iters; it++) {
    const g = new Array(D).fill(0), H = Array.from({ length: D }, () => new Array(D).fill(0));
    for (let i = 0; i < n; i++) {
      const z = Z[i]; let s = 0; for (let j = 0; j < D; j++) s += w[j] * z[j];
      const p = sig(s), e = p - y[i], q = p * (1 - p);
      for (let j = 0; j < D; j++) { g[j] += e * z[j]; const qz = q * z[j]; for (let k = j; k < D; k++) H[j][k] += qz * z[k]; }
    }
    for (let j = 1; j < D; j++) { g[j] += l2 * w[j]; H[j][j] += l2; }
    for (let j = 0; j < D; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    const step = solve(H, g);
    if (step.some((v) => !Number.isFinite(v))) break;
    let a = 1, next = null, nl = Infinity;
    for (let h = 0; h < 30; h++, a /= 2) { next = w.map((v, j) => v - a * step[j]); nl = loss(next); if (nl <= cur) break; }
    if (!(nl <= cur)) break;
    const mx = Math.max(...step.map((v) => Math.abs(a * v)));
    w = next; cur = nl;
    if (mx < 1e-6) break;
  }
  return { w, mu, sd };
}
export function predLogit(m, x) {
  let s = m.w[0];
  for (let j = 0; j < x.length; j++) s += m.w[j + 1] * ((x[j] - m.mu[j]) / m.sd[j]);
  return sig(s);
}
const brier1 = (p, y) => (p - y) ** 2;
const logloss = (p, y) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return -(y ? Math.log(q) : Math.log(1 - q)); };

// ---------- one alert ----------
const capP = (pf, fid, pressured) => { const e = pf[`${fid}|${pressured ? "P1:pressured" : "P0:none"}`]; return e ? e.p : pressured ? 0.33 : 0.18; };

/**
 * Archive bundle → prepared alert, or {key, skip}. Owners per minute come from the frames,
 * corrected by the exact capture times (flips), so labels and features line up.
 */
export function prepAlert(b) {
  const key = b && b.key;
  if (!b || !Array.isArray(b.fights) || !b.fights.length) return { key, skip: "no fights" };
  if (MELTDOWN.has(+b.event_id)) return { key, skip: "meltdown" };
  if (!FACS.includes(b.winner)) return { key, skip: "no winner" };
  const L = latticeFor(b.zone), r2f = regionMap(b.zone);
  if (!L || !r2f || !hasTree(b.zone)) return { key, skip: "no model" };
  if (!Array.isArray(b.frames) || b.frames.length < 2) return { key, skip: "few frames" };
  const dur = +b.dur || 90, start = +b.start_ts;
  const frames = [];
  let cur = new Map();
  for (const fr of b.frames) {
    cur = new Map(cur);
    for (const [fid, o] of Object.entries(fr.set || {})) cur.set(String(fid), o ? FI[o] || 0 : 0);
    frames.push({ t: +fr.t, own: cur });
  }
  const flips = (b.flips || []).map(([ts, fid, o, n]) => ({ ts: +ts, m: (+ts - start) / 60, fid: String(fid), old: +o, nw: +n }))
    .filter((x) => x.old !== x.nw && FN[x.nw]).sort((x, y) => x.ts - y.ts);
  const wg = new Set(Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f])));
  const fights = b.fights.filter((r) => r && Array.isArray(r.b) && Number.isFinite(+r.t)).map((r) => ({
    t: +r.t,
    b: new Map(r.b.map((x) => [String(x[0]), { n: [+x[1] || 0, +x[2] || 0, +x[3] || 0], k: +x[4] || 0, cf: x[5] ? FI[x[5]] || 0 : 0, ca: x[6] == null ? null : +x[6],
      sp: Array.isArray(x[7]) && x[7].length === 6 ? x[7].map((v) => +v || 0) : null, iv: Array.isArray(x[8]) && x[8].length === 3 ? x[8].map((v) => +v || 0) : null }])),
  })).sort((x, y) => x.t - y.t);
  return { key, zone: +b.zone, world: +b.world, dur, start, winner: b.winner, event_id: b.event_id, L, r2f, frames, flips, wg, fights, pf: captureModel(b.zone) };
}

/** Map as production saw it at minute m (frames only). */
export function frameOwn(a, m) { let s = null; for (const f of a.frames) { if (f.t <= m + 1e-9) s = f; else break; } return s ? s.own : null; }
/** Map at minute m with exact capture times applied. */
export function ownAt(a, m) {
  let s = null; for (const f of a.frames) { if (f.t <= m + 1e-9) s = f; else break; }
  if (!s) return null;
  const own = new Map(s.own);
  for (const x of a.flips) { if (x.m > m) break; if (x.m > s.t && own.has(x.fid)) own.set(x.fid, x.nw); }
  return own;
}

/** Front-line pairs at minute m: [{fid, A, B, nbB, pressured}]. */
export function frontier(a, own, m) {
  const reach = warpgateConnected(own, a.L.adj, a.L.names);
  const out = [];
  for (const [fid, A] of own) {
    if (!FN[A] || a.wg.has(fid)) continue;
    const nbs = a.L.adj.get(fid) || [];
    for (const B of [1, 2, 3]) {
      if (B === A) continue;
      const linked = nbs.filter((nb) => own.get(nb) === B && reach.has(B) && reach.get(B).has(nb));
      if (!linked.length) continue;
      const nbSet = new Set(nbs.map(String));
      const pressured = a.flips.some((x) => x.m <= m && x.m > m - 15 && x.nw === B && nbSet.has(x.fid));
      out.push({ fid, A, B, nbB: linked.length, pressured });
    }
  }
  return out;
}

/** Feature groups for one pair (fights row r may be undefined = base not among the 8 fights). */
export function features(a, pair, m, nowTs, r) {
  const { fid, A, B } = pair;
  const flipsC = [];
  for (const x of a.flips) { if (x.ts > nowTs) break; flipsC.push([x.ts, FN[x.nw], FN[x.old], x.fid]); }
  let last = null; for (const x of a.flips) { if (x.m > m) break; if (x.fid === fid) last = x.m; }
  const map = [logit(capP(a.pf, fid, pair.pressured)), pair.pressured ? 1 : 0, heatScore(fid, flipsC, nowTs, a.L.adj, 4) / 100,
    l1p(last == null ? 60 : Math.min(60, m - last)), pair.nbB, m / a.dur];
  const n = r ? r.n : [0, 0, 0];
  const nA = n[A - 1], nB = n[B - 1], nC = n[6 - A - B - 1];
  const crowd = [r ? 1 : 0, l1p(nB), l1p(nA), l1p(nC), (nB - nA) / (nB + nA + 2), l1p(r ? r.k : 0)];
  const ca = r && r.ca != null ? r.ca : null;
  const point = [r && r.cf === B && ca != null && ca <= 120 ? 1 : 0, r && r.cf === B && ca != null && ca <= 300 ? 1 : 0,
    r && r.cf === A && ca != null && ca <= 300 ? 1 : 0, r && r.cf === B && ca != null ? Math.exp(-ca / 120) : 0];
  // 🚐 forward spawns (points, spawns) and 👥 best scoreboard iVi per side; zeros when the row has none.
  const sp = r && r.sp ? r.sp : null, iv = r && r.iv ? r.iv : null;
  const spawn = [sp ? 1 : 0, l1p(sp ? sp[B - 1] : 0), l1p(sp ? sp[A - 1] : 0), l1p(sp ? sp[B + 2] : 0), l1p(sp ? sp[A + 2] : 0)];
  const skill = [iv ? 1 : 0, (iv ? iv[B - 1] : 0) / 100, (iv ? iv[A - 1] : 0) / 100];
  return { map, crowd, point, spawn, skill };
}

/** Labels: B captures fid in (m, m+H]; null when the window runs past the alert end. */
export function label(a, fid, B, m, H) {
  if (m + H > a.dur + 1e-9) return null;
  return a.flips.some((x) => x.fid === fid && x.nw === B && x.m > m && x.m <= m + H) ? 1 : 0;
}

/** Placement noise on one fights row (guess 6): thin each count to 85 %, move the rest to another listed base, drop 15 % of point signals. */
export function noisyRow(r, rnd, rate = NOISE) {
  const ids = [...r.b.keys()];
  const out = new Map(ids.map((id) => { const x = r.b.get(id); return [id, { ...x, n: [...x.n] }]; }));
  for (const id of ids) {
    const x = out.get(id);
    for (let f = 0; f < 3; f++) {
      let moved = 0;
      const keep = r.b.get(id).n[f];
      for (let i = 0; i < keep; i++) if (rnd() < rate) moved++;
      x.n[f] -= moved;
      for (let i = 0; i < moved; i++) {
        if (ids.length < 2) break;
        let o = ids[Math.floor(rnd() * ids.length)]; if (o === id) o = ids[(ids.indexOf(id) + 1) % ids.length];
        out.get(o).n[f]++;
      }
    }
    let k = 0; for (let i = 0; i < x.k; i++) if (rnd() >= rate) k++;
    x.k = k;
    if (x.cf && rnd() < rate) { x.cf = 0; x.ca = null; }
  }
  return { t: r.t, b: out };
}

/** Every sample of one alert: [{key, m, fid, A, B, X: {map, crowd, point}, Xn: noisy, y: {3, 15}, stale, lopsided, listed}]. */
export function samplesFor(a, rnd = mulberry(87)) {
  const out = [];
  for (const row of a.fights) {
    const m = row.t;
    if (m < 1 || m > a.dur - 0.5) continue;
    const own = ownAt(a, m);
    if (!own) continue;
    const nowTs = a.start + m * 60;
    const nrow = noisyRow(row, rnd);
    for (const pair of frontier(a, own, m)) {
      const y = {}; for (const H of HORIZONS) y[H] = label(a, pair.fid, pair.B, m, H);
      if (HORIZONS.every((H) => y[H] == null)) continue;
      const r = row.b.get(pair.fid);
      const X = features(a, pair, m, nowTs, r), Xn = features(a, pair, m, nowTs, nrow.b.get(pair.fid));
      const nB = r ? r.n[pair.B - 1] : 0, nA = r ? r.n[pair.A - 1] : 0;
      out.push({ key: a.key, m, dur: a.dur, fid: pair.fid, A: pair.A, B: pair.B, X, Xn, y,
        listed: !!r, hasSp: !!(r && r.sp), hasIv: !!(r && r.iv), stale: !!(r && r.cf === pair.B && r.ca != null && r.ca <= 180),
        lopsided: !!r && nA + nB >= 4 && Math.max(nA, nB) >= 1.5 * Math.max(1, Math.min(nA, nB)),
        pf: capP(a.pf, pair.fid, true) });
    }
  }
  return out;
}

export const VARIANTS = {
  map: (s) => s.X.map,
  crowd: (s) => [...s.X.map, ...s.X.crowd],
  point: (s) => [...s.X.map, ...s.X.point],
  both: (s) => [...s.X.map, ...s.X.crowd, ...s.X.point],
  noisy: (s) => [...s.Xn.map, ...s.Xn.crowd, ...s.Xn.point],
  spawn: (s) => [...s.X.map, ...s.X.crowd, ...s.X.point, ...s.X.spawn],
  skill: (s) => [...s.X.map, ...s.X.crowd, ...s.X.point, ...s.X.skill],
};
export const BASE_VARIANTS = ["map", "crowd", "point", "both", "noisy"];
/** 🚐 / 👥 variants only once enough alerts carry the data (rows from 2026-10-31 on). */
export function extraVariants(samples, minAlerts = 3) {
  const al = (k) => new Set(samples.filter((s) => s[k]).map((s) => s.key)).size;
  return [...(al("hasSp") >= minAlerts ? ["spawn"] : []), ...(al("hasIv") >= minAlerts ? ["skill"] : [])];
}

/** Out-of-fold predictions, folds by whole alerts. → Map variant → Float64Array aligned with samples (NaN = no label). */
export function crossFit(samples, H, keys, variants = BASE_VARIANTS, folds = FOLDS) {
  const foldOf = new Map(keys.map((k, i) => [k, i % folds]));
  const out = {};
  for (const v of variants) {
    const pred = new Float64Array(samples.length).fill(NaN);
    for (let f = 0; f < folds; f++) {
      const tr = [], ty = [];
      samples.forEach((s) => { if (foldOf.get(s.key) !== f && s.y[H] != null) { tr.push(VARIANTS[v](s)); ty.push(s.y[H]); } });
      if (tr.length < 50 || !ty.some((y) => y) ) continue;
      const mdl = fitLogit(tr, ty);
      samples.forEach((s, i) => { if (foldOf.get(s.key) === f && s.y[H] != null) pred[i] = predLogit(mdl, VARIANTS[v](s)); });
    }
    out[v] = pred;
  }
  return out;
}

/** Bootstrap 90 % interval of the mean over alerts. */
export function bootMean(vals, rnd = mulberry(7), n = 1000) {
  if (!vals.length) return null;
  const ms = [];
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < vals.length; j++) s += vals[Math.floor(rnd() * vals.length)]; ms.push(s / vals.length); }
  ms.sort((a, b) => a - b);
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  return { mean: +mean.toFixed(5), lo: +ms[Math.floor(0.05 * n)].toFixed(5), hi: +ms[Math.floor(0.95 * n)].toFixed(5) };
}

/** Part A report for one horizon. */
export function scoreFlips(samples, preds, H) {
  const buckets = { all: () => true, listed: (s) => s.listed, not_listed: (s) => !s.listed, stale: (s) => s.stale,
    lopsided: (s) => s.lopsided, even: (s) => s.listed && !s.lopsided, early: (s) => s.m / s.dur < 0.5, mid: (s) => s.m / s.dur >= 0.5 && s.m / s.dur < 0.8, late: (s) => s.m / s.dur >= 0.8 };
  const out = { horizon: H, buckets: {}, per_alert: {} };
  const vs = Object.keys(preds);
  for (const [b, test] of Object.entries(buckets)) {
    const g = { n: 0, pos: 0 }; for (const v of [...vs, "pf"]) g[v] = 0;
    samples.forEach((s, i) => {
      if (s.y[H] == null || !test(s) || vs.some((v) => Number.isNaN(preds[v][i]))) return;
      g.n++; g.pos += s.y[H];
      for (const v of vs) g[v] += brier1(preds[v][i], s.y[H]);
      g.pf += brier1(H === 15 ? s.pf : 1 - (1 - s.pf) ** (H / 15), s.y[H]);
    });
    if (!g.n) continue;
    const r = { n: g.n, rate: +(g.pos / g.n).toFixed(4) };
    for (const v of [...vs, "pf"]) r[v] = +(g[v] / g.n).toFixed(5);
    out.buckets[b] = r;
  }
  // Log loss on all samples, and per-alert Brier deltas (both − map, noisy − map; negative = fights better).
  const ll = {}; for (const v of vs) ll[v] = 0; let nll = 0;
  const per = new Map();
  samples.forEach((s, i) => {
    if (s.y[H] == null || vs.some((v) => Number.isNaN(preds[v][i]))) return;
    nll++; for (const v of vs) ll[v] += logloss(preds[v][i], s.y[H]);
    const q = per.get(s.key) || per.set(s.key, { n: 0, map: 0, both: 0, noisy: 0 }).get(s.key);
    q.n++; q.map += brier1(preds.map[i], s.y[H]); q.both += brier1(preds.both[i], s.y[H]); q.noisy += brier1(preds.noisy[i], s.y[H]);
  });
  out.logloss = Object.fromEntries(vs.map((v) => [v, +(ll[v] / (nll || 1)).toFixed(5)]));
  const dBoth = [], dNoisy = [];
  for (const [k, q] of per) { dBoth.push((q.both - q.map) / q.n); dNoisy.push((q.noisy - q.map) / q.n); out.per_alert[k] = { n: q.n, map: +(q.map / q.n).toFixed(5), both: +(q.both / q.n).toFixed(5) }; }
  out.alerts_better = dBoth.filter((d) => d < 0).length;
  out.alerts = dBoth.length;
  out.delta_both = bootMean(dBoth);
  out.delta_noisy = bootMean(dNoisy);
  return out;
}

// ---------- part B: win chance ----------
const snapOf = (a, own) => { const s = {}; for (const [r, fid] of Object.entries(a.r2f)) if (own.has(String(fid))) s[r] = String(own.get(String(fid)) || 0); return s; };

/** Win% Brier per minute: prod / fresh / projected (map-only) / projected (fights). pMap/pFights: Map "m|fid|B" → P(capture within LAG_MIN). */
export function winRows(a, pMap, pFights, rnd = mulberry(3)) {
  const getBin = binGetter(a.zone), kind = "territory", cutSnap = (s) => cutAwareSnap(s, a.zone).snap;
  const fc = (snapNow, snap15, t) => { const w = forecast({ getBin, kind, snapNow, snap15, t, dur: a.dur, cutSnap }).win; return Object.fromEntries(FACS.map((f) => [f, w[f].pct / 100])); };
  const rows = [];
  for (const row of a.fights) {
    const m = row.t;
    if (m < 1 || m > a.dur - 0.5) continue;
    const fo = frameOwn(a, m), fo15 = frameOwn(a, m - 15), own = ownAt(a, m), own12 = ownAt(a, m - 12) || own;
    if (!fo || !own) continue;
    const prod = fc(snapOf(a, fo), fo15 ? snapOf(a, fo15) : null, m);
    const fresh = fc(snapOf(a, own), snapOf(a, ownAt(a, m - 15) || own), m);
    const pairs = frontier(a, own, m);
    const tp = Math.min(m + LAG_MIN, a.dur - 0.25), s12 = snapOf(a, own12);
    const project = (pm) => {
      const acc = { VS: 0, NC: 0, TR: 0 };
      for (let k = 0; k < K_SAMPLES; k++) {
        const o = new Map(own), byBase = new Map();
        for (const p of pairs) { const q = pm.get(`${a.key}|${m}|${p.fid}|${p.B}`); if (q != null) (byBase.get(p.fid) || byBase.set(p.fid, []).get(p.fid)).push([p.B, q]); }
        for (const [fid, opts] of byBase) {
          const tot = opts.reduce((s, x) => s + x[1], 0), sc = tot > 0.98 ? 0.98 / tot : 1;
          let u = rnd();
          for (const [B, q] of opts) { if (u < q * sc) { o.set(fid, B); break; } u -= q * sc; }
        }
        const w = fc(snapOf(a, o), s12, tp);
        for (const f of FACS) acc[f] += w[f] / K_SAMPLES;
      }
      return acc;
    };
    const projMap = project(pMap), projFights = project(pFights);
    rows.push({ key: a.key, m, phase: m / a.dur < 0.5 ? "early" : m / a.dur < 0.8 ? "mid" : "late", dur: a.dur,
      prod: brier(prod, a.winner), fresh: brier(fresh, a.winner), projMap: brier(projMap, a.winner), projFights: brier(projFights, a.winner) });
  }
  return rows;
}

export function scoreWin(rows) {
  const V = ["prod", "fresh", "projMap", "projFights"];
  const agg = (test) => { const g = { n: 0 }; for (const v of V) g[v] = 0; for (const r of rows) if (test(r)) { g.n++; for (const v of V) g[v] += r[v]; } if (!g.n) return null; for (const v of V) g[v] = +(g[v] / g.n).toFixed(5); return g; };
  const out = { buckets: {} };
  for (const [b, t] of Object.entries({ all: () => true, early: (r) => r.phase === "early", mid: (r) => r.phase === "mid", late: (r) => r.phase === "late", dur90: (r) => r.dur >= 90, dur45: (r) => r.dur >= 45 && r.dur < 90, dur30: (r) => r.dur < 45 })) {
    const g = agg(t); if (g) out.buckets[b] = g;
  }
  const per = new Map();
  for (const r of rows) { const q = per.get(r.key) || per.set(r.key, { n: 0, prod: 0, projMap: 0, projFights: 0 }).get(r.key); q.n++; q.prod += r.prod; q.projMap += r.projMap; q.projFights += r.projFights; }
  const dF = [], dFM = [], dM = [];
  for (const q of per.values()) { dF.push((q.projFights - q.prod) / q.n); dFM.push((q.projFights - q.projMap) / q.n); dM.push((q.projMap - q.prod) / q.n); }
  out.delta_projmap_vs_prod = bootMean(dM);
  out.alerts_projmap_better_than_prod = dM.filter((d) => d < 0).length;
  out.alerts = per.size;
  out.delta_fights_vs_prod = bootMean(dF);
  out.delta_fights_vs_projmap = bootMean(dFM);
  out.alerts_better_than_prod = dF.filter((d) => d < 0).length;
  out.alerts_better_than_projmap = dFM.filter((d) => d < 0).length;
  return out;
}

// ---------- part C: commander ----------
/** Focus with the fixed capture chance vs the live one (15 min, out-of-fold); every 5th fights minute. */
export function commanderRows(a, pLive15) {
  const getBin = binGetter(a.zone), byName = new Map(Object.entries(a.L.names).map(([f, n]) => [n, f]));
  const rows = [];
  let i = 0;
  for (const row of a.fights) {
    const m = row.t;
    if (m < 1 || m > a.dur - 1 || i++ % 5) continue;
    const own = ownAt(a, m), own15 = ownAt(a, m - 15) || own;
    if (!own) continue;
    const terr = territory(snapOf(a, own)), t15 = territory(snapOf(a, own15));
    const header = forecast({ getBin, kind: "territory", snapNow: snapOf(a, own), snap15: snapOf(a, own15), t: m, dur: a.dur }).win;
    const base = { own, lattice: a.L, getBin, t: m, dur: a.dur, mom: Object.fromEntries(FACS.map((f) => [f, terr[f] - t15[f]])), header };
    const fixed = focusPlan({ ...base, pf: (fid) => capP(a.pf, fid, true) });
    const live = focusPlan({ ...base, pf: (fid) => { let s = 0, any = false; for (const B of [1, 2, 3]) { const q = pLive15.get(`${a.key}|${m}|${fid}|${B}`); if (q != null) { s += q; any = true; } } return any ? Math.min(0.98, s) : capP(a.pf, fid, true); } });
    for (const f of FACS) {
      const one = (plan) => {
        const c = plan[f] && plan[f].focus;
        if (!c || !["take", "plan", "hold"].includes(c.kind)) return null;
        const fid = byName.get(c.bases[0]);
        if (!fid) return null;
        const by = c.kind === "hold" ? FI[String(c.target).split("/")[0]] : FI[f];
        const y = label(a, fid, by, m, 15);
        return y == null ? null : { kind: c.kind, fid, p: Math.min(1, Math.max(0, c.kind === "plan" ? capP(a.pf, fid, true) : c.p)), y, gain: Math.abs((c.then ?? 0) - (c.now ?? 0)) };
      };
      const x = one(fixed), yv = one(live);
      if (!x && !yv) continue;
      rows.push({ key: a.key, m, f, fixed: x, live: yv, changed: !x || !yv || x.fid !== yv.fid || x.kind !== yv.kind });
    }
  }
  return rows;
}

export function scoreCommander(rows, pLiveOf) {
  const g = (sel) => { const xs = rows.map(sel).filter(Boolean); if (!xs.length) return null; return { n: xs.length, p: +(xs.reduce((s, x) => s + x.p, 0) / xs.length).toFixed(3), came_true: +(xs.reduce((s, x) => s + x.y, 0) / xs.length).toFixed(3), brier: +(xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / xs.length).toFixed(4), value: +(xs.reduce((s, x) => s + x.y * x.gain, 0) / xs.length).toFixed(3) }; };
  const ch = rows.filter((r) => r.changed);
  const out = { orders: rows.length, changed: ch.length, share_changed: rows.length ? +(ch.length / rows.length).toFixed(3) : null,
    fixed: g((r) => r.fixed), live: g((r) => r.live), changed_fixed: g((r) => r.changed && r.fixed), changed_live: g((r) => r.changed && r.live) };
  // Same orders, the live chance instead of the fixed one: is it better calibrated?
  const relive = rows.map((r) => r.fixed && pLiveOf(r) != null ? { ...r.fixed, p: pLiveOf(r) } : null);
  out.fixed_orders_live_p = g((_, i) => relive[i]) || null;
  return out;
}

// ---------- part D: player skill (rosters) ----------
export function iviIndex(cidNames, ranksLite) {
  const names = new Map(Object.entries(cidNames || {}).map(([c, v]) => [c, Array.isArray(v) ? v[0] : v]));
  const ni = ranksLite.cols.indexOf("name"), ii = ranksLite.cols.indexOf("ivi");
  const ivi = new Map(); for (const r of ranksLite.rows) { const v = +r[ii]; if (Number.isFinite(v) && v > 0) ivi.set(String(r[ni]).toLowerCase(), v); }
  const all = [...ivi.values()].sort((a, b) => a - b);
  const p90 = all.length ? all[Math.floor(0.9 * all.length)] : Infinity;
  return { of: (cid) => { const n = names.get(String(cid)); return n ? ivi.get(String(n).toLowerCase()) ?? null : null; }, p90 };
}

/** Roster row → sample {y: 1 cap / 0 held, crowd, skill, kills} or null. */
export function rosterSample(r, idx) {
  if (!r || !Array.isArray(r.pl) || !r.fac || !r.old) return null;
  const def = r.r === "cap" ? r.old : r.fac;
  const cnt = { VS: 0, NC: 0, TR: 0 };
  for (const p of r.pl) if (cnt[p[1]] != null) cnt[p[1]]++;
  const att = r.r === "cap" ? r.fac : FACS.filter((f) => f !== def).sort((x, y) => cnt[y] - cnt[x])[0];
  if (!att || att === def) return null;
  const side = (fac) => { const ps = r.pl.filter((p) => p[1] === fac); const iv = ps.map((p) => idx.of(p[0])).filter((v) => v != null); return { n: ps.length, k: ps.reduce((s, p) => s + (+p[2] || 0), 0), iv, elite: iv.filter((v) => v >= idx.p90).length }; };
  const A = side(att), D = side(def);
  if (A.n + D.n < 2) return null;
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return { y: r.r === "cap" ? 1 : 0, t: r.t, crowd: [l1p(A.n), l1p(D.n), (A.n - D.n) / (A.n + D.n + 2)],
    skill: [mean(A.iv) / 100, mean(D.iv) / 100, l1p(A.elite), l1p(D.elite), A.n ? A.iv.length / A.n : 0, D.n ? D.iv.length / D.n : 0],
    kills: [l1p(A.k), l1p(D.k)], cover: A.iv.length + D.iv.length };
}

export function scoreRosters(samples, folds = 5) {
  if (samples.length < 60) return { n: samples.length, note: "too few rows yet" };
  const sets = { crowd: (s) => s.crowd, crowd_skill: (s) => [...s.crowd, ...s.skill], crowd_kills: (s) => [...s.crowd, ...s.kills], all: (s) => [...s.crowd, ...s.skill, ...s.kills] };
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const out = { n: sorted.length, caps: sorted.filter((s) => s.y).length, with_ivi: sorted.filter((s) => s.cover > 0).length };
  for (const [name, fx] of Object.entries(sets)) {
    let b = 0, ll = 0, n = 0;
    for (let f = 0; f < folds; f++) {
      const lo = Math.floor((f * sorted.length) / folds), hi = Math.floor(((f + 1) * sorted.length) / folds);
      const tr = sorted.filter((_, i) => i < lo || i >= hi);
      const mdl = fitLogit(tr.map(fx), tr.map((s) => s.y));
      for (let i = lo; i < hi; i++) { const p = predLogit(mdl, fx(sorted[i])); b += brier1(p, sorted[i].y); ll += logloss(p, sorted[i].y); n++; }
    }
    out[name] = { brier: +(b / n).toFixed(5), logloss: +(ll / n).toFixed(5) };
  }
  const full = fitLogit(sorted.map(sets.crowd_skill), sorted.map((s) => s.y));
  out.skill_weights = { att_mean_ivi: +full.w[4].toFixed(3), def_mean_ivi: +full.w[5].toFixed(3), att_elite: +full.w[6].toFixed(3), def_elite: +full.w[7].toFixed(3) };
  return out;
}

// ---------- run ----------
export function runAll(bundles) {
  const prepped = bundles.map(prepAlert);
  const alerts = prepped.filter((a) => !a.skip);
  const skipped = prepped.filter((a) => a.skip).reduce((m, a) => ((m[a.skip] = (m[a.skip] || 0) + 1), m), {});
  const keys = alerts.map((a) => a.key);
  const samples = alerts.flatMap((a) => samplesFor(a));
  const report = { alerts: alerts.length, skipped, minutes: alerts.reduce((s, a) => s + a.fights.length, 0), pairs: samples.length,
    durations: alerts.reduce((m, a) => ((m[a.dur] = (m[a.dur] || 0) + 1), m), {}), flips: {} };
  const preds = {};
  const extra = extraVariants(samples);
  report.extra_variants = extra;
  report.with_spawns = new Set(samples.filter((s) => s.hasSp).map((s) => s.key)).size;
  report.with_ivi = new Set(samples.filter((s) => s.hasIv).map((s) => s.key)).size;
  for (const H of HORIZONS) { preds[H] = crossFit(samples, H, keys, [...BASE_VARIANTS, ...extra]); report.flips[H] = scoreFlips(samples, preds[H], H); }
  const idx = (v) => { const m = new Map(); samples.forEach((s, i) => { const p = preds[LAG_MIN][v][i]; if (!Number.isNaN(p)) m.set(`${s.key}|${s.m}|${s.fid}|${s.B}`, p); }); return m; };
  const pMap = idx("map"), pF = idx("both");
  const live15 = new Map(); samples.forEach((s, i) => { const p = preds[15].both[i]; if (!Number.isNaN(p)) live15.set(`${s.key}|${s.m}|${s.fid}|${s.B}`, p); });
  const win = [], cmd = [];
  for (const a of alerts) {
    win.push(...winRows(a, pMap, pF));
    cmd.push(...commanderRows(a, live15));
  }
  report.win = scoreWin(win);
  report.commander = scoreCommander(cmd, (r) => { let s = 0, any = false; for (const B of [1, 2, 3]) { const q = live15.get(`${r.key}|${r.m}|${r.fixed.fid}|${B}`); if (q != null && (r.fixed.kind !== "take" && r.fixed.kind !== "plan" ? B !== FI[r.f] : B === FI[r.f])) { s += q; any = true; } } return any ? Math.min(1, s) : null; });
  return report;
}

/** Pre-registered verdict (#87): fights win only on a clear, robust gain. */
export function verdict(rep) {
  const why = [];
  for (const H of HORIZONS) {
    const f = rep.flips[H];
    if (!f) continue;
    const worse = Object.entries(f.buckets).filter(([, b]) => b.both > b.map + 1e-5).map(([k]) => k);
    if (worse.length) why.push(`flips ${H} min: worse in ${worse.join(", ")}`);
    if (!f.delta_both || f.delta_both.hi >= 0) why.push(`flips ${H} min: gain not clear across alerts`);
    if (!f.delta_noisy || f.delta_noisy.hi >= 0) why.push(`flips ${H} min: gain does not survive noise`);
  }
  // Win chance, two separate questions: does projecting the map ahead help at all (map-only
  // capture chances, no new data), and do fights add to that projection?
  const w = rep.win;
  if (w && w.buckets) {
    const worseP = Object.entries(w.buckets).filter(([k, b]) => b.n >= 100 && b.projMap > b.prod + 1e-5).map(([k]) => k);
    if (worseP.length) why.push(`projection: worse than production in ${worseP.join(", ")}`);
    if (!w.delta_projmap_vs_prod || w.delta_projmap_vs_prod.hi >= 0) why.push("projection: gain not clear across alerts");
    const worse = Object.entries(w.buckets).filter(([k, b]) => b.n >= 100 && b.projFights > b.projMap + 1e-5).map(([k]) => k);
    if (worse.length) why.push(`win chance: fights worse than the map-only projection in ${worse.join(", ")}`);
    if (!w.delta_fights_vs_projmap || w.delta_fights_vs_projmap.hi >= 0) why.push("win chance: fights' gain over the projection not clear across alerts");
  }
  return { keep_flips: !why.some((x) => x.startsWith("flips")), keep_projection: !why.some((x) => x.startsWith("projection")),
    keep_win: !why.some((x) => x.startsWith("win")), why };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const get = async (p) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-fights-backtest" } }); if (r.ok) return r.json(); } catch {} await new Promise((s) => setTimeout(s, 1500)); } return null; };
  const since = +arg("--since", 1793290000); // fights storage began 2026-10-29
  const list = [];
  for (let before = 4e9, page = 0; page < 10; page++) {
    const l = await get(`/archive/list?limit=500&before=${before}`);
    if (!l || !l.alerts || !l.alerts.length) break;
    const fresh = l.alerts.filter((x) => x.start_ts >= since);
    list.push(...fresh);
    before = l.alerts[l.alerts.length - 1].start_ts;
    if (fresh.length < l.alerts.length || l.alerts.length < 500) break;
  }
  const bundles = [];
  for (let i = 0; i < list.length; i += 6) bundles.push(...(await Promise.all(list.slice(i, i + 6).map((x) => get(`/archive?key=${x.key}`)))).filter(Boolean));
  const rep = { generated: new Date().toISOString(), listed: list.length, ...runAll(bundles) };
  // Part D: rosters (internal, proxy key). Aggregates only: no ids or names leave this run.
  if (process.env.CENSUS_PROXY_KEY) {
    const C = process.env.CACHE_URL || "https://ps2-elite-kd-cache.dayset.workers.dev";
    const rows = [];
    let s = Math.floor(Date.now() / 1000 - 30 * 86400);
    for (let i = 0; i < 50; i++) {
      let j = null;
      try { const r = await fetch(`${C}/live/rosters?since=${s}&limit=2000`, { headers: { "X-Proxy-Key": process.env.CENSUS_PROXY_KEY } }); if (r.ok) j = await r.json(); else rep.rosters_error = `rosters ${r.status}`; } catch (e) { rep.rosters_error = String(e && e.message).slice(0, 80); }
      if (!j || !Array.isArray(j.rows) || !j.rows.length) break;
      rows.push(...j.rows);
      if (j.rows.length < 2000) break;
      s = j.rows[j.rows.length - 1].t + 1;
    }
    const dataDir = new URL("../../data/", import.meta.url);
    if (rows.length && existsSync(new URL("cid-names.json", dataDir))) {
      const idx = iviIndex(JSON.parse(readFileSync(new URL("cid-names.json", dataDir))), JSON.parse(readFileSync(new URL("ranks-lite.json", dataDir))));
      rep.rosters = scoreRosters(rows.map((r) => rosterSample(r, idx)).filter(Boolean));
      rep.rosters.rows = rows.length;
    }
  } else rep.rosters_error = "no proxy key";
  rep.verdict = verdict(rep);
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(rep, null, 1) + "\n");
  const f3 = rep.flips[3] && rep.flips[3].buckets.all, f15 = rep.flips[15] && rep.flips[15].buckets.all, w = rep.win.buckets.all;
  const n = (x) => (x == null ? "–" : x);
  console.log(`::notice title=fights coverage::alerts ${rep.alerts} (listed ${rep.listed}), minutes ${rep.minutes}, pairs ${rep.pairs}, skipped ${JSON.stringify(rep.skipped)}, durations ${JSON.stringify(rep.durations)}, with spawns ${rep.with_spawns}, with iVi ${rep.with_ivi}`);
  if (f3) console.log(`::notice title=flips 3 min::n ${f3.n} rate ${f3.rate} | map ${f3.map} crowd ${f3.crowd} point ${f3.point} both ${f3.both} noisy ${f3.noisy} spawn ${n(f3.spawn)} skill ${n(f3.skill)} pf ${f3.pf} | alerts better ${rep.flips[3].alerts_better}/${rep.flips[3].alerts} Δ ${JSON.stringify(rep.flips[3].delta_both)}`);
  if (f15) console.log(`::notice title=flips 15 min::n ${f15.n} rate ${f15.rate} | map ${f15.map} crowd ${f15.crowd} point ${f15.point} both ${f15.both} noisy ${f15.noisy} spawn ${n(f15.spawn)} skill ${n(f15.skill)} pf ${f15.pf} | alerts better ${rep.flips[15].alerts_better}/${rep.flips[15].alerts} Δ ${JSON.stringify(rep.flips[15].delta_both)}`);
  if (w) console.log(`::notice title=win chance::n ${w.n} prod ${w.prod} fresh ${w.fresh} projMap ${w.projMap} projFights ${w.projFights} | projMap vs prod: better ${rep.win.alerts_projmap_better_than_prod}/${rep.win.alerts} Δ ${JSON.stringify(rep.win.delta_projmap_vs_prod)} | fights vs projMap: better ${rep.win.alerts_better_than_projmap}/${rep.win.alerts} Δ ${JSON.stringify(rep.win.delta_fights_vs_projmap)}`);
  const c = rep.commander;
  console.log(`::notice title=commander::orders ${c.orders}, changed ${n(c.share_changed)}; fixed ${JSON.stringify(c.fixed)}; live ${JSON.stringify(c.live)}`);
  if (rep.rosters) console.log(`::notice title=rosters::${JSON.stringify(rep.rosters).slice(0, 900)}`);
  else console.log(`::notice title=rosters::${n(rep.rosters_error)}`);
  console.log(`::notice title=verdict::${JSON.stringify(rep.verdict).slice(0, 900)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
