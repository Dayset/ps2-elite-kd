// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { COLOR, HEXFILE, esc, $ } from "./state.js";
import { asset, names } from "./api.js";

export async function drawMap(a) {
  const host = $("map");
  if (!host) return;
  const hm = await asset(HEXFILE[a.zone]);
  if (!hm || !hm.hexes || !hm.hexes.length) { host.innerHTML = '<div class="note">No map geometry for this continent.</div>'; return; }
  const nm = await names(a.zone);
  const owners = (a.state && a.state.owners) || {};
  const hx = hm.hexes;
  // Hex spacing and orientation from the data itself: nearest-neighbour
  // distance d; neighbours straight above/below mean flat-top hexes.
  const n = Math.min(hx.length, 400);
  let d = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dd = Math.hypot(hx[j][0] - hx[i][0], hx[j][1] - hx[i][1]);
    if (dd > 1 && dd < d) d = dd;
  }
  let flatTop = false;
  for (let i = 0; i < n && !flatTop; i++) for (let j = i + 1; j < n; j++) {
    const dx = hx[j][0] - hx[i][0], dy = hx[j][1] - hx[i][1];
    if (Math.abs(dx) < 1 && Math.abs(Math.abs(dy) - d) < 1) { flatTop = true; break; }
  }
  const r = d / Math.sqrt(3);
  const off = flatTop ? 0 : Math.PI / 6;
  const pts = [...Array(6)].map((_, k) => [r * Math.cos(off + k * Math.PI / 3), r * Math.sin(off + k * Math.PI / 3)]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const polys = hx.map(([x, y, fid, flag]) => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
    const own = owners[String(fid)];
    const fill = own ? COLOR[own] : flag === 2 ? "var(--wg)" : "var(--neutral)";
    return `<polygon points="${pts.map(([px, py]) => (x + px).toFixed(1) + "," + (y + py).toFixed(1)).join(" ")}" fill="${fill}" data-f="${fid}"/>`;
  });
  const pad = r;
  host.innerHTML = `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" role="img" aria-label="${esc(a.zone_name)} territory map">
    <g stroke="#0b0c0e" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linejoin="round">${polys.join("")}</g></svg>
    <div class="legend"><span><i class="sw" style="background:var(--vs)"></i>VS</span><span><i class="sw" style="background:var(--nc)"></i>NC</span><span><i class="sw" style="background:var(--tr)"></i>TR</span><span><i class="sw" style="background:var(--neutral)"></i>neutral / unknown</span><span id="hover"></span></div>`;
  const hov = host.querySelector("#hover");
  const show = (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    const n = nm[f]; const o = owners[f];
    hov.innerHTML = n ? `<b>${esc(n.name)}</b>${o ? ` · <span class="${o}">${o}</span>` : ""}` : "";
  };
  const svg = host.querySelector("svg");
  svg.addEventListener("mousemove", show);   // desktop hover
  svg.addEventListener("click", show);       // phone tap
}
