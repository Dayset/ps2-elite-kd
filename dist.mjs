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
 * Each bin: { x0, x1, count, pct, cumPct, kind: "under" | "core" | "over" }
 * (cumPct = % of players with value < x1, i.e. up to the end of the bin).
 */
export function histogram(values, opts = {}) {
  const { clip = [0.01, 0.99], minBins = 12, maxBins = 40, targetBins = 30, floor = null } = opts;
  const s = sortedFinite(values);
  const n = s.length;
  const out = { n, bins: [], step: NaN, lo: NaN, hi: NaN, min: NaN, max: NaN, median: NaN, p90: NaN, p99: NaN, sorted: s };
  if (!n) return out;
  out.min = s[0];
  out.max = s[n - 1];
  out.median = quantile(s, 0.5);
  out.p90 = quantile(s, 0.9);
  out.p99 = quantile(s, 0.99);

  let a = quantile(s, clip[0]);
  let b = quantile(s, clip[1]);
  if (floor != null && a < floor) a = floor;
  if (!(b > a)) {
    // (Almost) constant data: one bin around the value.
    const w = Math.abs(a) > 0 ? Math.abs(a) * 0.1 : 1;
    a -= w / 2;
    b = a + w;
  }
  const span = b - a;
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
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
  out.lo = lo;
  out.hi = hi;

  const pct = (c) => (100 * c) / n;
  const under = lowerBound(s, lo); // values < lo
  if (under > 0) {
    out.bins.push({ x0: s[0], x1: lo, count: under, pct: pct(under), cumPct: pct(under), kind: "under" });
  }
  const nb = Math.max(1, Math.round((hi - lo) / step));
  for (let i = 0; i < nb; i++) {
    const x0 = i === 0 ? lo : cleanEdge(lo + i * step, step);
    const x1 = i === nb - 1 ? hi : cleanEdge(lo + (i + 1) * step, step);
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
