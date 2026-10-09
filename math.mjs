/**
 * Pure elite-K/D math (shared by the browser app and Node tests).
 * Keep this free of DOM / fetch / localStorage.
 */

export const X_MAX = 2.0;
export const EASY_MAX = 0.75;
export const HARD_MIN = 1.5;
/** Inflation / death-mix cutoff (avg planetman ~0.35 KPM). */
export const INFLATION_KPM = 0.5;
/** Soft RF baseline ≈ public IvI 600. */
export const RF_SOFT = 0.6;
/** Typical steep full-curve slope ≈ -2; fixed floor for LionHeart. */
export const SLOPE_FLOOR = -2.0;
export const SLOPE_EPS = 0.05;

export function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function pooled(sl) {
  let tk = 0;
  let td = 0;
  for (const r of sl) {
    tk += r.kills || 0;
    td += r.deaths || 0;
  }
  let kd = NaN;
  if (td) kd = tk / td;
  else if (tk) kd = tk;
  return { kills: tk, deaths: td, kd };
}

export function kpmCurve(rows, start = 2.5, end = 0.0, step = 0.05) {
  const pts = [];
  for (let t = start; t >= end - 1e-9; t -= step) {
    const cut = Math.round(t * 100) / 100;
    const sl = rows.filter((r) => (r.kpm || 0) >= cut);
    const { kills, deaths, kd } = pooled(sl);
    pts.push({ kpm: cut, kd, kills, deaths, n: sl.length });
  }
  return pts;
}

/**
 * Resistance Factor (RF) and Activity/IF from high-pressure pair union.
 * Union of top-n by opp KPM and top-n by deaths against player.
 * RF = rkd * avg_opp_kpm; IF = rkd * own_kpm.
 */
export function rfIf(p, sliceN) {
  const rows = Array.isArray(p.rows) ? p.rows.slice() : [];
  if (!rows.length) return null;
  const n = sliceN == null ? rows.length : Math.max(1, Math.min(sliceN, rows.length));
  const byKpm = rows.slice().sort((a, b) => (b.kpm || 0) - (a.kpm || 0)).slice(0, n);
  const byDth = rows.slice().sort((a, b) => (b.deaths || 0) - (a.deaths || 0)).slice(0, n);
  const seen = new Set();
  const sl = [];
  for (const r of byKpm.concat(byDth)) {
    const key = r.name;
    if (seen.has(key)) continue;
    seen.add(key);
    sl.push(r);
  }
  const { kills, deaths, kd: rkd } = pooled(sl);
  const kpms = sl.map((r) => +r.kpm || 0);
  const avgOpp = kpms.length ? kpms.reduce((a, b) => a + b, 0) / kpms.length : 0;
  const own = +(p.own_kpm || p.global_kpm || 0);
  const rf = rkd * avgOpp;
  const ifactor = rkd * own;
  return {
    n: sl.length,
    kills,
    deaths,
    rkd,
    avg_opp: avgOpp,
    own,
    rf,
    ifactor,
  };
}

/** adjIvI = 600 * (1 + log2(RF / 0.6)); soft RF 0.6 ≈ public IvI 600. */
export function adjustedIvi(ivi, rf) {
  if (rf == null || !(rf > 0)) return NaN;
  return 600 * (1 + Math.log2(rf / RF_SOFT));
}

/**
 * ⚡ ivi kill-speed adjustment (user-chosen 2026-10-07, multiplicative slow side).
 * Own KPM inside [SPEED_BAND_LOW, SPEED_BAND_HIGH] = neutral (⚡ ivi = 🎯🎈 ivi).
 * Faster than the band: + SPEED_FAST_K × log2(own / 1.4)^SPEED_EXP points
 *   (own 2.8 → +300, 4.5 → +658).
 * Slower than the band: a positive 🎯🎈 ivi is scaled by
 *   factor = max((own / 0.8)^SPEED_SLOW_EXP, SPEED_SLOW_FLOOR)
 *   (own 0.57 → ×0.87, 0.4 → ×0.75, 0.2 → ×0.56, never below ×0.5), so a slow,
 *   safe KD counts for less but is never flipped negative. A 🎯🎈 ivi ≤ 0 gets
 *   no extra penalty.
 */
export const SPEED_BAND_LOW = 0.8;
export const SPEED_BAND_HIGH = 1.4;
export const SPEED_EXP = 1.5;
export const SPEED_FAST_K = 300;
export const SPEED_SLOW_EXP = 0.415;
export const SPEED_SLOW_FLOOR = 0.5;

