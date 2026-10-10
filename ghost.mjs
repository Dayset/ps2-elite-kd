/**
 * 👻 Ghost lines: a PREDICTED continuation of a player's chart line where
 * their real fights are sparse or missing. Predicted from play style, not
 * real fights. DOM-free; the population model is fitted offline over the
 * shared cache by scripts/build-ghost-model.mjs → data/ghost-model.mjs (also refit by every
 * cache refresh run in refresh-cache.yml, in the same single commit).
 *
 * Model (log K/D vs opponent KPM x):
 *   log KD(x) ≈ A + S · g(x),   g(x) = ln(x + G_SHIFT)
 * Population: A and S regressed (ridge) on the player's style features
 * (overall KD, own KPM, acc, HSR, RF, slope, 🦁 Brave, 🎈 Inflation).
 * Per player: A/S shrunk toward their own fights (more fights → more own),
 * then a kernel-smoothed residual follows their real data near it and fades
 * back to the style model far from it.
 */
import { isFiniteNum, kpmBandCurve } from "./math.mjs?v=20261009-namesort";

export const G_SHIFT = 1.0;
/** Fights (events) of prior weight on the slope S / level A from the population. */
export const PRIOR_S_EVENTS = 50000;
export const PRIOR_A_EVENTS = 100;
/** Residual smoother: kernel width (KPM) and prior events (pull back to model). */
export const RES_SIGMA = 0.4;
export const RES_PRIOR_EVENTS = 300;
/** Banded: ghost is shown where weighted events < this; blends into real up to it. */
export const GHOST_BLEND_EVENTS = 250;

export const g = (x, shift = G_SHIFT) => Math.log(Math.max(0, x) + shift);

const FEATURE_NAMES = ["logKd", "ownKpm", "acc", "hsr", "logRf", "slope", "logBrave", "logInfl"];
export { FEATURE_NAMES };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const logPos = (v) => (isFiniteNum(v) && v > 0 ? Math.log(v) : NaN);

/** Style features from playerMetrics() output (NaN = missing → population mean). */
export function ghostFeatures(m) {
  m = m || {};
  return [
    logPos(m.kd),
    isFiniteNum(m.ownKpm) ? clamp(m.ownKpm, 0, 4) : NaN,
    isFiniteNum(m.acc) ? clamp(m.acc, 0, 100) / 100 : NaN,
    isFiniteNum(m.hsr) ? clamp(m.hsr, 0, 100) / 100 : NaN,
    logPos(m.rf),
    isFiniteNum(m.slope) ? clamp(m.slope, -3, 1) : NaN,
    logPos(m.pvs),
    logPos(m.inflation),
  ].map((v) => (isFiniteNum(v) ? clamp(v, -8, 8) : NaN));
}

/** Smoothed per-row points (log KD with +0.5 continuity) from top-N rows. */
function rowPoints(rows) {
  const out = [];
  for (const r of rows || []) {
    const k = +r.kills || 0, d = +r.deaths || 0, x = +r.kpm;
    if (!isFiniteNum(x) || k + d <= 0) continue;
    out.push({ x, e: k + d, y: Math.log((k + 0.5) / (d + 0.5)) });
  }
  return out;
}

/** Weighted LS of y on g(x). Null if too little spread to judge a slope. */
export function fitShape(rows, { minSpan = 0.5, minPts = 4, shift = G_SHIFT } = {}) {
  const pts = rowPoints(rows);
  if (pts.length < minPts) return null;
  let W = 0, sx = 0, sy = 0;
  for (const p of pts) { const gx = g(p.x, shift); W += p.e; sx += p.e * gx; sy += p.e * p.y; }
  const mx = sx / W, my = sy / W;
  let sxx = 0, sxy = 0, lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const dx = g(p.x, shift) - mx;
    sxx += p.e * dx * dx; sxy += p.e * dx * (p.y - my);
    lo = Math.min(lo, p.x); hi = Math.max(hi, p.x);
  }
  if (hi - lo < minSpan || sxx <= 1e-9) return null;
  const S = sxy / sxx;
  return { A: my - S * mx, S, W, span: hi - lo, mx, my };
}

