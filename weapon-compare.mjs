/**
 * weapon-compare.html: weapon comparison as a stat table and graphs. Data: assets/weapons/catalog.json
 * (names, categories, factions, images), profiles.json (fire profiles), cadence.json (bursts, wind-up) and
 * recoil.json (cones, recoil, attachments), all built from Census by scripts/build-weapon-catalog.mjs.
 * The maths is in weapons-model.mjs (exact time to kill), weapon-stats.mjs (table rows) and weapon-sim.mjs
 * (recoil simulator, run in weapon-sim-worker.mjs so the page never freezes). This file reads the controls and
 * draws plain SVG (no chart library, no third-party code). Every visible text goes through tr().
 *
 * Speed (owner 2026-11-06 "page is very slow"): every control change only marks what is stale and draws once per
 * animation frame; time-to-kill curves are cached per weapon and setting; the simulator runs in a worker that
 * drops stale work, and its results are cached per weapon, attachments and settings.
 */
import { t as tr, currentLang, ready } from "./i18n.mjs";
import { paletteColor } from "./palette.mjs";
import { toProfile } from "./replay/weapons.mjs";
import {
  HP_PRESETS, ttkDistribution, quantileMs, dps, rangeAxis, ttkCurve, winnerStrip, slowerPct, withCadence,
} from "./weapons-model.mjs?v=20261106-wcr2";
import { METRICS, GROUPS, GROUP_EN, statValues, bestOf, rank, classBests } from "./weapon-stats.mjs?v=20261106-wcr2";
import { simParams, compareBursts, sprayPattern, attEffects, SLOTS, slotOf, canon, TARGET, STANCES } from "./weapon-sim.mjs?v=20261106-wcr2";

export const MAX_WEAPONS = 4;
export const MAX_RANGE = 500;        // hard cap (the 500 m option); the chart shows 100 / 200 / 500, see viewMax()
export const DEFAULTS = Object.freeze({ acc: 20, hsr: 20, range: 20, hp: 1000 });
export const SIM_RUNS = 300;
export const GHOST_SPRAYS = 4;       // extra sprays drawn faintly behind the main one, each with its own random numbers
const DEFAULT_IDS = [4, 14, 20];          // NC1 Gauss Rifle, T1 Cycler, Pulsar VS1
const MODE_EN = { auto: "Automatic", semi: "Semi-auto", burst: "Burst", bolt: "Bolt action" };
const FACTION = { 0: "NS", 1: "VS", 2: "NC", 3: "TR" };
const OPEN_KEY = "ps2-elite-kd-wc-open";
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

/** A firing style in words parts: { pulls, shots } for a burst weapon, { shots } otherwise (pure, tested). */
export function styleParts(shots, burstN = 1) {
  return burstN > 1 ? { pulls: Math.round(shots / burstN), shots } : { shots };
}

/** Fresh random seed for the spray pictures (each draw shows new sprays, owner 2026-11-06). */
export const newSeed = () => 1 + Math.floor(Math.random() * 2 ** 30);

// ---------------------------------------------------------------- page --

if (typeof document !== "undefined" && document.getElementById("wcTtk")) boot();

