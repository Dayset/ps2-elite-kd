// ⏱ Live timer + 100%-lock probability card (sits next to the Voting panel).
//
// The probability chart re-renders the published "When does the 100% win
// lock land?" histogram: 38,104 past alerts in 5-minute bins. Bin counts
// were measured off the chart image and scaled to its stated total, so
// the shape and the median (t=85) match the original.
//
// Aspect-ratio note: the old version came out stretched/squished because
// the drawing surface was sized by CSS instead of by its own coordinate
// system. This one is an SVG with a viewBox and `height: auto`, so the
// browser preserves the aspect ratio at any width — it can never squish.

// 5-minute bins, t = 0..90 min. Sum = 38,104.
const LOCK_BINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 385, 0, 64, 225, 385, 1798, 5073, 6742, 23432];
const LOCK_TOTAL = LOCK_BINS.reduce((t, n) => t + n, 0);
const LOCK_MEDIAN_T = 85;

/** Fraction of past alerts whose 100% lock had landed by minute t. */
export function lockCdf(t) {
  let n = 0;
  for (let i = 0; i < LOCK_BINS.length; i++) {
    if ((i + 1) * 5 <= t) n += LOCK_BINS[i];
    else break;
  }
  return n / LOCK_TOTAL;
}

const BLUE = "#7b8ff0", YELLOW = "#ffd166", NOW = "#ff9d5c";

function lockSvg(tNow) {
  const W = 360, H = 212, L = 34, R = 8, T = 8, B = 22;
  const pw = W - L - R, ph = H - T - B;
  const yMax = Math.max(...LOCK_BINS);
  const x = (t) => L + (Math.min(t, 90) / 90) * pw;
  const y = (v) => T + (1 - v / yMax) * ph;
  const bw = pw / LOCK_BINS.length;
  const grid = [0, 12000, 24000].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#2a2e36" stroke-width="1" stroke-dasharray="2 4"/>` +
    `<text x="${L - 5}" y="${y(v) + 4}" fill="#9a988f" font-size="10" text-anchor="end">${v / 1000}k</text>`).join("");
  const bars = LOCK_BINS.map((v, i) => {
    if (!v) return "";
    const bx = L + i * bw + 1, w = bw - 2;
    return `<rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(T + ph - y(v)).toFixed(1)}" fill="${i === LOCK_BINS.length - 1 ? YELLOW : BLUE}"><title>${i * 5}–${i * 5 + 5} min: ${v.toLocaleString()} alerts</title></rect>`;
  }).join("");
  const xt = [0, 30, 60, 90].map((m) =>
    `<text x="${x(m)}" y="${H - 6}" fill="#9a988f" font-size="10" text-anchor="middle">${m}m</text>`).join("");
  const median = `<line x1="${x(LOCK_MEDIAN_T)}" x2="${x(LOCK_MEDIAN_T)}" y1="${T}" y2="${T + ph}" stroke="${YELLOW}" stroke-width="1" stroke-dasharray="4 3"/><text x="${x(LOCK_MEDIAN_T) - 4}" y="${T + 10}" fill="${YELLOW}" font-size="10" text-anchor="end">median t=${LOCK_MEDIAN_T}</text>`;
  const t = Math.max(0, Math.min(90, tNow));
  const nowMark = `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${T + ph}" stroke="${NOW}" stroke-width="1.5"/><text x="${Math.min(x(t) + 4, W - R - 34)}" y="${T + 10}" fill="${NOW}" font-size="10">now t=${Math.round(tNow)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="When the 100% win lock landed in ${LOCK_TOTAL.toLocaleString()} past alerts">${grid}${bars}${xt}${median}${nowMark}</svg>`;
}

const fmtLeft = (s) => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Alert end (unix seconds) for the per-second ticker; 0 = no live alert.
let endsAt = 0;

/** Card HTML for a live alert; call once per render. */
export function lockCard(a, now) {
  endsAt = a.start_ts + a.dur * 60;
  const tMin = (now - a.start_ts) / 60;
  const p = lockCdf(tMin);
  return `<h2>⏱ Live timer</h2>
    <div class="locktimer"><span id="lockTimer">${fmtLeft(endsAt - now)}</span> <span class="note">left</span></div>
    ${lockSvg(tMin)}
    <div class="note">By minute ${Math.floor(tMin)}, the 100% lock had landed in <b>${(p * 100).toFixed(1)}%</b> of ${LOCK_TOTAL.toLocaleString()} past alerts (median t=${LOCK_MEDIAN_T}).</div>`;
}

/** Per-second tick: updates the countdown in place, no re-render. */
export function lockTick() {
  if (!endsAt) return;
  const el = document.getElementById("lockTimer");
  if (!el) return;
  el.textContent = fmtLeft(endsAt - Math.floor(Date.now() / 1000));
}