/** Ridge regression (weighted) of y on standardized X. Returns {b0, b}. */
export function ridge(X, y, w, lambda = 1) {
  const n = X.length, p = X[0] ? X[0].length : 0;
  let W = 0, my = 0;
  for (let i = 0; i < n; i++) { W += w[i]; my += w[i] * y[i]; }
  my /= W;
  const M = Array.from({ length: p }, () => new Array(p).fill(0));
  const v = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      v[a] += w[i] * X[i][a] * (y[i] - my);
      for (let b = 0; b < p; b++) M[a][b] += w[i] * X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < p; a++) M[a][a] += lambda * W / n;
  // Gaussian elimination
  const A = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  const b = A.map((r, i) => r[p] / (r[i] || 1e-12));
  return { b0: my, b };
}

function standardize(f, model) {
  return f.map((v, i) => (isFiniteNum(v) ? (v - model.mean[i]) / (model.sd[i] || 1) : 0));
}

/**
 * Fit the population model. samples: [{ rows, metrics }] (top-N rows +
 * playerMetrics). Uses players whose own fights pin down a shape.
 */
export function fitGhostModel(samples, { lambda = 10, densityMax = 4, densityStep = 0.05, shift = G_SHIFT } = {}) {
  const fits = [];
  const nb = Math.round(densityMax / densityStep);
  const density = new Array(nb + 1).fill(0);
  let nDens = 0;
  for (const s of samples) {
    const tot = (s.rows || []).reduce((a, r) => a + (+r.kills || 0) + (+r.deaths || 0), 0);
    if (tot > 0) {
      for (const r of s.rows) {
        const i = Math.min(nb, Math.max(0, Math.round((+r.kpm || 0) / densityStep)));
        density[i] += ((+r.kills || 0) + (+r.deaths || 0)) / tot;
      }
      nDens++;
    }
    const f = fitShape(s.rows, { shift });
    if (!f || f.W < 300) continue;
    const feat = ghostFeatures(s.metrics);
    fits.push({ f, feat, rows: s.rows });
  }
  if (fits.length < 10) throw new Error("ghost model: too few players with a usable shape");
  const p = FEATURE_NAMES.length;
  const mean = new Array(p).fill(0), sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    const v = fits.map((x) => x.feat[j]).filter(isFiniteNum);
    const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const s2 = v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1);
    mean[j] = m; sd[j] = Math.sqrt(s2) || 1;
  }
  const model = { gShift: shift, features: FEATURE_NAMES, mean, sd };
  const X = fits.map((x) => standardize(x.feat, model));
  const w = fits.map((x) => Math.min(x.f.W, 3000));
  const rA = ridge(X, fits.map((x) => x.f.A), w, lambda);
  const rS = ridge(X, fits.map((x) => x.f.S), w, lambda);
  model.A = rA; model.S = rS;
  // Population residual sd of per-opponent log KD vs the style-only prediction.
  let se = 0, sw = 0;
  for (const x of fits) {
    const z = standardize(x.feat, model);
    const A = lin(rA, z), S = lin(rS, z);
    for (const pt of rowPoints(x.rows)) { se += pt.e * (pt.y - A - S * g(pt.x, shift)) ** 2; sw += pt.e; }
  }
  model.sigma = Math.sqrt(se / sw);
  model.density = { step: densityStep, values: density.map((v) => v / (nDens || 1)) };
  model.n = fits.length;
  return model;
}

function lin(r, z) {
  let v = r.b0;
  for (let i = 0; i < z.length; i++) v += r.b[i] * z[i];
  return v;
}

/** Style-only (A, S) for a feature vector. */
export function stylePrior(feat, model) {
  const z = standardize(feat, model);
  return { A: lin(model.A, z), S: lin(model.S, z) };
}

/**
 * Personal ghost model: log KD(x) = A + S·g(x) + offset(x).
 * Returns { at(x) → { kd, logSd } } where logSd is a rough 1σ in log space.
 */