async function boot() {
  await ready;
  const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
  const color = (i) => paletteColor(i, isLight());
  let catalog, profiles, cadence = {};
  try {
    const get = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const [c, p, cd] = await Promise.all([
      get("assets/weapons/catalog.json"), get("assets/weapons/profiles.json"),
      get("assets/weapons/cadence.json").catch(() => null),
    ]);
    catalog = c.items; profiles = p.profiles; cadence = (cd && cd.cadence) || {};
  } catch {
    const st = $("wcStatus");
    st.textContent = tr("wc.loadFail", "Weapon data could not be loaded.");
    st.classList.add("err");
    return;
  }
  $("wcStatus").hidden = true;
  let recoil = null;           // assets/weapons/recoil.json: loaded after the first draw; the rows and the simulator wait for it
  const recoilOf = (id) => {
    const r = recoil && recoil.weapons[id];
    if (!r) return null;
    return {
      fm: recoil.fm2[r[0]] || null, states: recoil.groups[r[1]] || [], pool: r[2] || 0,
      adsFm: (r[3] && recoil.fm2[r[3]]) || null, adsStates: (r[4] && recoil.groups[r[4]]) || [],
      handling: (recoil.handling && recoil.handling[id]) || null,
    };
  };

  // all weapons with a real, usable profile (+ their firing rhythm: bursts, wind-up)
  const weapons = new Map();
  for (const [id, tuple] of Object.entries(profiles)) {
    const item = catalog[id];
    const p = withCadence(toProfile(tuple), cadence[id], item && item[0]);
    if (!item || !p) continue;
    weapons.set(Number(id), { id: Number(id), name: item[0], cat: item[1], fac: item[2], img: item[3], p });
  }
  const label = (w) => `${w.name} · ${FACTION[w.fac] ?? ""} · ${w.cat}`;
  const byLabel = new Map([...weapons.values()].map((w) => [label(w).toLowerCase(), w]));
  const sorted = [...weapons.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byCat = new Map();
  for (const w of sorted) (byCat.get(w.cat) || byCat.set(w.cat, []).get(w.cat)).push(w);

  const st = parseState(location.search, (id) => weapons.has(id));
  if (!st.hasW) st.ids = DEFAULT_IDS.filter((id) => weapons.has(id));

  // ------------------------------------------------------------ controls --
  const cats = [...byCat.keys()].sort();
  const catSel = $("wcCat"), hpSel = $("wcHp");
  const fillCats = () => {
    const v = catSel.value;
    catSel.innerHTML = `<option value="">${esc(tr("wc.allCats", "All types"))}</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = v;
  };
  const fillHp = () => {
    const opts = [...new Set([...HP_PRESETS, st.hp])].sort((a, b) => a - b);
    hpSel.innerHTML = opts.map((v) => `<option value="${v}">${nf(v)}</option>`).join("");
    hpSel.value = String(st.hp);
  };
  const fillList = () => {
    const cat = catSel.value;
    $("wcList").innerHTML = sorted.filter((w) => !cat || w.cat === cat).map((w) => `<option value="${esc(label(w))}"></option>`).join("");
  };
  fillCats(); fillHp(); fillList();
  $("wcAcc").value = st.acc; $("wcHsr").value = st.hsr; $("wcRange").value = st.range; $("wcFar").checked = st.far;

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
    simState.seed = newSeed();
    input.value = ""; msg("");
    invalidate("all");
  }
  const removeId = (id) => { st.ids = st.ids.filter((x) => x !== id); msg(""); invalidate("all"); };
  $("wcSearch").addEventListener("change", addByLabel);
  $("wcSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addByLabel(); } });
  $("wcSearch").addEventListener("input", () => { if (byLabel.has($("wcSearch").value.trim().toLowerCase())) addByLabel(); });
  catSel.addEventListener("change", fillList);
  const readControls = () => {
    st.acc = +$("wcAcc").value; st.hsr = +$("wcHsr").value; st.range = +$("wcRange").value; st.hp = +hpSel.value;
    paintLabels();
  };
  $("wcAcc").addEventListener("input", () => { readControls(); invalidate("acc"); });
  $("wcHsr").addEventListener("input", () => { readControls(); invalidate("acc"); });
  $("wcRange").addEventListener("input", () => { readControls(); invalidate("range"); });
  hpSel.addEventListener("change", () => { readControls(); invalidate("acc"); });
  $("wcFar").addEventListener("change", () => { st.far = $("wcFar").checked; invalidate("all"); });
  window.addEventListener("resize", () => { clearTimeout(boot.rt); boot.rt = setTimeout(() => invalidate("charts"), 120); });
  window.addEventListener("ps2-lang", () => { fillCats(); fillHp(); paintSeg(); invalidate("all"); });
  $("wcChips").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) removeId(+b.dataset.id); });
  $("wcCards").addEventListener("click", (e) => {
    const x = e.target.closest("button[data-rm]");
    if (x) { removeId(+x.dataset.rm); return; }
    const g = e.target.closest("button[data-g]");
    if (g) { toggleGroup(g.dataset.g); }
  });

  function paintLabels() {
    $("wcAccV").textContent = nf(st.acc) + "%";
    $("wcHsrV").textContent = nf(st.hsr) + "%";
    $("wcRangeV").textContent = fmtM(st.range);
  }

  // ---------------------------------------------------------- scheduling --
  // Controls only mark what is stale; one draw per animation frame does the work.
  const dirty = new Set();
  let frame = 0;
  function invalidate(what) {
    dirty.add(what);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function flush() {
    frame = 0;
    const all = dirty.has("all"), acc = all || dirty.has("acc"), range = acc || dirty.has("range");
    const sim = range || dirty.has("sim"), charts = range || dirty.has("charts");
    dirty.clear();
    if (all) renderChips();
    if (range || !calc) compute();
    if (range) renderTable();
    if (charts) { drawTtk(); drawCdf(); drawDps(); }
    if (sim || charts) drawSim();
    try { history.replaceState(null, "", location.pathname + stateToSearch(st)); } catch {}
  }

  function renderChips() {
    $("wcChips").innerHTML = selected().map((w, i) => {
      const tip = esc(tr("wc.remove", "Click to remove {name}", { name: w.name }));
      return `<button type="button" class="wc-chip" role="listitem" data-id="${w.id}" style="--c:${color(i)}" title="${tip}" aria-label="${tip}">`
        + `<img src="assets/weapons/${w.img}.webp" alt="" width="40" height="20" loading="lazy" onerror="this.style.visibility='hidden'" />`
        + `<span class="wc-chip-n">${esc(w.name)}</span><span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")}</span><span class="wc-x" aria-hidden="true">✕</span></button>`;
    }).join("");
  }

  // ------------------------------------------------------------- compute --
  let calc = null;
  const curveCache = new Map();
  function compute() {
    const ws = selected();
    const maxR = viewMax(ws.map((w) => w.p), st.far);
    $("wcRange").max = maxR;
    if (st.range > maxR) { st.range = maxR; paintLabels(); }
    $("wcRange").value = st.range;
    const xs = rangeAxis(maxR, rangeStep(maxR));
    const opt = { acc: st.acc / 100, hsr: st.hsr / 100, hp: st.hp };
    const okey = `${opt.acc}|${opt.hsr}|${opt.hp}|${maxR}`;
    if (curveCache.size > 200) curveCache.clear();
    const cs = ws.map((w) => {
      const k = w.id + "|" + okey;
      if (!curveCache.has(k)) curveCache.set(k, ttkCurve(w.p, xs, opt));
      return curveCache.get(k);
    });
    const dists = ws.map((w) => ttkDistribution(w.p, { ...opt, range: st.range }));
    const med = dists.map((d) => quantileMs(d, 0.5));
    const dp = ws.map((w) => dps(w.p, { range: st.range }));
    calc = { maxR, ws, xs, curves: cs, dists, med, dp, winners: winnerStrip(cs) };
  }

  // ------------------------------------------------------------ the table --
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
  // best of the whole class (category) per range / hp: cached
  const classCache = new Map();
  function classBestFor(cat) {
    const key = `${cat}|${st.range}|${st.hp}|${recoil ? 1 : 0}`;
    if (!classCache.has(key)) {
      if (classCache.size > 100) classCache.clear();
      classCache.set(key, classBests((byCat.get(cat) || []).map((w) => statValues({ p: w.p, rec: recoilOf(w.id), range: st.range, hp: st.hp }))));
    }
    return classCache.get(key);
  }
  const DEFAULT_OPEN = new Set(["kill", "damage", "magazine"]);
  let openGroups;
  try { const j = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); openGroups = new Set(Array.isArray(j) ? j : DEFAULT_OPEN); } catch { openGroups = new Set(DEFAULT_OPEN); }
  function toggleGroup(g) {
    if (openGroups.has(g)) openGroups.delete(g); else openGroups.add(g);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openGroups])); } catch {}
    const body = $("wcCards").querySelector(`tbody[data-g="${g}"]`);
    if (body) { body.classList.toggle("open", openGroups.has(g)); body.querySelector("button[data-g]").setAttribute("aria-expanded", String(openGroups.has(g))); }
  }
  const SLOT_EN = { barrel: "Barrel", rail: "Rail", ammo: "Ammo" };

  function renderTable() {
    const { ws, med } = calc;
    const box = $("wcCards");
    $("wcKey").innerHTML = ws.length ? `<span class="good">■</span> ${esc(tr("wc.goodTip", "Best of the chosen weapons"))} <span class="gold">■</span> ${esc(tr("wc.goldKey", "Best of the whole class"))}` : "";
    if (!ws.length) { box.innerHTML = `<p class="wc-dim wc-empty">${esc(tr("wc.search", "Type a weapon name…"))}</p>`; return; }
    const vals = ws.map((w) => statValues({ p: w.p, rec: recoilOf(w.id), range: st.range, hp: st.hp }));
    const chosenBest = {};
    for (const m of METRICS) chosenBest[m.key] = bestOf(vals.map((v) => v[m.key]), m.dir);
    const best = bestOf(med, -1) ?? (med.filter((v) => v != null).length ? Math.min(...med.filter((v) => v != null)) : null);
    const cbs = ws.map((w) => classBestFor(w.cat));
    const td = (cls, inner, tip) => `<td class="${cls}"${tip ? ` title="${esc(tip)}"` : ""}>${inner}</td>`;
    const row = (lab, cells, cls = "") => `<tr class="${cls}"><th scope="row" class="wc-lab">${lab}</th>${cells}</tr>`;

    let h = `<table class="ranks-table wc-table" style="--n:${ws.length}"><colgroup><col class="wc-lab-col" />${ws.map(() => "<col />").join("")}</colgroup><thead><tr><th class="wc-lab"></th>`;
    h += ws.map((w, i) => {
      const tip = esc(tr("wc.remove", "Click to remove {name}", { name: w.name }));
      return `<th scope="col" class="wc-wh" style="--c:${color(i)}"><div class="wc-whead"><img src="assets/weapons/${w.img}.webp" alt="" width="56" height="28" loading="lazy" onerror="this.style.visibility='hidden'" />`
        + `<span class="wc-wname">${esc(w.name)}</span><span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)}</span>`
        + `<button type="button" class="wc-rm" data-rm="${w.id}" title="${tip}" aria-label="${tip}">✕</button></div></th>`;
    }).join("") + "</tr></thead>";

    // headline: median kill time at the chosen range, with how much slower than the best
    h += `<tbody class="wc-top open">`;
    h += row(esc(tr("wc.med", "Median kill at {m} m", { m: nf(st.range) })), ws.map((w, i) => {
      const slower = slowerPct(med[i], best);
      const cmp = med[i] == null || ws.length < 2 || best == null ? "" : slower === 0 || slower == null
        ? tr("wc.fastest", "fastest") : tr("wc.slower", "{pct}% slower", { pct: nf(slower, slower < 10 ? 1 : 0) });
      return td(`wc-med ${rank(med[i], -1, best, null)}`, `<b>${esc(fmtMs(med[i]))}</b>${cmp ? `<span class="wc-cmp">${esc(cmp)}</span>` : ""}`);
    }).join(""), "wc-hl");
    h += row(esc(tr("wc.mode", "Fire mode")), ws.map((w) => td("", esc(tr("wc.mode." + w.p.mode, MODE_EN[w.p.mode] || w.p.mode)) + (w.p.pellets > 1 ? " · " + esc(tr("wc.pellets", "{n} pellets", { n: nf(w.p.pellets) })) : ""))).join(""));
    h += "</tbody>";

    for (const g of GROUPS) {
      const ms = METRICS.filter((m) => m.group === g && vals.some((v) => v[m.key] != null));
      if (!ms.length) continue;
      const open = openGroups.has(g);
      h += `<tbody data-g="${g}" class="${open ? "open" : ""}"><tr class="wc-grp"><th colspan="${ws.length + 1}"><button type="button" data-g="${g}" aria-expanded="${open}"><span class="wc-caret" aria-hidden="true"></span>${esc(tr("wc.g." + g, GROUP_EN[g]))}</button></th></tr>`;
      for (const m of ms) {
        h += row(esc(tr("wc.k." + m.key, m.en)), ws.map((w, i) => {
          const v = vals[i];
          const cls = rank(v[m.key], m.dir, chosenBest[m.key], cbs[i][m.key]);
          let tip = cls === "gold" ? tr("wc.goldTip", "Best of all {cat}", { cat: w.cat }) : cls === "good" ? tr("wc.goodTip", "Best of the chosen weapons") : "";
          if (m.key === "windup" && w.p.delayHand) tip = tr("wc.windupHand", "Not in Census: typed in by hand");
          return td(cls, esc(fmtUnit(m.unit, v[m.key], v[m.key + ":max"])) + (m.key === "windup" && w.p.delayHand ? " ✍️" : ""), tip);
        }).join(""));
      }
      h += "</tbody>";
    }
    const atts = ws.map((w) => attsOf(w.id));
    if (atts.some((a) => SLOTS.some((sl) => a[sl]))) {
      const open = openGroups.has("att");
      h += `<tbody data-g="att" class="${open ? "open" : ""}"><tr class="wc-grp"><th colspan="${ws.length + 1}"><button type="button" data-g="att" aria-expanded="${open}"><span class="wc-caret" aria-hidden="true"></span>${esc(tr("wc.g.att", "Attachments"))}</button></th></tr>`;
      for (const sl of SLOTS) {
        if (!atts.some((a) => a[sl])) continue;
        h += row(esc(tr("wc.sim.slot." + sl, SLOT_EN[sl])), atts.map((a) => td("wc-attv", a[sl] ? a[sl].map(esc).join(", ") : "–")).join(""));
      }
      h += "</tbody>";
    }
    box.innerHTML = h + "</table>";
  }

  // -------------------------------------------------------------- charts --
  const svgOpen = (W, H, aria) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`;
  const legend = () => `<div class="wc-legend">${calc.ws.map((w, i) => `<span><span class="sw" style="background:${color(i)}"></span>${esc(w.name)}</span>`).join("")}</div>`;
  const chartWidth = (el) => Math.max(280, Math.floor(el.clientWidth || el.parentElement.clientWidth || 600));
  const CH = 280;   // both line charts share one height, so the two panels side by side match

  function drawTtk() {
    const el = $("wcTtk");
    const { ws, xs, curves, winners, maxR } = calc;
    if (!ws.length) { el.innerHTML = ""; $("wcReadout").innerHTML = ""; return; }
    const W = chartWidth(el), H = CH, L = 56, R = 16, T = 10, STRIP = 12, B = 30 + STRIP + 18;
    const vals = curves.flat().filter((v) => v != null);
    const yMax = Math.max(100, ...vals) * 1.08;
    const yt = niceTicks(yMax, 5), yTop = yt[yt.length - 1];
    const X = (r) => L + (r / maxR) * (W - L - R);
    const Y = (v) => T + (1 - v / yTop) * (H - T - B);
    let s = svgOpen(W, H, tr("wc.ariaTtk", "Graph: time to kill by range for the chosen weapons"));
    for (const v of yt) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
    for (const r of niceTicks(maxR, 5)) s += `<line class="grid" x1="${X(r)}" x2="${X(r)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(r)}" y="${H - B + 14}" text-anchor="middle">${nf(r)}</text>`;
    s += `<text class="ax" x="${W - R}" y="${H - 2}" text-anchor="end">${esc(tr("wc.xRange", "Range (m)"))}</text>`;
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
      s += `<rect x="${x.toFixed(1)}" y="${H - B + 20}" width="${(x2 - x).toFixed(1)}" height="${STRIP - 4}" fill="${w < 0 ? "var(--border)" : color(w)}"/>`;
    });
    s += `<text class="ax" x="${L}" y="${H - 2}" text-anchor="start">${esc(tr("wc.winner", "Fastest at each range"))}</text>`;
    s += `<line class="mark" x1="${X(st.range)}" x2="${X(st.range)}" y1="${T}" y2="${H - B}"/><text class="ax mark-t" x="${Math.min(W - R, X(st.range) + 5)}" y="${T + 10}" ${X(st.range) > W - 70 ? 'text-anchor="end" dx="-10"' : ""}>${esc(fmtM(st.range))}</text>`;
    s += `<line class="cursor" id="wcCur" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/></svg>`;
    el.innerHTML = s + `<div class="wc-legend">${calc.ws.map((w, i) => `<span><span class="sw" style="background:${color(i)}"></span>${esc(w.name)}</span>`).join("")}<span><span class="sw" style="background:var(--border)"></span>${esc(tr("wc.tie", "tie / no kill"))}</span></div>`;
    const svg = el.querySelector("svg"), cur = el.querySelector("#wcCur"), out = $("wcReadout");
    const idx = (clientX) => {
      const box = svg.getBoundingClientRect();
      const x = (clientX - box.left) * (W / box.width);
      return Math.min(xs.length - 1, Math.max(0, Math.round(((x - L) / (W - L - R)) * (xs.length - 1))));
    };
    const show = (k) => {
      const r = xs[k];
      cur.setAttribute("x1", X(r)); cur.setAttribute("x2", X(r)); cur.setAttribute("visibility", "visible");
      out.innerHTML = `<b>${esc(tr("wc.readoutAt", "At {m} m", { m: nf(r) }))}</b>` + ws.map((w, i) => `<span><span class="sw" style="background:${color(i)}"></span>${esc(w.name)}: ${esc(fmtMs(curves[i][k]))}</span>`).join("");
    };
    svg.addEventListener("pointermove", (e) => show(idx(e.clientX)));
    svg.addEventListener("pointerdown", (e) => {          // a click or tap sets the range for the other graphs and the table
      const k = idx(e.clientX);
      show(k);
      st.range = Math.round(xs[k]);
      $("wcRange").value = st.range; paintLabels();
      invalidate("range");
    });
    svg.addEventListener("pointerleave", () => { cur.setAttribute("visibility", "hidden"); out.innerHTML = ""; });
  }

  function drawCdf() {
    const el = $("wcCdf");
    $("wcCdfNote").textContent = tr("wc.cdfNote", "At {m} m. Higher and further left is better. The dots mark the 50% point.", { m: nf(st.range) });
    const { ws, dists, med } = calc;
    if (!ws.length) { el.innerHTML = ""; return; }
    const W = chartWidth(el), H = CH, L = 56, R = 16, T = 10, B = 30;
    const reach = dists.map((d) => quantileMs(d, 0.99) ?? quantileMs(d, 0.5) ?? 0);
    const xMax = Math.max(200, ...reach) * 1.05;
    const xt = niceTicks(xMax, 6), xTop = xt[xt.length - 1];
    const X = (v) => L + (v / xTop) * (W - L - R);
    const Y = (p) => T + (1 - p) * (H - T - B);
    let s = svgOpen(W, H, tr("wc.ariaCdf", "Graph: chance of having killed by a given time"));
    for (const p of [0, 0.25, 0.5, 0.75, 1]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(p)}" y2="${Y(p)}"/><text class="ax" x="${L - 6}" y="${Y(p) + 4}" text-anchor="end">${nf(p * 100)}%</text>`;
    for (const v of xt) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(v)}" y="${H - B + 14}" text-anchor="middle">${nf(v)}</text>`;
    s += `<text class="ax" x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle">${esc(tr("wc.xMs", "Time (ms)"))}</text>`;
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
    const max = Math.max(1, ...dp.flatMap((d) => [d.burst, d.sustained]));
    const bar = (i, k, v, op) => `<div class="wc-dpsrow"><span class="lab">${esc(tr("wc." + k, k === "burst" ? "Burst" : "Sustained"))}</span><span class="wc-meter"><i style="width:${Math.max(0.5, v / max * 100).toFixed(1)}%;background:${color(i)};opacity:${op}"></i></span><span class="v">${nf(v)}</span></div>`;
    el.innerHTML = `<div class="wc-dpsgrid" role="img" aria-label="${esc(tr("wc.ariaDps", "Graph: damage per second of the chosen weapons"))}">` + ws.map((w, i) =>
      `<div class="wc-dpsw" style="--c:${color(i)}"><div class="wc-dpsname">${esc(w.name)}</div>${bar(i, "burst", dp[i].burst, 1)}${bar(i, "sustained", dp[i].sustained, 0.55)}</div>`).join("") + "</div>";
  }

  // ------------------------------------------------------ recoil simulator --
  const simState = { aim: "ads", stance: "crouchStill", att: {}, comp: 0, target: null, seed: newSeed() };
  const sprayTarget = () => simState.target || (st.hsr >= 50 ? "head" : "body");   // the picture follows the headshot rate until a button is pressed
  const settingsKey = () => [simState.aim, simState.stance, simState.comp, st.acc, st.hsr, st.range, st.hp].join("|");
  const simOpts = () => ({ stance: simState.stance, aim: simState.aim, comp: simState.comp / 100, acc: st.acc / 100, hsr: st.hsr / 100 });
  // attachments the weapon can mount, by slot: { barrel: [names], rail: [...], ammo: [...] } (recoil.json v2: atts / descs / att)
  const partsOf = (id) => ((recoil && recoil.att && recoil.att[id]) || []).map((i) => recoil.atts[i]).filter(Boolean);
  const attsOf = (id) => {
    const out = {};
    for (const [name] of partsOf(id)) { const slot = slotOf(name); if (slot && !(out[slot] ||= []).includes(name)) out[slot].push(name); }
    // a part Census lists under two names (Muzzle Brake beside Compensator) is shown once
    for (const sl of Object.keys(out)) out[sl] = out[sl].filter((n) => canon(n) === n || !out[sl].includes(canon(n)));
    return out;
  };
  // name -> Census description of THIS weapon's version of the attachment (it carries the weapon's own numbers)
  const descsOf = (id) => {
    const out = {};
    for (const [name, d] of partsOf(id)) if (!out[name] && d >= 0) out[name] = recoil.descs[d];
    return out;
  };
  const chosenAtt = (id) => Object.values(simState.att[id] || {}).filter(Boolean);
  const paramsOf = (w, att) => {
    const x = recoilOf(w.id);
    if (!x || !x.fm) return null;
    return simParams(w.p, x.fm, x.states, { ...simOpts(), attachments: att, attDesc: descsOf(w.id), adsFm: x.adsFm, adsStates: x.adsStates, cat: w.cat, weaponName: w.name });
  };
  const styleLabel = (shots, n) => {
    const s = styleParts(shots, n);
    if (s.pulls != null) return s.pulls === 1 ? tr("wc.sim.pull1", "1 burst · {s} shots", { s: nf(s.shots) }) : tr("wc.sim.pulls", "{n} bursts · {s} shots", { n: nf(s.pulls), s: nf(s.shots) });
    return s.shots === 1 ? tr("wc.sim.tap", "single shots") : tr("wc.sim.burstN", "{n}-shot bursts", { n: nf(s.shots) });
  };

  // results: weapon key -> compareBursts result; class key -> best median of the class (gold)
  const simCache = new Map(), classSim = new Map();
  const lastShown = new Map();     // weapon id -> last result drawn (kept on screen, dimmed, while a new one is computed)
  let gen = 0, worker = null;
  try {
    worker = new Worker(new URL("weapon-sim-worker.mjs?v=20261106-wcr2", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { key, kind, result } = e.data || {};
      (kind === "class" ? classSim : simCache).set(key, result);
      if (simCache.size > 300) simCache.clear();
      invalidate("sim");
    };
    worker.onerror = () => { worker = null; invalidate("sim"); };
  } catch { worker = null; }
  function runJobs(jobs) {
    if (!jobs.length) return;
    gen++;
    if (worker) { worker.postMessage({ gen, jobs }); return; }
    // no worker: run on the main thread in small slices (same results, the page just stays a little busier)
    const my = gen;
    const queue = jobs.slice();
    const step = () => {
      if (my !== gen || !queue.length) return;
      const j = queue.shift();
      if (j.kind === "weapon") simCache.set(j.key, compareBursts(j.P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }));
      else { let b = null; for (const P of j.Ps) { const r = compareBursts(P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }).best; if (r && (b == null || r.median < b)) b = r.median; } classSim.set(j.key, b); }
      invalidate("sim");
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function drawSim() {
    const el = $("wcSim"), sum = $("wcSimSum");
    if (!calc || !calc.ws.length) { el.innerHTML = ""; sum.innerHTML = ""; return; }
    if (!recoil) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`; sum.innerHTML = ""; return; }
    $("wcSimNote").textContent = tr("wc.sim.note3", "Target at {m} m with {hp} health. Each shot is aimed at the head with the headshot rate, else at the body, and lands on the aim point with the accuracy (else it misses clearly); the cone and recoil come on top. Times count from the trigger pull, so a wind-up is included. Recoil compensation pulls that share of the vertical kick back, a simple pulldown. Each style is tried 300 times.", { m: nf(st.range), hp: nf(st.hp) });
    paintSeg();
    const sk = settingsKey(), jobs = [];
    const res = calc.ws.map((w) => {
      const att = chosenAtt(w.id), key = `${w.id}|${att.join("+")}|${sk}`;
      if (simCache.has(key)) { const r = simCache.get(key); lastShown.set(w.id, r); return { r, busy: false }; }
      const P = paramsOf(w, att);
      if (!P) return { r: null, busy: false, none: true };
      jobs.push({ key, kind: "weapon", P, distance: st.range, hp: st.hp, runs: SIM_RUNS });
      return { r: lastShown.get(w.id) || null, busy: true };
    });
    const classKey = (cat) => `${cat}|${sk}`;
    for (const cat of new Set(calc.ws.map((w) => w.cat))) {
      if (classSim.has(classKey(cat))) continue;
      const Ps = (byCat.get(cat) || []).map((w) => paramsOf(w, [])).filter(Boolean);
      jobs.push({ key: classKey(cat), kind: "class", Ps, distance: st.range, hp: st.hp, runs: SIM_RUNS });
    }
    if (jobs.length && jobs.some((j) => !pending.has(j.key))) { pending = new Set(jobs.map((j) => j.key)); runJobs(jobs); }

    const meds = res.map((x) => (x.r && x.r.best ? x.r.best.median : null)), rates = res.map((x) => (x.r && x.r.best ? x.r.best.killRate : null));
    const bestMed = bestOf(meds, -1), bestRate = bestOf(rates, 1);
    const cls = (v, w) => { const cb = classSim.get(classKey(w.cat)); return v != null && cb != null && v <= cb * (1 + 1e-9) ? "gold" : v != null && v === bestMed ? "good" : ""; };
    const busyTag = `<span class="wc-busy">${esc(tr("wc.sim.busy", "simulating…"))}</span>`;
    sum.innerHTML = calc.ws.length > 1 ? `<ul class="wc-simsum">${calc.ws.map((w, i) => {
      const b = res[i].r && res[i].r.best;
      return `<li style="--c:${color(i)}" class="${res[i].busy ? "is-busy" : ""}"><b>${esc(w.name)}</b><span class="${b ? cls(b.median, w) : ""}">${b ? esc(styleLabel(b.burst, w.p.burstN)) + " · " + esc(fmtMs(b.median)) : res[i].busy ? "" : esc(tr("wc.never", "no kill"))}</span><span class="${b && b.killRate === bestRate ? "good" : ""}">${b ? nf(b.killRate * 100) + "%" : ""}</span>${res[i].busy ? busyTag : ""}</li>`;
    }).join("")}</ul>` : "";

    // one scale for every spray picture, so the patterns can be compared by eye
    const sprays = calc.ws.map((w, i) => { const P = !res[i].none && paramsOf(w, chosenAtt(w.id)); return P ? sprayData(w, P) : null; });
    const S = Math.max(TARGET.halfW * 1.4, ...sprays.filter(Boolean).map((d) => d.reach)) * 1.1;
    lastSprays = { sprays, S, names: calc.ws.map((w) => w.name) };
    el.innerHTML = calc.ws.map((w, i) => {
      const x = res[i];
      if (x.none) return `<article class="wc-sim" style="--c:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b></div><p class="wc-dim">${esc(tr("wc.sim.none", "No recoil data for this weapon."))}</p></article>`;
      const rows = (x.r && x.r.rows) || [], best = x.r && x.r.best;
      const worst = Math.max(1, ...rows.map((r) => r.median ?? 0));
      const bars = rows.map((r) => `<li class="${best && r.burst === best.burst ? "best" : ""}"><span class="lab">${esc(styleLabel(r.burst, w.p.burstN))}</span><span class="wc-meter"><i style="width:${r.median == null ? 0 : Math.max(2, r.median / worst * 100).toFixed(1)}%;background:${color(i)}"></i></span><span class="v">${r.median == null ? esc(tr("wc.never", "no kill")) : esc(fmtMs(r.median))} · ${nf(r.killRate * 100)}%</span></li>`).join("");
      const head = best
        ? `<span class="${cls(best.median, w)}">` + esc(tr("wc.sim.best", "Best: {style}, median {ms}", { style: styleLabel(best.burst, w.p.burstN), ms: fmtMs(best.median) })) + "</span>"
        : x.r ? esc(tr("wc.sim.nobest", "Cannot kill reliably at this range with this setup")) : "";
      const have = attsOf(w.id);
      const chips = SLOTS.filter((sl) => have[sl]).map((sl) => `<label class="wc-att"><span>${esc(tr("wc.sim.slot." + sl, SLOT_EN[sl]))}</span><select data-w="${w.id}" data-slot="${sl}"><option value="">${esc(tr("wc.sim.noAtt", "none"))}</option>${have[sl].map((n) => `<option value="${esc(n)}" ${(simState.att[w.id] || {})[sl] === n ? "selected" : ""}>${esc(n)}${((fx) => (fx ? (Object.keys(fx).length ? "" : " · " + esc(tr("wc.sim.noCombat", "no effect on killing"))) : " · " + esc(tr("wc.sim.noEffect", "not modelled"))))(attEffects(n, descsOf(w.id)[n], w.name, simState.aim === "hip"))}</option>`).join("")}</select></label>`).join("");
      return `<article class="wc-sim${x.busy ? " is-busy" : ""}" style="--c:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b><span class="wc-best">${head}${x.busy ? busyTag : ""}</span></div>
        <div class="wc-simbody"><ul class="wc-bars">${bars}</ul>${sprayFigure(sprays[i], S, i)}</div>${chips ? `<div class="wc-atts">${chips}</div>` : ""}</article>`;
    }).join("");
  }
  let pending = new Set();
  let lastSprays = null;

  // zoom: the same spray, drawn large in a dialog (Esc or Close to leave)
  const zoomDlg = $("wcZoom");
  $("wcSim").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-zoom]");
    if (!b || !lastSprays) return;
    const i = Number(b.dataset.zoom), d = lastSprays.sprays[i];
    if (!d) return;
    $("wcZoomH").textContent = lastSprays.names[i] || "";
    $("wcZoomBody").innerHTML = sprayFigure(d, lastSprays.S, i, 560);
    try { zoomDlg.showModal(); } catch (err) { zoomDlg.setAttribute("open", ""); }
  });
  $("wcZoomClose").addEventListener("click", () => zoomDlg.close ? zoomDlg.close() : zoomDlg.removeAttribute("open"));
  zoomDlg.addEventListener("click", (e) => { if (e.target === zoomDlg) zoomDlg.close ? zoomDlg.close() : zoomDlg.removeAttribute("open"); });

  // the spray picture: one full spray drawn bright (later shots fainter) and GHOST_SPRAYS more, each with new random numbers
  function sprayData(w, P) {
    const n = Math.min(30, P.mag), aimHead = sprayTarget() === "head";
    const seed = (simState.seed + w.id * 7919) % 2147483647;
    const main = sprayPattern(P, { distance: st.range, seed, shots: n, aimHead });
    const ghosts = [];
    for (let g = 1; g <= GHOST_SPRAYS; g++) ghosts.push(...sprayPattern(P, { distance: st.range, seed: seed + g * 104723, shots: n, aimHead }));
    const cy0 = aimHead ? TARGET.headY / 2 : 0;
    const reach = Math.max(0, ...[...main, ...ghosts].map((s) => Math.max(Math.abs(s.x), Math.abs(s.y - cy0))));
    return { n, main, ghosts, cy0, reach };
  }
  function sprayFigure(d, S, i, Z = 240) {
    if (!d) return "";
    const U = (Z / 2) / S, cx = Z / 2, cy = Z / 2 + d.cy0 * U;
    let svg = svgOpen(Z, Z, tr("wc.sim.aria", "Where a full-magazine spray lands on the target"));
    svg += `<rect class="wc-tgt" x="${cx - TARGET.halfW * U}" y="${cy - TARGET.top * U}" width="${2 * TARGET.halfW * U}" height="${(TARGET.top - TARGET.bottom) * U}"/>`;
    svg += `<circle class="wc-tgt" cx="${cx + TARGET.headX * U}" cy="${cy - TARGET.headY * U}" r="${TARGET.headR * U}"/>`;
    svg += d.ghosts.map((s) => `<circle cx="${(cx + s.x * U).toFixed(1)}" cy="${(cy - s.y * U).toFixed(1)}" r="1.3" fill="${color(i)}" fill-opacity="0.22"/>`).join("");
    svg += d.main.map((s) => `<circle cx="${(cx + s.x * U).toFixed(1)}" cy="${(cy - s.y * U).toFixed(1)}" r="2.4" fill="${color(i)}" fill-opacity="${(0.4 + 0.6 * (1 - s.i / d.n)).toFixed(2)}"/>`).join("");
    svg += "</svg>";
    const cap = `${esc(tr("wc.sim.scale", "Weapon spray only, {m} m wide at {d} m", { m: nf(2 * S, 1), d: nf(st.range) }))} · ${esc(tr("wc.sim.ghostKey", "faint dots: {n} more sprays", { n: nf(GHOST_SPRAYS) }))}`;
    if (Z !== 240) return `<figure class="wc-spray">${svg}<figcaption class="wc-dim">${cap}</figcaption></figure>`;
    return `<figure class="wc-spray">${svg}<figcaption class="wc-dim">${cap}</figcaption></figure><button type="button" class="wc-btn wc-zoombtn" data-zoom="${i}"><span aria-hidden="true">🔍</span> <span>${esc(tr("wc.sim.zoom", "Zoom"))}</span></button>`;
  }

  $("wcSim").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-w]");
    if (!sel) return;
    const id = Number(sel.dataset.w);
    simState.att[id] = { ...(simState.att[id] || {}), [sel.dataset.slot]: sel.value };
    invalidate("sim");
  });
  $("wcReroll").addEventListener("click", () => { simState.seed = newSeed(); invalidate("sim"); });

  // icon buttons: aim (ADS / hip), stance (4), what the spray picture is aimed at (torso / head)
  const ico = (body) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const stand = '<circle cx="12" cy="4.5" r="2.3"/><path d="M12 7.5v8M12 9.5l-4 4M12 9.5l4 4M12 15.5l-3 6.5M12 15.5l3 6.5"/>';
  const crouch = '<circle cx="11" cy="8" r="2.3"/><path d="M11 11l-1 5.5M11 12.5l5 1.5M10 16.5l6 1.5-1 4M10 16.5l-3 5"/>';
  const speed = '<path d="M2 8h4M1 12h5M2 16h4"/>';
  const ICONS = {
    ads: ico('<circle cx="12" cy="12" r="6.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>'),
    hip: ico('<path d="M2.5 13h12l2-2.5h5v4h-4.5l-1 4h-3l-.8-4H2.5z"/>'),
    crouchStill: ico(crouch), standStill: ico(stand),
    crouchMove: ico(crouch + speed), standMove: ico(stand + speed),
    body: ico('<circle cx="12" cy="4.5" r="2.3" opacity=".45"/><rect x="8" y="8" width="8" height="12" fill="currentColor" fill-opacity=".35"/>'),
    head: ico('<circle cx="12" cy="6" r="3.8" fill="currentColor" fill-opacity=".35"/><rect x="8" y="12" width="8" height="9" opacity=".45"/>'),
  };
  const STANCE_EN = { crouchStill: "Crouched, still", standStill: "Standing, still", crouchMove: "Crouched, moving", standMove: "Standing, moving" };
  const SEGS = [
    ["wcSimAim", [["ads", "Aiming down sights", "wc.sim.ads"], ["hip", "Hip fire", "wc.sim.hip"]], () => simState.aim, (k) => { simState.aim = k; }],
    ["wcSimStance", STANCES.map((k) => [k, STANCE_EN[k], "wc.sim.st." + k]), () => simState.stance, (k) => { simState.stance = k; }],
    ["wcSimTarget", [["body", "Torso", "wc.sim.tgtBody"], ["head", "Head", "wc.sim.tgtHead"]], () => sprayTarget(), (k) => { simState.target = k; }],
  ];
  function paintSeg() {
    for (const [id, items, get] of SEGS) {
      const box = $(id), cur = get();
      const html = items.map(([k, en, key]) => { const t = tr(key, en); return `<button type="button" role="radio" class="wc-segbtn" data-k="${k}" aria-checked="${cur === k}" aria-label="${esc(t)}" title="${esc(t)}">${ICONS[k]}<span>${esc(t)}</span></button>`; }).join("");
      if (box.innerHTML !== html) box.innerHTML = html;
    }
  }
  for (const [id, , , set] of SEGS) $(id).addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; set(b.dataset.k); paintSeg(); invalidate("sim"); });
  const cp = $("wcSimComp");
  cp.addEventListener("input", () => { simState.comp = +cp.value; $("wcSimCompV").textContent = nf(simState.comp) + "%"; invalidate("sim"); });

  paintLabels(); paintSeg();
  invalidate("all");
  // recoil data after the first draw (it is the biggest file); the table rows and the simulator fill in when it lands
  fetch("assets/weapons/recoil.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j && j.weapons && j.atts) { recoil = j; classCache.clear(); invalidate("range"); invalidate("sim"); }
  }).catch(() => {});
}
