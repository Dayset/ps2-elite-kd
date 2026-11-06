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
import { simParams, compareBursts, sprayPattern, ATTACHMENTS, ADS_DEFAULT, TARGET, STANCES } from "./weapon-sim.mjs";

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
    return { fm: recoil.fm2[r[0]] || null, states: recoil.groups[r[1]] || [], pool: r[2] || 0 };
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

  const row = (lab, val) => `<li><span class="lab">${esc(lab)}</span><span>${val}</span></li>`;
  const deg = (v) => tr("wc.deg", "{v}°", { v: nf(v, 2) });
  const STATE_EN = { 0: "Standing", 1: "Crouching", 2: "Running", 3: "Sprinting", 4: "Falling (long)", 5: "Crouch walking", 6: "Jumping", 7: "Falling (short)" };
  function extra(x) {
    if (!x || !x.fm) return "";
    const f = x.fm;
    const v = f.recoil_magnitude_min === f.recoil_magnitude_max ? deg(f.recoil_magnitude_min) : `${nf(f.recoil_magnitude_min, 2)}–${deg(f.recoil_magnitude_max)}`;
    return (x.pool ? row(tr("wc.pool", "Ammo pool"), nf(x.pool)) : "")
      + row(tr("wc.recoilV", "Vertical recoil per shot"), esc(v))
      + row(tr("wc.recoilFirst", "First-shot recoil"), "×" + nf(f.recoil_first_shot_modifier, 2))
      + row(tr("wc.recoilH", "Horizontal recoil"), "±" + esc(deg(f.recoil_horizontal_max)))
      + row(tr("wc.bloom", "Bloom per shot"), esc(deg(f.cof_recoil)));
  }
  function stances(x) {
    if (!x || !x.states || !x.states.length) return "";
    const rows = x.states.map((r) => row(tr("wc.st." + r.player_state_id, STATE_EN[r.player_state_id] || "#" + r.player_state_id), esc(tr("wc.cofV", "{min} / {max}", { min: nf(r.cof_min, 2), max: nf(r.cof_max, 2) })))).join("");
    return `<details class="wc-acc"><summary>${esc(tr("wc.acc.h", "Accuracy by stance (hip cone, min / max)"))}</summary><ul class="wc-wstats">${rows}</ul><p class="wc-dim">${esc(tr("wc.accNote", "Hip-fire cone of fire from Census. Aiming-down-sights values are not in the weapon data."))}</p></details>`;
  }

  function renderCards() {
    const { ws, med, ideal } = calc;
    const best = Math.min(...med.filter((v) => v != null));
    $("wcCards").innerHTML = ws.map((w, i) => {
      const slower = slowerPct(med[i], Number.isFinite(best) ? best : null);
      const cmp = med[i] == null ? "" : slower === 0 || slower == null
        ? `<span class="good">${esc(tr("wc.fastest", "fastest"))}</span>`
        : esc(tr("wc.slower", "{pct}% slower", { pct: nf(slower, slower < 10 ? 1 : 0) }));
      const h = hitDamage(w.p, st.range);
      const x = recoilOf(w.id);
      return `<article class="wc-wcard" style="border-top-color:${color(i)}">
        <img src="assets/weapons/${w.img}.webp" alt="" width="64" height="32" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div><div class="wc-wname">${esc(w.name)}</div><div class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)}</div></div>
        <ul class="wc-wstats">
          <li><span class="lab">${esc(tr("wc.med", "Median kill at {m} m", { m: nf(st.range) }))}</span><span>${esc(fmtMs(med[i]))} ${cmp ? "· " + cmp : ""}</span></li>
          <li><span class="lab">${esc(tr("wc.ideal", "Best case (all hits)"))}</span><span>${esc(fmtMs(ideal[i]))}</span></li>
          <li><span class="lab">${esc(tr("wc.rpm", "Rounds per minute"))}</span><span>${nf(w.p.rpm)}</span></li>
          <li><span class="lab">${esc(tr("wc.mode", "Fire mode"))}</span><span>${esc(tr("wc.mode." + w.p.mode, MODE_EN[w.p.mode] || w.p.mode))}${w.p.pellets > 1 ? " · " + esc(tr("wc.pellets", "{n} pellets", { n: nf(w.p.pellets) })) : ""}</span></li>
          <li><span class="lab">${esc(tr("wc.dmg", "Damage per hit"))}</span><span>${nf(h.body)} / ${nf(h.head)}</span></li>
          <li><span class="lab">${esc(tr("wc.hsMult", "Headshot multiplier"))}</span><span>×${nf(w.p.hsMult, 2)}</span></li>
          <li><span class="lab">${esc(tr("wc.fall", "Damage falloff"))}</span><span>${w.p.dmgMin !== w.p.dmgMax && w.p.rangeMinDmg > 0 ? esc(tr("wc.fallV", "{max} → {min} ({a}–{b} m)", { max: nf(w.p.dmgMax), min: nf(w.p.dmgMin), a: nf(w.p.rangeMaxDmg), b: nf(w.p.rangeMinDmg) })) : esc(tr("wc.fallNone", "none"))}</span></li>
          <li><span class="lab">${esc(tr("wc.reload", "Reload"))}</span><span>${esc(tr("wc.s", "{s} s", { s: nf(w.p.reloadMs / 1000, 2) }))}</span></li>
          <li><span class="lab">${esc(tr("wc.reloadLong", "Long reload"))}</span><span>${esc(tr("wc.s", "{s} s", { s: nf((w.p.reloadMs + ((x && x.fm && x.fm.reload_chamber_ms) || 0)) / 1000, 2) }))}</span></li>
          <li><span class="lab">${esc(tr("wc.mag", "Magazine"))}</span><span>${nf(w.p.mag)}</span></li>${extra(x)}
        </ul>${stances(x)}</article>`;
    }).join("");
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
  const simState = { aim: "ads", stance: "crouchStill", att: {} };
  const STANCE_EN = { crouchStill: "Crouched, still", standStill: "Standing, still", crouchMove: "Crouched, moving", standMove: "Standing, moving" };
  const attsOf = (id) => {
    const ids = recoil && recoil.att && recoil.att[id];
    if (!ids || !recoil.attNames) return [];
    const keys = Object.keys(ATTACHMENTS);
    return [...new Set(ids.map((a) => keys.find((k) => k.toLowerCase() === String(recoil.attNames[a] || "").toLowerCase())).filter(Boolean))];
  };
  const burstLabel = (b) => (b === Infinity ? tr("wc.sim.hold", "hold the trigger") : b === 1 ? tr("wc.sim.tap", "single shots") : tr("wc.sim.burstN", "{n}-shot bursts", { n: nf(b) }));

  function drawSim() {
    const el = $("wcSim");
    if (!calc || !calc.ws.length) { el.innerHTML = ""; return; }
    if (!recoil) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`; return; }
    $("wcSimNote").textContent = tr("wc.sim.note", "Target at {m} m with {hp} health. No recoil control: the crosshair is never pulled back. Each style is tried 300 times.", { m: nf(st.range), hp: nf(st.hp) });
    el.innerHTML = calc.ws.map((w, i) => {
      const x = recoilOf(w.id);
      if (!x || !x.fm) return `<article class="wc-sim" style="border-top-color:${color(i)}"><b>${esc(w.name)}</b><p class="wc-dim">${esc(tr("wc.sim.none", "No recoil data for this weapon."))}</p></article>`;
      const att = (simState.att[w.id] || []).filter((n) => attsOf(w.id).includes(n));
      const P = simParams(w.p, x.fm, x.states, { stance: simState.stance, aim: simState.aim, attachments: att });
      const { rows, best } = compareBursts(P, { distance: st.range, hp: st.hp, runs: 300, seed: 1 });
      const worst = Math.max(1, ...rows.map((r) => r.median ?? 0));
      const bars = rows.map((r) => `<li class="${best && r.burst === best.burst ? "best" : ""}"><span class="lab">${esc(burstLabel(r.burst))}</span><span class="wc-bar"><i style="width:${r.median == null ? 0 : Math.max(2, r.median / worst * 100).toFixed(1)}%;background:${color(i)}"></i></span><span class="v">${r.median == null ? esc(tr("wc.never", "no kill")) : esc(fmtMs(r.median))} · ${nf(r.killRate * 100)}%</span></li>`).join("");
      const shots = sprayPattern(P, { distance: st.range, seed: 1, shots: Math.min(30, w.p.mag) });
      const S = Math.max(1, ...shots.map((s) => Math.max(Math.abs(s.x), Math.abs(s.y))) .map((v) => v * 1.1));
      const U = 75 / S, cx = 80, cy = 75;
      let svg = svgOpen(160, 180, tr("wc.sim.aria", "Where a full-magazine spray lands on the target"));
      svg += `<rect x="${cx - TARGET.halfW * U}" y="${cy - TARGET.top * U}" width="${2 * TARGET.halfW * U}" height="${(TARGET.top - TARGET.bottom) * U}" fill="var(--border)"/>`;
      svg += `<circle cx="${cx + TARGET.headX * U}" cy="${cy - TARGET.headY * U}" r="${TARGET.headR * U}" fill="var(--border)" stroke="var(--dim)"/>`;
      svg += shots.map((s) => `<circle cx="${(cx + s.x * U).toFixed(1)}" cy="${(cy - s.y * U).toFixed(1)}" r="2" fill="${color(i)}" fill-opacity="${(0.35 + 0.65 * (1 - s.i / 30)).toFixed(2)}"/>`).join("");
      svg += "</svg>";
      const head = best
        ? esc(tr("wc.sim.best", "Best: {style}, median {ms}", { style: burstLabel(best.burst), ms: fmtMs(best.median) }))
        : esc(tr("wc.sim.nobest", "Cannot kill reliably at this range with this setup"));
      const chips = attsOf(w.id).map((n) => `<label class="wc-att"><input type="checkbox" data-w="${w.id}" data-a="${esc(n)}" ${att.includes(n) ? "checked" : ""}/> ${esc(n)}</label>`).join("");
      return `<article class="wc-sim" style="border-top-color:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b><span class="good">${head}</span></div>
        <div class="wc-simbody"><ul class="wc-bars">${bars}</ul><div class="wc-spray">${svg}</div></div>${chips ? `<div class="wc-atts">${chips}</div>` : ""}</article>`;
    }).join("");
    el.querySelectorAll("input[data-w]").forEach((cb) => cb.addEventListener("change", () => {
      const id = Number(cb.dataset.w), a = cb.dataset.a, cur = new Set(simState.att[id] || []);
      cb.checked ? cur.add(a) : cur.delete(a);
      simState.att[id] = [...cur];
      drawSim();
    }));
  }
  {
    const a = $("wcSimAim"), s = $("wcSimStance");
    s.innerHTML = STANCES.map((k) => `<option value="${k}">${esc(tr("wc.sim.st." + k, STANCE_EN[k]))}</option>`).join("");
    a.addEventListener("change", () => { simState.aim = a.value; drawSim(); });
    s.addEventListener("change", () => { simState.stance = s.value; drawSim(); });
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
