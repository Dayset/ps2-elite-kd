/**
 * weapon-compare.html: weapon comparison as graphs. Data: assets/weapons/catalog.json
 * (names, categories, factions, images) + profiles.json (fire profiles built from
 * Census by scripts/build-weapon-catalog.mjs). All maths is in weapons-model.mjs;
 * this file only reads the controls and draws plain SVG (no chart library, no
 * third-party code). Every visible text goes through tr().
 */
import { t as tr, currentLang, ready } from "./i18n.mjs";
import { paletteColor } from "./palette.mjs";
import { toProfile } from "./replay/weapons.mjs";
import {
  HP_PRESETS, hitDamage, ttkDistribution, quantileMs, idealTtk, dps, rangeAxis, ttkCurve,
  winnerStrip, slowerPct,
} from "./weapons-model.mjs";
import { METRICS, GROUPS, GROUP_EN, statValues, bestOf, rank, classBests } from "./weapon-stats.mjs";
import { simParams, compareBursts, sprayPattern, attEffects, SLOTS, slotOf, canon, ADS_DEFAULT, TARGET, STANCES } from "./weapon-sim.mjs";

export const MAX_WEAPONS = 4;
export const MAX_RANGE = 500;        // hard cap (the 500 m option); the chart shows 100 / 200 / 500, see viewMax()
export const DEFAULTS = Object.freeze({ acc: 20, hsr: 20, range: 20, hp: 1000 });
const DEFAULT_IDS = [4, 14, 20];          // NC1 Gauss Rifle, T1 Cycler, Pulsar VS1
const MODE_EN = { auto: "Automatic", semi: "Semi-auto", burst: "Burst", bolt: "Bolt action" };
const FACTION = { 0: "NS", 1: "VS", 2: "NC", 3: "TR" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString(currentLang(), { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtMs = (v) => (v == null ? tr("wc.never", "no kill") : tr("wc.ms", "{ms} ms", { ms: nf(v) }));
const fmtM = (v) => tr("wc.m", "{m} m", { m: nf(v) });

/** Parse ?w=4,14&acc=60&hsr=10&hp=500&r=20 (pure, tested). */
export function parseState(search, known = () => true) {
  const q = new URLSearchParams(search);
  const num = (k, lo, hi, d) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const ids = (q.get("w") || "").split(",").map(Number).filter((n) => Number.isInteger(n) && known(n));
  const hp = num("hp", 100, 3000, DEFAULTS.hp);
  return {
    ids: [...new Set(ids)].slice(0, MAX_WEAPONS),
    acc: Math.round(num("acc", 10, 100, DEFAULTS.acc)),
    hsr: Math.round(num("hsr", 0, 100, DEFAULTS.hsr)),
    range: Math.round(num("r", 0, MAX_RANGE, DEFAULTS.range)),
    hp: Math.round(hp),
    far: q.get("max") === "500",
    hasW: q.has("w"),
  };
}

/** Build the ?w=… query for a state (pure, tested). Defaults are left out. */
export function stateToSearch(s) {
  const q = new URLSearchParams();
  if (s.ids.length) q.set("w", s.ids.join(","));
  if (s.acc !== DEFAULTS.acc) q.set("acc", String(s.acc));
  if (s.hsr !== DEFAULTS.hsr) q.set("hsr", String(s.hsr));
  if (s.range !== DEFAULTS.range) q.set("r", String(s.range));
  if (s.hp !== DEFAULTS.hp) q.set("hp", String(s.hp));
  if (s.far) q.set("max", "500");
  const str = q.toString();
  return str ? "?" + str : "";
}

/** Longest range drawn: 100 m, 200 m when a chosen weapon still loses damage beyond 100 m (snipers), 500 m with the footer option. */
export function viewMax(profiles, far) {
  if (far) return 500;
  return profiles.some((p) => p.rangeMinDmg > 100) ? 200 : 100;
}
export const rangeStep = (max) => (max > 200 ? 5 : max > 100 ? 4 : 2);

/** Nice axis ticks from 0 to max (about n ticks). */
export function niceTicks(max, n = 5) {
  if (!(max > 0)) return [0];
  const raw = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = 0; ; v += step) {            // last tick is at or above max, so the plot always holds the data
    out.push(+v.toFixed(6));
    if (v >= max - step * 1e-6) break;
  }
  return out;
}

// ---------------------------------------------------------------- page --

if (typeof document !== "undefined" && document.getElementById("wcTtk")) boot();

async function boot() {
  await ready;
  const light = document.documentElement.getAttribute("data-theme") === "light";
  const color = (i) => paletteColor(i, light);
  let catalog, profiles;
  try {
    const [c, p] = await Promise.all([
      fetch("assets/weapons/catalog.json").then((r) => { if (!r.ok) throw new Error("catalog"); return r.json(); }),
      fetch("assets/weapons/profiles.json").then((r) => { if (!r.ok) throw new Error("profiles"); return r.json(); }),
    ]);
    catalog = c.items; profiles = p.profiles;
  } catch {
    const st = $("wcStatus");
    st.textContent = tr("wc.loadFail", "Weapon data could not be loaded.");
    st.classList.add("err");
    return;
  }
  $("wcStatus").hidden = true;
  let recoil = null;           // assets/weapons/recoil.json: optional, the rows just stay out without it
  fetch("assets/weapons/recoil.json").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.weapons) { recoil = j; if (calc) { renderCards(); drawSim(); } } }).catch(() => {});
  const recoilOf = (id) => {
    const r = recoil && recoil.weapons[id];
    if (!r) return null;
    return {
      fm: recoil.fm2[r[0]] || null, states: recoil.groups[r[1]] || [], pool: r[2] || 0,
      adsFm: (r[3] && recoil.fm2[r[3]]) || null, adsStates: (r[4] && recoil.groups[r[4]]) || [],
      handling: (recoil.handling && recoil.handling[id]) || null,
    };
  };

  // all weapons with a real, usable profile
  const weapons = new Map();
  for (const [id, tuple] of Object.entries(profiles)) {
    const item = catalog[id];
    const p = toProfile(tuple);
    if (!item || !p) continue;
    weapons.set(Number(id), { id: Number(id), name: item[0], cat: item[1], fac: item[2], img: item[3], p });
  }
  const label = (w) => `${w.name} · ${FACTION[w.fac] ?? ""} · ${w.cat}`;
  const byLabel = new Map([...weapons.values()].map((w) => [label(w).toLowerCase(), w]));
  const sorted = [...weapons.values()].sort((a, b) => a.name.localeCompare(b.name));

  const st = parseState(location.search, (id) => weapons.has(id));
  if (!st.hasW) st.ids = DEFAULT_IDS.filter((id) => weapons.has(id));
  if (!HP_PRESETS.includes(st.hp)) { /* a custom hp from the link stays valid */ }

  // category select + hp select
  const cats = [...new Set(sorted.map((w) => w.cat))].sort();
  const catSel = $("wcCat");
  const fillCats = () => {
    catSel.innerHTML = `<option value="">${esc(tr("wc.allCats", "All types"))}</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  };
  fillCats();
  const hpSel = $("wcHp");
  const hpOptions = [...new Set([...HP_PRESETS, st.hp])].sort((a, b) => a - b);
  hpSel.innerHTML = hpOptions.map((v) => `<option value="${v}">${nf(v)}</option>`).join("");
  hpSel.value = String(st.hp);
  $("wcAcc").value = st.acc; $("wcHsr").value = st.hsr; $("wcRange").value = st.range;

  const fillList = () => {
    const cat = catSel.value;
    $("wcList").innerHTML = sorted.filter((w) => !cat || w.cat === cat).map((w) => `<option value="${esc(label(w))}"></option>`).join("");
  };
  fillList();

  const msg = (text, err = false) => { const m = $("wcMsg"); m.textContent = text || ""; m.classList.toggle("err", !!err); };
  const selected = () => st.ids.map((id) => weapons.get(id)).filter(Boolean);

  function addByLabel() {
    const input = $("wcSearch");
    const raw = input.value.trim().toLowerCase();
    if (!raw) return;
    let w = byLabel.get(raw);
    if (!w) {                       // a bare name that is unique
      const hits = sorted.filter((x) => x.name.toLowerCase() === raw);
      if (hits.length === 1) w = hits[0];
    }
    if (!w) { msg(tr("wc.notFound", "No weapon with that name."), true); return; }
    if (st.ids.includes(w.id)) { input.value = ""; msg(""); return; }
    if (st.ids.length >= MAX_WEAPONS) { msg(tr("wc.max", "Four weapons at most. Remove one to add another."), true); return; }
    st.ids.push(w.id);
    input.value = ""; msg("");
    renderAll();
  }
  $("wcSearch").addEventListener("change", addByLabel);
  $("wcSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addByLabel(); } });
  $("wcSearch").addEventListener("input", () => {            // a pick from the list adds at once
    if (byLabel.has($("wcSearch").value.trim().toLowerCase())) addByLabel();
  });
  catSel.addEventListener("change", fillList);
  const onSlider = () => {
    st.acc = +$("wcAcc").value; st.hsr = +$("wcHsr").value; st.range = +$("wcRange").value; st.hp = +hpSel.value;
    renderAll();
  };
  $("wcFar").checked = st.far;
  $("wcFar").addEventListener("change", () => { st.far = $("wcFar").checked; renderAll(); });
  for (const id of ["wcAcc", "wcHsr", "wcRange", "wcHp"]) $(id).addEventListener("input", onSlider);
  window.addEventListener("resize", () => { clearTimeout(boot.rt); boot.rt = setTimeout(renderCharts, 120); });

  function renderChips() {
    $("wcChips").innerHTML = selected().map((w, i) => {
      const tip = esc(tr("wc.remove", "Click to remove {name}", { name: w.name }));
      return `<button type="button" class="wc-chip" role="listitem" data-id="${w.id}" style="border-left-color:${color(i)}" title="${tip}" aria-label="${tip}">${esc(w.name)} <span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")}</span></button>`;
    }).join("");
    for (const b of $("wcChips").querySelectorAll("button")) b.addEventListener("click", () => { st.ids = st.ids.filter((id) => id !== +b.dataset.id); msg(""); renderAll(); });
  }

  // ------------------------------------------------------------- compute --
  let calc = null;
  function compute() {
    const ws = selected();
    const maxR = viewMax(ws.map((w) => w.p), st.far);
    if (st.range > maxR) st.range = maxR;
    const xs = rangeAxis(maxR, rangeStep(maxR));
    const opt = { acc: st.acc / 100, hsr: st.hsr / 100, hp: st.hp };
    const curves = ws.map((w) => ttkCurve(w.p, xs, opt));
    const dists = ws.map((w) => ttkDistribution(w.p, { ...opt, range: st.range }));
    const med = dists.map((d) => quantileMs(d, 0.5));
    const ideal = ws.map((w) => idealTtk(w.p, { range: st.range, hp: st.hp }));
    const dp = ws.map((w) => dps(w.p, { range: st.range }));
    calc = { maxR, ws, xs, curves, dists, med, ideal, dp, winners: winnerStrip(curves) };
  }

  const deg = (v) => tr("wc.deg", "{v}°", { v: nf(v, 2) });
  const fmtUnit = (unit, v, vmax) => {
    if (v == null) return "–";
    switch (unit) {
      case "ms": return fmtMs(v);
      case "s": return tr("wc.s", "{s} s", { s: nf(v / 1000, 2) });
      case "m": return fmtM(v);
      case "x": return "×" + nf(v, 2);
      case "deg": return deg(v);
      case "cone": return tr("wc.cofV", "{min} / {max}", { min: nf(v, 2), max: vmax == null ? "–" : nf(vmax, 2) });
      case "mps": return tr("wc.mps", "{v} m/s", { v: nf(v) });
      case "degps": return tr("wc.degps", "{v}°/s", { v: nf(v, 1) });
      default: return nf(v);
    }
  };
  // best of the whole class (category), per range / hp: cached
  const classCache = new Map();
  function classBestFor(cat) {
    const key = `${cat}|${st.range}|${st.hp}|${recoil ? 1 : 0}`;
    if (!classCache.has(key)) {
      const vals = [...weapons.values()].filter((w) => w.cat === cat).map((w) => statValues({ p: w.p, rec: recoilOf(w.id), range: st.range, hp: st.hp }));
      classCache.set(key, classBests(vals));
    }
    return classCache.get(key);
  }

  function renderCards() {
    const { ws, med } = calc;
    const best = Math.min(...med.filter((v) => v != null));
    const vals = ws.map((w) => statValues({ p: w.p, rec: recoilOf(w.id), range: st.range, hp: st.hp }));
    const chosenBest = {};
    for (const m of METRICS) chosenBest[m.key] = bestOf(vals.map((v) => v[m.key]), m.dir);
    const medBest = bestOf(med, -1);
    $("wcCards").innerHTML = ws.map((w, i) => {
      const slower = slowerPct(med[i], Number.isFinite(best) ? best : null);
      const cmp = med[i] == null || ws.length < 2 ? "" : slower === 0 || slower == null
        ? esc(tr("wc.fastest", "fastest"))
        : esc(tr("wc.slower", "{pct}% slower", { pct: nf(slower, slower < 10 ? 1 : 0) }));
      const cb = classBestFor(w.cat), v = vals[i];
      let rows = `<li class="${rank(med[i], -1, medBest, null)}"><span class="lab">${esc(tr("wc.med", "Median kill at {m} m", { m: nf(st.range) }))}</span><span class="v">${esc(fmtMs(med[i]))}${cmp ? " · " + cmp : ""}</span></li>`;
      rows += `<li><span class="lab">${esc(tr("wc.mode", "Fire mode"))}</span><span class="v">${esc(tr("wc.mode." + w.p.mode, MODE_EN[w.p.mode] || w.p.mode))}${w.p.pellets > 1 ? " · " + esc(tr("wc.pellets", "{n} pellets", { n: nf(w.p.pellets) })) : ""}</span></li>`;
      for (const g of GROUPS) {
        const ms = METRICS.filter((m) => m.group === g && (v[m.key] != null || vals.some((o) => o[m.key] != null)));
        if (!ms.length) continue;
        rows += `<li class="grp">${esc(tr("wc.g." + g, GROUP_EN[g]))}</li>`;
        for (const m of ms) {
          const cls = rank(v[m.key], m.dir, chosenBest[m.key], cb[m.key]);
          const tip = cls === "gold" ? ` title="${esc(tr("wc.goldTip", "Best of all {cat}", { cat: w.cat }))}"` : cls === "good" ? ` title="${esc(tr("wc.goodTip", "Best of the chosen weapons"))}"` : "";
          rows += `<li class="${cls}"${tip}><span class="lab">${esc(tr("wc.k." + m.key, m.en))}</span><span class="v">${esc(fmtUnit(m.unit, v[m.key], v[m.key + ":max"]))}</span></li>`;
        }
      }
      const have = attsOf(w.id);
      if (SLOTS.some((sl) => have[sl])) {
        rows += `<li class="grp">${esc(tr("wc.g.att", "Attachments"))}</li>`;
        for (const sl of SLOTS) if (have[sl]) rows += `<li class="att"><span class="lab">${esc(tr("wc.sim.slot." + sl, SLOT_EN[sl]))}</span><span class="v">${have[sl].map(esc).join(", ")}</span></li>`;
      }
      return `<article class="wc-wcard" style="border-top-color:${color(i)}">
        <img src="assets/weapons/${w.img}.webp" alt="" width="64" height="32" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div><div class="wc-wname">${esc(w.name)}</div><div class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)}</div></div>
        <ul class="wc-wstats">${rows}</ul></article>`;
    }).join("") + `<p class="wc-key"><span class="good">■</span> ${esc(tr("wc.goodTip", "Best of the chosen weapons"))} <span class="gold">■</span> ${esc(tr("wc.goldKey", "Best of the whole class"))}</p>`;
  }

  // -------------------------------------------------------------- charts --
  const svgOpen = (W, H, aria) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`;
  const legend = () => `<div class="wc-legend">${calc.ws.map((w, i) => `<span><span class="sw" style="background:${color(i)}"></span>${esc(w.name)}</span>`).join("")}</div>`;
  const chartWidth = (el) => Math.max(280, Math.floor(el.clientWidth || el.parentElement.clientWidth || 600));

  function drawTtk() {
    const el = $("wcTtk");
    const { ws, xs, curves, winners, maxR } = calc;
    if (!ws.length) { el.innerHTML = ""; $("wcReadout").innerHTML = ""; return; }
    const W = chartWidth(el), H = 300, L = 60, R = 24, T = 10, STRIP = 14, B = 34 + STRIP + 16;
    const vals = curves.flat().filter((v) => v != null);
    const yMax = Math.max(100, ...vals) * 1.08;
    const yt = niceTicks(yMax, 5), yTop = yt[yt.length - 1];
    const X = (r) => L + (r / maxR) * (W - L - R);
    const Y = (v) => T + (1 - v / yTop) * (H - T - B);
    let s = svgOpen(W, H, tr("wc.ariaTtk", "Graph: time to kill by range for the chosen weapons"));
    for (const v of yt) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
    for (const r of niceTicks(maxR, 5)) s += `<line class="grid" x1="${X(r)}" x2="${X(r)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(r)}" y="${H - B + 14}" text-anchor="middle">${nf(r)}</text>`;
    s += `<text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(tr("wc.xRange", "Range (m)"))}</text>`;
    s += `<text class="ax" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(tr("wc.yMs", "Time to kill (ms)"))}</text>`;
    curves.forEach((c, i) => {
      let d = "", pen = false;
      c.forEach((v, k) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${X(xs[k]).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true;
      });
      s += `<path d="${d}" fill="none" stroke="${color(i)}" stroke-width="2" stroke-linejoin="round"/>`;
    });
    // winner strip: who kills fastest at each range
    const cw = (W - L - R) / (xs.length - 1);
    winners.forEach((w, k) => {
      const x = Math.max(L, X(xs[k]) - cw / 2), x2 = Math.min(W - R, X(xs[k]) + cw / 2);
      s += `<rect x="${x.toFixed(1)}" y="${H - B + 22}" width="${(x2 - x).toFixed(1)}" height="${STRIP - 4}" fill="${w < 0 ? "var(--border)" : color(w)}"/>`;
    });
    s += `<text class="ax" x="${L}" y="${H - B + 48}" text-anchor="start">${esc(tr("wc.winner", "Fastest at each range"))}</text>`;
    s += `<line class="mark" x1="${X(st.range)}" x2="${X(st.range)}" y1="${T}" y2="${H - B}"/><text class="ax mark-t" x="${Math.min(W - R, X(st.range) + 5)}" y="${T + 10}" ${X(st.range) > W - 70 ? 'text-anchor="end" dx="-10"' : ""}>${esc(fmtM(st.range))}</text>`;
    s += `<line class="cursor" id="wcCur" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/></svg>`;
    el.innerHTML = s + legend() + `<div class="wc-legend"><span><span class="sw" style="background:var(--border)"></span>${esc(tr("wc.tie", "tie / no kill"))}</span></div>`;
    const svg = el.querySelector("svg"), cur = el.querySelector("#wcCur"), out = $("wcReadout");
    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const x = (clientX - box.left) * (W / box.width);
      const k = Math.min(xs.length - 1, Math.max(0, Math.round(((x - L) / (W - L - R)) * (xs.length - 1))));
      const r = xs[k];
      cur.setAttribute("x1", X(r)); cur.setAttribute("x2", X(r)); cur.setAttribute("visibility", "visible");
      out.innerHTML = `<b>${esc(tr("wc.readoutAt", "At {m} m", { m: nf(r) }))}</b>` + ws.map((w, i) => `<span><span class="sw" style="background:${color(i)}"></span>${esc(w.name)}: ${esc(fmtMs(curves[i][k]))}</span>`).join("");
    };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerdown", (e) => {          // a click or tap sets the range for the other graphs and the cards
      show(e.clientX);
      const box = svg.getBoundingClientRect();
      const x = (e.clientX - box.left) * (W / box.width);
      st.range = Math.min(maxR, Math.max(0, Math.round((x - L) / (W - L - R) * maxR)));
      $("wcRange").value = st.range;
      renderAll();
    });
    svg.addEventListener("pointerleave", () => { cur.setAttribute("visibility", "hidden"); out.innerHTML = ""; });
  }

  function drawCdf() {
    const el = $("wcCdf");
    $("wcCdfNote").textContent = tr("wc.cdfNote", "At {m} m. Higher and further left is better. The dots mark the 50% point.", { m: nf(st.range) });
    const { ws, dists, med } = calc;
    if (!ws.length) { el.innerHTML = ""; return; }
    const W = chartWidth(el), H = 260, L = 60, R = 24, T = 10, B = 34;
    const reach = dists.map((d) => quantileMs(d, 0.99) ?? quantileMs(d, 0.5) ?? 0);
    const xMax = Math.max(200, ...reach) * 1.05;
    const xt = niceTicks(xMax, 6), xTop = xt[xt.length - 1];
    const X = (v) => L + (v / xTop) * (W - L - R);
    const Y = (p) => T + (1 - p) * (H - T - B);
    let s = svgOpen(W, H, tr("wc.ariaCdf", "Graph: chance of having killed by a given time"));
    for (const p of [0, 0.25, 0.5, 0.75, 1]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(p)}" y2="${Y(p)}"/><text class="ax" x="${L - 6}" y="${Y(p) + 4}" text-anchor="end">${nf(p * 100)}%</text>`;
    for (const v of xt) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(v)}" y="${H - B + 14}" text-anchor="middle">${nf(v)}</text>`;
    s += `<text class="ax" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(tr("wc.xMs", "Time (ms)"))}</text>`;
    s += `<text class="ax" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(tr("wc.yChance", "Chance killed"))}</text>`;
    dists.forEach((d, i) => {
      let path = `M${X(0)} ${Y(0)}`, prev = 0;
      d.ms.forEach((t, k) => {
        if (t > xTop) return;
        path += `L${X(t).toFixed(1)} ${Y(prev).toFixed(1)}L${X(t).toFixed(1)} ${Y(d.cdf[k]).toFixed(1)}`;
        prev = d.cdf[k];
      });
      path += `L${X(xTop).toFixed(1)} ${Y(prev).toFixed(1)}`;
      s += `<path d="${path}" fill="none" stroke="${color(i)}" stroke-width="2"/>`;
      if (med[i] != null && med[i] <= xTop) s += `<circle cx="${X(med[i]).toFixed(1)}" cy="${Y(0.5)}" r="4" fill="${color(i)}"><title>${esc(ws[i].name)}: ${esc(fmtMs(med[i]))}</title></circle>`;
    });
    el.innerHTML = s + "</svg>" + legend();
  }

  function drawDps() {
    const el = $("wcDps");
    $("wcDpsNote").textContent = tr("wc.dpsNote", "At {m} m, body hits, every pellet lands. Burst = the magazine's firing time only. Sustained = reloads counted.", { m: nf(st.range) });
    const { ws, dp } = calc;
    if (!ws.length) { el.innerHTML = ""; return; }
    const W = chartWidth(el), ROW = 16, GAP = 14, L = 4, R = 52;
    const max = Math.max(1, ...dp.flatMap((d) => [d.burst, d.sustained]));
    const H = ws.length * (2 * ROW + GAP) + 6;
    const lab = Math.min(W * 0.45, 200);
    let s = svgOpen(W, H, tr("wc.ariaDps", "Graph: damage per second of the chosen weapons"));
    ws.forEach((w, i) => {
      const y0 = 4 + i * (2 * ROW + GAP);
      s += `<text class="ax" x="${L}" y="${y0 + ROW + 4}" style="fill:var(--text)">${esc(w.name.length > 26 ? w.name.slice(0, 25) + "…" : w.name)}</text>`;
      [["burst", dp[i].burst, 1], ["sustained", dp[i].sustained, 0.55]].forEach(([k, v, op], j) => {
        const bw = Math.max(1, (v / max) * (W - lab - R - L));
        const y = y0 + j * ROW;
        s += `<rect x="${L + lab}" y="${y}" width="${bw.toFixed(1)}" height="${ROW - 3}" fill="${color(i)}" fill-opacity="${op}"><title>${esc(tr("wc." + k, k === "burst" ? "Burst" : "Sustained"))}: ${nf(v)}</title></rect>`;
        s += `<text class="val" x="${(L + lab + bw + 5).toFixed(1)}" y="${y + ROW - 5}">${nf(v)}</text>`;
      });
    });
    const key = (op, k) => `<span><span class="sw" style="background:var(--text);opacity:${op}"></span>${esc(tr("wc." + k, k === "burst" ? "Burst" : "Sustained"))}</span>`;
    el.innerHTML = s + "</svg>" + `<div class="wc-legend">${key(1, "burst")}${key(0.55, "sustained")}</div>`;
  }

  // ------------------------------------------------------ recoil simulator --
  const simState = { aim: "ads", stance: "crouchStill", att: {}, comp: 0, target: null };
  const sprayTarget = () => simState.target || (st.hsr >= 50 ? "head" : "body");   // the picture follows the headshot rate until a button is pressed
  // best median kill time per weapon of a class (no attachments), for the gold "best in class" colour; filled in slices
  const simClassCache = new Map(), simClassBusy = new Set();
  const simKey = (cat) => [cat, simState.aim, simState.stance, simState.comp, st.acc, st.hsr, st.range, st.hp].join("|");
  const simOpts = () => ({ stance: simState.stance, aim: simState.aim, comp: simState.comp / 100, acc: st.acc / 100, hsr: st.hsr / 100 });
  const bestMedian = (w, att) => {
    const x = recoilOf(w.id);
    if (!x || !x.fm) return null;
    const P = simParams(w.p, x.fm, x.states, { ...simOpts(), attachments: att, attDesc: descsOf(w.id), adsFm: x.adsFm, adsStates: x.adsStates, cat: w.cat, weaponName: w.name });
    return compareBursts(P, { distance: st.range, hp: st.hp, runs: 300, seed: 1 });
  };
  function ensureClass(cat) {
    const key = simKey(cat);
    if (simClassCache.has(key) || simClassBusy.has(key)) return;
    simClassBusy.add(key);
    const list = [...weapons.values()].filter((w) => w.cat === cat && recoilOf(w.id));
    let best = null, i = 0;
    const slice = () => {
      const stop = Math.min(list.length, i + 6);
      for (; i < stop; i++) { const b = bestMedian(list[i], []).best; if (b && (best == null || b.median < best)) best = b.median; }
      if (i < list.length) { setTimeout(slice, 0); return; }
      simClassBusy.delete(key); simClassCache.set(key, best);
      if (simKey(cat) === key || calc) drawSim();
    };
    setTimeout(slice, 0);
  }
  const STANCE_EN = { crouchStill: "Crouched, still", standStill: "Standing, still", crouchMove: "Crouched, moving", standMove: "Standing, moving" };
  // attachments the weapon can mount, by slot: { barrel: [names], rail: [...], ammo: [...] }
  const attsOf = (id) => {
    const ids = recoil && recoil.att && recoil.att[id];
    const out = {};
    if (!ids || !recoil.attNames) return out;
    for (const a of ids) {
      const name = String(recoil.attNames[a] || "").trim(), slot = slotOf(name);
      if (slot && !(out[slot] ||= []).includes(name)) out[slot].push(name);
    }
    // a part Census lists under two names (Muzzle Brake beside Compensator) is shown once
    for (const sl of Object.keys(out)) out[sl] = out[sl].filter((n) => canon(n) === n || !out[sl].includes(canon(n)));
    return out;
  };
  // name -> Census description of THIS weapon's version of the attachment (it carries the weapon's own numbers)
  const descsOf = (id) => {
    const out = {};
    for (const a of (recoil && recoil.att && recoil.att[id]) || []) { const n = String(recoil.attNames[a] || "").trim(); if (n && !out[n] && recoil.attDesc && recoil.attDesc[a]) out[n] = recoil.attDesc[a]; }
    return out;
  };
  const chosenAtt = (id) => Object.values(simState.att[id] || {}).filter(Boolean);
  const SLOT_EN = { barrel: "Barrel", rail: "Rail", ammo: "Ammo" };
  const burstLabel = (b) => (b === 1 ? tr("wc.sim.tap", "single shots") : tr("wc.sim.burstN", "{n}-shot bursts", { n: nf(b) }));

  function drawSim() {
    const el = $("wcSim");
    if (!calc || !calc.ws.length) { el.innerHTML = ""; return; }
    if (!recoil) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`; return; }
    $("wcSimNote").textContent = tr("wc.sim.note2", "Target at {m} m with {hp} health. Each shot is aimed at the head with the headshot rate, else at the body, and lands on the aim point with the accuracy (else it misses clearly); the cone and recoil come on top. Recoil compensation pulls that share of the vertical kick back, a simple pulldown. Each style is tried 300 times.", { m: nf(st.range), hp: nf(st.hp) });
    document.querySelectorAll("#wcSimTarget .wc-segbtn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.k === sprayTarget())));
    const results = calc.ws.map((w) => { const x = recoilOf(w.id); return x && x.fm ? bestMedian(w, chosenAtt(w.id)) : null; });
    const meds = results.map((r) => (r && r.best ? r.best.median : null)), rates = results.map((r) => (r && r.best ? r.best.killRate : null));
    const bestMed = bestOf(meds, -1), bestRate = bestOf(rates, 1);
    for (const cat of new Set(calc.ws.map((w) => w.cat))) ensureClass(cat);
    const cls = (v, w) => { const cb = simClassCache.get(simKey(w.cat)); return v != null && cb != null && v <= cb * (1 + 1e-9) ? "gold" : v != null && v === bestMed ? "good" : ""; };
    const sum = calc.ws.length > 1 ? `<ul class="wc-simsum">${calc.ws.map((w, i) => { const b = results[i] && results[i].best; return `<li style="border-left-color:${color(i)}"><b>${esc(w.name)}</b> <span class="${b ? cls(b.median, w) : ""}">${b ? esc(burstLabel(b.burst)) + " · " + esc(fmtMs(b.median)) : esc(tr("wc.never", "no kill"))}</span> <span class="${b && b.killRate === bestRate && calc.ws.length > 1 ? "good" : ""}">${b ? nf(b.killRate * 100) + "%" : ""}</span></li>`; }).join("")}</ul>` : "";
    el.innerHTML = sum + calc.ws.map((w, i) => {
      const x = recoilOf(w.id);
      if (!x || !x.fm) return `<article class="wc-sim" style="border-top-color:${color(i)}"><b>${esc(w.name)}</b><p class="wc-dim">${esc(tr("wc.sim.none", "No recoil data for this weapon."))}</p></article>`;
      const att = chosenAtt(w.id);
      const P = simParams(w.p, x.fm, x.states, { ...simOpts(), attachments: att, attDesc: descsOf(w.id), adsFm: x.adsFm, adsStates: x.adsStates, cat: w.cat, weaponName: w.name });
      const { rows, best } = results[i];
      const worst = Math.max(1, ...rows.map((r) => r.median ?? 0));
      const bars = rows.map((r) => `<li class="${best && r.burst === best.burst ? "best" : ""}"><span class="lab">${esc(burstLabel(r.burst))}</span><span class="wc-bar"><i style="width:${r.median == null ? 0 : Math.max(2, r.median / worst * 100).toFixed(1)}%;background:${color(i)}"></i></span><span class="v">${r.median == null ? esc(tr("wc.never", "no kill")) : esc(fmtMs(r.median))} · ${nf(r.killRate * 100)}%</span></li>`).join("");
      const shots = sprayPattern(P, { distance: st.range, seed: 1, shots: Math.min(30, w.p.mag), aimHead: sprayTarget() === "head" });
      const S = Math.max(1, ...shots.map((s) => Math.max(Math.abs(s.x), Math.abs(s.y))) .map((v) => v * 1.1));
      const U = 145 / S, cx = 150, cy = 145;
      let svg = svgOpen(300, 340, tr("wc.sim.aria", "Where a full-magazine spray lands on the target"));
      svg += `<rect x="${cx - TARGET.halfW * U}" y="${cy - TARGET.top * U}" width="${2 * TARGET.halfW * U}" height="${(TARGET.top - TARGET.bottom) * U}" fill="var(--border)"/>`;
      svg += `<circle cx="${cx + TARGET.headX * U}" cy="${cy - TARGET.headY * U}" r="${TARGET.headR * U}" fill="var(--border)" stroke="var(--dim)"/>`;
      svg += shots.map((s) => `<circle cx="${(cx + s.x * U).toFixed(1)}" cy="${(cy - s.y * U).toFixed(1)}" r="2" fill="${color(i)}" fill-opacity="${(0.35 + 0.65 * (1 - s.i / 30)).toFixed(2)}"/>`).join("");
      svg += "</svg>";
      const head = best
        ? `<span class="${cls(best.median, w)}">` + esc(tr("wc.sim.best", "Best: {style}, median {ms}", { style: burstLabel(best.burst), ms: fmtMs(best.median) })) + "</span>"
        : esc(tr("wc.sim.nobest", "Cannot kill reliably at this range with this setup"));
      const have = attsOf(w.id);
      const chips = SLOTS.filter((sl) => have[sl]).map((sl) => `<label class="wc-att"><span>${esc(tr("wc.sim.slot." + sl, SLOT_EN[sl]))}</span> <select data-w="${w.id}" data-slot="${sl}"><option value="">${esc(tr("wc.sim.noAtt", "none"))}</option>${have[sl].map((n) => `<option value="${esc(n)}" ${(simState.att[w.id] || {})[sl] === n ? "selected" : ""}>${esc(n)}${(fx => fx ? (Object.keys(fx).length ? "" : " · " + esc(tr("wc.sim.noCombat", "no effect on killing"))) : " · " + esc(tr("wc.sim.noEffect", "not modelled")))(attEffects(n, descsOf(w.id)[n], w.name, simState.aim === "hip"))}</option>`).join("")}</select></label>`).join("");
      return `<article class="wc-sim" style="border-top-color:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b><span class="wc-best">${head}</span></div>
        <div class="wc-simbody"><ul class="wc-bars">${bars}</ul><div class="wc-spray">${svg}<div class="wc-dim">${esc(tr("wc.sim.scale", "Weapon spray only, {m} m wide at {d} m", { m: nf(2 * S, 1), d: nf(st.range) }))}</div></div></div>${chips ? `<div class="wc-atts">${chips}</div>` : ""}</article>`;
    }).join("");
    el.querySelectorAll("select[data-w]").forEach((sel) => sel.addEventListener("change", () => {
      const id = Number(sel.dataset.w);
      simState.att[id] = { ...(simState.att[id] || {}), [sel.dataset.slot]: sel.value };
      drawSim();
    }));
  }
  {
    // icon buttons: aim (ADS / hip), stance (4), what the spray picture is aimed at (torso / head)
    const ico = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const stand = '<circle cx="12" cy="4.5" r="2.3"/><path d="M12 7.5v8M12 9.5l-4 4M12 9.5l4 4M12 15.5l-3 6.5M12 15.5l3 6.5"/>';
    const crouch = '<circle cx="11" cy="8" r="2.3"/><path d="M11 11l-1 5.5M11 12.5l5 1.5M10 16.5l6 1.5-1 4M10 16.5l-3 5"/>';
    const speed = '<path d="M2 8h4M1 12h5M2 16h4"/>';
    const ICONS = {
      ads: ico('<circle cx="12" cy="12" r="6.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>'),
      hip: ico('<path d="M2.5 13h12l2-2.5h5v4h-4.5l-1 4h-3l-.8-4H2.5z"/>'),
      crouchStill: ico(crouch), standStill: ico(stand),
      crouchMove: ico(crouch + speed), standMove: ico(stand + speed),
      body: ico('<circle cx="12" cy="4.5" r="2.3" opacity=".45"/><rect x="8" y="8" width="8" height="12" rx="1" fill="currentColor" fill-opacity=".35"/>'),
      head: ico('<circle cx="12" cy="6" r="3.8" fill="currentColor" fill-opacity=".35"/><rect x="8" y="12" width="8" height="9" rx="1" opacity=".45"/>'),
    };
    const seg = (id, items, get, set) => {
      const box = $(id);
      const paint = () => { box.innerHTML = items.map(([k, en, key]) => { const t = tr(key, en); return `<button type="button" role="radio" class="wc-segbtn" data-k="${k}" aria-checked="${get() === k}" aria-label="${esc(t)}" title="${esc(t)}">${ICONS[k]}<span>${esc(t)}</span></button>`; }).join(""); };
      box.addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; set(b.dataset.k); paint(); drawSim(); });
      paint();
    };
    seg("wcSimAim", [["ads", "Aiming down sights", "wc.sim.ads"], ["hip", "Hip fire", "wc.sim.hip"]], () => simState.aim, (k) => { simState.aim = k; });
    seg("wcSimStance", STANCES.map((k) => [k, STANCE_EN[k], "wc.sim.st." + k]), () => simState.stance, (k) => { simState.stance = k; });
    seg("wcSimTarget", [["body", "Torso", "wc.sim.tgtBody"], ["head", "Head", "wc.sim.tgtHead"]], () => sprayTarget(), (k) => { simState.target = k; });
    const cp = $("wcSimComp");
    cp.addEventListener("input", () => { simState.comp = +cp.value; $("wcSimCompV").textContent = nf(simState.comp) + "%"; drawSim(); });
  }

  function renderCharts() { if (!calc) return; drawTtk(); drawCdf(); drawDps(); drawSim(); }

  function renderAll() {
    $("wcAccV").textContent = nf(st.acc) + "%";
    $("wcHsrV").textContent = nf(st.hsr) + "%";
    $("wcRangeV").textContent = fmtM(st.range);
    renderChips();
    compute();
    $("wcRange").max = calc.maxR; $("wcRange").value = st.range; $("wcRangeV").textContent = fmtM(st.range);
    renderCards();
    renderCharts();
    try { history.replaceState(null, "", location.pathname + stateToSearch(st)); } catch {}
  }
  renderAll();
}
