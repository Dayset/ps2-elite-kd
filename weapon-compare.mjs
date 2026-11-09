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
 *
 * Tidy-up (owner 2026-11-08 "flooded with text, spaghetti logic"): one loadout per weapon (attachments picked on
 * the weapon's card) feeds EVERY number on the page (table, graphs, simulator); one aim rule everywhere (headshot
 * rate = share of shots aimed at the head, the rest at the chest); no repeated blocks; the deep dive is folded and
 * only works while open; all simulator jobs of one draw go to the worker in one message.
 */
import { t as tr, currentLang, ready } from "./i18n.mjs";
import { paletteColor } from "./palette.mjs";
import { toProfile } from "./replay/weapons.mjs";
import {
  HP_PRESETS, ttkDistribution, quantileMs, rangeAxis, ttkCurve, winnerStrip, slowerPct, withCadence,
  FPS_LIMIT, fpsFireRateDrop, withFpsLimit, deepBands, minShots, hitDamage,
} from "./weapons-model.mjs?v=20261107-merge1";
import { METRICS, GROUPS, GROUP_EN, statValues, bestOf, rank, classBests, rowAllSame } from "./weapon-stats.mjs?v=20261108-tidy1";
import {
  simParams, compareBursts, burstAnalysis, deepTimings, sprayPattern, attEffects, SLOTS, slotOf, canon, TARGET, STANCES,
  stylesFor, loadoutEffects, loadoutProfile, loadoutRec,
} from "./weapon-sim.mjs?v=20261109-deepfollow1";

export const MAX_WEAPONS = 4;
export const MAX_RANGE = 500;        // hard cap (the 500 m option); the chart shows 100 / 200 / 500, see viewMax()
export const DEFAULTS = Object.freeze({ acc: 20, hsr: 20, range: 20, hp: 1000 });
export const SIM_RUNS = 300;
export const GHOST_SPRAYS = 4;       // extra sprays drawn faintly behind the main one, each with its own random numbers
const DEFAULT_IDS = [4, 14, 20];          // NC1 Gauss Rifle, T1 Cycler, Pulsar VS1
const MODE_EN = { auto: "Automatic", semi: "Semi-auto", burst: "Burst", bolt: "Bolt action" };
const FACTION = { 0: "NS", 1: "VS", 2: "NC", 3: "TR" };
const OPEN_KEY = "ps2-elite-kd-wc-open";
const DIFF_KEY = "ps2-elite-kd-wc-diff";   // "0" = show the rows that are the same for every chosen weapon
const FOLLOW_KEY = "ps2-elite-kd-wc-deep-follow";   // "1" = the deep dive follows the page headshot rate instead of chest aim
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString(currentLang(), { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtMs = (v) => (v == null ? tr("wc.never", "no kill") : tr("wc.ms", "{ms} ms", { ms: nf(v) }));
const fmtM = (v) => tr("wc.m", "{m} m", { m: nf(v) });

/** Parse ?w=4,14&acc=60&hsr=10&hp=500&r=20&fps=60 (pure, tested). `fps` present = the FPS limit is on. */
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
    fps: Math.round(num("fps", FPS_LIMIT.min, FPS_LIMIT.max, FPS_LIMIT.def)),
    fpsOn: q.has("fps"),
    hasW: q.has("w"),
    att: parseAtt(q, ids),
  };
}

// attachments per weapon in the link: a<itemId>=Name,Name (at most one per slot, so three)
function parseAtt(q, ids) {
  const out = {};
  for (const [k, v] of q) {
    const m = /^a(\d+)$/.exec(k);
    if (!m || !ids.includes(+m[1])) continue;
    const names = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3);
    if (names.length) out[+m[1]] = names;
  }
  return out;
}
/** Attachment names of one weapon from either form: a list, or { slot: name }. */
export const attList = (a) => (Array.isArray(a) ? a : Object.values(a || {})).filter(Boolean);