function ownKpmValue(ownKpm) {
  const k = +ownKpm;
  if (ownKpm == null || ownKpm === "" || !Number.isFinite(k) || k <= 0) return NaN;
  return k;
}

/**
 * Slow-side multiplier for a positive 🎯🎈 ivi: 1 at/above SPEED_BAND_LOW,
 * (own/0.8)^0.415 below it, floored at SPEED_SLOW_FLOOR. NaN for bad input.
 */
export function speedSlowFactor(ownKpm) {
  const k = ownKpmValue(ownKpm);
  if (!Number.isFinite(k)) return NaN;
  if (k >= SPEED_BAND_LOW) return 1;
  return Math.max(Math.pow(k / SPEED_BAND_LOW, SPEED_SLOW_EXP), SPEED_SLOW_FLOOR);
}

/**
 * Points added (+) or removed (−) for own kill speed given 🎯🎈 ivi (adj):
 * 0 inside the band, +fast bonus above it, adj × (factor − 1) below it
 * (0 when adj ≤ 0). NaN when an input is missing or ownKpm ≤ 0.
 */
export function speedAdjustment(ownKpm, adj) {
  const k = ownKpmValue(ownKpm);
  if (!Number.isFinite(k)) return NaN;
  if (k > SPEED_BAND_HIGH) return SPEED_FAST_K * Math.pow(Math.log2(k / SPEED_BAND_HIGH), SPEED_EXP);
  if (k >= SPEED_BAND_LOW) return 0;
  if (adj == null || adj === "") return NaN;
  const a = +adj;
  if (!Number.isFinite(a)) return NaN;
  if (a <= 0) return 0;
  return a * (speedSlowFactor(k) - 1);
}

/**
 * ⚡ ivi: 🎯🎈 ivi (adj) + speedAdjustment(ownKpm, adj). NaN when an input is
 * missing or ownKpm ≤ 0.
 */
export function speedAdjustedIvi(adj, ownKpm) {
  if (adj == null || adj === "") return NaN;
  const a = +adj;
  const d = speedAdjustment(ownKpm, a);
  if (!Number.isFinite(a) || !Number.isFinite(d)) return NaN;
  return a + d;
}

export function sliceAt(rows, cut) {
  const sl = (rows || []).filter((r) => (r.kpm || 0) >= cut);
  const { kills, deaths, kd } = pooled(sl);
  return { kd, kills, deaths, n: sl.length };
}

/** COI = RF / 0.6; soft player ≈ 1. */
export function combatOutput(rf) {
  return rf && rf === rf ? rf / RF_SOFT : NaN;
}

/** Experimental: 0.30 × (1 + ln(1+RF)) as percent. */
export function projectedMech(rf) {
  if (rf == null || rf !== rf || rf < 0) return NaN;
  return 100.0 * 0.3 * (1.0 + Math.log(1.0 + rf));
}

/**
 * Full-curve pressure slope: death-weighted linear regression of projected
 * K/D vs enemy KPM across the plotted curve (deaths > 0, kpm ≤ X_MAX).
 */
export function curveSlope(p) {
  let curve = Array.isArray(p.curve) ? p.curve : [];
  if (curve.length < 4 && Array.isArray(p.rows) && p.rows.length) {
    curve = kpmCurve(p.rows);
  }
  const pts = curve.filter(
    (pt) =>
      (pt.deaths || 0) > 0 &&
      isFiniteNum(pt.kd) &&
      isFiniteNum(pt.kpm) &&
      +pt.kpm <= X_MAX + 1e-9
  );
  if (pts.length < 4) return NaN;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of pts) {
    const w = Math.max(+pt.deaths || 1, 1);
    const x = +pt.kpm;
    const y = +pt.kd;
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  const den = sw * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return NaN;
  return (sw * sxy - sx * sy) / den;
}

/** @deprecated alias — prefer curveSlope */
export function slope2575(p) {
  return curveSlope(p);
}

/** LionHeart = Activity × (shifted slope)^1.5 */
export function pressureVolume(activity, slope) {
  if (activity !== activity || slope !== slope) return NaN;
  const shifted = Math.max(slope - SLOPE_FLOOR + SLOPE_EPS, SLOPE_EPS);
  return activity * Math.pow(shifted, 1.5);
}

