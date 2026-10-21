/**
 * columns.html worked example (t445u): the demo name lives in an input
 * (prefilled YuigahamaYui); typing another cached name swaps every number in
 * the example for that character's. Same data and formulas as the main table:
 * the shared ranks.json row decides "in the cache" (hidden players are not in
 * it) and supplies the final ⚔️ iVi / percentile; the player's own
 * data/players/<slug>.json gives the step-by-step parts via playerMetrics()
 * (💩 padder penalty + 🚜 vehicle / MAX cut included). Text pieces are pure
 * (exampleFacts / exampleCard), so Node tests cover them.
 */
import { t as tr } from "./i18n.mjs";
import { normalizePlayer, playerMetrics, consistencyParts, MIN_FIGHTS_RULE } from "./player-metrics.mjs?v=20261021-bare1";
import { RF_SOFT, SPEED_BAND_LOW, SPEED_BAND_HIGH, speedSlowFactor, speedAdjustment, SLOPE_FLOOR, SLOPE_EPS } from "./math.mjs?v=20261010-sav1";
import { percentileOf, quantile } from "./dist.mjs?v=20261010-sav1";
import { slugKey, bareName } from "./rank-row.mjs?v=20261021-bare1";
import { PADDER_PENALTY_REF } from "./padding.mjs?v=20261020-i18n2";

export const DEMO_NAME = "YuigahamaYui";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const f = (v, d = 2) => (fin(v) ? v.toFixed(d) : "—");
const r0 = (v) => (fin(v) ? String(Math.round(v)) : "—");
const minus = (s) => String(s).replace(/^-/, "−");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Sorted finite pool of one ranks.json column. */
export function ranksPool(payload, col) {
  const i = payload.cols.indexOf(col);
  return payload.rows.map((r) => r[i]).filter(fin).sort((a, b) => a - b);
}

/** ranks.json row for a typed name (case-insensitive, outfit tag ignored), or null. */
export function findRanksRow(payload, name) {
  const k = slugKey(name);
  if (!k || !payload) return null;
  const i = payload.cols.indexOf("slug");
  const row = payload.rows.find((r) => r[i] === k);
  return row ? Object.fromEntries(payload.cols.map((c, j) => [c, row[j]])) : null;
}

/** Every number the worked example shows, from one raw player file (+ population pools). */
export function exampleFacts(raw, pools = {}) {
  const p = normalizePlayer(raw);
  const m = playerMetrics(p);
  const cp = consistencyParts(p);
  const s = m.m || {};
  const own = m.ownKpm;
  const preCut = m.adjsBase != null ? m.adjsBase : m.adjsPreVeh != null && !m.poop ? m.adjsPreVeh : m.adjs;
  return {
    name: bareName(p.display) || p.display,
    top: p.top,
    thin: m.thin,
    kd: m.kd, kpm: m.kpm, own, acc: m.acc, hsr: m.hsr, ivi: m.ivi,
    kills: s.kills, deaths: s.deaths, ekpm: m.ekpm, rkd: m.rkd, rf: m.rf,
    log2: fin(m.rf) && m.rf > 0 ? Math.log2(m.rf / RF_SOFT) : NaN,
    adj: m.adj,
    slowFactor: speedSlowFactor(own),
    speedDelta: speedAdjustment(own, m.adj),
    speed: preCut, // ⚔️ iVi after pace, before 💩 / 🚜
    poop: !!m.poop,
    afterPoop: m.poop ? (m.adjsPreVeh != null ? m.adjsPreVeh : m.adjs) : NaN,
    vehCut: m.vehCut || 0, vehOnly: m.vehOnly, maxShare: m.maxShare, vehCutVeh: m.vehCutVeh, vehCutMax: m.vehCutMax,
    adjs: m.adjs,
    pct: pools.adjs ? percentileOf(pools.adjs, m.adjs) : null,
    median: pools.adjs ? quantile(pools.adjs, 0.5) : NaN,
    iviPct: pools.ivi ? percentileOf(pools.ivi, m.ivi) : null,
    act: m.act, slope: m.slope,
    shifted: fin(m.slope) ? Math.max(m.slope - SLOPE_FLOOR + SLOPE_EPS, SLOPE_EPS) : NaN,
    pvs: m.pvs,
    consLo: cp ? cp.lo : NaN, consHi: cp ? cp.hi : NaN, cons: cp ? cp.value : NaN,
    kd05: m.kd05, inflation: m.inflation, coi: m.coi, mech: m.mech,
  };
}

