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
  const geo = {};   // fid -> {pts: [polygon point strings], cx, cy}
  const polys = hx.map(([x, y, fid, flag]) => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
    const own = owners[String(fid)];
    const fill = own ? COLOR[own] : flag === 2 ? "var(--wg)" : "var(--neutral)";
    const ps = pts.map(([px, py]) => (x + px).toFixed(1) + "," + (y + py).toFixed(1)).join(" ");
    const g = geo[fid] || (geo[fid] = { pts: [], sx: 0, sy: 0 }); g.pts.push(ps); g.sx += x; g.sy += y;
    return `<polygon points="${ps}" fill="${fill}" data-f="${fid}"/>`;
  });
  const pad = r;
  host.innerHTML = `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" role="img" aria-label="${esc(a.zone_name)} territory map">
    <g stroke="#0b0c0e" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linejoin="round">${polys.join("")}</g><g class="hlg"></g></svg>
    <div class="legend"><span><i class="sw" style="background:var(--vs)"></i>VS</span><span><i class="sw" style="background:var(--nc)"></i>NC</span><span><i class="sw" style="background:var(--tr)"></i>TR</span><span><i class="sw" style="background:var(--neutral)"></i>neutral / unknown</span></div>
    <div class="tip" hidden></div>`;
  // Heat per base name from the commander payload (attack/defend rows), for the tooltip.
  const heat = {};
  const cmd = a.commander || (a.state && a.state.commander);
  if (cmd && cmd.factions) for (const x of Object.values(cmd.factions)) for (const e of [...((x && x.attack) || []), ...((x && x.defend) || [])]) if (e && e.name) heat[e.name] = Math.max(heat[e.name] || 0, +e.heat || 0);
  const svg = host.querySelector("svg"), tip = host.querySelector(".tip");
  cur = { svg, geo, nm, r };
  // Hex tooltip near the cursor (desktop hover, phone tap): name, owner, heat.
  const show = (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    const n = f && nm[f];
    if (!n) { tip.hidden = true; return; }
    const o = owners[f], h = heat[n.name];
    tip.innerHTML = `<b>${esc(n.name)}</b>${o ? ` · <span class="${o}">${o}</span>` : " · neutral"}${h != null ? ` · heat ${h}${h >= 40 ? " 🔥" : ""}` : ""}`;
    tip.hidden = false;
    const hr = host.getBoundingClientRect();
    const x = e.clientX - hr.left, y = e.clientY - hr.top;
    tip.style.left = Math.max(4, Math.min(x + 12, hr.width - tip.offsetWidth - 4)) + "px";
    tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + "px";
  };
  svg.addEventListener("mousemove", show);   // desktop hover
  svg.addEventListener("click", show);       // phone tap
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });
  if (hlName) highlightBase(hlName);
}

let cur = null, hlName = null;
/** Outline every hex of the base called `name` and label it (commander row hover); null clears. */
export function highlightBase(name) {
  hlName = name || null;
  if (!cur || !cur.svg.isConnected) return;
  const g = cur.svg.querySelector(".hlg");
  if (!hlName) { g.innerHTML = ""; return; }
  const fids = Object.keys(cur.nm).filter((f) => cur.nm[f].name === hlName && cur.geo[f]);
  if (!fids.length) { g.innerHTML = ""; return; }
  let sx = 0, sy = 0, k = 0;
  const polys = fids.flatMap((f) => { const q = cur.geo[f]; sx += q.sx; sy += q.sy; k += q.pts.length; return q.pts; });
  const fs = (cur.r * 1.5).toFixed(1), cx = (sx / k).toFixed(1), cy = (sy / k - cur.r * 1.6).toFixed(1);
  g.innerHTML = `<g fill="none" stroke="#fff" stroke-width="${(cur.r * 0.3).toFixed(1)}" stroke-linejoin="round">${polys.map((ps) => `<polygon points="${ps}"/>`).join("")}</g>
    <text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs}" fill="#fff" stroke="#0b0c0e" stroke-width="${(cur.r * 0.35).toFixed(1)}" paint-order="stroke" font-weight="700">${esc(hlName)}</text>`;
}
