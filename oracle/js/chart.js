// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { FACS, COLOR } from "./state.js";

export function chart(ticks, dur, width) {
  if (!ticks || ticks.length < 2) return '<div class="note">Win-chance history appears after a few minutes.</div>';
  const W = Math.max(280, Math.round(width || 560)), H = 220, L = 34, B = 22, T = 8, R = 20;
  const x = (t) => L + (Math.min(t, dur) / dur) * (W - L - R);
  const y = (p) => T + (1 - p / 100) * (H - T - B);
  const grid = [0, 25, 50, 75, 100].map((p) => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" stroke="#2a2e36" stroke-width="1"/><text x="${L - 6}" y="${y(p) + 4}" fill="#8a8882" font-size="11" text-anchor="end">${p}%</text>`).join("");
  const xt = [0, dur / 2, dur].map((m) => `<text x="${x(m)}" y="${H - 6}" fill="#8a8882" font-size="11" text-anchor="middle">${Math.round(m)}m</text>`).join("");
  const lines = FACS.map((f) => `<polyline fill="none" stroke="${COLOR[f]}" stroke-width="2.2" stroke-linejoin="round" points="${ticks.map((k) => x(k.t).toFixed(1) + "," + y(k.win[f]).toFixed(1)).join(" ")}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Win chance over time">${grid}${xt}${lines}<line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#c8c6c0" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="hoverline">Hover or tap the chart for exact numbers.</div>`;
}

// Chart hover/tap: minute + VS/NC/TR win % at the nearest tick.
export function chartHover(host, ticks, dur) {
  const svg = host.querySelector("svg"), out = host.querySelector(".hoverline");
  if (!svg || !out || !ticks || ticks.length < 2) return;
  const vb = svg.viewBox.baseVal, L = 34, R = 20, line = svg.querySelector(".cursor");
  const pick = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const sx = (e.clientX - rect.left) * vb.width / rect.width;
    const t = Math.max(0, Math.min(dur, (sx - L) / (vb.width - L - R) * dur));
    let best = ticks[0];
    for (const k of ticks) if (Math.abs(k.t - t) < Math.abs(best.t - t)) best = k;
    const bx = L + (Math.min(best.t, dur) / dur) * (vb.width - L - R);
    line.setAttribute("x1", bx); line.setAttribute("x2", bx); line.setAttribute("visibility", "visible");
    out.innerHTML = `minute ${Math.round(best.t)} · ${FACS.map((f) => `<span class="${f}">${f} ${(+best.win[f]).toFixed(1)}%</span>`).join(" · ")}`;
  };
  svg.addEventListener("pointermove", pick);
  svg.addEventListener("click", pick);
}