const fmtSigned = (v) => minus(r0(v));

function trackerLook(pct) {
  if (pct == null || pct < 45) return tr("cx.lookLow", "below average");
  if (pct <= 55) return tr("cx.lookMid", "average");
  return tr("cx.lookHigh", "above average");
}
function oppWords(ekpm) {
  if (!fin(ekpm)) return "";
  if (ekpm >= 0.9) return tr("cx.oppVhard", " Very hard opposition.");
  if (ekpm >= 0.6) return tr("cx.oppHard", " Hard opposition.");
  if (ekpm >= 0.42) return tr("cx.oppHarder", " Harder than average opposition.");
  if (ekpm >= 0.3) return tr("cx.oppAvg", " About average opposition.");
  return tr("cx.oppSoft", " Soft opposition.");
}

/** Inner HTML of the example card (same layout as the static page), DOM-free. */
export function exampleCard(x) {
  const shown = fin(x.adjs) ? Math.max(0, x.adjs) : NaN;
  const own = f(x.own);
  let pace;
  if (x.own < SPEED_BAND_LOW && x.adj > 0) pace = tr("cx.paceSlow", "Slow pace (own KPM {own}, under {low}): × {factor} → ⚔️ iVi <b>{v}</b>", { own, low: SPEED_BAND_LOW, factor: f(x.slowFactor), v: fmtSigned(x.speed) });
  else if (x.own < SPEED_BAND_LOW) pace = tr("cx.paceSlowZero", "Slow pace (own KPM {own}, under {low}), but a rating at or below 0 gets no extra cut → ⚔️ iVi <b>{v}</b>", { own, low: SPEED_BAND_LOW, v: fmtSigned(x.speed) });
  else if (x.own <= SPEED_BAND_HIGH) pace = tr("cx.paceNormal", "Normal pace (own KPM {own}, {low}–{high}): no change → ⚔️ iVi <b>{v}</b>", { own, low: SPEED_BAND_LOW, high: SPEED_BAND_HIGH, v: fmtSigned(x.speed) });
  else pace = tr("cx.paceFast", "Fast pace (own KPM {own}, over {high}): + {delta} → ⚔️ iVi <b>{v}</b>", { own, high: SPEED_BAND_HIGH, delta: r0(x.speedDelta), v: fmtSigned(x.speed) });
  const items = [
    tr("cx.opp", "Their {top} most-fought opponents kill at {ekpm} per minute (a typical player’s opponents: ~0.35).{opp}", { top: x.top, ekpm: f(x.ekpm), opp: oppWords(x.ekpm) }),
    tr("cx.kd", "☠️ K/D against them: {k} ÷ {d} = <b>{v}</b>", { k: x.kills, d: x.deaths, v: f(x.rkd) }),
    tr("cx.resist", "🛡️ Resist: {a} × {b} = <b>{v}</b>", { a: f(x.rkd), b: f(x.ekpm), v: f(x.rf, 3) }),
    tr("cx.rating", "Rating: 600 × (1 + log₂({rf} ÷ 0.6)) = <b>{v}</b>", { rf: f(x.rf, 3), v: fmtSigned(x.adj) }),
    pace,
  ];
  if (x.poop) items.push(tr("cx.poop", "💩 Confirmed padder: {cut} → ⚔️ iVi <b>{v}</b>", { cut: x.speed > 0 ? "−10%" : `−${Math.round(0.1 * PADDER_PENALTY_REF)}`, v: fmtSigned(x.afterPoop) }));
  if (x.vehCut > 0) {
    const parts = [];
    if (x.vehCutVeh > 0) parts.push(tr("veh.partVehicle", "vehicle kills {p}%: −{c}%", { p: Math.round(x.vehOnly * 100), c: Math.round(x.vehCutVeh * 100) }));
    if (x.vehCutMax > 0) parts.push(tr("veh.partMax", "MAX kills {p}%: −{c}%", { p: Math.round(x.maxShare * 100), c: Math.round(x.vehCutMax * 100) }));
    items.push(tr("cx.veh", '<a href="#vehicle-cut">🚜</a> {parts} → ⚔️ iVi <b>{v}</b>', { parts: parts.join(tr("veh.join", " · ")), v: fmtSigned(x.adjs) }));
  }
  const list = items.map((t) => `        <li>${t}</li>`).join("\n");
  return (
    tr("cx.trackers", '<p><b>What trackers show:</b> <span class="st-num">KD {kd} · IvI {ivi}</span>, which looks {look}.</p>', { kd: f(x.kd), ivi: r0(x.ivi), look: trackerLook(x.iviPct) }) +
    "\n      " + tr("cx.sees", "<p><b>What the site sees:</b></p>") +
    `\n      <ol class="st-list st-num">\n${list}\n      </ol>\n      ` +
    tr("cx.result", "<p><b>Result:</b> {v}, better than {pct}% of tracked players (median {median}). The public IvI said {ivi}. Same sample: 🏃 Activity {act} · 🦁 Brave {brave} · ⚡ Const {cons}.</p>", { v: r0(shown), pct: x.pct == null ? "—" : x.pct, median: r0(x.median), ivi: r0(x.ivi), act: f(x.act), brave: f(x.pvs), cons: f(x.cons) })
  );
}