/** Prefer player.ivi; fall back to acc × hsr (IvI-style). */
export function resolveIvi(p) {
  if (p.ivi != null && isFiniteNum(+p.ivi)) return +p.ivi;
  const acc = p.acc != null ? +p.acc : NaN;
  const hsr = p.hsr != null ? +p.hsr : NaN;
  if (isFiniteNum(acc) && isFiniteNum(hsr)) return acc * hsr;
  return NaN;
}

/**
 * Lightweight death_mix metrics at inflation cutoff INFLATION_KPM (0.5).
 * inflation = global_kd / KD among rows with enemy kpm ≥ cutoff.
 */
export function deathMixLite(p, cut = INFLATION_KPM) {
  const { kd: kdCut, deaths: dCut, n: nCut } = sliceAt(p.rows || [], cut);
  const gkd = +p.global_kd || 0;
  const inflation = isFiniteNum(kdCut) && kdCut > 0.05 ? gkd / kdCut : NaN;
  return {
    kd05: kdCut,
    d05: dCut,
    n05: nCut,
    inflation,
    cut,
  };
}


/**
 * Y-axis range for projected K/D series.
 * Always contains the true max (and min) so lines never paint above the plot.
 * Extreme farm/cheater spikes switch to log scale so the bulk stays readable.
 */
export function yScale(yvals) {
  const finite = (yvals || []).filter(isFiniteNum);
  if (!finite.length) return { lo: 0, hi: 2, log: false };
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const ordered = finite.filter((v) => v > 0).sort((a, b) => a - b);
  const mid = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 1;
  // Extreme farm spikes: log axis keeps the bulk readable while still fitting max.
  const striking = hi >= 15 && hi >= 8 * Math.max(mid, 0.25);
  if (striking) {
    const floor = ordered.length ? Math.max(0.15, ordered[0] * 0.9) : 0.15;
    return { lo: floor, hi: hi * 1.12, log: true };
  }
  // Always extend to true max so no series paints above the plot.
  const span = Math.max(hi - lo, 0.15);
  return {
    lo: Math.max(0, lo - 0.1 * span),
    hi: hi + 0.12 * span,
    log: false,
  };
}

/** True if every finite y is within [scale.lo, scale.hi] (log uses positive clamp). */
export function scaleContains(scale, yvals) {
  const finite = (yvals || []).filter(isFiniteNum);
  if (!finite.length) return true;
  for (const y of finite) {
    if (scale.log) {
      if (y > 0 && (y < scale.lo || y > scale.hi)) return false;
      if (y <= 0) continue; // non-positive skipped on log axis mapping
    } else {
      if (y < scale.lo || y > scale.hi) return false;
    }
  }
  return true;
}

/** Alias used in UI copy. */
export const lionHeart = pressureVolume;


export const Y_ZOOM_MIN = 0.25;
export const Y_ZOOM_MAX = 4;
export const Y_ZOOM_DEFAULT = 1;

/** Clamp Y zoom into [Y_ZOOM_MIN, Y_ZOOM_MAX]; invalid → default 1. */
export function clampYZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return Y_ZOOM_DEFAULT;
  return Math.min(Y_ZOOM_MAX, Math.max(Y_ZOOM_MIN, n));
}

/**
 * Apply Y zoom to an auto-fitted scale from yScale().
 * zoom = 1 → unchanged (auto fit current data)
 * zoom > 1 → zoom in (shrink Y span from lo; bottom-tier curves expand)
 * zoom < 1 → zoom out (expand Y span; extremes flatten / fit)
 * Linear and log both pin lo and scale hi.
 */
export function applyYZoom(scale, zoom) {
  const z = clampYZoom(zoom);
  const base = scale || { lo: 0, hi: 2, log: false };
  if (Math.abs(z - 1) < 1e-9) {
    return { lo: base.lo, hi: base.hi, log: !!base.log, zoom: 1 };
  }
  if (base.log) {
    const lo = Math.max(+base.lo || 1e-6, 1e-6);
    const hi = Math.max(+base.hi || lo * 1.01, lo * 1.01);
    const logLo = Math.log10(lo);
    const logHi = Math.log10(hi);
    const newHi = Math.pow(10, logLo + (logHi - logLo) / z);
    return { lo, hi: Math.max(newHi, lo * 1.01), log: true, zoom: z };
  }
  const lo = +base.lo || 0;
  const span = Math.max((+base.hi || 2) - lo, 0.05);
  return { lo, hi: lo + span / z, log: false, zoom: z };
}

