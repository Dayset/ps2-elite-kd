// PS2MapOracle dashboard map (split in #15; zoom/pan, lattice, heat markers, base sheet in #19).
import { S, COLOR, HEXFILE, SLUG, FACS, esc, $ } from "./state.js?v=20261018-scrub2";
import { asset, names } from "./api.js?v=20261018-scrub2";

export async function drawMap(a) {
  const host = $("map");
  if (!host) return;
  if (!host.firstChild) host.innerHTML = '<div class="sk sk-map" aria-label="Loading map"></div>';
  const hm = await asset(HEXFILE[a.zone]);
  if (!hm || !hm.hexes || !hm.hexes.length) { host.innerHTML = '<div class="note">No map geometry for this continent.</div>'; return; }
  const nm = await names(a.zone);
  const links = (await asset(SLUG[a.zone] + "_links.json")) || [];
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
  const geo = {};   // fid -> {pts: [polygon point strings], sx, sy (sums for the centroid), wg}
  const polys = hx.map(([x, y, fid, flag]) => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
    const own = owners[String(fid)];
    // #19: neutral / unknown hatched instead of flat grey; warpgates get their own outline below.
    const fill = own ? COLOR[own] : flag === 2 ? "var(--wg)" : "url(#hatch)";
    const ps = pts.map(([px, py]) => (x + px).toFixed(1) + "," + (y + py).toFixed(1)).join(" ");
    const g = geo[fid] || (geo[fid] = { pts: [], sx: 0, sy: 0, wg: false }); g.pts.push(ps); g.sx += x; g.sy += y; if (flag === 2) g.wg = true;
    return `<polygon points="${ps}" fill="${fill}" data-f="${fid}"${flag === 2 ? ' data-w="1"' : ""}/>`;
  });
  const cen = (f) => { const g = geo[f]; return g && [g.sx / g.pts.length, g.sy / g.pts.length]; };
  // Commander payload: heat / freezing / lines per base name.
  const info = {};
  const cmd = a.commander || (a.state && a.state.commander);
  const add = (name, e, line) => { const o = info[name] || (info[name] = { heat: 0, freezing: false, cut: false, lines: [] }); o.heat = Math.max(o.heat, +e.heat || 0); o.freezing = o.freezing || !!e.freezing; o.cut = o.cut || !!e.cut_off; o.lines.push(line); };
  if (cmd && cmd.factions) for (const f of FACS) {
    const x = cmd.factions[f]; if (!x) continue;
    for (const e of x.attack || []) if (e && e.name) add(e.name, e, `<span class="${f}">${f}</span> attack → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> +${esc(e.win_gain ?? "")}%`);
    for (const e of x.defend || []) if (e && e.name) add(e.name, e, `<span class="${f}">${f}</span> defend vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> −${esc(e.win_drop ?? "")}%${e.cuts ? ` · losing it cuts off ${e.cuts} of ours ✂️` : ""}`);
  }
  const fidsByName = {};
  for (const f of Object.keys(geo)) { const n = nm[f]; if (n) (fidsByName[n.name] = fidsByName[n.name] || []).push(f); }
  const baseCen = (name) => { let sx = 0, sy = 0, k = 0; for (const f of fidsByName[name] || []) { const g = geo[f]; sx += g.sx; sy += g.sy; k += g.pts.length; } return k ? [sx / k, sy / k] : null; };
  // Lattice links: thin lines between base centres (drawn over the tiles, faint, so they stay visible).
  const seen = new Set();
  const linkLines = links.map((l) => {
    const A = String(l.facility_id_a), B = String(l.facility_id_b), k = A < B ? A + "|" + B : B + "|" + A;
    if (seen.has(k)) return ""; seen.add(k);
    const p = cen(A), q = cen(B); if (!p || !q) return "";
    return `<line x1="${p[0].toFixed(0)}" y1="${p[1].toFixed(0)}" x2="${q[0].toFixed(0)}" y2="${q[1].toFixed(0)}"/>`;
  }).join("");
  const markers = Object.entries(info).map(([name, o]) => {
    const c = baseCen(name); if (!c) return "";
    const m = o.heat >= 40 ? "🔥" : o.freezing ? "🥶" : ""; if (!m) return "";
    return `<text x="${c[0].toFixed(0)}" y="${(c[1] + r * 0.6).toFixed(0)}">${m}</text>`;
  }).join("");
  // Numbered Commander orders of the selected faction (owner 2026-10-24): "1 🛡️ −5.0%" on the
  // base, full text under the same number in the Commander card.
  const orderLbl = (S.cmdOrders || []).map((o) => {
    const c = baseCen(o.base); if (!c) return "";
    return `<text x="${c[0].toFixed(0)}" y="${(c[1] - r * 1.2).toFixed(0)}"><tspan class="on">${o.n}</tspan> ${o.emoji}${esc(o.short)}</text>`;
  }).join("");
  const labels = Object.keys(fidsByName).map((name) => { const c = baseCen(name); return c ? `<text x="${c[0].toFixed(0)}" y="${(c[1] - r * 0.9).toFixed(0)}">${esc(name)}</text>` : ""; }).join("");
  const wgOutline = Object.values(geo).filter((g) => g.wg).flatMap((g) => g.pts).map((ps) => `<polygon points="${ps}"/>`).join("");
  const pad = r;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  host.innerHTML = `<svg viewBox="${vb.join(" ")}" role="img" aria-label="${esc(a.zone_name)} territory map">
    <defs><pattern id="hatch" width="${(r * 0.7).toFixed(1)}" height="${(r * 0.7).toFixed(1)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="var(--neutral)"/><line x1="0" y1="0" x2="0" y2="${(r * 0.7).toFixed(1)}" stroke="#5a5f69" stroke-width="${(r * 0.25).toFixed(1)}"/></pattern></defs>
    <g class="vp">
      <g stroke="#0b0c0e" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linejoin="round">${polys.join("")}</g>
      <g class="wgo" fill="none" stroke="#e8e6df" stroke-width="${(r * 0.18).toFixed(1)}" stroke-dasharray="${(r * 0.5).toFixed(1)} ${(r * 0.3).toFixed(1)}" pointer-events="none">${wgOutline}</g>
      <g class="links" stroke="rgba(255,255,255,.28)" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linecap="round" pointer-events="none">${linkLines}</g>
      <g class="hlg" pointer-events="none"></g>
      <g class="marks" font-size="${(r * 1.6).toFixed(1)}" text-anchor="middle" pointer-events="none">${markers}</g>
      <g class="ords" font-size="${(r * 1.5).toFixed(1)}" text-anchor="middle" fill="#fff" stroke="#0b0c0e" stroke-width="${(r * 0.45).toFixed(1)}" paint-order="stroke" font-weight="700" pointer-events="none">${orderLbl}</g>
      <g class="lbls" text-anchor="middle" fill="#fff" stroke="#0b0c0e" paint-order="stroke" font-weight="600" pointer-events="none">${labels}</g>
    </g></svg>
    <div class="legend"><span><i class="sw" style="background:var(--vs)"></i>VS</span><span><i class="sw" style="background:var(--nc)"></i>NC</span><span><i class="sw" style="background:var(--tr)"></i>TR</span><span><i class="sw hatch"></i>neutral / unknown</span><span><i class="sw wgs"></i>warpgate</span><span class="hint">1 2 3: Commander orders, full text in the AI Commander card · 🔥 hot · 🥶 cut off or almost cut · scroll/pinch to zoom, double-click to reset</span></div>
    <div class="tip" hidden></div><div class="sheet" hidden role="dialog" aria-label="Base details"></div>`;
  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), sheet = host.querySelector(".sheet");
  cur = { svg, geo, nm, r, owners };
  // ---------------------------------------------------------------- zoom / pan (#19)
  // One transform on <g class="vp">; hexes are never re-rendered while panning.
  const vp = svg.querySelector(".vp"), lbls = svg.querySelector(".lbls");
  const key = a.zone;
  if (!view || view.key !== key) view = { key, k: 1, tx: 0, ty: 0 };
  const apply = () => {
    const k = view.k;
    // keep the map inside the frame
    const minX = vb[0] + vb[2] - vb[2] * k - vb[0] * k, minY = vb[1] + vb[3] - vb[3] * k - vb[1] * k;
    view.tx = Math.min(vb[0] - vb[0] * k, Math.max(minX, view.tx));
    view.ty = Math.min(vb[1] - vb[1] * k, Math.max(minY, view.ty));
    vp.setAttribute("transform", `translate(${view.tx.toFixed(1)} ${view.ty.toFixed(1)}) scale(${k.toFixed(3)})`);
    const show = k >= 2.2;   // labels only once they are readable
    lbls.style.display = show ? "" : "none";
    if (show) { const w = svg.getBoundingClientRect().width || 600, fs = 12 * vb[2] / w / k; lbls.setAttribute("font-size", fs.toFixed(1)); lbls.setAttribute("stroke-width", (fs * 0.3).toFixed(1)); }   // ~12 px on screen
    svg.classList.toggle("zoomed", k > 1.01);
  };
  const toSvg = (cx, cy) => { const rc = svg.getBoundingClientRect(); return [vb[0] + (cx - rc.left) / rc.width * vb[2], vb[1] + (cy - rc.top) / rc.height * vb[3]]; };
  const zoomAt = (cx, cy, factor) => {
    const [sx, sy] = toSvg(cx, cy);
    const k2 = Math.max(1, Math.min(8, view.k * factor)), f = k2 / view.k;
    view.tx = sx - (sx - view.tx) * f; view.ty = sy - (sy - view.ty) * f; view.k = k2; apply();
  };
  const reset = () => { view.k = 1; view.tx = 0; view.ty = 0; apply(); };
  let raf = 0; const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  const ptrs = new Map(); let moved = 0, pinch = null, lastTap = 0;
  svg.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
    if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), k: view.k }; }
    if (view.k > 1 || ptrs.size === 2) svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const now = [e.clientX, e.clientY]; ptrs.set(e.pointerId, now);
    if (ptrs.size === 2 && pinch) {
      const [p, q] = [...ptrs.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      zoomAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (pinch.k * d / pinch.d) / view.k); moved = 99; return;
    }
    if (view.k <= 1.01) return;   // at full view a one-finger drag scrolls the page
    const rc = svg.getBoundingClientRect();
    view.tx += (now[0] - prev[0]) / rc.width * vb[2]; view.ty += (now[1] - prev[1]) / rc.height * vb[3];
    moved += Math.abs(now[0] - prev[0]) + Math.abs(now[1] - prev[1]); schedule();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  svg.addEventListener("dblclick", (e) => { e.preventDefault(); reset(); });
  // ---------------------------------------------------------------- tooltip + base sheet
  const baseOf = (e) => { const el = e.type === "click" ? document.elementFromPoint(e.clientX, e.clientY) : e.target; const f = el && el.dataset && el.dataset.f; return f && nm[f] ? { f, n: nm[f] } : null; };
  const show = (e) => {
    if (e.pointerType === "touch" || ptrs.size) return;
    const b = baseOf(e);
    if (!b) { tip.hidden = true; return; }
    const o = owners[b.f], h = info[b.n.name] && info[b.n.name].heat;
    tip.innerHTML = `<b>${esc(b.n.name)}</b>${o ? ` · <span class="${o}">${o}</span>` : " · neutral"}${h ? ` · heat ${h}${h >= 40 ? " 🔥" : ""}` : ""}`;
    tip.hidden = false;
    const hr = host.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(e.clientX - hr.left + 12, hr.width - tip.offsetWidth - 4)) + "px";
    tip.style.top = Math.max(4, e.clientY - hr.top - tip.offsetHeight - 10) + "px";
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });
  svg.addEventListener("click", (e) => {
    if (moved > 6) return;   // that was a drag
    const t = Date.now(); if (e.pointerType !== "mouse" && t - lastTap < 300) { reset(); lastTap = 0; return; } lastTap = t;
    const b = baseOf(e); if (!b) { sheet.hidden = true; return; }
    const o = owners[b.f], x = info[b.n.name];
    const km = cmd && cmd.factions ? FACS.flatMap((f) => ((cmd.factions[f] && cmd.factions[f].kingmaker) || []).filter((k) => k && k.text && k.text.includes(b.n.name)).map((k) => `<span class="${f}">${f}</span> ${esc(k.text)}`)) : [];
    const lines = [...(x ? x.lines : []), ...km];
    sheet.innerHTML = `<button type="button" class="x" aria-label="Close">✕</button><b>${esc(b.n.name)}</b>
      <div>${o ? `Owner <span class="${o}">${o}</span>` : "Neutral / unknown"}${x && x.heat ? ` · heat ${x.heat}${x.heat >= 40 ? " 🔥" : ""}` : ""}${x && x.freezing ? (x.cut ? " · 🥶 cut off from the warpgate" : " · 🥶 almost cut (supply chokepoint under attack)") : ""}</div>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : `<div class="note">No AI Commander line mentions this base.</div>`}`;
    sheet.hidden = false; tip.hidden = true;
    sheet.querySelector(".x").onclick = () => { sheet.hidden = true; };
  });
  apply();
  if (hlName) highlightBase(hlName);
  if (scrubOwners) recolorMap(scrubOwners);
}

let cur = null, hlName = null, view = null, scrubOwners = null;

/**
 * Timeline scrub: recolour the hexes in place to a past moment ({fid: "VS"|"NC"|"TR"|null});
 * null restores the current map. Heat/🥶 markers belong to the current moment, so they
 * are hidden while replaying (CSS: svg.replay .marks).
 */
export function recolorMap(owners) {
  scrubOwners = owners || null;
  if (!cur || !cur.svg.isConnected) return;
  const src = scrubOwners || cur.owners || {};
  for (const p of cur.svg.querySelectorAll("polygon[data-f]")) {
    const o = src[p.dataset.f];
    p.setAttribute("fill", o ? COLOR[o] : p.dataset.w ? "var(--wg)" : "url(#hatch)");
  }
  cur.svg.classList.toggle("replay", !!scrubOwners);
}
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