/** Build the ?w=… query for a state (pure, tested). Defaults are left out. */
export function stateToSearch(s) {
  const q = new URLSearchParams();
  if (s.ids.length) q.set("w", s.ids.join(","));
  if (s.acc !== DEFAULTS.acc) q.set("acc", String(s.acc));
  if (s.hsr !== DEFAULTS.hsr) q.set("hsr", String(s.hsr));
  if (s.range !== DEFAULTS.range) q.set("r", String(s.range));
  if (s.hp !== DEFAULTS.hp) q.set("hp", String(s.hp));
  if (s.far) q.set("max", "500");
  if (s.fpsOn) q.set("fps", String(s.fps ?? FPS_LIMIT.def));
  for (const id of s.ids) { const a = attList(s.att && s.att[id]); if (a.length) q.set("a" + id, a.join(",")); }
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

/**
 * How many shots of a burst analysis are worth showing (pure, tested): up to two past the last shot that still
 * hits at least `floor` of the time, never fewer than `min` — the long tail of 0 % rows is dropped.
 */
export function burstRowsShown(rows, floor = 0.01, min = 6) {
  let last = -1;
  rows.forEach((r, i) => { if (r.total >= floor) last = i; });
  return Math.min(rows.length, Math.max(min, last + 3));
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
  let recoil = null;           // assets/weapons/recoil.json: loaded after the first draw; the rows, attachments and the simulator wait for it
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
  // attachments: { itemId: { slot: name } } — the one loadout every number on the page uses
  const linkAtt = st.att;
  st.att = {};
  for (const [id, names] of Object.entries(linkAtt)) for (const n of names) { const sl = slotOf(n); if (sl) (st.att[id] ||= {})[sl] = n; }

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
  const removeId = (id) => { st.ids = st.ids.filter((x) => x !== id); delete st.att[id]; msg(""); invalidate("all"); };
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
  // footer: the experimental FPS limit (checkbox enables it, slider sets the frame rate)
  $("wcFps").addEventListener("change", () => { st.fpsOn = $("wcFps").checked; paintFps(); invalidate("all"); });
  $("wcFpsRange").addEventListener("input", () => { st.fps = +$("wcFpsRange").value; paintFps(); invalidate("range"); });
  window.addEventListener("resize", () => { clearTimeout(boot.rt); boot.rt = setTimeout(() => invalidate("charts"), 120); });
  window.addEventListener("ps2-lang", () => { fillCats(); fillHp(); paintSeg(); invalidate("all"); });
  // the weapon cards: ✕ removes, the slot menus set the loadout
  $("wcChips").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) removeId(+b.dataset.id); });
  $("wcChips").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-w]");
    if (!sel) return;
    const id = Number(sel.dataset.w);
    st.att[id] = { ...(st.att[id] || {}), [sel.dataset.slot]: sel.value };
    invalidate("range");
  });
  $("wcCards").addEventListener("click", (e) => { const g = e.target.closest("button[data-g]"); if (g) toggleGroup(g.dataset.g); });
  let onlyDiff = true;
  try { onlyDiff = localStorage.getItem(DIFF_KEY) !== "0"; } catch {}
  $("wcDiff").checked = onlyDiff;
  $("wcDiff").addEventListener("change", () => {
    onlyDiff = $("wcDiff").checked;
    try { localStorage.setItem(DIFF_KEY, onlyDiff ? "1" : "0"); } catch {}
    invalidate("range");
  });

  function paintLabels() {
    $("wcAccV").textContent = nf(st.acc) + "%";
    $("wcHsrV").textContent = nf(st.hsr) + "%";
    $("wcRangeV").textContent = fmtM(st.range);
    paintFps();
  }

  // footer: the experimental FPS limit. The slider is dead until the box is ticked.
  function paintFps() {
    const on = !!st.fpsOn;
    $("wcFps").checked = on;
    $("wcFpsRange").disabled = !on;
    $("wcFpsRange").value = st.fps;
    $("wcFpsV").textContent = tr("wc.fpsV", "{fps} FPS", { fps: nf(st.fps) });
    $("wcFpsNote").textContent = on
      ? tr("wc.fpsReadout", "At {fps} FPS, a 600 rpm weapon loses {pct}% of its fire rate. Each weapon uses its own fire rate, so faster weapons lose more.", { fps: nf(st.fps), pct: nf(fpsFireRateDrop(st.fps, 600) * 100, 1) })
      : tr("wc.fpsOff", "Off: fire rates as listed in Census.");
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
    const sim = range || dirty.has("sim"), charts = range || dirty.has("charts"), cards = all || dirty.has("cards");
    dirty.clear();
    if (cards) renderCards();
    if (range || !calc) compute();
    if (range) renderTable();
    if (charts) { drawTtk(); drawCdf(); }
    // every simulator job this draw needs goes to the worker in ONE message (a second message would make the
    // first one's jobs stale in the worker)
    if (sim || charts) postJobs([...drawSim(), ...drawDeep()]);
    try { history.replaceState(null, "", location.pathname + stateToSearch(st)); } catch {}
  }

  // ------------------------------------------------------------- loadout --
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
  const chosenAtt = (id) => attList(st.att[id]);
  const hipAim = () => simState.aim === "hip";
  const effectsOf = (w) => (recoil ? loadoutEffects(chosenAtt(w.id), descsOf(w.id), w.name, hipAim()) : []);
  const fpsP = (p) => (st.fpsOn ? withFpsLimit(p, st.fps) : p);
  // once recoil.json is in, attachments the weapon cannot mount (an old or edited link) are dropped
  function pruneAtt() {
    for (const id of Object.keys(st.att)) {
      const have = attsOf(+id);
      for (const [sl, n] of Object.entries(st.att[id])) if (n && !(have[sl] || []).includes(n)) delete st.att[id][sl];
    }
  }
  const SLOT_EN = { barrel: "Barrel", rail: "Rail", ammo: "Ammo" };

  // the picker's weapon cards: picture, name, ✕ and one menu per attachment slot
  function renderCards() {
    $("wcChips").innerHTML = selected().map((w, i) => {
      const tip = esc(tr("wc.remove", "Click to remove {name}", { name: w.name }));
      const have = recoil ? attsOf(w.id) : {};
      const mine = st.att[w.id] || {};
      const slots = SLOTS.filter((sl) => have[sl]).map((sl) => `<label class="wc-att"><span title="${esc(tr("wc.sim.slot." + sl, SLOT_EN[sl]))}">${esc(tr("wc.sim.slot." + sl, SLOT_EN[sl]))}</span><select data-w="${w.id}" data-slot="${sl}"><option value="">${esc(tr("wc.sim.noAtt", "none"))}</option>${have[sl].map((n) => {
        const fx = attEffects(n, descsOf(w.id)[n], w.name, hipAim());
        const note = fx ? (Object.keys(fx).length ? "" : " · " + tr("wc.sim.noCombat", "no effect on killing")) : " · " + tr("wc.sim.noEffect", "not modelled");
        return `<option value="${esc(n)}" ${mine[sl] === n ? "selected" : ""}>${esc(n + note)}</option>`;
      }).join("")}</select></label>`).join("");
      return `<div class="wc-wcard" role="listitem" style="--c:${color(i)}"><div class="wc-wtop">`
        + `<img src="assets/weapons/${w.img}.webp" alt="" width="56" height="28" loading="lazy" onerror="this.style.visibility='hidden'" />`
        + `<div class="wc-wtxt"><b>${esc(w.name)}</b><span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)}</span></div>`
        + `<button type="button" class="wc-rm" data-id="${w.id}" title="${tip}" aria-label="${tip}">✕</button></div>`
        + (slots ? `<div class="wc-atts">${slots}</div>` : recoil ? "" : `<p class="wc-dim wc-attwait">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`)
        + `</div>`;
    }).join("");
  }

  // ------------------------------------------------------------- compute --
  let calc = null;
  const curveCache = new Map();
  function compute() {
    // the loadout's profile (attachments), slowed by the FPS limit when it is on: TTK, the table and the
    // class comparison all read this one profile; the simulator applies the same numbers itself
    const ws = selected().map((w) => ({ ...w, p: fpsP(loadoutProfile(w.p, effectsOf(w), w.cat)), base: fpsP(w.p) }));
    const maxR = viewMax(ws.map((w) => w.p), st.far);
    $("wcRange").max = maxR;
    if (st.range > maxR) { st.range = maxR; paintLabels(); }
    $("wcRange").value = st.range;
    const xs = rangeAxis(maxR, rangeStep(maxR));
    const opt = { acc: st.acc / 100, hsr: st.hsr / 100, hp: st.hp };
    const okey = `${opt.acc}|${opt.hsr}|${opt.hp}|${maxR}|${st.fpsOn ? st.fps : 0}|${simState.aim}`;
    if (curveCache.size > 200) curveCache.clear();
    const cs = ws.map((w) => {
      const k = w.id + "|" + chosenAtt(w.id).join("+") + "|" + okey;
      if (!curveCache.has(k)) curveCache.set(k, ttkCurve(w.p, xs, opt));
      return curveCache.get(k);
    });
    const dists = ws.map((w) => ttkDistribution(w.p, { ...opt, range: st.range }));
    const med = dists.map((d) => quantileMs(d, 0.5));
    calc = { maxR, ws, xs, curves: cs, dists, med, winners: winnerStrip(cs) };
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
  // best of the whole class (category) per range / hp, stock weapons: cached
  const classCache = new Map();
  function classBestFor(cat) {
    const key = `${cat}|${st.range}|${st.hp}|${recoil ? 1 : 0}|${st.fpsOn ? st.fps : 0}`;
    if (!classCache.has(key)) {
      if (classCache.size > 100) classCache.clear();
      // the class best is judged on the same slowed profiles as the chosen weapons
      classCache.set(key, classBests((byCat.get(cat) || []).map((w) => statValues({ p: fpsP(w.p), rec: recoilOf(w.id), range: st.range, hp: st.hp }))));
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

  function renderTable() {
    const { ws, med } = calc;
    const box = $("wcCards");
    const anyAtt = ws.some((w) => chosenAtt(w.id).length);
    $("wcKey").innerHTML = ws.length ? `<span><span class="good">■</span> ${esc(tr("wc.goodTip", "Best of the chosen weapons"))}</span> <span><span class="gold">■</span> ${esc(tr("wc.goldKey", "Best of the whole class"))}</span>`
      + (anyAtt ? ` <span><span class="wc-mod">123</span> ${esc(tr("wc.modKey", "changed by attachments"))}</span>` : "") : "";
    if (!ws.length) { box.innerHTML = `<p class="wc-dim wc-empty">${esc(tr("wc.search", "Type a weapon name…"))}</p>`; return; }
    const vals = ws.map((w) => statValues({ p: w.p, rec: loadoutRec(recoilOf(w.id), effectsOf(w), hipAim()), range: st.range, hp: st.hp }));
    const stock = ws.map((w) => (chosenAtt(w.id).length ? statValues({ p: w.base, rec: recoilOf(w.id), range: st.range, hp: st.hp }) : null));
    const chosenBest = {};
    for (const m of METRICS) chosenBest[m.key] = bestOf(vals.map((v) => v[m.key]), m.dir);
    const best = bestOf(med, -1) ?? (med.filter((v) => v != null).length ? Math.min(...med.filter((v) => v != null)) : null);
    const cbs = ws.map((w) => classBestFor(w.cat));
    const td = (cls, inner, tip) => `<td class="${cls}"${tip ? ` title="${esc(tip)}"` : ""}>${inner}</td>`;
    const row = (lab, cells, cls = "") => `<tr class="${cls}"><th scope="row" class="wc-lab">${lab}</th>${cells}</tr>`;

    let h = `<table class="ranks-table wc-table" style="--n:${ws.length}"><colgroup><col class="wc-lab-col" />${ws.map(() => "<col />").join("")}</colgroup><thead><tr><th class="wc-lab"></th>`;
    h += ws.map((w, i) => {
      const mode = tr("wc.mode." + w.p.mode, MODE_EN[w.p.mode] || w.p.mode) + (w.p.pellets > 1 ? " · " + tr("wc.pellets", "{n} pellets", { n: nf(w.p.pellets) }) : "");
      return `<th scope="col" class="wc-wh" style="--c:${color(i)}"><div class="wc-whead"><img src="assets/weapons/${w.img}.webp" alt="" width="56" height="28" loading="lazy" onerror="this.style.visibility='hidden'" />`
        + `<span class="wc-wname">${esc(w.name)}</span><span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)}</span><span class="wc-wmeta">${esc(mode)}</span></div></th>`;
    }).join("") + "</tr></thead>";

    // headline: the kill time at the chosen range two ways — the exact maths (no recoil) and the simulator's best
    // firing style (recoil, cone and bloom on); the simulator cells fill in as its results arrive (drawSim)
    h += `<tbody class="wc-top open">`;
    h += row(esc(tr("wc.medExact", "Median kill at {m} m, no recoil", { m: nf(st.range) })), ws.map((w, i) => {
      const slower = slowerPct(med[i], best);
      const cmp = med[i] == null || ws.length < 2 || best == null ? "" : slower === 0 || slower == null
        ? tr("wc.fastest", "fastest") : tr("wc.slower", "{pct}% slower", { pct: nf(slower, slower < 10 ? 1 : 0) });
      return td(`wc-med ${rank(med[i], -1, best, null)}`, `<b>${esc(fmtMs(med[i]))}</b>${cmp ? `<span class="wc-cmp">${esc(cmp)}</span>` : ""}`);
    }).join(""), "wc-hl");
    h += row(esc(tr("wc.medSim", "With recoil: best way to fire")), ws.map((w, i) => `<td class="wc-med" data-sim="${i}"><b>…</b></td>`).join(""), "wc-hl");
    h += "</tbody>";

    for (const g of GROUPS) {
      const ms = METRICS.filter((m) => m.group === g && vals.some((v) => v[m.key] != null) && !(onlyDiff && rowAllSame(vals, m.key)));
      if (!ms.length) continue;
      const open = openGroups.has(g);
      h += `<tbody data-g="${g}" class="${open ? "open" : ""}"><tr class="wc-grp"><th colspan="${ws.length + 1}"><button type="button" data-g="${g}" aria-expanded="${open}"><span class="wc-caret" aria-hidden="true"></span>${esc(tr("wc.g." + g, GROUP_EN[g]))}</button></th></tr>`;
      for (const m of ms) {
        h += row(esc(tr("wc.k." + m.key, m.en)), ws.map((w, i) => {
          const v = vals[i];
          let cls = rank(v[m.key], m.dir, chosenBest[m.key], cbs[i][m.key]);
          let tip = cls === "gold" ? tr("wc.goldTip", "Best of all {cat}", { cat: w.cat }) : cls === "good" ? tr("wc.goodTip", "Best of the chosen weapons") : "";
          if (m.key === "windup" && w.p.delayHand) tip = tr("wc.windupHand", "Not in Census: typed in by hand");
          const s0 = stock[i];
          if (s0 && (s0[m.key] !== v[m.key] || s0[m.key + ":max"] !== v[m.key + ":max"])) {
            cls += " wc-mod";
            tip = tr("wc.modTip", "Changed by the attachments. Without them: {v}", { v: fmtUnit(m.unit, s0[m.key], s0[m.key + ":max"]) }) + (tip ? " · " + tip : "");
          }
          return td(cls, esc(fmtUnit(m.unit, v[m.key], v[m.key + ":max"])) + (m.key === "windup" && w.p.delayHand ? " ✍️" : ""), tip);
        }).join(""));
      }
      h += "</tbody>";
    }
    box.innerHTML = h + "</table>";
  }

  // -------------------------------------------------------------- charts --
  const svgOpen = (W, H, aria) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`;
  const plotBg = (L, T, W, H) => `<rect class="plot" x="${L}" y="${T}" width="${Math.max(0, W).toFixed(1)}" height="${Math.max(0, H).toFixed(1)}"/>`;
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
    let s = svgOpen(W, H, tr("wc.ariaTtk", "Graph: time to kill by range for the chosen weapons")) + plotBg(L, T, W - L - R, H - T - B);
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
    s += `<line class="mark" x1="${X(st.range)}" x2="${X(st.range)}" y1="${T}" y2="${H - B}"/><text class="ax mark-t" x="${Math.min(W - R, X(st.range) + 5)}" y="${T + 12}" ${X(st.range) > W - 70 ? 'text-anchor="end" dx="-10"' : ""}>${esc(fmtM(st.range))}</text>`;
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
    $("wcCdfNote").textContent = tr("wc.cdfNote2", "At {m} m. Further left is better; the dot marks the median.", { m: nf(st.range) });
    const { ws, dists, med } = calc;
    if (!ws.length) { el.innerHTML = ""; return; }
    const W = chartWidth(el), H = CH, L = 56, R = 16, T = 10, B = 30;
    const reach = dists.map((d) => quantileMs(d, 0.99) ?? quantileMs(d, 0.5) ?? 0);
    const xMax = Math.max(200, ...reach) * 1.05;
    const xt = niceTicks(xMax, 6), xTop = xt[xt.length - 1];
    const X = (v) => L + (v / xTop) * (W - L - R);
    const Y = (p) => T + (1 - p) * (H - T - B);
    let s = svgOpen(W, H, tr("wc.ariaCdf", "Graph: chance of having killed by a given time")) + plotBg(L, T, W - L - R, H - T - B);
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

  // ------------------------------------------------------ recoil simulator --
  // One aim rule (owner 2026-11-08): each shot is aimed at the head with the headshot rate, else at the chest; it
  // lands on that point with the accuracy, else it misses clearly; cone, bloom and recoil come on top.
  const simState = { aim: "ads", stance: "crouchStill", comp: 0, compX: 0, seed: newSeed() };
  const settingsKey = () => [simState.aim, simState.stance, simState.comp, simState.compX, st.acc, st.hsr, st.range, st.hp, st.fpsOn ? st.fps : 0].join("|");
  const simOpts = () => ({ stance: simState.stance, aim: simState.aim, comp: simState.comp / 100, compX: simState.compX / 100, acc: st.acc / 100, hsr: st.hsr / 100 });
  const paramsOf = (w, att) => {
    const x = recoilOf(w.id);
    if (!x || !x.fm) return null;
    // the simulator takes the raw Census profile and applies the attachments and the FPS limit itself (simParams
    // scales the shot gaps from the raw fire_refire_ms, which the adjusted profile cannot reach), so each is counted once
    const raw = (weapons.get(w.id) || w).p;
    return simParams(raw, x.fm, x.states, { ...simOpts(), fpsDrop: st.fpsOn ? fpsFireRateDrop(st.fps, raw.rpm) : 0, attachments: att, attDesc: descsOf(w.id), adsFm: x.adsFm, adsStates: x.adsStates, cat: w.cat, weaponName: w.name });
  };
  const styleLabel = (shots, n) => {
    const s = styleParts(shots, n);
    if (s.pulls != null) return s.pulls === 1 ? tr("wc.sim.pull1", "1 burst · {s} shots", { s: nf(s.shots) }) : tr("wc.sim.pulls", "{n} bursts · {s} shots", { n: nf(s.pulls), s: nf(s.shots) });
    return s.shots === 1 ? tr("wc.sim.tap", "single shots") : tr("wc.sim.burstN", "{n}-shot bursts", { n: nf(s.shots) });
  };

  // results: weapon key -> compareBursts result; class key -> best median of the class (gold)
  const simCache = new Map(), classSim = new Map(), deepCache = new Map();   // deep dive: "burst|<key>" and "ranges|<key>"
  const lastShown = new Map();     // weapon id -> last result drawn (kept on screen, dimmed, while a new one is computed)
  let gen = 0, worker = null, posted = new Set();
  try {
    worker = new Worker(new URL("weapon-sim-worker.mjs?v=20261109-deepfollow1", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { key, kind, result } = e.data || {};
      (kind === "class" ? classSim : kind === "burst" || kind === "ranges" ? deepCache : simCache).set(key, result);
      if (simCache.size > 300) simCache.clear();
      invalidate("sim");
    };
    worker.onerror = () => { worker = null; posted = new Set(); invalidate("sim"); };
  } catch { worker = null; }
  // send the jobs one draw needs, all in one message, and only when something new is needed (the worker keeps the
  // latest message's jobs and drops older ones, so the full list goes every time)
  function postJobs(jobs) {
    if (!jobs.length || jobs.every((j) => posted.has(j.key))) return;
    posted = new Set(jobs.map((j) => j.key));
    gen++;
    if (worker) { worker.postMessage({ gen, jobs }); return; }
    // no worker: run on the main thread in small slices (same results, the page just stays a little busier)
    const my = gen;
    const queue = jobs.slice();
    const step = () => {
      if (my !== gen || !queue.length) return;
      const j = queue.shift();
      if (j.kind === "weapon") simCache.set(j.key, compareBursts(j.P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }));
      else if (j.kind === "burst") deepCache.set(j.key, burstAnalysis(j.P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }));
      else if (j.kind === "ranges") deepCache.set(j.key, j.ranges.map((r) => { const b = compareBursts(j.P, { distance: r, hp: j.hp, runs: j.runs, seed: 1 }).best; return { range: r, best: b ? { median: b.median, burst: b.burst } : null }; }));
      else { let b = null; for (const P of j.Ps) { const r = compareBursts(P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }).best; if (r && (b == null || r.median < b)) b = r.median; } classSim.set(j.key, b); }
      invalidate("sim");
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  // the shared key for every spray picture (drawn once, above the cards)
  function paintSimLegend() {
    const c = "var(--text)", U = 12;
    const dot = (zone) => `<svg viewBox="0 0 ${U} ${U}" width="${U}" height="${U}" aria-hidden="true">${shotDot({ x: 0, y: 0, zone }, U / 2, U / 2, 1, c, 1, true)}</svg>`;
    const cross = `<svg viewBox="0 0 ${U} ${U}" width="${U}" height="${U}" aria-hidden="true"><path class="wc-aimx" d="M1 6H11M6 1V11"/></svg>`;
    $("wcSimLegend").innerHTML = [
      [dot("head"), tr("wc.deep.head", "Head")], [dot("body"), tr("wc.deep.body", "Body")], [dot("leg"), tr("wc.deep.leg", "Leg")],
      [dot(null), tr("wc.sim.miss", "miss")], [cross, tr("wc.sim.aimPt", "aim point")],
    ].map(([i, t]) => `<span>${i} ${esc(t)}</span>`).join("") + `<span class="wc-dim">${esc(tr("wc.sim.ghostKey", "faint dots: {n} more sprays", { n: nf(GHOST_SPRAYS) }))}</span>`;
  }

  function drawSim() {
    const el = $("wcSim");
    if (!calc || !calc.ws.length) { el.innerHTML = ""; return []; }
    if (!recoil) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`; return []; }
    $("wcSimNote").textContent = tr("wc.sim.note4", "{m} m, {hp} health, your accuracy and headshot rate, with cone, bloom and recoil. Each firing style is tried 300 times.", { m: nf(st.range), hp: nf(st.hp) });
    paintSeg(); paintSimLegend();
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

    const meds = res.map((x) => (x.r && x.r.best ? x.r.best.median : null));
    const bestMed = bestOf(meds, -1);
    const cls = (v, w) => { const cb = classSim.get(classKey(w.cat)); return v != null && cb != null && v <= cb * (1 + 1e-9) ? "gold" : v != null && v === bestMed ? "good" : ""; };
    // the table's "with recoil" row
    for (const cell of document.querySelectorAll("#wcCards td[data-sim]")) {
      const i = +cell.dataset.sim, x = res[i], w = calc.ws[i];
      if (!x || !w) continue;
      const b = x.r && x.r.best;
      cell.className = `wc-med ${b ? cls(b.median, w) : ""}${x.busy ? " wc-busy" : ""}`;
      cell.innerHTML = x.none ? "–" : b ? `<b>${esc(fmtMs(b.median))}</b><span class="wc-cmp">${esc(styleLabel(b.burst, w.p.burstN))}</span>`
        : x.r ? `<b>${esc(tr("wc.never", "no kill"))}</b>` : "<b>…</b>";
    }

    // one scale for every spray picture, so the patterns can be compared by eye
    const sprays = calc.ws.map((w, i) => { const P = !res[i].none && paramsOf(w, chosenAtt(w.id)); return P ? sprayData(w, P) : null; });
    const S = Math.max(TARGET.halfW * 1.4, Math.abs(TARGET.bottom), TARGET.headY + TARGET.headR, ...sprays.filter(Boolean).map((d) => d.reach)) * 1.1;
    lastSprays = { sprays, S, names: calc.ws.map((w) => w.name) };
    el.innerHTML = calc.ws.map((w, i) => {
      const x = res[i];
      if (x.none) return `<article class="wc-sim" style="--c:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b></div><p class="wc-dim">${esc(tr("wc.sim.none", "No recoil data for this weapon."))}</p></article>`;
      const rows = (x.r && x.r.rows) || [], best = x.r && x.r.best;
      const worst = Math.max(1, ...rows.map((r) => r.median ?? 0));
      const bars = rows.map((r) => `<li class="${best && r.burst === best.burst ? "best" : ""}"><span class="lab">${esc(styleLabel(r.burst, w.p.burstN))}</span><span class="wc-meter"><i style="width:${r.median == null ? 0 : Math.max(2, r.median / worst * 100).toFixed(1)}%;background:${color(i)}"></i></span><span class="v">${r.median == null ? esc(tr("wc.never", "no kill")) : esc(fmtMs(r.median))} · ${nf(r.killRate * 100)}%</span></li>`).join("");
      const att = chosenAtt(w.id);
      const sub = !x.r ? esc(tr("wc.sim.busy", "simulating…")) : !best ? esc(tr("wc.sim.nobest", "Cannot kill reliably at this range with this setup")) : att.length ? esc(att.join(" · ")) : "";
      return `<article class="wc-sim${x.busy ? " wc-busy" : ""}" style="--c:${color(i)}"><div class="wc-simhead"><b>${esc(w.name)}</b><span class="wc-dim">${sub}</span></div>
        <div class="wc-simbody"><div><div class="wc-barhead"><span>${esc(tr("wc.sim.style", "Firing style"))}</span><span>${esc(tr("wc.sim.medRate", "median · kills"))}</span></div><ul class="wc-bars">${bars}</ul></div>${sprayFigure(sprays[i], S, i)}</div></article>`;
    }).join("");
    return jobs;
  }

  // ------------------------------------------------------------ deep dive --
  // Dorf's workbook tables, rebuilt from our own numbers, for one weapon (the first chosen, or the one picked here):
  // the Burst Analysis (per-shot hit chances), time to kill / best burst / kills per magazine over distance (log
  // axis, with his reference bands) and the Advanced Timings. Perfect aim throughout, so the weapon's
  // own cone, recoil and falloff are what shows: at the chest by default, at the page headshot rate
  // when the "follow" box is ticked (the reference bands are chest-aimed, so they hide in that case).
  // Folded by default; nothing is computed while it is closed.
  let deepId = null;
  let deepFollow = false;
  try { deepFollow = localStorage.getItem(FOLLOW_KEY) === "1"; } catch {}
  const deepInputs = { fps: 150, resY: 2160, fov: 74, zoom: 1.35 };   // timings inputs, Dorf's saved values
  const DEEP_GRID = [1, 2, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200];
  const deepGrid = (maxR) => { const g = DEEP_GRID.filter((r) => r <= maxR); if (g[g.length - 1] !== maxR) g.push(maxR); return g; };
  const DEEP_RUNS = 150;   // the best-burst-vs-distance chart: fewer trials, it is a trend, not a verdict
  const DW = 300, DH = 150, DL = 44, DR = 12, DT = 10, DB = 24;   // one size for every small chart

  // stacked bars for the chance to hit: body / head / leg per shot in the burst
  function deepStack(rows) {
    const X = (i) => DL + (i + 0.5) * ((DW - DL - DR) / rows.length);
    const Y = (v) => DT + (1 - v) * (DH - DT - DB);
    const bw = ((DW - DL - DR) / rows.length) * 0.7;
    let s = svgOpen(DW, DH, tr("wc.deep.hitChart", "Chance to hit, by shot in the burst")) + plotBg(DL, DT, DW - DL - DR, DH - DT - DB);
    for (const v of [0, 0.5, 1]) s += `<line class="grid" x1="${DL}" x2="${DW - DR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${DL - 4}" y="${Y(v) + 4}" text-anchor="end">${nf(v * 100)}%</text>`;
    const every = Math.max(1, Math.ceil(rows.length / 8));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], x = X(i) - bw / 2;
      const seg = (v0, v1, fill) => `<rect x="${x.toFixed(1)}" y="${Y(v1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, Y(v0) - Y(v1)).toFixed(1)}" fill="${fill}"/>`;
      s += seg(0, r.body, "var(--accent)") + seg(r.body, r.body + r.head, "var(--wc-gold)") + seg(r.body + r.head, r.total, "var(--dim)");
      if (i % every === 0) s += `<text class="ax" x="${X(i).toFixed(1)}" y="${DH - 6}" text-anchor="middle">${r.shot}</text>`;
    }
    return s + "</svg>";
  }

  // line chart on a log distance axis (1 m to `xMax`): [{ x, y }]; `bands` = [{ upto: (r) => ms, fill }] paints the
  // reference bands under the line
  function deepLine(pts, { xMax = 200, ymax = null, bands = null, step = false, yfmt = (v) => nf(v), aria = "" } = {}) {
    const yt = niceTicks(Math.max(1e-9, ymax ?? Math.max(1e-9, ...pts.map((p) => p.y))), 4), yMax = yt[yt.length - 1];
    const X = (r) => DL + (Math.log10(Math.max(1, r)) / Math.log10(Math.max(2, xMax))) * (DW - DL - DR);
    const Y = (v) => DT + (1 - Math.min(1, v / yMax)) * (DH - DT - DB);
    let s = svgOpen(DW, DH, aria) + plotBg(DL, DT, DW - DL - DR, DH - DT - DB);
    if (bands) {
      let lo = () => 0;
      for (const b of bands) {
        const top = b.upto;
        s += `<path d="M${pts.map((p) => `${X(p.x).toFixed(1)} ${Y(top(p.x)).toFixed(1)}`).join("L")}L${X(pts[pts.length - 1].x).toFixed(1)} ${Y(lo(pts[pts.length - 1].x)).toFixed(1)}L${pts.map((p) => `${X(p.x).toFixed(1)} ${Y(lo(p.x)).toFixed(1)}`).reverse().join("L")}Z" fill="${b.fill}" opacity="0.28"/>`;
        lo = top;
      }
    }
    for (const v of yt) s += `<line class="grid" x1="${DL}" x2="${DW - DR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${DL - 4}" y="${Y(v) + 4}" text-anchor="end">${yfmt(v)}</text>`;
    for (const r of [1, 10, 100].filter((r) => r < xMax * 0.8)) s += `<line class="grid" x1="${X(r)}" x2="${X(r)}" y1="${DT}" y2="${DH - DB}"/><text class="ax" x="${X(r).toFixed(1)}" y="${DH - 8}" text-anchor="${r === 1 ? "start" : "middle"}">${nf(r)}</text>`;
    s += `<text class="ax" x="${DW - DR}" y="${DH - 8}" text-anchor="end">${esc(fmtM(xMax))}</text>`;
    let d = "";
    pts.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`;
      if (step && i + 1 < pts.length) d += `L${X(pts[i + 1].x).toFixed(1)} ${Y(p.y).toFixed(1)}`;
    });
    s += `<path d="${d}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round"/>`;
    return s + "</svg>";
  }

  function drawDeep() {
    const el = $("wcDeep");
    if (!calc || !calc.ws.length) { el.innerHTML = ""; return []; }
    if (!$("wcDeepBox").open) return [];
    if (!recoil) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.wait", "Loading recoil data…"))}</p>`; return []; }
    if (!deepId || !calc.ws.some((w) => w.id === deepId)) deepId = calc.ws[0].id;
    const w = calc.ws.find((x) => x.id === deepId);
    const att = chosenAtt(w.id), sk = settingsKey();
    const key = `${w.id}|${att.join("+")}|${sk}|${deepFollow ? "f1" : "f0"}`;
    const P = paramsOf(w, att);
    const jobs = [];
    if (P && !deepCache.has("burst|" + key)) jobs.push({ key: "burst|" + key, kind: "burst", P: { ...P, hsr: deepFollow ? P.hsr : 0 }, distance: st.range, hp: st.hp, runs: SIM_RUNS });
    if (P && !deepCache.has("ranges|" + key)) jobs.push({ key: "ranges|" + key, kind: "ranges", P: { ...P, acc: 1, hsr: deepFollow ? P.hsr : 0 }, ranges: deepGrid(calc.maxR), hp: st.hp, runs: DEEP_RUNS });
    if (!P) { el.innerHTML = `<p class="wc-dim">${esc(tr("wc.sim.none", "No recoil data for this weapon."))}</p>`; return jobs; }

    const burst = deepCache.get("burst|" + key), ranges = deepCache.get("ranges|" + key);
    const busy = `<p class="wc-dim">${esc(tr("wc.sim.busy", "simulating…"))}</p>`;
    const fig = (cap, body, extra = "") => `<figure><figcaption>${esc(cap)}</figcaption><div class="wc-chart">${body}</div>${extra}</figure>`;
    const sel = `<label class="wc-field wc-deeppick"><span>${esc(tr("wc.deep.weapon", "Weapon"))}</span><select id="wcDeepW">${calc.ws.map((x) => `<option value="${x.id}" ${x.id === deepId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>`;
    const DORF_WORKBOOK = "https://drive.google.com/drive/folders/1ZCGUPWa530d2T0KvJrBpdesUGlmvYwB2";   // folder: the single-file link is dead
    const DORF_REDDIT = "https://www.reddit.com/user/EmperorDorf/";
    const deepNote = deepFollow
      ? tr("wc.deep.noteFollow", "Perfect aim: {hsr}% of shots at the head, the rest at the chest: only the weapon's cone, recoil and damage falloff count here. {m} m, {hp} health.", { hsr: nf(st.hsr), m: nf(st.range), hp: nf(st.hp) })
      : tr("wc.deep.note", "Perfect aim at the chest: only the weapon's cone, recoil and damage falloff count here. {m} m, {hp} health.", { m: nf(st.range), hp: nf(st.hp) });
    let h = `<div class="wc-deephead">${sel}<p class="wc-note">${esc(deepNote)}</p><label class="wc-check"><input type="checkbox" id="wcDeepFollow" ${deepFollow ? "checked" : ""} title="${esc(tr("wc.deep.followTip", "Use your headshot-rate slider in the tables below, instead of aiming everything at the chest."))}" /> <span>${esc(tr("wc.deep.follow", "Follow my headshot rate"))}</span></label><p class="wc-note">${esc(tr("wc.deep.source", "Source:"))} <a href="${DORF_WORKBOOK}" target="_blank" rel="noopener noreferrer">${esc(tr("wc.deep.workbook", "Weapon Surgeon workbook"))}</a> · <a href="${DORF_REDDIT}" target="_blank" rel="noopener noreferrer">${esc(tr("wc.deep.reddit", "u/EmperorDorf on Reddit"))}</a></p></div><div class="wc-deepgrid">`;

    // 1) hit chance by shot in a long burst, shots that never hit cut off
    const sw = (c, t) => `<span><span class="sw" style="background:${c}"></span>${esc(t)}</span>`;
    h += fig(tr("wc.deep.hitChart", "Chance to hit, by shot in the burst"), burst ? deepStack(burst.slice(0, burstRowsShown(burst))) : busy,
      burst ? `<div class="wc-legend">${sw("var(--accent)", tr("wc.deep.body", "Body"))}${sw("var(--wc-gold)", tr("wc.deep.head", "Head"))}${sw("var(--dim)", tr("wc.deep.leg", "Leg"))}</div>` : "");
    // 2) over distance
    const ttkPts = (ranges || []).filter((r) => r.best).map((r) => ({ x: r.range, y: r.best.median }));
    const burstPts = (ranges || []).filter((r) => r.best).map((r) => ({ x: r.range, y: r.best.burst }));
    const stkPts = deepGrid(calc.maxR).map((r) => {
      if (!deepFollow) return { x: r, y: minShots(w.p, { hp: st.hp, range: r }) };
      const hd = hitDamage(w.p, r), d = (1 - st.hsr / 100) * hd.body + (st.hsr / 100) * hd.head;
      return { x: r, y: d > 0 ? Math.ceil(st.hp / (d * w.p.pellets)) : null };
    }).filter((p) => p.y != null);
    const kpmPts = stkPts.map((p) => ({ x: p.x, y: w.p.mag / p.y }));
    // the bands are EmperorDorf's chest-aimed reference times: they only mean anything next to the chest table
    const bands = deepFollow ? null : [{ upto: (r) => deepBands(r).green, fill: "var(--wc-band-g)" }, { upto: (r) => deepBands(r).yellow, fill: "var(--wc-band-y)" }, { upto: () => Math.max(...ttkPts.map((p) => p.y), 1) * 1.1, fill: "var(--wc-band-r)" }];
    h += fig(tr("wc.deep.ttk", "Time to kill"), ranges && ttkPts.length ? deepLine(ttkPts, { xMax: calc.maxR, bands, aria: tr("wc.deep.ttk", "Time to kill") }) : busy,
      deepFollow ? "" : `<div class="wc-legend">${sw("var(--wc-band-g)", tr("wc.deep.bandG", "fastest 15%"))}${sw("var(--wc-band-y)", tr("wc.deep.bandY", "average"))}${sw("var(--wc-band-r)", tr("wc.deep.bandR", "slower"))}</div>`);
    h += fig(tr("wc.deep.bestBurst", "Best burst length"), ranges && burstPts.length ? deepLine(burstPts, { xMax: calc.maxR, ymax: Math.max(4, ...burstPts.map((p) => p.y)), step: true, aria: tr("wc.deep.bestBurst", "Best burst length") }) : busy);
    h += fig(tr("wc.deep.kpm", "Kills per magazine"), deepLine(kpmPts, { xMax: calc.maxR, yfmt: (v) => nf(v, 1), aria: tr("wc.deep.kpm", "Kills per magazine") }));
    h += `</div><p class="wc-dim">${esc(deepFollow ? tr("wc.deep.bandsFollow", "Reference bands hidden while following your headshot rate: EmperorDorf's bands are chest-aimed.") : tr("wc.deep.bands2", "Bands: EmperorDorf's 40 reference weapons at the same range."))}</p>`;

    // 3) Advanced Timings: one row per firing style the simulator tries, the pulldown as first shot + every next one
    const T = deepTimings(P, deepInputs);
    const styles = new Set(stylesFor(P).filter((n) => n <= 20));
    const rec = T.recoil.filter((r) => styles.has(r.n)), cof = new Map(T.cof.map((r) => [r.n, r]));
    const numIn = (id, label, v, min, max, step) => `<label class="wc-field"><span>${esc(label)}</span><input id="${id}" type="number" value="${v}" min="${min}" max="${max}" step="${step}"></label>`;
    const th = (t) => `<th>${esc(t)}</th>`;
    h += `<h3>${esc(tr("wc.deep.timings", "Advanced timings and recoil control"))}</h3><p class="wc-note">${esc(tr("wc.deep.timingsNote", "Perfect bursting: how long to hold the trigger, how long to let go, and how far to pull down. His formulas, our numbers."))}</p>`
      + `<div class="wc-deepin">${numIn("wcDeepFps", tr("wc.deep.fps", "Frame rate (1% lows)"), deepInputs.fps, 30, 500, 1)}${numIn("wcDeepResY", tr("wc.deep.resY", "Screen height (px)"), deepInputs.resY, 720, 4320, 1)}${numIn("wcDeepFov", tr("wc.deep.fov", "Field of view"), deepInputs.fov, 40, 120, 1)}${numIn("wcDeepZoom", tr("wc.deep.zoom", "Optical zoom"), deepInputs.zoom, 1, 4, 0.05)}</div>`
      + `<div class="wc-deepgrid wc-deepgrid2"><figure><figcaption>${esc(tr("wc.deep.msCap", "Times in ms"))}</figcaption><div class="ranks-table-wrap wc-table-wrap"><table class="ranks-table wc-deep-t"><thead><tr>${th(tr("wc.sim.style", "Firing style"))}${th(tr("wc.deep.down", "Hold"))}${th(tr("wc.deep.relRecoil", "Let go: recoil"))}${th(tr("wc.deep.relCof", "Let go: cone"))}</tr></thead><tbody>`
      + rec.map((r) => `<tr><td>${esc(styleLabel(r.n, P.burstN))}</td><td>${nf(r.down)}</td><td>${nf(r.release)}</td><td>${nf(cof.get(r.n).release)}</td></tr>`).join("") + `</tbody></table></div></figure>`
      + `<figure><figcaption>${esc(tr("wc.deep.pull", "Vertical recoil counteraction"))} · ${esc(tr("wc.deep.angle", "Pull angle {deg}°", { deg: nf(T.pull[0].angle, 1) }))}</figcaption><div class="ranks-table-wrap wc-table-wrap"><table class="ranks-table wc-deep-t"><thead><tr>${th(tr("wc.deep.shot", "Shot"))}${th(tr("wc.deep.deg", "Degrees"))}${th(tr("wc.deep.px", "Pixels"))}${th(tr("wc.deep.speed", "Speed"))}</tr></thead><tbody>`
      + [[tr("wc.deep.first", "First shot"), T.pull[0]], [tr("wc.deep.next", "Each next shot"), T.pull[1]]].filter(([, p]) => p).map(([t, p]) => `<tr><td>${esc(t)}</td><td>${nf(p.deg, 2)}</td><td>${nf(p.px, 1)}</td><td>${nf(p.speed)}</td></tr>`).join("") + `</tbody></table></div></figure></div>`;
    el.innerHTML = `<div class="wc-deep">${h}</div>`;
    return jobs;
  }
  $("wcDeepBox").addEventListener("toggle", () => invalidate("sim"));
  $("wcDeep").addEventListener("change", (e) => {
    if (e.target.id === "wcDeepW") { deepId = Number(e.target.value); invalidate("sim"); return; }
    if (e.target.id === "wcDeepFollow") { deepFollow = e.target.checked; try { localStorage.setItem(FOLLOW_KEY, deepFollow ? "1" : "0"); } catch {} invalidate("sim"); return; }
    const map = { wcDeepFps: "fps", wcDeepResY: "resY", wcDeepFov: "fov", wcDeepZoom: "zoom" };
    const k = map[e.target.id];
    if (k) { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) { deepInputs[k] = v; invalidate("sim"); } }
  });
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
    const n = Math.min(30, P.mag);
    const seed = (simState.seed + w.id * 7919) % 2147483647;
    const main = sprayPattern(P, { distance: st.range, seed, shots: n });
    const ghosts = [];
    for (let g = 1; g <= GHOST_SPRAYS; g++) ghosts.push(...sprayPattern(P, { distance: st.range, seed: seed + g * 104723, shots: n }));
    // the aim points: the chest unless every shot goes to the head, the head when any does
    const aims = [];
    if (st.hsr < 100) aims.push({ x: 0, y: 0 });
    if (st.hsr > 0) aims.push({ x: TARGET.headX, y: TARGET.headY });
    const reach = Math.max(0, ...[...main, ...ghosts].map((s) => Math.max(Math.abs(s.x), Math.abs(s.y))));
    // what the bullets hit, over every spray drawn: head, body, legs, or a miss
    const all = [...main, ...ghosts], tot = all.length || 1;
    const heads = all.filter((s) => s.zone === "head").length, hits = all.filter((s) => s.zone).length;
    const stats = { hit: hits / tot, hs: heads / (hits || 1) };
    return { n, main, ghosts, aims, reach, stats };
  }
  // one bullet: a filled dot if it hit the head, a ring if the body, a diamond if the legs, a grey dot if it missed
  function shotDot(s, cx, cy, U, c, op, big) {
    const x = (cx + s.x * U).toFixed(1), y = (cy - s.y * U).toFixed(1);
    if (s.zone === "head") return `<circle cx="${x}" cy="${y}" r="${big ? 2.6 : 1.4}" fill="${c}" fill-opacity="${op.toFixed(2)}"/>`;
    if (s.zone === "body") return `<circle cx="${x}" cy="${y}" r="${big ? 2.6 : 1.4}" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op.toFixed(2)}"/>`;
    if (s.zone === "leg") { const r = big ? 2.8 : 1.3, nx = parseFloat(x), ny = parseFloat(y); return `<path d="M${nx.toFixed(1)} ${(ny - r).toFixed(1)}L${(nx + r).toFixed(1)} ${ny.toFixed(1)}L${nx.toFixed(1)} ${(ny + r).toFixed(1)}L${(nx - r).toFixed(1)} ${ny.toFixed(1)}Z" fill="${c}" fill-opacity="${op.toFixed(2)}"/>`; }
    return `<circle class="wc-miss" cx="${x}" cy="${y}" r="${big ? 1.8 : 1}" fill-opacity="${(op * 0.7).toFixed(2)}"/>`;
  }
  function sprayFigure(d, S, i, Z = 240) {
    if (!d) return "";
    const U = (Z / 2) / S, cx = Z / 2, cy = Z / 2;
    let svg = svgOpen(Z, Z, tr("wc.sim.aria", "Where a full-magazine spray lands on the target"));
    svg += `<rect class="wc-tgt" x="${cx - TARGET.halfW * U}" y="${cy - TARGET.top * U}" width="${2 * TARGET.halfW * U}" height="${(TARGET.top - TARGET.bottom) * U}"/>`;
    svg += `<line class="wc-tgt" x1="${cx - TARGET.halfW * U}" y1="${cy - TARGET.legTop * U}" x2="${cx + TARGET.halfW * U}" y2="${cy - TARGET.legTop * U}"/>`;
    svg += `<circle class="wc-tgt" cx="${cx + TARGET.headX * U}" cy="${cy - TARGET.headY * U}" r="${TARGET.headR * U}"/>`;
    svg += d.ghosts.map((s) => shotDot(s, cx, cy, U, color(i), 0.25, Z !== 240)).join("");
    svg += d.main.map((s) => shotDot(s, cx, cy, U, color(i), 0.4 + 0.6 * (1 - s.i / d.n), Z !== 240)).join("");
    for (const a of d.aims) {                     // the aim points, drawn last so they stay visible
      const ax = cx + a.x * U, ay = cy - a.y * U, k = 5;
      svg += `<path class="wc-aimx" d="M${(ax - k).toFixed(1)} ${ay.toFixed(1)}H${(ax + k).toFixed(1)}M${ax.toFixed(1)} ${(ay - k).toFixed(1)}V${(ay + k).toFixed(1)}"/>`;
    }
    svg += "</svg>";
    const cap = tr("wc.sim.hitLine", "{h}% hit · {hs}% of hits on the head · {w} m across", { h: nf(d.stats.hit * 100), hs: nf(d.stats.hs * 100), w: nf(2 * S, 1) });
    const zoom = Z === 240 ? `<button type="button" class="wc-zoombtn" data-zoom="${i}" title="${esc(tr("wc.sim.zoom", "Zoom"))}" aria-label="${esc(tr("wc.sim.zoom", "Zoom"))}"><span aria-hidden="true">🔍</span></button>` : "";
    return `<figure class="wc-spray"><div class="wc-sprayimg">${svg}${zoom}</div><figcaption class="wc-hitline">${esc(cap)}</figcaption></figure>`;
  }

  $("wcReroll").addEventListener("click", () => { simState.seed = newSeed(); invalidate("sim"); });

  // icon buttons: aim (ADS / hip) and stance (4)
  const ico = (body) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const stand = '<circle cx="12" cy="4.5" r="2.3"/><path d="M12 7.5v8M12 9.5l-4 4M12 9.5l4 4M12 15.5l-3 6.5M12 15.5l3 6.5"/>';
  const crouch = '<circle cx="11" cy="8" r="2.3"/><path d="M11 11l-1 5.5M11 12.5l5 1.5M10 16.5l6 1.5-1 4M10 16.5l-3 5"/>';
  const speed = '<path d="M2 8h4M1 12h5M2 16h4"/>';
  const ICONS = {
    ads: ico('<circle cx="12" cy="12" r="6.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>'),
    hip: ico('<path d="M2.5 13h12l2-2.5h5v4h-4.5l-1 4h-3l-.8-4H2.5z"/>'),
    crouchStill: ico(crouch), standStill: ico(stand),
    crouchMove: ico(crouch + speed), standMove: ico(stand + speed),
  };
  const STANCE_EN = { crouchStill: "Crouched, still", standStill: "Standing, still", crouchMove: "Crouched, moving", standMove: "Standing, moving" };
  // aim (hip / ADS) also changes which attachments count (hip-only parts), so it redraws everything; stance is simulator-only
  const SEGS = [
    ["wcSimAim", [["ads", "Aiming down sights", "wc.sim.ads"], ["hip", "Hip fire", "wc.sim.hip"]], () => simState.aim, (k) => { simState.aim = k; }, ["range", "cards"]],
    ["wcSimStance", STANCES.map((k) => [k, STANCE_EN[k], "wc.sim.st." + k]), () => simState.stance, (k) => { simState.stance = k; }, ["sim"]],
  ];
  function paintSeg() {
    for (const [id, items, get] of SEGS) {
      const box = $(id), cur = get();
      const html = items.map(([k, en, key]) => { const t = tr(key, en); return `<button type="button" role="radio" class="wc-segbtn" data-k="${k}" aria-checked="${cur === k}" aria-label="${esc(t)}" title="${esc(t)}">${ICONS[k]}<span>${esc(t)}</span></button>`; }).join("");
      if (box.innerHTML !== html) box.innerHTML = html;
    }
  }
  for (const [id, , , set, what] of SEGS) $(id).addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; set(b.dataset.k); paintSeg(); for (const x of what) invalidate(x); });
  const cp = $("wcSimComp");
  cp.addEventListener("input", () => { simState.comp = +cp.value; $("wcSimCompV").textContent = nf(simState.comp) + "%"; invalidate("sim"); });
  const cpx = $("wcSimCompX");
  cpx.addEventListener("input", () => { simState.compX = +cpx.value; $("wcSimCompXV").textContent = nf(simState.compX) + "%"; invalidate("sim"); });

  paintLabels(); paintSeg();
  invalidate("all");
  // recoil data after the first draw (it is the biggest file); the rows, the attachment menus and the simulator fill in when it lands
  fetch("assets/weapons/recoil.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j && j.weapons && j.atts) { recoil = j; pruneAtt(); classCache.clear(); invalidate("all"); }
  }).catch(() => {});
}
