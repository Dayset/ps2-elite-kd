/**
 * Distribution helpers for ranks.html (📊 Distribution chart). Pure, DOM-free,
 * Node-tested. Values come from data/ranks.json.
 */

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Finite values, ascending. */
export function sortedFinite(values) {
  return (values || []).filter(fin).sort((a, b) => a - b);
}

/** Quantile q ∈ [0,1] of an ascending array (linear interpolation, like numpy default). */
export function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const pos = Math.min(1, Math.max(0, q)) * (n - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

/** Index of the first element ≥ v (binary search). */
export function lowerBound(sorted, v) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Population percentile: share of players with a strictly lower value,
 * floored to an integer (p0 = lowest … p99 = top 1%). null when v is missing.
 */
export function percentileOf(sorted, v) {
  if (!fin(v) || !sorted.length) return null;
  return Math.floor((100 * lowerBound(sorted, v)) / sorted.length);
}

/** % of players with value ≥ x ("top Y% from here"). */
export function shareAtOrAbove(sorted, x) {
  if (!sorted.length) return 0;
  return (100 * (sorted.length - lowerBound(sorted, x))) / sorted.length;
}

/** Round a raw step up to a "nice" 1 / 2 / 2.5 / 5 × 10^k. */
export function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const k = Math.floor(Math.log10(raw));
  const base = Math.pow(10, k);
  const m = raw / base;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Histogram with outlier clipping.
 *  - Core range = [p1, p99] (opts.clip), widened to "nice" bin edges.
 *  - Bin width: core span / ≈30 (Freedman–Diaconis when there are < 200
 *    players), bounded to minBins…maxBins bins, then rounded to a nice step.
 *  - Values below the core go to an underflow bin ("≤ lo"), above to an
 *    overflow bin ("≥ hi"); each only appears when it has players.
 *  - opts.floor (e.g. 0 for ⚔️ iVi): the core never starts below it, so
 *    below-scale values (< 0) land in the underflow bin.
 *  - opts.scale = "log1p" (2026-11-15, thin-graph fix): for right-skewed
 *    ≥ 0 metrics (🏃 Activity, 🦁 Brave, ☠️ K/D, 🛡️ Resist) the bins are
 *    equal on a log(1+x) scale instead of a linear one — narrow near 0,
 *    wider in the tail — so the bulk where most players live gets most of
 *    the plot instead of one 40–50% first bar and ~18 bins under 1%.
 *    Bar height stays % of players per bin (linear Y); only the X spacing
 *    is non-linear, and the chart labels it as such. log1p (not log) so 0
 *    is a valid value; metrics with negatives fall back to linear.
 *    In log1p mode out.step is the nice step in log(1+x) units, and
 *    out.digits is the decimal places for edge labels (2 — the t-step
 *    alone would round small edges to 1 decimal and collapse them).
 *  - opts.scale = "sqrt" (2026-11-17): the middle ground between linear
 *    and log1p for ⚔️ iVi — its density peaks near 150, but log1p's
 *    widening bins put the tallest count bar at ~900 (slot 85%) and leave
 *    0–400 as a ramp of stubs. sqrt bins move the peak to ~200–300
 *    (slot ~30%) with ~10 thin bars below 400, so the graph sits on the
 *    left and the tail still fits. Same equal-steps-in-t-space machinery
 *    as log1p; out.digits is 0 when the square edges are all integers.
 *  - opts.scale = "symlog" (2026-11-15): the signed twin of log1p for
 *    two-sided metrics (⚔️ iVi, 🧘 Pure) — bins are equal on a
 *    sign(x)·log(1+|x|) scale, so 0 stays 0 and the bins widen away from
 *    zero in both directions. Needed because 27% of ⚔️ iVi (11% of 🧘 Pure)
 *    is negative with real spread (p10 of negatives ≈ −1000 / −800), so a
 *    plain log1p + floor 0 would leave the whole negative tail in one ≤0
 *    bar — the tallest bar on the chart — and an empty first core bin.
 *    In symlog mode opts.floor is ignored: the core spans the negatives
 *    by design. out.step is the nice step in signed-log units, out.digits 2.
 * Each bin: { x0, x1, count, pct, cumPct, kind: "under" | "core" | "over" }
 * (cumPct = % of players with value < x1, i.e. up to the end of the bin).
 */
export function histogram(values, opts = {}) {
  const { clip = [0.01, 0.99], minBins = 12, maxBins = 40, targetBins = 30, floor = null, scale = "linear" } = opts;
  const s = sortedFinite(values);
  const n = s.length;
  const out = { n, bins: [], step: NaN, lo: NaN, hi: NaN, min: NaN, max: NaN, median: NaN, p90: NaN, p99: NaN, sorted: s, scale: "linear", digits: NaN };
  if (!n) return out;
  out.min = s[0];
  out.max = s[n - 1];
  out.median = quantile(s, 0.5);
  out.p90 = quantile(s, 0.9);
  out.p99 = quantile(s, 0.99);

  // symlog (2026-11-15): signed log1p for two-sided metrics — the floor is
  // ignored here, the core spans the negatives by design (see doc above).
  const useSym = scale === "symlog";
  let a = quantile(s, clip[0]);
  let b = quantile(s, clip[1]);
  if (floor != null && !useSym && a < floor) a = floor;
  if (!(b > a)) {
    // (Almost) constant data: one bin around the value.
    const w = Math.abs(a) > 0 ? Math.abs(a) * 0.1 : 1;
    a -= w / 2;
    b = a + w;
  }
  const span = b - a;
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
  // log1p / sqrt only for non-negative data with a real spread in t-space.
  const useLog = scale === "log1p" && a >= 0 && (floor == null || floor >= 0) && Math.log1p(b) > Math.log1p(a);
  const useSqrt = scale === "sqrt" && a >= 0 && (floor == null || floor >= 0) && Math.sqrt(b) > Math.sqrt(a);
  let edges;
  if (useSym) {
    // Same bin-count logic as log1p, carried out in signed-log space:
    // t(x) = sign(x)·log(1+|x|) is strictly increasing, 0 maps to 0, and
    // the bins widen away from zero in both directions.
    const t = (x) => Math.sign(x) * Math.log1p(Math.abs(x));
    const inv = (y) => Math.sign(y) * Math.expm1(Math.abs(y));
    const ta = t(a);
    const tb = t(b);
    const spanT = tb - ta;
    const iqrT = t(quantile(s, 0.75)) - t(quantile(s, 0.25));
    let rawT = spanT / targetBins;
    if (n < 200 && iqrT > 0) rawT = Math.max(rawT, (2 * iqrT) / Math.cbrt(n));
    rawT = Math.min(spanT / minBins, Math.max(spanT / maxBins, rawT));
    let stepT = niceStep(rawT);
    let loT = Math.floor(ta / stepT) * stepT;
    let hiT = Math.ceil(tb / stepT) * stepT;
    if (hiT <= loT) hiT = loT + stepT;
    while ((hiT - loT) / stepT > maxBins) {
      stepT = niceStep(stepT * 1.01);
      loT = Math.floor(ta / stepT) * stepT;
      hiT = Math.ceil(tb / stepT) * stepT;
    }
    const nbT = Math.max(1, Math.round((hiT - loT) / stepT));
    edges = [];
    for (let i = 0; i <= nbT; i++) {
      const e = +inv(loT + i * stepT).toPrecision(12);
      edges.push(e === 0 ? 0 : e); // never a -0 edge
    }
    out.step = stepT;
    out.scale = "symlog";
    out.digits = 2;
    out.lo = edges[0];
    out.hi = edges[edges.length - 1];
  } else if (useLog || useSqrt) {
    // Same bin-count logic as linear, carried out in t-space: log(1+x) for
    // log1p, sqrt(x) for sqrt — narrow bins near 0, wider in the tail.
    const t = useSqrt ? (x) => Math.sqrt(x) : (x) => Math.log1p(x);
    const inv = useSqrt ? (y) => y * y : (y) => Math.expm1(y);
    const ta = t(a);
    const tb = t(b);
    const spanT = tb - ta;
    const iqrT = t(quantile(s, 0.75)) - t(quantile(s, 0.25));
    let rawT = spanT / targetBins;
    if (n < 200 && iqrT > 0) rawT = Math.max(rawT, (2 * iqrT) / Math.cbrt(n));
    rawT = Math.min(spanT / minBins, Math.max(spanT / maxBins, rawT));
    let stepT = niceStep(rawT);
    let loT = Math.floor(ta / stepT) * stepT;
    if (floor != null) loT = Math.max(loT, t(floor));
    let hiT = Math.ceil(tb / stepT) * stepT;
    if (hiT <= loT) hiT = loT + stepT;
    while ((hiT - loT) / stepT > maxBins) {
      stepT = niceStep(stepT * 1.01);
      loT = Math.floor(ta / stepT) * stepT;
      if (floor != null) loT = Math.max(loT, t(floor));
      hiT = Math.ceil(tb / stepT) * stepT;
    }
    const nbT = Math.max(1, Math.round((hiT - loT) / stepT));
    edges = [];
    for (let i = 0; i <= nbT; i++) edges.push(+inv(loT + i * stepT).toPrecision(12));
    out.step = stepT;
    out.scale = useSqrt ? "sqrt" : "log1p";
    out.digits = useSqrt ? (edges.some((e) => Math.abs(e - Math.round(e)) > 1e-9) ? 2 : 0) : 2;
    out.lo = edges[0];
    out.hi = edges[edges.length - 1];
  } else {
    // ≈ targetBins bins over the core; with few players widen to Freedman–Diaconis
    // (2·IQR·n^−1/3) so bins aren't mostly empty.
    let raw = span / targetBins;
    if (n < 200 && iqr > 0) raw = Math.max(raw, (2 * iqr) / Math.cbrt(n));
    raw = Math.min(span / minBins, Math.max(span / maxBins, raw));
    let step = niceStep(raw);
    let lo = Math.floor(a / step) * step;
    if (floor != null && lo < floor) lo = floor;
    let hi = Math.ceil(b / step) * step;
    if (hi <= lo) hi = lo + step;
    lo = cleanEdge(lo, step);
    hi = cleanEdge(hi, step);
    // Nice rounding can overshoot the bin cap: coarsen until within maxBins.
    while ((hi - lo) / step > maxBins) {
      step = niceStep(step * 1.01);
      lo = Math.floor(a / step) * step;
      if (floor != null && lo < floor) lo = floor;
      hi = Math.ceil(b / step) * step;
    }
    out.step = step;
    out.scale = "linear";
    out.digits = stepDigits(step);
    out.lo = lo;
    out.hi = hi;
    const nb = Math.max(1, Math.round((hi - lo) / step));
    edges = [];
    for (let i = 0; i <= nb; i++) edges.push(i === 0 ? lo : i === nb ? hi : cleanEdge(lo + i * step, step));
  }
  const lo = out.lo;
  const hi = out.hi;

  const pct = (c) => (100 * c) / n;
  const under = lowerBound(s, lo); // values < lo
  if (under > 0) {
    out.bins.push({ x0: s[0], x1: lo, count: under, pct: pct(under), cumPct: pct(under), kind: "under" });
  }
  const nb = edges.length - 1;
  for (let i = 0; i < nb; i++) {
    const x0 = edges[i];
    const x1 = edges[i + 1];
    const iA = lowerBound(s, x0);
    // Last core bin is closed on the right ([x0, hi]); others are [x0, x1).
    const iB = i === nb - 1 ? upperBoundExclusive(s, hi) : lowerBound(s, x1);
    const c = Math.max(0, iB - iA);
    out.bins.push({ x0, x1, count: c, pct: pct(c), cumPct: pct(iB), kind: "core" });
  }
  const over = n - upperBoundExclusive(s, hi); // values > hi
  if (over > 0) {
    out.bins.push({ x0: hi, x1: s[n - 1], count: over, pct: pct(over), cumPct: 100, kind: "over" });
  }
  return out;
}

/** Snap a computed bin edge to the step grid (kills 3.9000000000000004). */
function cleanEdge(x, step) {
  const r = Math.round(x / step) * step;
  return Math.abs(r) < 1e-12 ? 0 : +r.toPrecision(12);
}

/** Index of the first element > v. */
function upperBoundExclusive(sorted, v) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Which bin index holds value v (under/over bins catch the tails). -1 if none. */
export function binIndexOf(hist, v) {
  if (!fin(v) || !hist.bins.length) return -1;
  for (let i = 0; i < hist.bins.length; i++) {
    const b = hist.bins[i];
    if (b.kind === "under" && v < hist.lo) return i;
    if (b.kind === "over" && v > hist.hi) return i;
    if (b.kind === "core") {
      const last = i === hist.bins.length - 1 || hist.bins[i + 1].kind === "over";
      if (v >= b.x0 && (v < b.x1 || (last && v <= b.x1))) return i;
    }
  }
  return -1;
}

/** Decimal places for bin edge labels given the step. */
export function stepDigits(step) {
  if (!(step > 0)) return 0;
  if (step >= 1) return Number.isInteger(step) ? 0 : 1;
  return Math.min(4, Math.ceil(-Math.log10(step) + 1e-9) + (String(step).includes("25") ? 1 : 0));
}

/**
 * Chart bar → table jump (t308u). `values` = the sort metric of each table row
 * in display order (sorted by that metric, `dir` "desc" | "asc"; rows without a
 * value — "—", thin samples — last). Returns where the bar's players start:
 *  { index, count, exact }
 *   exact: true  → rows [index, index + count) are the bar's players (contiguous);
 *   exact: false → the bar is empty (or filtered out): index = the nearest row,
 *                  i.e. where that range would begin in this order (the next
 *                  lower value for "desc", next higher for "asc"), or the last
 *                  ranked row when nothing lies beyond it; count = 0.
 *  index = -1 when no row has a value.
 */
export function binJumpTarget(values, hist, bin, dir = "desc") {
  const bi = (values || []).map((v) => binIndexOf(hist, v));
  let first = bi.indexOf(bin);
  if (first >= 0) {
    let end = first;
    while (end < bi.length && bi[end] === bin) end++;
    return { index: first, count: end - first, exact: true };
  }
  const past = dir === "asc" ? (b) => b > bin : (b) => b >= 0 && b < bin;
  first = bi.findIndex((b) => b >= 0 && past(b));
  if (first < 0) {
    for (let i = bi.length - 1; i >= 0; i--) if (bi[i] >= 0) { first = i; break; }
  }
  return { index: first, count: 0, exact: false };
}