export function ghostModelFor(rows, metrics, model, { priorS = PRIOR_S_EVENTS, priorA = PRIOR_A_EVENTS, resPrior = RES_PRIOR_EVENTS, resSigma = RES_SIGMA } = {}) {
  const shift = model.gShift || G_SHIFT;
  const prior = stylePrior(ghostFeatures(metrics), model);
  const pts = rowPoints(rows);
  const own = fitShape(rows, { shift });
  let S = prior.S;
  if (own) S = (prior.S * priorS + own.S * own.W) / (priorS + own.W);
  let A = prior.A;
  let W = 0, sa = 0;
  for (const p of pts) { W += p.e; sa += p.e * (p.y - S * g(p.x, shift)); }
  if (W > 0) A = (prior.A * priorA + sa) / (priorA + W);
  const res = pts.map((p) => ({ x: p.x, e: p.e, r: p.y - (A + S * g(p.x, shift)) }));
  const sigma = model.sigma || 0.8;
  return {
    A, S, prior,
    at(x) {
      let num = 0, den = 0;
      for (const p of res) {
        const k = Math.exp(-0.5 * ((x - p.x) / resSigma) ** 2) * p.e;
        num += k * p.r; den += k;
      }
      const off = num / (resPrior + den);
      const logKd = A + S * g(x, shift) + off;
      return { kd: Math.exp(logKd), logKd, logSd: sigma * Math.sqrt(resPrior / (resPrior + den)) };
    },
  };
}

/**
 * Banded ghost on the band-curve grid. Each point: { kpm, kd, lo, hi, ghost }
 * ghost = true where real weighted events < GHOST_BLEND_EVENTS. Near that
 * edge the ghost blends (in log space) into the real band value so the dashed
 * line meets the solid one; far from data it is the style model.
 */
export function bandGhost(band, rows, metrics, model) {
  const gm = ghostModelFor(rows, metrics, model);
  return (band || []).map((pt) => {
    const pr = gm.at(pt.kpm);
    const ev = pt.events || 0;
    const w = isFiniteNum(pt.kd) && pt.kd > 0 ? clamp(ev / GHOST_BLEND_EVENTS, 0, 1) : 0;
    const logKd = w ? w * Math.log(pt.kd) + (1 - w) * pr.logKd : pr.logKd;
    const sd = (1 - w) * pr.logSd;
    return {
      kpm: pt.kpm,
      kd: Math.exp(logKd),
      lo: Math.exp(logKd - sd),
      hi: Math.exp(logKd + sd),
      ghost: ev < GHOST_BLEND_EVENTS,
    };
  });
}

/**
 * Cumulative ghost for X where the real cumulative line has no deaths (the
 * line ended): real kills/deaths at ≥ X plus predicted ones, with the
 * player's total fights spread by the population's opponent-KPM density and
 * split by the predicted K/D. Returns Map kpm → { kd, lo, hi }.
 */
export function cumulativeGhost(curve, rows, metrics, model) {
  const gm = ghostModelFor(rows, metrics, model);
  const N = (rows || []).reduce((a, r) => a + (+r.kills || 0) + (+r.deaths || 0), 0);
  const dens = (model.density && model.density.values) || [];
  const step = (model.density && model.density.step) || 0.05;
  const cache = dens.map((_, i) => gm.at(i * step));
  const out = new Map();
  for (const pt of curve || []) {
    if (pt.deaths > 0) continue;
    let pk = 0, pd = 0, vk = 0;
    for (let i = 0; i < dens.length; i++) {
      const x = i * step;
      if (x < pt.kpm - 1e-9) continue;
      const ev = N * dens[i];
      const kd = cache[i].kd;
      pk += ev * kd / (1 + kd);
      pd += ev / (1 + kd);
      vk += ev * cache[i].logSd;
    }
    const k = (pt.kills || 0) + pk, d = (pt.deaths || 0) + pd;
    if (d <= 1e-9 || pk + pd <= 1e-9) {
      // No population mass this far right: the banded prediction at X itself.
      const at = gm.at(pt.kpm);
      out.set(Math.round(pt.kpm * 100) / 100, { kd: at.kd, lo: at.kd * Math.exp(-at.logSd), hi: at.kd * Math.exp(at.logSd) });
      continue;
    }
    const kd = k / d;
    const sd = vk / (pk + pd);
    out.set(Math.round(pt.kpm * 100) / 100, { kd, lo: kd * Math.exp(-sd), hi: kd * Math.exp(sd) });
  }
  return out;
}

export { kpmBandCurve };