/** Friendly note for a name that isn't in the shared cache. */
export function notCachedHtml(name) {
  const b = bareName(name) || String(name).trim();
  return tr("cx.notCached", "“{name}” isn’t in the shared cache yet. Get their stats on the <a href=\"index.html?names={enc}\">main page</a> (Analyze), then come back here.", { name: esc(b), enc: encodeURIComponent(b) });
}
export const THIN_HTML = (name) => tr("cx.thin", "{name} has too few fights to measure yet (needs {rule}), so the example keeps the previous player.", { name: esc(bareName(name) || name), rule: MIN_FIGHTS_RULE });

// ---- page wiring (browser only) ----
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const input = $("exName");
  if (input) {
    let ranksP = null;
    const loadRanks = () =>
      (ranksP ||= fetch("data/ranks.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))));
    const fileCache = new Map();
    const loadFile = (slug) => {
      if (!fileCache.has(slug)) fileCache.set(slug, fetch(`data/players/${slug}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
      return fileCache.get(slug);
    };
    let pools = null;
    let seq = 0;
    const msg = $("exMsg");
    const say = (html) => { msg.innerHTML = html || ""; msg.hidden = !html; };
    const fit = () => { input.size = Math.max(6, Math.min(32, (input.value || "").length + 1)); };
    function paint(x) {
      $("exCard").innerHTML = exampleCard(x);
    }
    async function show(name) {
      const my = ++seq;
      const typed = String(name || "").trim();
      if (!slugKey(typed)) { say(""); return; }
      let payload;
      try { payload = await loadRanks(); } catch { if (my === seq) say(tr("cx.loadFail", "Could not load the shared cache right now. Please try again later.")); return; }
      if (my !== seq) return;
      pools ||= { adjs: ranksPool(payload, "adjs"), ivi: ranksPool(payload, "ivi") };
      const row = findRanksRow(payload, typed);
      if (!row) { say(notCachedHtml(typed)); return; }
      if (row.thin === 1) { say(THIN_HTML(row.name)); return; }
      const raw = await loadFile(row.slug);
      if (my !== seq) return;
      if (!raw) { say(notCachedHtml(typed)); return; }
      const x = exampleFacts(raw, pools);
      // ranks.json is what the main table shows: prefer its final ⚔️ iVi if the file is a newer copy.
      if (fin(row.adjs) && Math.abs(row.adjs - x.adjs) > 0.5) console.warn("columns example: ranks.json vs file iVi differ", row.adjs, x.adjs);
      say("");
      paint(x);
    }
    let t = 0;
    input.addEventListener("input", () => { fit(); clearTimeout(t); t = setTimeout(() => show(input.value), 400); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(t); show(input.value); } });
    fit();
    // Lazy: the static page already shows the demo numbers; refresh them from the live cache once the page is idle.
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    idle(() => show(input.value || DEMO_NAME));
  }
}
