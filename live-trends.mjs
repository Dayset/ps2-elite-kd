/**
 * 🎥 Live trends: Honu-style session charts for the live page, combined into
 * one canvas (owner 2026-10-25: KPM + K/D together, one colour per metric,
 * trend dashed). Method ported from Varunda/honu's session Trends
 * (src/view/sessionview/components/ChartTimestamp.vue for KPM,
 * ChartKillDeathRatioTrend.vue for K/D):
 *   - buckets of 30 s from session start to now;
 *   - interval = the trailing window of up to 9 buckets (4.5 min): KPM is the
 *     MEAN of the buckets' per-minute rates, K/D is the RATIO of the window's
 *     summed kills over summed deaths (deaths floored at 1, as Honu does);
 *     an idle bucket counts as 0, so only that stretch of the line goes low;
 *   - trend = the cumulative average since session start: KPM is total kills
 *     over elapsed minutes at each kill, K/D is total kills over total deaths
 *     (floored at 1) at each event.
 * Pure math (node-testable) + one canvas renderer. No DOM at import time.
 */

export const TREND_PERIOD_MS = 30000; // Honu's bucket: 30 s
export const TREND_WINDOW = 9; // trailing buckets in the interval window (9 x 30 s = 4.5 min)

/** Points { x: seconds since start, y } for the six series, plus maxX. Empty series when its guard fails (Honu: < 2 events).
 *  DPM (deaths per minute, owner 2026-10-25 experiment) mirrors KPM on deaths: same buckets, same trailing window,
 *  same cumulative trend — it shares the KPM (left) axis, since both are per-minute rates. */
export function trendSeries(kills, deaths, start, now) {
  const out = { kpmInt: [], kpmTrend: [], kdInt: [], kdTrend: [], dpmInt: [], dpmTrend: [], maxX: 0 };
  if (!Number.isFinite(start) || !Number.isFinite(now) || now <= start) return out;
  out.maxX = (now - start) / 1000;
  const ks = [...(kills || [])].filter(Number.isFinite).sort((a, b) => a - b);
  const ds = [...(deaths || [])].filter(Number.isFinite).sort((a, b) => a - b);

  // ---- intervals: one pass over the 30 s buckets, events in time order ----
  if (ks.length >= 2 || ks.length + ds.length >= 2) {
    let ki = 0, di = 0;
    const prevKpm = []; // raw per-bucket KPM rates
    const prevKd = []; // raw per-bucket { k, d }
    const prevDpm = []; // raw per-bucket DPM rates
    for (let t = start; t <= now; t += TREND_PERIOD_MS) {
      const tEnd = t + TREND_PERIOD_MS;
      let kc = 0, dc = 0;
      while (ki < ks.length && ks[ki] < tEnd) { if (ks[ki] >= t) kc++; ki++; }
      while (di < ds.length && ds[di] < tEnd) { if (ds[di] >= t) dc++; di++; }
      const x = (t - start) / 1000;
      if (ks.length >= 2) {
        if (prevKpm.length > TREND_WINDOW - 1) prevKpm.shift();
        const rate = kc / (TREND_PERIOD_MS / 60000);
        const rates = [...prevKpm, rate];
        out.kpmInt.push({ x, y: rates.reduce((a, b) => a + b, 0) / rates.length });
        prevKpm.push(rate);
      }
      if (ks.length + ds.length >= 2) {
        if (prevKd.length > TREND_WINDOW - 1) prevKd.shift();
        const sumK = prevKd.reduce((a, b) => a + b.k, 0);
        const sumD = prevKd.reduce((a, b) => a + b.d, 0);
        out.kdInt.push({ x, y: (kc + sumK) / Math.max(1, dc + sumD) });
        prevKd.push({ k: kc, d: dc });
      }
      if (ds.length >= 2) {
        if (prevDpm.length > TREND_WINDOW - 1) prevDpm.shift();
        const rate = dc / (TREND_PERIOD_MS / 60000);
        const rates = [...prevDpm, rate];
        out.dpmInt.push({ x, y: rates.reduce((a, b) => a + b, 0) / rates.length });
        prevDpm.push(rate);
      }
    }
  }

  // ---- KPM trend: cumulative kills / elapsed minutes, one point per kill ----
  if (ks.length >= 2) {
    const mins = (t) => (t - start) / 60000;
    out.kpmTrend.push({ x: (ks[0] - start) / 1000, y: 0 });
    let total = 0;
    for (const k of ks) {
      total++;
      const m = mins(k);
      if (m > 0) out.kpmTrend.push({ x: (k - start) / 1000, y: total / m });
    }
    const totalM = mins(now);
    if (totalM > 0) out.kpmTrend.push({ x: out.maxX, y: total / totalM });
  }

  // ---- K/D trend: cumulative kills / deaths (floored at 1), one point per event ----
  if (ks.length + ds.length >= 2) {
    const evs = [...ks.map((t) => ({ t, kill: true })), ...ds.map((t) => ({ t, kill: false }))].sort((a, b) => a.t - b.t);
    let k = 0, d = 0;
    out.kdTrend.push({ x: 0, y: 0 });
    for (const e of evs) {
      if (e.kill) k++; else d++;
      out.kdTrend.push({ x: (e.t - start) / 1000, y: k / Math.max(1, d) });
    }
    out.kdTrend.push({ x: out.maxX, y: k / Math.max(1, d) });
  }

  // ---- DPM trend: cumulative deaths / elapsed minutes, one point per death ----
  if (ds.length >= 2) {
    const mins = (t) => (t - start) / 60000;
    out.dpmTrend.push({ x: (ds[0] - start) / 1000, y: 0 });
    let total = 0;
    for (const d of ds) {
      total++;
      const m = mins(d);
      if (m > 0) out.dpmTrend.push({ x: (d - start) / 1000, y: total / m });
    }
    const totalM = mins(now);
    if (totalM > 0) out.dpmTrend.push({ x: out.maxX, y: total / totalM });
  }
  return out;
}

