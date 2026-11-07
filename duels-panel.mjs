/**
 * 🤺 Duels tab (owner 2026-10-28, both rooms): one player → that player vs the crowd (killboard
 * the page already has, nemesis / favourite target; no Census call); two players → head-to-head:
 * a comparison of both sides and every kill between them, cut into fights (▸ opens a fight).
 * Three to five players → 1-vs-many (#113): one row per opponent with the 🌐 ladder win% and
 * the 📈 pairwise Glicko win% side by side; the first name is the subject, the rest are opponents.
 * Logic in duels.mjs. Head-to-head data on first open: up to 5 Census pages of one player's
 * kills & deaths (the whole history on "Read further back"), plus 2 calls for the weapons' lifetime shots / hits.
 * A small spinner sits in the status line while a load runs.
 * Each Census page re-renders the table as it arrives, and a ticking page/elapsed line
 * proves the load is alive between pages (the spinner alone does not rotate on
 * animation-disabled devices).
 * Head-to-head history is cached in this browser (last 10 pairs): opening a pair shows the
 * saved history at once, then fetches only newer kills in the background.
 */
import { t as tr, currentLang } from "./i18n.mjs";
import { zoneName } from "./scrims-panel.mjs?v=20261103-ps1";
import { mergeEvents } from "./scrims.mjs?v=20261028-os2";
import {
  AUTO_PAGES, FIRST_FIGHTS, nsOfBase, pairFloor, DUEL_GAP, ONE_V_ONE, classOf, bareName, crowdRows, crowdSummary, expectedCount, pagerOf,
  readPairPages, readPairNewer, pairEvents, fightsOf, fightResult, weaponShotUrls, parseShotStats, perKill, pairSummary,
  charInfoUrl, parseCharInfo, pairWarnings, WORLD_NAME, iviLuck, duelFitKind, DUEL_FIT_V1,
  DUEL_CACHE_KEY, duelCacheEntry, duelCacheRestore, duelCachePrune,
} from "./duels.mjs?v=20261102-luck5";
import { duelGlickoFromIvi, pairChance, rating } from "./glicko2.mjs?v=20261106-glk3";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return currentLang() || undefined; } catch { return undefined; } };
const int = (n) => Math.round(n).toLocaleString(lang());
const num1 = (n) => (n == null || !Number.isFinite(n) ? "–" : n < 10 ? n.toLocaleString(lang(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : int(n));
const kdTxt = (n) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(2));
const pct0 = (n) => (n == null || !Number.isFinite(n) ? "–" : `${Math.round(n * 100)}%`);
const pct = (n) => (n == null || !Number.isFinite(n) ? "–" : `${(n * 100).toLocaleString(lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const tagOf = (n) => { const m = /^\[([^\]]*)\]/.exec(String(n || "")); return m ? m[1] : ""; };
const dateTime = (t) => new Date(t * 1000).toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" });
const dateOnly = (t) => new Date(t * 1000).toLocaleDateString(lang(), { day: "numeric", month: "short", year: "numeric" });
const clock = (t) => new Date(t * 1000).toLocaleTimeString(lang(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Short class names stay English (community abbreviations, like KPM / K/D); the hover is translated. */
const CLS_SHORT = { inf: "Inf", la: "LA", med: "Medic", eng: "Eng", ha: "HA", max: "MAX" };
const CLS_FULL = { inf: "Infiltrator", la: "Light Assault", med: "Combat Medic", eng: "Engineer", ha: "Heavy Assault", max: "MAX" };
const clsFull = (c) => (c ? tr(`duel.cls.${c}`, CLS_FULL[c]) : "");
const clsHtml = (c) => (c ? `<span title="${esc(clsFull(c))}">${esc(CLS_SHORT[c])}</span>` : "–");

const gapTxt = (s) => (s < 60 ? `+${s}s` : `+${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`);

function personHtml(full) {
  const nm = bareName(full);
  if (!nm) return `<span class="kf-name kf-unknown">${esc(tr("kf.unknown", "Unknown player"))}</span>`;
  const tag = tagOf(full);
  return `${tag ? `<span class="kf-tag">[${esc(tag)}]</span> ` : ""}<button type="button" class="kf-name" data-name="${esc(nm)}" title="${esc(tr("kf.addTip", "Add {name} to the names", { name: nm }))}">${esc(nm)}</button>`;
}

// 🎬 Duel replay links (#102) hidden for now (owner 2026-11-07): the
// replayDuelHtml / replayVsHtml helpers were removed with their call sites
// below. The solo 🎬 in stats-table.mjs / rankings.mjs and the scrim-row 🎬
// in scrims-panel.mjs are hidden too (same day, same reason: whole replay
// system to be redesigned). The replay/ page stays, and the
// duel.replayDuel / duel.replayVs keys stay in i18n/en.json so this is a
// one-commit revert.

const fightResLabel = (res, a, b) => (res === "won" ? tr("duel.won", "{name} won", { name: a }) : res === "lost" ? tr("duel.won", "{name} won", { name: b }) : tr("scr.draw", "Draw"));

/* ------------------------------------------------------------ vs the crowd */

function crowdColumns() {
  return [
    { id: "kills", label: tr("duel.c.kills", "Kills"), hint: tr("duel.c.killsTip", "This player's kills on them."), fn: (r) => r.kills },
    { id: "deaths", label: tr("duel.c.deaths", "Deaths"), hint: tr("duel.c.deathsTip", "Times they killed this player."), fn: (r) => r.deaths },
    { id: "kd", label: "K/D", hint: tr("duel.c.kdTip", "This player's kills ÷ deaths against them."), fn: (r) => (r.kd == null ? (r.kills ? Infinity : -1) : r.kd) },
    { id: "kpm", label: tr("duel.c.kpm", "Their KPM"), hint: tr("duel.c.kpmTip", "The opponent's own kills per minute (how fast a player they are)."), fn: (r) => (r.kpm == null ? -1 : r.kpm) },
    { id: "share", label: tr("duel.c.share", "Share"), hint: tr("duel.c.shareTip", "Share of this player's kills & deaths in the killboard."), fn: (r) => r.share },
  ];
}

/* ------------------------------------------------------------ panel */

/**
 * @param section <details id="duelsSection">
 * @param o getJson(url) (Census), baseOf(p) → Census base, addName(name, anchor), sortScroll,
 *   catalog() → Promise<{ items: { id: [name, category, …] } }>,
 *   pairApi({ ns, p, q, want, seen }) → Promise<reply>: the cache Worker's pair cache (#83,
 *   GET /duels/pair, worker/src/duel-store.js). reply = { v: 1, events (p's compact events: every kill
 *   with q plus p's other kills & deaths within 10 min), rev, lo, hi, done, fights, kills, pages,
 *   blocks, error? }. Each call reads a few Census pages on the server and keeps them for every
 *   device; the panel calls again until FIRST_FIGHTS fights (first open) or the whole history ("Read
 *   further back"), re-drawing after every call. A throw before anything came → the Census path.
 */
export function mountDuels(section, o = {}) {
  if (!section) return { setPlayers() {} };
  const { getJson, baseOf, addName, sortScroll, catalog = async () => null, pairApi = null, dataDir = "data/", isPS = false } = o;
  const count = section.querySelector(".duel-count");
  const sum = section.querySelector(".duel-summary");
  const status = section.querySelector(".duel-status");
  const cmpWrap = section.querySelector(".duel-cmp-wrap");
  const cmp = section.querySelector(".duel-cmp");
  const wrap = section.querySelector(".duel-scroll");
  const table = section.querySelector(".duel-table");
  const moreBtn = section.querySelector(".duel-more");
  // ⚠️ Same faction / different servers (owner 2026-10-28): say so up front, so an empty result isn't a surprise.
  const warn = document.createElement("p");
  warn.className = "duel-warn";
  warn.setAttribute("role", "note");
  warn.hidden = true;
  section.insertBefore(warn, status);
  // 🌐 Infantry ladder (owner 2026-11-06): one Glicko-2 rating per PC player from every stored
  // infantry kill of the last 30 days (data/ladder.json, built by scripts/ladder-eval.mjs).
  // Works for any two players, also on different servers or with no kills between them.
  const ladderEl = document.createElement("p");
  ladderEl.className = "duel-ladder";
  ladderEl.hidden = true;
  section.insertBefore(ladderEl, status);
  let ladder = null, ladderP = null, ladderKnown = false;
  function ensureLadder() {
    if (isPS) { ladderKnown = true; return Promise.resolve(null); } // PS room: no ladder.json at all
    if (!ladderP) ladderP = fetch(`${dataDir}ladder.json`).then((r) => (r.ok ? r.json() : null)).then((d) => { ladder = d && d.v === 1 && d.p ? d : null; ladderKnown = true; return ladder; }).catch(() => { ladderKnown = true; return null; });
    return ladderP;
  }
  /** Ladder ratings [subject, opponent] from data/ladder.json, or null when either has too few recent infantry kills. */
  function ladderPair(L, p, q) {
    if (!L) return null;
    const rp = L.p[bareName(p.display).toLowerCase()], rq = L.p[bareName(q.display).toLowerCase()];
    return rp && rq ? [rp, rq] : null;
  }

  function renderLadder() {
    ladderEl.hidden = true;
    if (mode !== "pair" || !a || !b) return;
    const want = pairKey();
    ensureLadder().then((L) => {
      if (!L || mode !== "pair" || pairKey() !== want) return;
      const rs = ladderPair(L, a, b);
      if (!rs) {
        ladderEl.textContent = tr("duel.lad.none", "🌐 Infantry ladder: not enough recent infantry kills for one of them.");
        ladderEl.title = "";
        ladderEl.hidden = false;
        return;
      }
      const [ra, rb] = rs;
      const p = pairChance(rating(ra[0], ra[1], 0.02), rating(rb[0], rb[1], 0.02));
      ladderEl.textContent = tr("duel.lad.line", "🌐 Infantry ladder: {a} {ra} ±{da} · {b} {rb} ±{db} → next kill {pa} – {pb}", {
        a: bareName(a.display), b: bareName(b.display), ra: int(ra[0]), rb: int(rb[0]), da: int(ra[1]), db: int(rb[1]), pa: pct0(p), pb: pct0(1 - p) });
      ladderEl.title = tr("duel.lad.tip", "Rating from every infantry kill of the last {days} days against everyone, not only each other. Compares players on different servers too.\nTested on {n} first meetings: about 3% better than the iVi prediction. Different servers can\u2019t be checked against real kills.", { days: int(L.days), n: int(L.tested || 0) });
      ladderEl.hidden = false;
    });
  }
  // Small spinner in the status line while a load runs (site .spinner, 14px).
  const spin = document.createElement("span");
  spin.className = "spinner";
  spin.setAttribute("aria-hidden", "true");
  // Ticking liveness line next to the spinner (no styling: it rides the status line's font).
  const wait = document.createElement("span");
  wait.setAttribute("aria-hidden", "true");
  // ☰ Flat list (owner 2026-11-02, t844u): one long list of every kill, no fight rows, nothing folded.
  // Remembered in this browser; only shown for a head-to-head with kills.
  const FLAT_KEY = "duelFlat";
  let flat = true;
  try { if (typeof localStorage !== "undefined") flat = localStorage.getItem(FLAT_KEY) !== "0"; } catch (_) { /* default on */ }
  const flatBtn = document.createElement("button");
  flatBtn.type = "button";
  flatBtn.className = "duel-flat";
  flatBtn.hidden = true;
  const flatLabel = () => {
    flatBtn.textContent = tr("duel.flat", "☰ Flat list");
    flatBtn.title = tr("duel.flatTip", "Every kill in one list: no fight rows, nothing folded. Date and map on each row.");
    flatBtn.setAttribute("aria-pressed", flat ? "true" : "false");
    flatBtn.classList.toggle("is-on", flat);
  };
  flatLabel();
  wrap.parentNode.insertBefore(flatBtn, wrap);
  const pairs = new Map(); // "cidA|cidB" → { st, stats, need, pIsA, … }
  let catP = null;
  let mode = null, a = null, b = null, shownKey = "", listKey = "";
  let sortKey = "share", sortDir = "desc";
  const opened = new Set();
  let busyKey = null, runId = 0, stopAsked = false;
  const moreLabel = () => tr("duel.more", "Read further back");

  const cat = () => catP || (catP = Promise.resolve().then(() => catalog()).catch(() => null).then((c) => (c && c.items) || {}));
  const wName = (items, id) => { const e = id && items[String(id)]; return e ? e[0] : id ? `#${id}` : "–"; };

  // Duels history cache (owner 2026-10-28): localStorage, last 10 pairs, auto-refresh on open.
  // A failing cache never breaks the panel: reads fall back to {}, writes are best-effort.
  function readCacheMap() {
    try {
      if (typeof localStorage === "undefined") return {};
      const m = JSON.parse(localStorage.getItem(DUEL_CACHE_KEY) || "null");
      return m && typeof m === "object" ? m : {};
    } catch (_) { return {}; }
  }
  function writeCacheMap(map) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(DUEL_CACHE_KEY, JSON.stringify(map));
    } catch (_) {
      // Quota: drop the oldest half and retry once.
      try {
        const keys = Object.keys(map).sort((x, y) => (map[x].savedAt || 0) - (map[y].savedAt || 0));
        keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => delete map[k]);
        localStorage.setItem(DUEL_CACHE_KEY, JSON.stringify(map));
      } catch (_) { /* cache is a bonus */ }
    }
  }
  function saveCache(key, job) {
    if (!job || job.servers || !job.st) return;
    const map = readCacheMap();
    map[key] = duelCacheEntry(job);
    writeCacheMap(duelCachePrune(map));
  }

  function setStatus(text) { status.textContent = text || ""; status.hidden = !text; }
  function clear() {
    count.textContent = "";
    sum.hidden = true; sum.textContent = "";
    cmpWrap.hidden = true; cmp.innerHTML = "";
    wrap.hidden = true;
    table.querySelector("thead").innerHTML = ""; table.querySelector("tbody").innerHTML = "";
    const cg = table.querySelector("colgroup"); if (cg) cg.remove();
    moreBtn.hidden = true;
    flatBtn.hidden = true;
    warn.hidden = true; warn.textContent = "";
    setStatus("");
  }
  function colgroup(cols) {
    let cg = table.querySelector("colgroup");
    if (!cg) { cg = document.createElement("colgroup"); table.insertBefore(cg, table.firstChild); }
    cg.innerHTML = cols.map((c) => `<col class="duel-w-${c}" />`).join("");
  }

  /* ---------- one player: vs the crowd */

  /* ⚔️ iVi for crowd opponents, from the room's ranks-lite (same ⚔️ iVi as the
   * skill tables: evened adjs, finite and > 0 only). Lazy: fetched on the first
   * crowd render, then cached for the page; a failed load just means no iVi
   * (never a broken table). Keyed by lowercased name and by slug, so a
   * killboard name matches either spelling. */
  let iviMap = null, iviMapP = null, vehMap = new Map();
  function ensureIvi() {
    if (iviMapP) return iviMapP;
    iviMapP = fetch(`${dataDir}ranks-lite.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const m = new Map();
      if (d && Array.isArray(d.cols) && Array.isArray(d.rows)) {
        const ni = d.cols.indexOf("name"), si = d.cols.indexOf("slug"), ai = d.cols.indexOf("adjs"), vi = d.cols.indexOf("infVeh");
        for (const row of d.rows) {
          const v = row[ai];
          if (!Number.isFinite(v) || v <= 0) continue;
          // Vehicle kill share (0…1) only feeds the 🎲 vs expected row.
          const vh = vi >= 0 && Number.isFinite(row[vi]) ? row[vi] / 100 : null;
          for (const k of [String(row[ni] || "").toLowerCase(), String(row[si] || "").toLowerCase()]) {
            if (!k) continue;
            m.set(k, v);
            if (vh != null) vehMap.set(k, vh);
          }
        }
      }
      iviMap = m;
      return m;
    }).catch(() => { iviMap = new Map(); return iviMap; });
    return iviMapP;
  }
  // 🪦 Reverse favourite targets (owner 2026-11-03): who has the viewed
  // player as favourite target, precomputed by build-ranks into
  // data/rev-targets.json (room's dataDir). Lazy like iviMap: fetched on the
  // first crowd render, then cached; a failed load just hides the line.
  // Entry: [hunterDisplay, hunterKills, hunterDeaths] — the crowd line flips
  // the numbers to the viewed player's perspective (k = hunterDeaths).
  let revTargets = null, revTargetsP = null;
  function ensureRevTargets() {
    if (revTargetsP) return revTargetsP;
    revTargetsP = fetch(`${dataDir}rev-targets.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      revTargets = (d && d.rev) || {};
      return revTargets;
    }).catch(() => { revTargets = {}; return revTargets; });
    return revTargetsP;
  }
  // 🎲 vs expected (owner 2026-11-02, t845u / t847u): the ⚔️ iVi → kill-split fit (scripts/fit-duel-ivi.mjs). Lazy, once per page.
  // v2 (curve + vehicle kills) when the file has it; a missing, broken or v1 file falls back to the single-k formula.
  let duelFit = null, duelFitP = null;
  function ensureFit() {
    if (duelFitP) return duelFitP;
    duelFitP = fetch(`${dataDir}duel-ivi-fit.json`).then((r) => (r.ok ? r.json() : null)).then((d) => { duelFit = duelFitKind(d) ? d : DUEL_FIT_V1; return duelFit; })
      .catch(() => { duelFit = DUEL_FIT_V1; return duelFit; });
    return duelFitP;
  }
  const vehOf = (p) => { const v = p && vehMap.get(bareName(p.display).toLowerCase()); return Number.isFinite(v) ? v : null; };
  const iviOf = (p) => { const v = iviMap && p && iviMap.get(bareName(p.display).toLowerCase()); return Number.isFinite(v) && v > 0 ? v : null; };
  const iviHtml = (r) => {
    if (!iviMap) return "";
    const v = iviMap.get(bareName(r.name).toLowerCase());
    return Number.isFinite(v) && v > 0 ? ` <span class="duel-ivi">⚔️${int(v)}</span>` : "";
  };

  function renderCrowd() {
    const rows = crowdRows(a);
    const s = crowdSummary(rows);
    table.classList.remove("duel-pair", "duel-multi"); table.classList.add("duel-crowd");
    count.textContent = rows.length ? `(${rows.length.toLocaleString(lang())})` : "";
    if (!rows.length) { setStatus(tr("duel.crowdNone", "No killboard for this player yet.")); return; }
    const who = bareName(a.display);
    // 🪦 Third line (owner 2026-11-03): the hunter who has this player as
    // favourite target. Numbers flipped to this player's perspective.
    const preyEntry = revTargets && revTargets[bareName(a.display).toLowerCase()];
    sum.textContent = [
      tr("duel.crowdKd", "K/D {kd} vs the crowd", { kd: kdTxt(s.kd) }),
      s.nemesis ? tr("duel.nemesisOf", "😈 Nemesis: {name} ({k}–{d})", { name: bareName(s.nemesis.name), k: int(s.nemesis.kills), d: int(s.nemesis.deaths) }) : "",
      s.target ? tr("duel.targetOf", "🎯 Favourite target: {name} ({k}–{d})", { name: bareName(s.target.name), k: int(s.target.kills), d: int(s.target.deaths) }) : "",
      preyEntry ? tr("duel.preyOf", "🪦 Hunter: {name} ({k}–{d})", { name: bareName(preyEntry[0]), k: int(preyEntry[2]), d: int(preyEntry[1]) }) : "",
    ].filter(Boolean).join(" · ");
    sum.hidden = false;
    setStatus(tr("duel.crowdNote", "The {n} players {name} fights most (Census killboard). Add one of them to the names to see every kill between the two.", { n: rows.length.toLocaleString(lang()), name: who }));
    const cols = crowdColumns();
    const ind = (id) => `<span class="sort-ind${sortKey === id ? " active" : ""}">${sortKey === id ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>`;
    const th = (id, label, hint, cls = "") => `<th class="${cls}sortable${sortKey === id ? " sorted" : ""}" data-sort="${id}" scope="col"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}${ind(id)}</th>`;
    colgroup(["num", "name", "n", "n", "n", "n", "n"]);
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      th("opp", tr("duel.c.opp", "Opponent"), tr("duel.c.oppTip", "Click a name to add it and see the head-to-head."), "duel-name ") +
      cols.map((c) => th(c.id, c.label, c.hint, c.id === "kills" ? "duel-kills " : "")).join("") + `</tr>`;
    const dir = sortDir === "asc" ? 1 : -1;
    const col = cols.find((c) => c.id === sortKey);
    const list = rows.slice().sort((x, y) => (sortKey === "opp" ? dir * bareName(x.name).localeCompare(bareName(y.name)) : dir * (col.fn(x) - col.fn(y))) || y.share - x.share);
    const preyRow = preyEntry ? rows.find((r) => bareName(r.name).toLowerCase() === bareName(preyEntry[0]).toLowerCase()) : null;
    const badge = (r) => (r === s.nemesis ? ` <span class="scr-group duel-nem" title="${esc(tr("duel.nemesisTip", "Killed this player the most."))}">😈</span>` : r === s.target ? ` <span class="scr-group duel-tgt" title="${esc(tr("duel.targetTip", "This player killed them the most."))}">🎯</span>` : r === preyRow ? ` <span class="scr-group duel-prey" title="${esc(tr("duel.preyTip", "This player is their favourite target."))}">🪦</span>` : "");
    table.querySelector("tbody").innerHTML = list.map((r, i) =>
      `<tr><td class="rk-num">${i + 1}</td><td class="duel-name">${personHtml(r.name)}${iviHtml(r)}${badge(r)}</td>` +
      `<td class="duel-kills">${int(r.kills)}</td><td>${int(r.deaths)}</td><td>${kdTxt(r.kd)}</td><td>${r.kpm == null ? "–" : r.kpm.toFixed(2)}</td><td>${pct(r.share)}</td></tr>`).join("");
    wrap.hidden = false;
    if (!iviMap) ensureIvi().then(() => {
      if (mode === "crowd" && section.open && a && shownKey === `c:${a.cid}`) { shownKey = ""; renderCrowd(); }
    });
    // No shownKey / section.open condition here (unlike ivi above): the ivi
    // re-render clears shownKey, and a load landing while the section is
    // closed would otherwise never paint (show() early-returns on shownKey).
    // Re-rendering the current crowd player is idempotent either way.
    if (!revTargets) ensureRevTargets().then(() => {
      if (mode === "crowd" && a) renderCrowd();
    });
  }

  /* ---------- two players: head-to-head */
  const pairKey = () => `${a.cid}|${b.cid}`;
  const pairKeyFor = (p, q) => `${p.cid}|${q.cid}`;

  /** Load one pair's history (pair mode's loadPair, plus the 1-vs-many table's per-opponent loads). */
  async function loadPairFor(p, q, more, onProgress, onCached) {
    const key = pairKeyFor(p, q);
    let job = pairs.get(key);
    let restored = false;
    if (!job) {
      const base = baseOf(p);
      if (baseOf(q) !== base) { job = { servers: true }; pairs.set(key, job); return job; }
      const P = pagerOf(p, q), Q = P === p ? q : p;
      const need = expectedCount(P, Q) ?? expectedCount(Q, P);
      job = { base, pid: String(P.cid), pIsA: P === p, need, fl: pairFloor(p, q), st: { pid: String(P.cid), qid: String(Q.cid), all: [], cursor: 0, done: false, pages: 0 }, stats: new Map(), asked: new Set() };
      const entry = readCacheMap()[key];
      if (entry && duelCacheRestore(entry, job)) restored = true;
      pairs.set(key, job);
      if (restored && onCached) onCached(job);
    }
    if (job.servers) return job;
    // Faction / server lookup runs alongside (never in front of the cached head-to-head); the warning shows when it lands.
    if (!job.infoP) {
      job.infoP = Promise.resolve().then(() => getJson(charInfoUrl(job.base, [p.cid, q.cid]))).then(parseCharInfo, () => new Map())
        .then((m) => { job.info = m; if (mode === "pair" && pairs.get(key) === job) renderWarn(job); });
    }
    // Cross-server gate (owner 2026-10-28, temporary until servers merge): players on
    // different worlds never meet, so no pair history is fetched for them at all. The one
    // character lookup above is what detects the worlds; everything after it is skipped.
    // The pair-fetch code below stays in place for when servers merge. Unknown worlds
    // (lookup failed) do not block: fetching proceeds as before.
    {
      await job.infoP; // resolves to undefined: the lookup chain stores the map on job.info, not on the promise
      const info = job.info;
      const x = info && info.get(String(p.cid)), y = info && info.get(String(q.cid));
      if (x && y && x.world && y.world && x.world !== y.world) { job.servers = true; return job; }
    }
    let fromApi = false;
    if (pairApi && !job.census && nsOfBase(job.base)) {
      // #83 pair cache: a few Census pages per call on the server, saved there for every device.
      // The history player stays the one the panel picked (pagerOf), so every device asks the same store.
      job.api = job.api || { seen: 0 };
      const want = more ? 1e6 : FIRST_FIGHTS;
      try {
        for (let call = 0; call < 400 && !stopAsked; call++) {
          const r = await pairApi({ ns: nsOfBase(job.base), p: job.st.pid, q: job.st.qid, want, seen: job.api.seen });
          if (!r || r.v !== 1 || !Array.isArray(r.events)) throw new Error("bad pair reply");
          if (r.error && !fromApi && !r.blocks) throw new Error(r.error); // nothing stored and Census busy: try Census here
          fromApi = true;
          job.st.all = mergeEvents(job.st.all, r.events);
          job.api.seen = r.rev || job.api.seen;
          // An errored reply never claims completion: the loop still stops on r.done
          // (no hammering), but done is not stored, so the next open re-asks the server
          // instead of serving a possibly false "Whole history read."
          job.st.done = !!r.done && !r.error;
          job.st.pages = (job.st.pages || 0) + (r.pages || 0);
          job.st.oldest = r.lo || (job.st.all.length ? job.st.all[job.st.all.length - 1][0] : 0);
          // The server's creation dates win (same Census source; the files can be older).
          if (Array.isArray(r.created) && Math.max(...r.created) > 0) {
            const [cp, cq] = r.created.map(Number), pA = job.st.pid === String(p.cid);
            const ca = pA ? cp : cq, cb = pA ? cq : cp;
            job.fl = { floor: Math.max(ca, cb) - DUEL_GAP, created: Math.max(ca, cb), newer: ca >= cb ? p : q };
          }
          if (onProgress) onProgress(job);
          if (r.done || (!more && r.fights >= FIRST_FIGHTS)) break;
          if (r.error) await new Promise((res) => setTimeout(res, 3000)); // Census busy on the server: short pause
        }
      } catch (_) { /* the Census path below */ }
      if (!fromApi) job.census = true;
    }
    if (!fromApi) {
      const onPage = onProgress ? () => onProgress(job) : undefined;
      if (restored && !more) await readPairNewer(job.st, { base: job.base, get: getJson, onPage });
      else await readPairPages(job.st, { base: job.base, get: getJson, pages: more ? Infinity : AUTO_PAGES, need: more ? null : job.need, onPage, stop: () => stopAsked, floor: job.fl ? job.fl.floor : 0 });
    }
    // Lifetime shots / hits of the weapons used in kills between them (asked once per weapon).
    const pe = pairEvents(job.st.all, job.st.qid, job.pIsA);
    const items = [...new Set(pe.map((e) => String(e.w)).filter((w) => w !== "0" && !job.asked.has(w)))];
    if (items.length) {
      try {
        const u = weaponShotUrls(job.base, [p.cid, q.cid], items.slice(0, 100));
        const [plain, kills] = await Promise.all([getJson(u.plain), getJson(u.kills)]);
        if (plain && kills && !plain.error && !kills.error) { parseShotStats(plain, kills, job.stats); items.forEach((w) => job.asked.add(w)); }
      } catch (_) { /* the ≈ columns stay "–" */ }
    }
    saveCache(key, job);
    return job;
  }

  /** Pair mode's loader: the current two players. */
  async function loadPair(more, onProgress, onCached) {
    return loadPairFor(a, b, more, onProgress, onCached);
  }

  function cmpHtml(s, items, aName, bName, pe = []) {
    const ca = crowdSummary(crowdRows(a), b.display), cb = crowdSummary(crowdRows(b), a.display);
    const wTxt = (w) => (w ? `${wName(items, w[0])} (${int(w[1])})` : "–");
    const cTxt = (c) => (c ? `${clsFull(c[0])} (${int(c[1])})` : "–");
    const row = (label, hint, x, y, cls = "", tx = "", ty = "") => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}</th><td${tx ? ` title="${esc(tx)}"` : ""}>${x}</td><td${ty ? ` title="${esc(ty)}"` : ""}>${y}</td></tr>`;
    // Share of the kills between them, and "+N%" on the bigger side (how much more than the other).
    const nk = s.a.kills + s.b.kills;
    const shareTxt = (k) => (nk ? ` <span class="duel-sub">${pct0(k / nk)}</span>` : "");
    const more = (x, y) => (x > y && y > 0 ? ` <span class="duel-more-pct">+${int(((x / y) - 1) * 100)}%</span>` : "");
    const ia = iviOf(a), ib = iviOf(b);
    const luck = ia && ib && duelFit ? iviLuck(s.a.kills, s.b.kills, ia, ib, duelFit, vehOf(a), vehOf(b)) : null;
    let luckRow = "";
    if (luck) {
      // Plain verdict per side; every number lives in the hover (owner t847u: easy to read).
      const lvl = { normal: 0, unusual: 1, very: 2 }[luck.verdict];
      const side = (g) => {
        if (luck.verdict === "few") return `<span class="duel-luck-few">${esc(tr("duel.luck.few", "too few kills"))}</span>`;
        if (!lvl) return `<span class="duel-luck-as">≈ ${esc(tr("duel.luck.as", "as expected"))}</span>`;
        const up = g >= 0;
        const txt = up ? (lvl === 2 ? tr("duel.luck.better2", "much better") : tr("duel.luck.better1", "a bit better"))
          : (lvl === 2 ? tr("duel.luck.worse2", "much worse") : tr("duel.luck.worse1", "a bit worse"));
        return `<span class="duel-luck-${up ? "up" : "down"}${lvl}">${up ? "↑".repeat(lvl) : "↓".repeat(lvl)} ${esc(txt)}</span>`;
      };
      const pts = (v) => `${v >= 0 ? "+" : "−"}${int(Math.abs(v) * 100)}`;
      const how = luck.kind === 2
        ? tr("duel.m.luckHow2", "Learned from {pairs} real player pairs: higher iVi wins more of the kills, and kills from vehicles count in.", { pairs: int(duelFit.pairs) })
        : tr("duel.m.luckHow1", "Learned from {pairs} real player pairs: higher iVi wins more of the kills.", { pairs: int(duelFit.pairs) });
      const tip = tr("duel.m.luckTip", "Kills each one got, compared with what their iVi predicts.\nExpected: {ea} – {eb}. Got: {aa} – {ab}.\nMore one-sided than {rarer} of player pairs.\n{how}\n“As expected” = like 9 in 10 pairs. “Much” = rarer than 1 in 100.\nNot clean 1v1s: “much better” is only a hint to look closer.", {
        ea: pct0(luck.exp), eb: pct0(1 - luck.exp), aa: pct0(luck.act), ab: pct0(1 - luck.act), rarer: luck.rarer == null ? "–" : `${luck.rarer}%`, how });
      const sideTip = (e, x, g) => tr("duel.m.luckSide", "Expected {e}, got {a} ({gap} pts).", { e: pct0(e), a: pct0(x), gap: pts(g) });
      luckRow = row(tr("duel.m.luck", "🎲 vs expected"), tip, side(luck.gap), side(-luck.gap), "duel-luck",
        sideTip(luck.exp, luck.act, luck.gap), sideTip(1 - luck.exp, 1 - luck.act, -luck.gap));
    }
    // 📈 Glicko (#112): the kills between them replayed in order, starting from the 🎲 prediction.
    // Infantry kills only (a vehicle kill says little about who wins the next infantry fight).
    let glkRow = "";
    if (luck) {
      const g = duelGlickoFromIvi(pe, ia, ib, duelFit, vehOf(a), vehOf(b), { now: Date.now() / 1000 });
      const tip = tr("duel.m.glkTip", "Chess-style rating (Glicko-2) of just these two: every infantry kill between them, oldest first, moves it. It starts from what their iVi predicts.\n± = how unsure it is: it grows with every day they don\u2019t meet.\n% = chance to get the next kill between them. Vehicle kills left out.");
      if (!g) {
        const few = `<span class="duel-luck-few">${esc(tr("duel.glk.few", "too few infantry kills"))}</span>`;
        glkRow = row(tr("duel.m.glk", "📈 Glicko"), tip, few, few, "duel-glk");
      } else {
        const last = dateOnly(g.last);
        const cell = (r, p) => `${int(r.mu)} <span class="duel-sub">±${int(r.phi)}</span> · ${pct0(p)}`;
        const stale = g.stale ? ` <span class="duel-luck-few">${esc(tr("duel.glk.stale", "old"))}</span>` : "";
        const sideTip = (r) => tr("duel.m.glkSide", "Rating {r} ± {rd} (now). Infantry kills replayed: {n}; last {last}.", { r: int(r.mu), rd: int(r.phi), n: int(g.n), last });
        glkRow = row(tr("duel.m.glk", "📈 Glicko"), tip, cell(g.aNow, g.p) + stale, cell(g.bNow, 1 - g.p) + stale, "duel-glk", sideTip(g.aNow), sideTip(g.bNow));
      }
    }
    return `<thead><tr><th scope="col"></th><th scope="col" class="duel-a">${esc(aName)}</th><th scope="col" class="duel-b">${esc(bName)}</th></tr></thead><tbody>` +
      row(tr("duel.m.kills", "Kills on the other"), tr("duel.m.killsTip", "Kills on each other; % = share of the kills between them, +% = how many more than the other."), `${int(s.a.kills)}${shareTxt(s.a.kills)}${more(s.a.kills, s.b.kills)}`, `${int(s.b.kills)}${shareTxt(s.b.kills)}${more(s.b.kills, s.a.kills)}`, "duel-big") +
      (ia && ib ? row("⚔️ iVi", tr("duel.m.iviTip", "Skill rating (same as the table); +% = how much higher than the other."), `${int(ia)}${more(ia, ib)}`, `${int(ib)}${more(ib, ia)}`) : "") +
      luckRow + glkRow +
      row(tr("duel.m.kd", "K/D vs each other"), "", kdTxt(s.a.kd), kdTxt(s.b.kd)) +
      row(tr("duel.m.crowd", "K/D vs everyone else"), tr("duel.m.crowdTip", "Kills ÷ deaths against the ~200 players they fight most (Census killboard), this opponent left out."), kdTxt(ca.kd), kdTxt(cb.kd)) +
      row(tr("duel.m.hs", "Headshot kills"), "", `${int(s.a.hs)} · ${pct(s.a.hsr)}`, `${int(s.b.hs)} · ${pct(s.b.hsr)}`) +
      row(tr("duel.m.ones", "1v1 fights won"), tr("duel.m.onesTip", "Fights with {min}+ kills where {pct}+ of the kills & deaths in that time were between these two.", { min: ONE_V_ONE.min, pct: `${ONE_V_ONE.focus * 100}%` }), int(s.a.oneWon), int(s.b.oneWon)) +
      row(tr("duel.m.streak", "Best streak"), tr("duel.m.streakTip", "Most kills on the other in a row."), int(s.a.streak), int(s.b.streak)) +
      row(tr("duel.m.weapon", "Main weapon"), tr("duel.m.weaponTip", "Weapon with the most kills on the other (kills)."), esc(wTxt(s.a.weapon)), esc(wTxt(s.b.weapon))) +
      (s.a.cls || s.b.cls ? row(tr("duel.m.class", "Main class"), tr("duel.m.classTip", "Class they were playing in most kills on the other."), esc(cTxt(s.a.cls)), esc(cTxt(s.b.cls))) : "") +
      row(tr("duel.m.shots", "Shots per kill ≈"), tr("duel.shotsTip", "Census does not record the bullets of one kill. This is the killer's lifetime average with that weapon: shots fired per kill (hits per kill)."), `${num1(s.a.shots)} (${num1(s.a.hits)})`, `${num1(s.b.shots)} (${num1(s.b.hits)})`) +
      `</tbody>`;
  }

  /** ⚠️ Same faction / different servers (needs the faction / server lookup; empty until it lands). */
  function renderWarn(job) {
    const aName = bareName(a.display), bName = bareName(b.display);
    const ws = pairWarnings(job.info, a.cid, b.cid).map((w) => (w.kind === "faction"
      ? tr("duel.warnFaction", "⚠️ Both play {faction}: kills between them can only be teamkills, so expect few or none.", { faction: w.faction })
      : tr("duel.warnWorld", "⚠️ {a} plays on {wa}, {b} on {wb}: players on different servers almost never meet, so expect few or no kills.", { a: aName, b: bName, wa: WORLD_NAME[w.wa] || `#${w.wa}`, wb: WORLD_NAME[w.wb] || `#${w.wb}` })));
    warn.textContent = ws.join(" ");
    warn.hidden = !ws.length;
  }

  function renderPair(job, items) {
    const aName = bareName(a.display), bName = bareName(b.display);
    renderWarn(job);
    table.classList.remove("duel-crowd", "duel-multi"); table.classList.add("duel-pair");
    const pe = pairEvents(job.st.all, job.st.qid, job.pIsA);
    const fights = fightsOf(pe, job.st.all, job.st.pid, DUEL_GAP);
    const s = pairSummary(pe, fights, job.stats, a.cid, b.cid);
    count.textContent = pe.length ? `(${pe.length.toLocaleString(lang())})` : "";
    const since = job.st.oldest ? dateOnly(job.st.oldest) : "";
    const fl = job.fl || {};
    const floorHit = job.st.done && fl.floor && job.st.oldest && job.st.oldest <= fl.floor && fl.newer;
    const read = floorHit
      ? tr("duel.readFloor", "Read back to when {name} was created ({date}): every kill between them is here.", { name: bareName(fl.newer.display), date: dateOnly(fl.created) })
      : job.st.done
      ? tr("duel.readAll", "Whole history read.")
      : job.need != null && pe.length < job.need
        ? tr("duel.readOf", "History read back to {date}: {n} of the {total} kills between them on the killboard found.", { date: since, n: pe.length.toLocaleString(lang()), total: job.need.toLocaleString(lang()) })
        : tr("duel.readTo", "History read back to {date}.", { date: since });
    moreBtn.hidden = job.st.done;
    if (!pe.length) {
      setStatus(`${tr("duel.none", "No kills between them found yet.")} ${read}`);
      cmpWrap.hidden = true; wrap.hidden = true; sum.hidden = true; flatBtn.hidden = true;
      return;
    }
    sum.innerHTML = esc(tr("duel.summary", "{a} {ka} – {kb} {b} · fights: {fights} (1v1: {ones}) · first {first} · last {last}", {
      a: aName, b: bName, ka: int(s.a.kills), kb: int(s.b.kills), fights: int(s.fights), ones: int(s.ones), first: dateOnly(s.first), last: dateOnly(s.last),
    }));
    sum.hidden = false;
    setStatus(read);
    cmp.innerHTML = cmpHtml(s, items, aName, bName, pe);
    if (!iviMap || duelFit === null) {
      Promise.all([ensureIvi(), ensureFit()]).then(() => {
        if (mode === "pair" && pairs.get(pairKey()) === job && section.open) cmp.innerHTML = cmpHtml(s, items, aName, bName, pe);
      });
    }
    cmpWrap.hidden = false;

    flatLabel();
    flatBtn.hidden = false;
    table.classList.toggle("duel-flat-on", flat);
    colgroup(["num", "killer", "weapon", "cls", "n", "n", "gap", "time"]);
    const shotsTip = tr("duel.shotsTip", "Census does not record the bullets of one kill. This is the killer's lifetime average with that weapon: shots fired per kill (hits per kill).");
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      `<th class="duel-c-killer" scope="col">${esc(tr("duel.c.killer", "Kill by"))}</th>` +
      `<th class="duel-c-weapon" scope="col">${esc(tr("kf.colWeapon", "Weapon"))}</th>` +
      `<th class="duel-c-cls" scope="col" title="${esc(tr("duel.c.clsTip", "Killer's class → victim's class."))}">${esc(tr("duel.c.cls", "Classes"))}</th>` +
      `<th scope="col" title="${esc(shotsTip)}">${esc(tr("duel.c.shots", "Shots ≈"))}</th>` +
      `<th scope="col" title="${esc(shotsTip)}">${esc(tr("duel.c.hits", "Hits ≈"))}</th>` +
      `<th scope="col" title="${esc(tr("duel.c.gapTip", "Time since the previous kill between them in this fight."))}">${esc(tr("duel.c.gap", "Gap"))}</th>` +
      `<th class="duel-c-time" scope="col">${esc(tr("duel.c.time", "Time"))}</th></tr>`;
    const oneTip = tr("duel.oneTip", "1v1: {pct}+ of the kills & deaths in that time were between these two.", { pct: `${ONE_V_ONE.focus * 100}%` });
    const open = tr("duel.fightOpen", "Show the fight's kills");
    if (!opened.size && fights.length) opened.add(0);
    // Flat list: strictly newest first (fights already are; kills inside a fight flip), numbered n … 1 like the fights.
    let kn = pe.length;
    table.querySelector("tbody").innerHTML = fights.map((f, i) => {
      const res = fightResult(f);
      const mins = Math.max(1, Math.round((f.t1 - f.t0) / 60));
      const head = `<tr class="kf-scr-row duel-fight duel-${res}" data-fight="${i}"><td class="rk-num"><button type="button" class="kf-caret" aria-expanded="false" aria-label="${esc(open)}" title="${esc(open)}">${fights.length - i}</button></td>` +
        `<td class="duel-fight-cell" colspan="7">${esc(dateTime(f.t0))} · <span class="scr-res scr-${res}">${esc(fightResLabel(res, aName, bName))}</span> ${int(f.a)}–${int(f.b)}` +
        ` · ${esc(tr("scr.min", "{n} min", { n: mins.toLocaleString(lang()) }))}${f.one ? ` · <span class="scr-group" title="${esc(oneTip)}">1v1</span>` : ""}` +
        `${f.z ? ` · ${esc(zoneName(f.z))}` : ""}</td></tr>`;
      let prev = 0;
      const where = f.z ? ` · ${zoneName(f.z)}` : "";
      const rows = f.ev.map((e) => {
        const gap = prev ? gapTxt(e.t - prev) : "–";
        prev = e.t;
        const pk = perKill(job.stats, e.aKill ? a.cid : b.cid, e.w);
        const killer = e.aKill ? aName : bName;
        const wTxt = `${e.veh ? "🚜 " : ""}${wName(items, e.w)}`;
        const timeCell = flat
          ? `<td class="duel-c-time" title="${esc(`${dateTime(e.t)}${where}`)}">${esc(`${dateOnly(e.t)} ${clock(e.t)}`)}</td>`
          : `<td class="duel-c-time" title="${esc(dateTime(e.t))}">${esc(clock(e.t))}</td>`;
        return `<tr class="kf-row ${flat ? "duel-flat-row" : "kf-sub-row"} duel-ev ${e.aKill ? "is-kill" : "is-death"}" data-of="${i}"${flat ? "" : " hidden"}><td class="rk-num">${flat ? "#" : ""}</td>` +
          `<td class="duel-c-killer"><span class="kf-mark ${e.aKill ? "kf-kill" : "kf-death"}">${esc(killer)}</span></td>` +
          `<td class="duel-c-weapon" title="${esc(wTxt)}">${e.hs ? `<span class="kf-hs" title="${esc(tr("kf.headshot", "Headshot"))}">🎯</span> ` : ""}${esc(wTxt)}</td>` +
          `<td class="duel-c-cls">${((k, v) => (k || v ? `${clsHtml(k)} → ${clsHtml(v)}` : "–"))(classOf(e.aKill ? e.aL : e.bL), classOf(e.aKill ? e.bL : e.aL))}</td>` +
          `<td>${pk ? `≈${num1(pk.shots)}` : "–"}</td><td>${pk && pk.hits != null ? `≈${num1(pk.hits)}` : "–"}</td><td>${esc(gap)}</td>` +
          timeCell + `</tr>`;
      });
      if (!flat) return head + rows.join("");
      return rows.reverse().map((h) => h.replace('<td class="rk-num">#</td>', `<td class="rk-num">${int(kn--)}</td>`)).join("");
    }).join("");
    if (!flat) for (const i of opened) setOpen(i, true);
    wrap.hidden = false;
  }

  function setOpen(i, on) {
    const row = table.querySelector(`tr.duel-fight[data-fight="${i}"]`);
    if (!row) return;
    row.classList.toggle("is-open", on);
    const btn = row.querySelector(".kf-caret");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    for (const r of table.querySelectorAll(`tr[data-of="${i}"]`)) r.hidden = !on;
    if (on) opened.add(Number(i)); else opened.delete(Number(i));
  }

  /* ---------- 3–5 players: 1-vs-many (#113) — one row per opponent, ladder + pairwise side by side */
  let multiList = [], multiRun = 0;
  const multiErr = new Set(); // pair keys whose history could not be read at all

  /** One opponent row's numbers, or nulls while the data is still coming. */
  function multiRow(opp) {
    const kb = crowdRows(a).find((r) => bareName(r.name).toLowerCase() === bareName(opp.display).toLowerCase());
    const row = { opp, kb, lad: null, ladTitle: "", glk: null, glkTitle: "", last: null, done: false };
    const rs = ladderPair(ladder, a, opp);
    if (ladder && rs) {
      const [ra, rb] = rs;
      const p = pairChance(rating(ra[0], ra[1], 0.02), rating(rb[0], rb[1], 0.02));
      row.lad = `${int(ra[0])} ±${int(ra[1])} · ${pct0(p)}`;
      row.ladTitle = tr("duel.lad.line", "🌐 Infantry ladder: {a} {ra} ±{da} · {b} {rb} ±{db} → next kill {pa} – {pb}", {
        a: bareName(a.display), b: bareName(opp.display), ra: int(ra[0]), rb: int(rb[0]), da: int(ra[1]), db: int(rb[1]), pa: pct0(p), pb: pct0(1 - p) });
    } else if (ladderKnown) {
      row.lad = "—";
      row.ladTitle = tr("duel.lad.none", "🌐 Infantry ladder: not enough recent infantry kills for one of them.");
    }
    const key = pairKeyFor(a, opp);
    const job = pairs.get(key);
    if (job && job.servers) {
      row.glk = "—";
      row.glkTitle = tr("duel.servers", "These two play on different servers: they never meet.");
      row.done = true;
    } else if (multiErr.has(key)) {
      row.glk = "—";
      row.glkTitle = tr("duel.multi.err", "The kills between these two could not be read.");
      row.done = true;
    } else if (job && job.st && iviMap && duelFit) {
      const pe = pairEvents(job.st.all, job.st.qid, job.pIsA);
      const g = duelGlickoFromIvi(pe, iviOf(a), iviOf(opp), duelFit, vehOf(a), vehOf(opp), { now: Date.now() / 1000 });
      if (g) {
        row.glk = `${int(g.aNow.mu)} ±${int(g.aNow.phi)} · ${pct0(g.p)}${g.stale ? ` (${tr("duel.glk.stale", "old")})` : ""}`;
        row.glkTitle = tr("duel.multi.glkTitle", "Next kill {p} · {k} counted infantry kills since {d} · ratings {a} ±{da} vs {b} ±{db}", {
          p: pct0(g.p), k: int(g.n), d: dateOnly(g.last), a: int(g.aNow.mu), da: int(g.aNow.phi), b: int(g.bNow.mu), db: int(g.bNow.phi) });
        row.last = dateOnly(g.last);
        row.done = job.st.done;
      } else if (job.st.done) {
        row.glk = tr("duel.glk.few", "too few infantry kills");
        row.done = true;
      }
    }
    return row;
  }

  function renderMulti(run) {
    if (mode !== "multi" || run !== multiRun) return;
    const aName = bareName(a.display);
    table.classList.remove("duel-crowd", "duel-pair");
    table.classList.add("duel-multi");
    colgroup(["num", "name", "n", "wide", "wide", "date"]);
    const ladTip = ladder
      ? tr("duel.multi.ladTip", "Chance {a} gets the next kill, from the ladder rating: every infantry kill of the last {days} days against everyone, not only each other.", { a: aName, days: int(ladder.days) })
      : tr("duel.multi.ladTip", "Chance {a} gets the next kill, from the ladder rating: every infantry kill of the last {days} days against everyone, not only each other.", { a: aName, days: 30 });
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      `<th scope="col">${esc(tr("duel.multi.opp", "Opponent"))}</th>` +
      `<th scope="col" title="${esc(tr("duel.multi.killsTip", "Kills on each other — {a} first, then the opponent.", { a: aName }))}">${esc(tr("duel.multi.kills", "Kills"))}</th>` +
      `<th scope="col" title="${esc(ladTip)}">${esc(tr("duel.multi.lad", "🌐 Ladder"))}</th>` +
      `<th scope="col" title="${esc(tr("duel.multi.glkTip", "Chance {a} gets the next kill, from just the kills between these two, replayed oldest first. Infantry kills only.", { a: aName }))}">${esc(tr("duel.multi.glk", "📈 Pairwise"))}</th>` +
      `<th scope="col">${esc(tr("duel.multi.last", "Last fight"))}</th></tr>`;
    const data = multiList.map((opp) => multiRow(opp));
    const rows = data.map((r, i) => {
      const kills = r.kb ? `${int(r.kb.kills)}–${int(r.kb.deaths)}` : "—";
      const killsTitle = r.kb ? tr("duel.multi.killsTip", "Kills on each other — {a} first, then the opponent.", { a: aName }) : tr("duel.multi.noKb", "No kills between them in this killboard.");
      return `<tr><td class="rk-num">${i + 1}</td>` +
        `<td class="duel-name">${personHtml(r.opp.display)}${iviHtml({ name: r.opp.display })}</td>` +
        `<td title="${esc(killsTitle)}">${kills}</td>` +
        `<td title="${esc(r.ladTitle)}">${r.lad == null ? "…" : esc(r.lad)}</td>` +
        `<td title="${esc(r.glkTitle)}">${r.glk == null ? "…" : esc(r.glk)}</td>` +
        `<td>${r.last == null ? "—" : esc(r.last)}</td></tr>`;
    });
    table.querySelector("tbody").innerHTML = rows.join("");
    wrap.hidden = false;
    if (ladderKnown && data.every((r) => r.done)) setStatus(tr("duel.multi.note", "One row per opponent: the 🌐 ladder says how {a} does against everyone, the 📈 pairwise replay says how {a} does against this opponent. When they disagree, that is the interesting bit.", { a: aName }));
  }

  async function showMulti() {
    const run = ++multiRun;
    ladderEl.hidden = true;
    clear();
    count.textContent = `(${multiList.length})`;
    sum.textContent = tr("duel.multi.sum", "{a} vs {n} opponents", { a: bareName(a.display), n: multiList.length });
    sum.hidden = false;
    setStatus(tr("duel.multi.loading", "Reading the kills against each opponent…"));
    renderMulti(run);
    ensureLadder().then(() => { if (mode === "multi" && run === multiRun) renderMulti(run); });
    Promise.all([ensureIvi(), ensureFit()]).then(() => { if (mode === "multi" && run === multiRun) renderMulti(run); });
    for (const opp of multiList) {
      loadPairFor(a, opp, false,
        () => { if (mode === "multi" && run === multiRun) renderMulti(run); },
        () => { if (mode === "multi" && run === multiRun) renderMulti(run); })
        .then(() => { if (mode === "multi" && run === multiRun) renderMulti(run); })
        .catch(() => { multiErr.add(pairKeyFor(a, opp)); if (mode === "multi" && run === multiRun) renderMulti(run); });
    }
  }

  async function show(more = false) {
    if (!section.open || !mode) return;
    if (mode === "multi") { showMulti(); return; }
    if (mode === "crowd") {
      ladderEl.hidden = true;
      if (shownKey === `c:${a.cid}`) return;
      shownKey = `c:${a.cid}`;
      clear();
      renderCrowd();
      return;
    }
    const key = pairKey();
    if (!more && shownKey === `p:${key}`) return;
    renderLadder();
    // Per-pair loading (owner 2026-10-28): a previous pair's still-running load must not
    // block the new pair — switching pairs used to sit with no loading text until the
    // section was closed and reopened, because one global flag held the load. A stale
    // run's renders are already guarded by the pair-key checks below; it only must not
    // clear the new run's flag when it settles (see the finally guard).
    if (busyKey === `p:${key}`) return;
    busyKey = `p:${key}`;
    const myRun = ++runId;
    if (!more) { clear(); opened.clear(); }
    stopAsked = false;
    // While reading further back, the button stops the reading (everything read so far stays: on the server and here).
    if (more) { moreBtn.textContent = tr("duel.stop", "Stop"); moreBtn.disabled = false; } else moreBtn.disabled = true;
    setStatus(tr("duel.loading", "Reading the kills between them…"));
    status.appendChild(spin);
    // Ticking liveness line: the spinner does not rotate on animation-disabled devices,
    // so a slow Census page would otherwise look frozen. renderPair wipes the status line,
    // so the progress callback re-appends both the spinner and this line after each render.
    let waitSecs = 0, waitPages = 0;
    const tickWait = () => { wait.textContent = ` page ${waitPages} · ${waitSecs}s`; };
    tickWait();
    status.appendChild(wait);
    const waitTimer = setInterval(() => { waitSecs++; tickWait(); if (!wait.isConnected) status.appendChild(wait); }, 1000);
    try {
      const items = await cat();
      const renderLive = (j) => { renderPair(j, items); if (more) moreBtn.hidden = false; status.appendChild(spin); status.appendChild(wait); tickWait(); };
      const job = await loadPair(more, (j) => {
        if (mode !== "pair" || pairKey() !== key) return;
        waitPages = j.st.pages;
        renderLive(j);
      }, (j) => {
        if (mode !== "pair" || pairKey() !== key) return;
        renderLive(j);
      });
      if (mode !== "pair" || pairKey() !== key) return;
      shownKey = `p:${key}`;
      if (job.servers) { clear(); setStatus(tr("duel.servers", "These two play on different servers: they never meet.")); return; }
      renderPair(job, items);
    } catch (_) {
      if (mode !== "pair" || pairKey() !== key) return;
      setStatus(tr("duel.error", "Census is busy: close and open this tab to try again."));
    } finally {
      if (runId === myRun) { busyKey = null; moreBtn.disabled = false; moreBtn.textContent = moreLabel(); }
      spin.remove();
      clearInterval(waitTimer);
      wait.remove();
    }
  }

  section.addEventListener("toggle", () => { if (section.open) show(); });
  flatBtn.addEventListener("click", () => {
    flat = !flat;
    try { if (typeof localStorage !== "undefined") localStorage.setItem(FLAT_KEY, flat ? "1" : "0"); } catch (_) { /* not remembered */ }
    const job = mode === "pair" && a && b ? pairs.get(pairKey()) : null;
    flatLabel();
    if (job && job.st && !job.servers) cat().then((items) => { if (mode === "pair" && pairs.get(pairKey()) === job) renderPair(job, items); if (busyKey) { status.appendChild(spin); status.appendChild(wait); } });
  });
  moreBtn.addEventListener("click", () => { if (busyKey) { stopAsked = true; moreBtn.disabled = true; return; } show(true); });
  table.addEventListener("click", (e) => {
    const nb = e.target.closest && e.target.closest("button.kf-name[data-name]");
    if (nb) { if (addName) addName(nb.dataset.name, nb); return; }
    const fr = e.target.closest && e.target.closest("tr.duel-fight");
    if (fr) { setOpen(fr.dataset.fight, !fr.classList.contains("is-open")); return; }
    const th = e.target.closest && e.target.closest("th[data-sort]");
    if (!th || mode !== "crowd") return;
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = k; sortDir = k === "opp" ? "asc" : "desc"; }
    const prevLeft = wrap.scrollLeft;
    shownKey = "";
    show();
    if (sortScroll) sortScroll(wrap, table.querySelector(`th[data-sort="${k}"]`), prevLeft);
  });

  // Same header pin as the Rankings and weapons tables.
  {
    let queued = false, last = -1;
    const pin = () => {
      queued = false;
      if (wrap.hidden || !section.open) return;
      const r = wrap.getBoundingClientRect();
      const headH = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      let off = 0;
      if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top, Math.max(0, wrap.clientHeight - headH));
      off = Math.round(off);
      if (off !== last) { last = off; table.style.setProperty("--rk-head-top", off + "px"); }
    };
    const q = () => { if (!queued) { queued = true; requestAnimationFrame(pin); } };
    window.addEventListener("scroll", q, { passive: true });
    window.addEventListener("resize", q, { passive: true });
  }

  return {
    /** Loaded players on the page: one → vs the crowd, two → head-to-head, 3–5 → 1-vs-many, else hidden. */
    setPlayers(list) {
      const ok = (list || []).filter((p) => p && p.cid);
      const next = ok.length === 1 ? "crowd" : ok.length === 2 ? "pair" : ok.length >= 3 && ok.length <= 5 ? "multi" : null;
      section.hidden = !next;
      const key = ok.map((p) => p.cid).join("|");
      if (!next) { mode = null; a = b = null; multiList = []; shownKey = ""; listKey = ""; return; }
      if (mode === next && listKey === key) { a = ok[0]; if (next === "pair") b = ok[1]; if (next === "multi") multiList = ok.slice(1); return; }
      mode = next; a = ok[0]; b = next === "pair" ? ok[1] : null; multiList = next === "multi" ? ok.slice(1) : []; listKey = key; shownKey = "";
      if (next === "crowd") { sortKey = "share"; sortDir = "desc"; }
      opened.clear();
      clear();
      show();
    },
  };
}