/* ---------- left-anchored zoom (slider above the middle) ---------- */

/** Smallest visible X range when fully zoomed in (enemy KPM 0 → 0.25). */
export const X_ZOOM_MIN_XMAX = 0.25;

/**
 * Right edge of the X window for a zoom factor (same factor as the slider's
 * 2^value). z ≤ 1 → full range (X_MAX). z > 1 zooms into the LEFT start of the
 * graph, fast: xMax = X_MAX · 2^(−1.5·log2 z) → z=2 (slider +1) ≈ 0.71,
 * z=4 (top) = 0.25. X min always stays at 0.
 */
export function xMaxForZoom(zoom) {
  const z = clampYZoom(zoom);
  if (z <= 1) return X_MAX;
  const s = Math.log2(z);
  return Math.max(X_ZOOM_MIN_XMAX, Math.min(X_MAX, X_MAX * Math.pow(2, -1.5 * s)));
}

/**
 * Projected K/D values visible in the window [0, xMax]: every valid point
 * (deaths > 0, finite kd) with kpm ≤ xMax, plus the line's value where it
 * crosses the right edge, so Y can re-fit to just the left side of the graph.
 * @param {Array<Array<{kpm:number, kd:number, deaths:number}>>} curves
 */
export function windowYValues(curves, xMax) {
  const out = [];
  for (const curve of curves || []) {
    const pts = (curve || [])
      .filter((pt) => pt && isFiniteNum(pt.kd) && pt.deaths > 0 && isFiniteNum(pt.kpm))
      .sort((a, b) => a.kpm - b.kpm);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.kpm <= xMax + 1e-9) {
        out.push(p.kd);
        const q = pts[i + 1];
        if (q && q.kpm > xMax + 1e-9 && q.kpm > p.kpm) {
          const t = (xMax - p.kpm) / (q.kpm - p.kpm);
          out.push(p.kd + t * (q.kd - p.kd));
        }
      }
    }
  }
  return out;
}

/* ---------- Banded curve (opt-in chart view) ---------- */

/** Gaussian window width (opponent KPM) for the banded view. */
export const BAND_SIGMA = 0.2;
/** Weighted kills+deaths at/above which a banded point is fully opaque. */
export const BAND_FULL_EVENTS = 500;
/** Weighted kills+deaths below which a banded point is hidden. */
export const BAND_HIDE_EVENTS = 30;
/** Minimum line strength for a visible (not hidden) banded point. */
export const BAND_MIN_REL = 0.22;

/**
 * Banded K/D curve: for each X (same grid as kpmCurve), a Gaussian-weighted
 * pooled K/D against opponents whose KPM is NEAR X (σ = BAND_SIGMA), instead
 * of the cumulative "everyone at or above X".
 * kills/deaths are the weighted sums; events = kills + deaths; n = Σ weights
 * (effective opponent count). Weighted deaths are floored at 1 for the
 * ratio so a deathless farm window can't explode (kd NaN only when no
 * weighted events at all).
 */
export function kpmBandCurve(rows, { start = 2.5, end = 0.0, step = 0.05, sigma = BAND_SIGMA } = {}) {
  const src = (rows || []).filter((r) => r && isFiniteNum(+r.kpm));
  const pts = [];
  const s = sigma > 0 ? sigma : BAND_SIGMA;
  for (let t = start; t >= end - 1e-9; t -= step) {
    const x = Math.round(t * 100) / 100;
    let k = 0, d = 0, n = 0;
    for (const r of src) {
      const z = (+r.kpm - x) / s;
      if (z > 4 || z < -4) continue;
      const w = Math.exp(-0.5 * z * z);
      k += w * (r.kills || 0);
      d += w * (r.deaths || 0);
      n += w;
    }
    const kd = k + d > 1e-9 ? k / Math.max(d, 1) : NaN;
    pts.push({ kpm: x, kd, kills: k, deaths: d, events: k + d, n });
  }
  return pts;
}

/**
 * Line strength 0..1 for a banded point from its weighted kills+deaths:
 * 0 (hidden) below BAND_HIDE_EVENTS, else clamp(events / BAND_FULL_EVENTS)
 * with a BAND_MIN_REL floor so visible points never vanish entirely.
 */
export function bandReliability(events) {
  const e = +events || 0;
  if (e < BAND_HIDE_EVENTS) return 0;
  return Math.max(BAND_MIN_REL, Math.min(1, e / BAND_FULL_EVENTS));
}