/** Line colours per theme (same grid/text tones as theme.mjs chartTheme). */
export function trendColors(light) {
  return light
    ? { kpm: "#1565c0", kd: "#c25700", dpm: "#388e3c", grid: "#d0c8ba", text: "#1c1914" }
    : { kpm: "#64b5f6", kd: "#ffb74d", dpm: "#81c784", grid: "#2a2e36", text: "#f2f0ea" };
}

const niceCeil = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

/** Skeleton frame for a session too young to draw (< 2 events): the same plot
 *  area, axes and titles as the real chart, no lines, one dim hint in the
 *  middle — so the chart's place above the feed is visible from page load
 *  instead of a gap, and nothing shifts when the first lines appear. */
export function drawTrendsSkeleton(canvas, colors, hint) {
  const ctx = canvas.getContext("2d");
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 240;
  const dpr = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const L = 8, R = 8, T = 16, B = 6, pw = w - L - R, ph = h - T - B; // owner 2026-10-25: no numbers on the chart, so no room is kept for tick labels
  if (pw <= 0 || ph <= 0) return;
  ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
  }
  ctx.font = "11px sans-serif";
  ctx.fillStyle = colors.kpm; ctx.textAlign = "left"; ctx.fillText("KPM", L, 11);
  ctx.fillStyle = colors.kd; ctx.textAlign = "right"; ctx.fillText("K/D", L + pw, 11);
  if (hint) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = colors.text; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(hint, L + pw / 2, T + ph / 2);
    ctx.globalAlpha = 1;
  }
}

/** Draw the series on a canvas (CSS-sized by the caller). Owner 2026-10-25: no
 *  numbers anywhere on the chart — gridlines + axis titles + legend only, the
 *  lines speak for themselves. Axes: per-minute rates (KPM + DPM) left, K/D right; trend dashed. */
export function drawTrends(canvas, series, colors) {
  const ctx = canvas.getContext("2d");
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 240;
  const dpr = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const L = 8, R = 8, T = 16, B = 6, pw = w - L - R, ph = h - T - B; // no tick labels to make room for
  if (pw <= 0 || ph <= 0) return;
  const maxX = series.maxX > 0 ? series.maxX : 60;
  const maxLeft = niceCeil(Math.max(0, ...series.kpmInt.map((p) => p.y), ...series.kpmTrend.map((p) => p.y), ...series.dpmInt.map((p) => p.y), ...series.dpmTrend.map((p) => p.y)));
  const maxKd = niceCeil(Math.max(0, ...series.kdInt.map((p) => p.y), ...series.kdTrend.map((p) => p.y)));
  const X = (x) => L + (x / maxX) * pw;
  const YL = (y) => T + ph - (y / maxLeft) * ph;
  const YR = (y) => T + ph - (y / maxKd) * ph;
  ctx.font = "11px sans-serif";
  // gridlines only (no numbers)
  ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
  }
  // axis titles
  ctx.fillStyle = colors.kpm; ctx.textAlign = "left"; ctx.fillText("KPM", L, 11);
  ctx.fillStyle = colors.kd; ctx.textAlign = "right"; ctx.fillText("K/D", L + pw, 11);
  // series (clipped to the plot area)
  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  const line = (pts, Y, color, dashed) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.setLineDash(dashed ? [6, 4] : []);
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(series.kpmInt, YL, colors.kpm, false);
  line(series.kpmTrend, YL, colors.kpm, true);
  line(series.dpmInt, YL, colors.dpm, false);
  line(series.dpmTrend, YL, colors.dpm, true);
  line(series.kdInt, YR, colors.kd, false);
  line(series.kdTrend, YR, colors.kd, true);
  ctx.restore();
}
