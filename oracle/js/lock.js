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
import { t as tr } from "../../i18n.mjs";

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
  // Compact 5:1 layout (360x72, about 1/3 the original height). Every element
  // is re-placed for this ratio - nothing is scaled down from a taller
  // drawing, so there is no squish: text stays 9px, bars keep proportions.
  const W = 360, H = 72, L = 26, R = 6, T = 10, B = 14;
  const pw = W - L - R, ph = H - T - B;
  const yMax = Math.max(...LOCK_BINS);
  const x = (t) => L + (Math.min(t, 90) / 90) * pw;
  const y = (v) => T + (1 - v / yMax) * ph;
  const bw = pw / LOCK_BINS.length;
  const grid = [12000, 24000].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#2a2e36" stroke-width="1" stroke-dasharray="2 3"/>` +
    `<text x="${L - 4}" y="${y(v) + 3}" fill="#9a988f" font-size="9" text-anchor="end">${v / 1000}k</text>`).join("") +
    `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="#2a2e36" stroke-width="1"/>`;
  const bars = LOCK_BINS.map((v, i) => {
    if (!v) return "";
    const h = Math.max(1.5, T + ph - y(v)); // near-zero bins stay visible
    const yy = T + ph - h;
    const bx = L + i * bw + 1, w = bw - 2;
    return `<rect x="${bx.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${i === LOCK_BINS.length - 1 ? YELLOW : BLUE}"><title>${tr("or.lockBin", "{a}-{b} min: {n} alerts", { a: i * 5, b: i * 5 + 5, n: v.toLocaleString() })}</title></rect>`;
  }).join("");
  const xt = [0, 30, 60, 90].map((m) =>
    `<text x="${x(m)}" y="${H - 4}" fill="#9a988f" font-size="9" text-anchor="middle">${m}m</text>`).join("");
  const mx = x(LOCK_MEDIAN_T);
  const median = `<line x1="${mx}" x2="${mx}" y1="${T}" y2="${T + ph}" stroke="${YELLOW}" stroke-width="1" stroke-dasharray="3 2"/><text x="${mx - 3}" y="${T - 1}" fill="${YELLOW}" font-size="9" text-anchor="end">${tr("or.median", "median t={n}", { n: LOCK_MEDIAN_T })}</text>`;
  const t = Math.max(0, Math.min(90, tNow));
  const nx = x(t);
  // Late in the alert the "now" label would collide with the median label -
  // the caption below already states the minute, so the line alone suffices.
  const clash = Math.abs(nx - mx) < 44;
  const nowMark = `<line x1="${nx}" x2="${nx}" y1="${T}" y2="${T + ph}" stroke="${NOW}" stroke-width="1.5"/>` +
    (clash ? "" : `<text x="${Math.min(nx + 3, W - R - 30)}" y="${T - 1}" fill="${NOW}" font-size="9">${tr("or.nowT", "now t={n}", { n: Math.round(tNow) })}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${tr("or.lockAria", "When the 100% win lock landed in {n} past alerts", { n: LOCK_TOTAL.toLocaleString() })}">${grid}${bars}${xt}${median}${nowMark}</svg>`;
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
  return `<h2 data-sec="live-timer">${tr("or.h.timer", "⏱ Live timer")}</h2>
    <div class="locktimer"><span id="lockTimer">${fmtLeft(endsAt - now)}</span> <span class="note">${tr("or.left", "left")}</span></div>
    ${lockSvg(tMin)}
    <div class="note">${tr("or.lockNote", "By minute {m}, the 100% lock had landed in {p} of {n} past alerts (median t={med}).", { m: Math.floor(tMin), p: `<b>${(p * 100).toFixed(1)}%</b>`, n: LOCK_TOTAL.toLocaleString(), med: LOCK_MEDIAN_T })}</div>`;
}

/** Per-second tick: updates the countdown in place, no re-render. */
export function lockTick() {
  if (!endsAt) return;
  const el = document.getElementById("lockTimer");
  if (!el) return;
  el.textContent = fmtLeft(endsAt - Math.floor(Date.now() / 1000));
}
