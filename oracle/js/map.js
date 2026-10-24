// PS2MapOracle dashboard map (split in #15; zoom/pan, lattice, heat markers, base sheet in #19).
import { S, COLOR, HEXFILE, SLUG, FACS, esc, $ } from "./state.js?v=20261018-scrub2";
import { asset, names } from "./api.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";

export async function drawMap(a) {
  const host = $("map");
  if (!host) return;
  if (!host.firstChild) host.innerHTML = `<div class="sk sk-map" aria-label="${tr("or.m.loading", "Loading map")}"></div>`;
  const hm = await asset(HEXFILE[a.zone]);
  if (!hm || !hm.hexes || !hm.hexes.length) { host.innerHTML = `<div class="note">${tr("or.m.noGeo", "No map geometry for this continent.")}</div>`; return; }
  const nm = await names(a.zone);
  const links = (await asset(SLUG[a.zone] + "_links.json")) || [];
  const regs = (await asset(SLUG[a.zone] + "_regions.json")) || [];
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
    // Hexes of one base blend together (stroke = fill); the base borders below separate bases.
    return `<polygon points="${ps}" fill="${fill}" stroke="${fill.startsWith("url") ? "var(--neutral)" : fill}" data-f="${fid}"${flag === 2 ? ' data-w="1"' : ""}/>`;
  });
  const ctr = (f) => { const g = geo[f]; return g && [g.sx / g.pts.length, g.sy / g.pts.length]; };
  // Base outlines (owner 2026-10-24): a thick edge wherever two neighbouring hexes belong to
  // different bases, so each base reads as one region. Neighbour = the hex one spacing away
  // through that edge (centres looked up on a coarse grid).
  const q = d / 2, cell = new Map();
  for (const [x, y, fid] of hx) cell.set(`${Math.round(x / q)},${Math.round(y / q)}`, String(fid));
  const at = (x, y) => { const i = Math.round(x / q), j = Math.round(y / q); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const k = `${i + di},${j + dj}`; if (cell.has(k)) { const [a2, b2] = k.split(",").map(Number); if (Math.hypot(a2 * q - x, b2 * q - y) < q * 0.9) return cell.get(k); } } return null; };
  const edges = [];
  for (const [x, y, fid] of hx) for (let k = 0; k < 6; k++) {
    const ang = off + (k + 0.5) * Math.PI / 3, nb = at(x + d * Math.cos(ang), y + d * Math.sin(ang));
    if (nb === String(fid)) continue;
    if (nb !== null && nb < String(fid)) continue;   // each shared edge once
    const [p1, p2] = [pts[k], pts[(k + 1) % 6]];
    edges.push(`M${(x + p1[0]).toFixed(0)} ${(y + p1[1]).toFixed(0)}L${(x + p2[0]).toFixed(0)} ${(y + p2[1]).toFixed(0)}`);
  }
  // Point of interest per base: the facility's own location (Census) when it lies on the
  // base, else the middle of its hexes. Bigger dot for the large facilities.
  const loc = {}, typ = {};
  for (const rg of regs) { const x = +rg.location_x, y = +rg.location_y; typ[rg.facility_id] = +rg.facility_type_id; if (Number.isFinite(x) && Number.isFinite(y)) loc[rg.facility_id] = [x, y]; }
  const poi = {};
  for (const f of Object.keys(geo)) {
    const c = ctr(f), L = loc[f];
    poi[f] = L && at(L[0], L[1]) === String(f) ? L : c;
  }
  const cen = (f) => poi[f] || ctr(f);
  // Census facility types: 2 amp station, 3 bio lab, 4 tech plant, 5 large outpost, 11 containment
  // site, 12 trident (big bases with several points: big dot); 7 warpgate (ring); 9 construction
  // outpost (square); 14 / 15 / 16 capture the flag (flag); the rest small outposts (small dot).
  const BIG = new Set([2, 3, 4, 5, 11, 12]), CTF = new Set([14, 15, 16]);
  const poiDots = Object.keys(geo).map((f) => {
    const [x, y] = poi[f], t = typ[f], X = x.toFixed(0), Y = y.toFixed(0);
    if (geo[f].wg || t === 7) return `<circle cx="${X}" cy="${Y}" r="${(r * 0.9).toFixed(1)}" fill="none" stroke="#fff" stroke-width="${(r * 0.3).toFixed(1)}"/><circle cx="${X}" cy="${Y}" r="${(r * 0.35).toFixed(1)}"/>`;
    if (CTF.has(t)) { const h = r * 1.9, w = r * 1.2; return `<path d="M${(x - w / 2).toFixed(0)} ${(y + h / 2).toFixed(0)}V${(y - h / 2).toFixed(0)}l${w.toFixed(0)} ${(h * 0.22).toFixed(0)}l${(-w).toFixed(0)} ${(h * 0.22).toFixed(0)}"/>`; }
    if (t === 9) { const a = r * 0.75; return `<rect x="${(x - a / 2).toFixed(0)}" y="${(y - a / 2).toFixed(0)}" width="${a.toFixed(0)}" height="${a.toFixed(0)}" transform="rotate(45 ${X} ${Y})"/>`; }
    return `<circle cx="${X}" cy="${Y}" r="${(r * (BIG.has(t) ? 0.62 : 0.3)).toFixed(1)}"/>`;
  }).join("");
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
  const baseCen = (name) => { const fs = fidsByName[name] || []; if (fs.length === 1) return cen(fs[0]); let sx = 0, sy = 0, k = 0; for (const f of fs) { const g = geo[f]; sx += g.sx; sy += g.sy; k += g.pts.length; } return k ? [sx / k, sy / k] : null; };
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
  const liveOrders = a.status === "live" && S.cmdOnLive;
  // 🥶 pockets of the picked faction: icy dashed lines from each pocket base to its
  // chokepoint, and a ring on the chokepoint: hold it or the pocket is cut off.
  const pk = liveOrders ? S.cmdPockets || [] : [];
  const pocketSvg = pk.map((p) => {
    const cp = poi[String(p.cp_fid)]; if (!cp) return "";
    const lines = (p.fids || []).map((f) => poi[String(f)]).filter(Boolean)
      .map((q) => `<line x1="${q[0].toFixed(0)}" y1="${q[1].toFixed(0)}" x2="${cp[0].toFixed(0)}" y2="${cp[1].toFixed(0)}"/>`).join("");
    return `<g class="pk">${lines}<circle class="cpring" cx="${cp[0].toFixed(0)}" cy="${cp[1].toFixed(0)}" r="${(r * 1.1).toFixed(1)}"/></g>`;
  }).join("");
  // Labels: a yellow number badge, then a thin "−5%" (whole percent; nothing when it rounds to 0).
  // Laid out at a fixed size on screen (re-done on zoom): right of the base's point, else left,
  // below, above; if every spot hits an earlier label or base name, the badge alone.
  const ordData = (liveOrders ? S.cmdOrders || [] : []).map((o) => {
    const c = baseCen(o.base); if (!c) return null;
    const v = Math.round(parseFloat(String(o.short).replace("−", "-")) || 0);
    return { n: o.n, c, txt: v ? `${v > 0 ? "+" : "−"}${Math.abs(v)}%` : "" };
  }).filter(Boolean);
  const layoutOrds = (unit, names) => {   // unit = map units per screen px
    const fs = 13 * unit, br = 8.5 * unit, gap = 7 * unit, placed = [];
    if (names) for (const nm2 of Object.keys(fidsByName)) { const c = baseCen(nm2); if (c) { const w = nm2.length * 12 * 0.55 * unit; placed.push([c[0] - w / 2, c[1] - r * 0.9 - 9 * unit, c[0] + w / 2, c[1] - r * 0.9 + 3 * unit]); } }
    const hit = (b) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    return ordData.map((o) => {
      const w = br * 2 + (o.txt ? 4 * unit + o.txt.length * fs * 0.56 : 0), h = br * 2, [cx, cy] = o.c;
      const spots = [[cx + gap, cy - h / 2], [cx - gap - w, cy - h / 2], [cx - w / 2, cy + gap], [cx - w / 2, cy - gap - h]];
      let b = null;
      for (const [x, y] of spots) { const t = [x, y, x + w, y + h]; if (!hit(t)) { b = t; break; } }
      const solo = !b;
      if (solo) b = [cx + gap, cy - br, cx + gap + br * 2, cy + br];
      placed.push(b);
      const bx = b[0] + br, by = b[1] + br;
      return `<circle cx="${bx.toFixed(0)}" cy="${by.toFixed(0)}" r="${br.toFixed(0)}" class="ob" stroke-width="${(1.5 * unit).toFixed(1)}"/><text x="${bx.toFixed(0)}" y="${by.toFixed(0)}" class="on" font-size="${(fs * 0.85).toFixed(0)}" text-anchor="middle" dominant-baseline="central">${o.n}</text>${solo || !o.txt ? "" : `<text x="${(bx + br + 4 * unit).toFixed(0)}" y="${by.toFixed(0)}" class="ot" font-size="${fs.toFixed(0)}" stroke-width="${(2.5 * unit).toFixed(1)}" dominant-baseline="central">${o.txt}</text>`}`;
    }).join("");
  };
  const labels = Object.keys(fidsByName).map((name) => { const c = baseCen(name); return c ? `<text x="${c[0].toFixed(0)}" y="${(c[1] - r * 0.9).toFixed(0)}">${esc(name)}</text>` : ""; }).join("");
  const wgOutline = Object.values(geo).filter((g) => g.wg).flatMap((g) => g.pts).map((ps) => `<polygon points="${ps}"/>`).join("");
  const pad = r;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  host.innerHTML = `<svg viewBox="${vb.join(" ")}" role="img" aria-label="${tr("or.m.aria", "{z} territory map", { z: esc(a.zone_name) })}">
    <defs><pattern id="hatch" width="${(r * 0.7).toFixed(1)}" height="${(r * 0.7).toFixed(1)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="var(--neutral)"/><line x1="0" y1="0" x2="0" y2="${(r * 0.7).toFixed(1)}" stroke="#5a5f69" stroke-width="${(r * 0.25).toFixed(1)}"/></pattern></defs>
    <g class="vp">
      <g stroke="#0b0c0e" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linejoin="round">${polys.join("")}</g>
      <g class="wgo" fill="none" stroke="#e8e6df" stroke-width="${(r * 0.18).toFixed(1)}" stroke-dasharray="${(r * 0.5).toFixed(1)} ${(r * 0.3).toFixed(1)}" pointer-events="none">${wgOutline}</g>
      <path class="borders" d="${edges.join("")}" fill="none" stroke="#0b0c0e" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" pointer-events="none"/>
      <g class="links" stroke="rgba(255,255,255,.28)" stroke-width="${(r * 0.12).toFixed(1)}" stroke-linecap="round" pointer-events="none">${linkLines}</g>
      <g class="pockets" fill="none" stroke="#9fe3ff" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none">${pocketSvg}</g>
      <g class="pois" fill="#fff" stroke="#0b0c0e" stroke-width="${(r * 0.14).toFixed(1)}" pointer-events="none">${poiDots}</g>
      <g class="hlg" pointer-events="none"></g>
      <g class="marks" font-size="${(r * 1.6).toFixed(1)}" text-anchor="middle" pointer-events="none">${markers}</g>
      <g class="ords" pointer-events="none"></g>
      <g class="lbls" text-anchor="middle" fill="#fff" stroke="#0b0c0e" paint-order="stroke" font-weight="600" pointer-events="none">${labels}</g>
    </g></svg>
    ${liveOrders ? `<div class="ordseg" role="group" aria-label="${tr("or.m.ordersFor", "Orders for")}">${tr("or.m.ordersFor", "Orders for")} ${FACS.map((f) => `<button type="button" class="${f}${f === S.cmdOn ? " on" : ""}" aria-pressed="${f === S.cmdOn}" data-mapfac="${f}">${f}</button>`).join("")}</div>` : ""}
    <div class="legend"><span><i class="sw" style="background:var(--vs)"></i>VS</span><span><i class="sw" style="background:var(--nc)"></i>NC</span><span><i class="sw" style="background:var(--tr)"></i>TR</span><span><i class="sw hatch"></i>${tr("or.m.neutral", "neutral / unknown")}</span><span><i class="sw wgs"></i>${tr("or.m.wg", "warpgate")}</span><span><i class="sw poi"></i>${tr("or.m.outpost", "outpost")}</span><span><i class="sw poi big"></i>${tr("or.m.big", "big base")}</span><span>${tr("or.m.ctf", "⚑ capture the flag")}</span>${pk.length ? `<span><i class="sw pkring"></i>${tr("or.m.pocket", "🥶 pocket chokepoint: hold it")}</span>` : ""}<span><i class="sw poi cons"></i>${tr("or.m.cons", "construction")}</span><span class="hint">${tr("or.m.hint", "1 2 3: Commander orders, full text in the AI Commander card · 🔥 hot · 🥶 cut off or almost cut · scroll/pinch to zoom, double-click to reset")}</span></div>
    <div class="tip" hidden></div><div class="sheet" hidden role="dialog" aria-label="${tr("or.m.details", "Base details")}"></div>`;
  host.querySelectorAll("[data-mapfac]").forEach((b) => b.onclick = () => { S.cmdFac = b.dataset.mapfac; if (S.hooks.rerender) S.hooks.rerender(); });
  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), sheet = host.querySelector(".sheet");
  cur = { svg, geo, nm, r, owners };
  // ---------------------------------------------------------------- zoom / pan (#19)
  // One transform on <g class="vp">; hexes are never re-rendered while panning.
  const vp = svg.querySelector(".vp"), lbls = svg.querySelector(".lbls"), ords = svg.querySelector(".ords");
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
    if (ordData.length) { const w = svg.getBoundingClientRect().width || 600, key2 = `${k.toFixed(2)}|${w}`; if (ords.dataset.k !== key2) { ords.dataset.k = key2; ords.innerHTML = layoutOrds(vb[2] / w / k, show); } }
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
    tip.innerHTML = `<b>${esc(b.n.name)}</b>${o ? ` · <span class="${o}">${o}</span>` : ` · ${tr("or.m.neutral1", "neutral")}`}${h ? ` · ${tr("or.m.heat", "heat {n}", { n: h })}${h >= 40 ? " 🔥" : ""}` : ""}`;
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
    sheet.innerHTML = `<button type="button" class="x" aria-label="${tr("or.close", "Close")}">✕</button><b>${esc(b.n.name)}</b>
      <div>${o ? tr("or.m.owner", "Owner {f}", { f: `<span class="${o}">${o}</span>` }) : tr("or.m.neutralU", "Neutral / unknown")}${x && x.heat ? ` · ${tr("or.m.heat", "heat {n}", { n: x.heat })}${x.heat >= 40 ? " 🔥" : ""}` : ""}${x && x.freezing ? (x.cut ? ` · ${tr("or.m.cut", "🥶 cut off from the warpgate")}` : ` · ${tr("or.m.almost", "🥶 almost cut (supply chokepoint under attack)")}`) : ""}</div>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : `<div class="note">${tr("or.m.noLine", "No AI Commander line mentions this base.")}</div>`}`;
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
    const fill = o ? COLOR[o] : p.dataset.w ? "var(--wg)" : "url(#hatch)";
    p.setAttribute("fill", fill); p.setAttribute("stroke", fill.startsWith("url") ? "var(--neutral)" : fill);
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
