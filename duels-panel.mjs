/**
 * 🤺 Duels tab (owner 2026-10-28, both rooms): one player → that player vs the crowd (killboard
 * the page already has, nemesis / favourite target; no Census call); two players → head-to-head:
 * a comparison of both sides and every kill between them, cut into fights (▸ opens a fight).
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
import { zoneName } from "./scrims-panel.mjs?v=20261028-os2";
import { mergeEvents } from "./scrims.mjs?v=20261028-os2";
import {
  AUTO_PAGES, FIRST_FIGHTS, nsOfBase, pairFloor, DUEL_GAP, ONE_V_ONE, classOf, bareName, crowdRows, crowdSummary, expectedCount, pagerOf,
  readPairPages, readPairNewer, pairEvents, fightsOf, fightResult, weaponShotUrls, parseShotStats, perKill, pairSummary,
  charInfoUrl, parseCharInfo, pairWarnings, WORLD_NAME,
  DUEL_CACHE_KEY, duelCacheEntry, duelCacheRestore, duelCachePrune,
} from "./duels.mjs?v=20261028-floor1";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return currentLang() || undefined; } catch { return undefined; } };
const int = (n) => Math.round(n).toLocaleString(lang());
const num1 = (n) => (n == null || !Number.isFinite(n) ? "–" : n < 10 ? n.toLocaleString(lang(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : int(n));
const kdTxt = (n) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(2));
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
  const { getJson, baseOf, addName, sortScroll, catalog = async () => null, pairApi = null } = o;
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
  // Small spinner in the status line while a load runs (site .spinner, 14px).
  const spin = document.createElement("span");
  spin.className = "spinner";
  spin.setAttribute("aria-hidden", "true");
  // Ticking liveness line next to the spinner (no styling: it rides the status line's font).
  const wait = document.createElement("span");
  wait.setAttribute("aria-hidden", "true");
  const pairs = new Map(); // "cidA|cidB" → { st, stats, need, pIsA, … }
  let catP = null;
  let mode = null, a = null, b = null, shownKey = "";
  let sortKey = "share", sortDir = "desc";
  const opened = new Set();
  let busy = false, stopAsked = false;
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
    warn.hidden = true; warn.textContent = "";
    setStatus("");
  }
  function colgroup(cols) {
    let cg = table.querySelector("colgroup");
    if (!cg) { cg = document.createElement("colgroup"); table.insertBefore(cg, table.firstChild); }
    cg.innerHTML = cols.map((c) => `<col class="duel-w-${c}" />`).join("");
  }

  /* ---------- one player: vs the crowd */
  function renderCrowd() {
    const rows = crowdRows(a);
    const s = crowdSummary(rows);
    table.classList.remove("duel-pair"); table.classList.add("duel-crowd");
    count.textContent = rows.length ? `(${rows.length.toLocaleString(lang())})` : "";
    if (!rows.length) { setStatus(tr("duel.crowdNone", "No killboard for this player yet.")); return; }
    const who = bareName(a.display);
    sum.textContent = [
      tr("duel.crowdKd", "K/D {kd} vs the crowd", { kd: kdTxt(s.kd) }),
      s.nemesis ? tr("duel.nemesisOf", "😈 Nemesis: {name} ({k}–{d})", { name: bareName(s.nemesis.name), k: int(s.nemesis.kills), d: int(s.nemesis.deaths) }) : "",
      s.target ? tr("duel.targetOf", "🎯 Favourite target: {name} ({k}–{d})", { name: bareName(s.target.name), k: int(s.target.kills), d: int(s.target.deaths) }) : "",
    ].filter(Boolean).join(" · ");
    sum.hidden = false;
    setStatus(tr("duel.crowdNote", "The {n} players {name} fights most (Census killboard). Add one of them to the names to see every kill between the two.", { n: rows.length.toLocaleString(lang()), name: who }));
    const cols = crowdColumns();
    const ind = (id) => `<span class="sort-ind${sortKey === id ? " active" : ""}">${sortKey === id ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>`;
    const th = (id, label, hint, cls = "") => `<th class="${cls}sortable${sortKey === id ? " sorted" : ""}" data-sort="${id}" scope="col"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}${ind(id)}</th>`;
    colgroup(["num", "name", "n", "n", "n", "n", "n"]);
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      th("opp", tr("duel.c.opp", "Opponent"), tr("duel.c.oppTip", "Click a name to add it and see the head-to-head."), "duel-name ") +
      cols.map((c) => th(c.id, c.label, c.hint)).join("") + `</tr>`;
    const dir = sortDir === "asc" ? 1 : -1;
    const col = cols.find((c) => c.id === sortKey);
    const list = rows.slice().sort((x, y) => (sortKey === "opp" ? dir * bareName(x.name).localeCompare(bareName(y.name)) : dir * (col.fn(x) - col.fn(y))) || y.share - x.share);
    const badge = (r) => (r === s.nemesis ? ` <span class="scr-group duel-nem" title="${esc(tr("duel.nemesisTip", "Killed this player the most."))}">😈</span>` : r === s.target ? ` <span class="scr-group duel-tgt" title="${esc(tr("duel.targetTip", "This player killed them the most."))}">🎯</span>` : "");
    table.querySelector("tbody").innerHTML = list.map((r, i) =>
      `<tr><td class="rk-num">${i + 1}</td><td class="duel-name">${personHtml(r.name)}${badge(r)}</td>` +
      `<td>${int(r.kills)}</td><td>${int(r.deaths)}</td><td>${kdTxt(r.kd)}</td><td>${r.kpm == null ? "–" : r.kpm.toFixed(2)}</td><td>${pct(r.share)}</td></tr>`).join("");
    wrap.hidden = false;
  }

  /* ---------- two players: head-to-head */
  const pairKey = () => `${a.cid}|${b.cid}`;

  async function loadPair(more, onProgress, onCached) {
    const key = pairKey();
    let job = pairs.get(key);
    let restored = false;
    if (!job) {
      const base = baseOf(a);
      if (baseOf(b) !== base) { job = { servers: true }; pairs.set(key, job); return job; }
      const P = pagerOf(a, b), Q = P === a ? b : a;
      const need = expectedCount(P, Q) ?? expectedCount(Q, P);
      job = { base, pid: String(P.cid), pIsA: P === a, need, fl: pairFloor(a, b), st: { pid: String(P.cid), qid: String(Q.cid), all: [], cursor: 0, done: false, pages: 0 }, stats: new Map(), asked: new Set() };
      const entry = readCacheMap()[key];
      if (entry && duelCacheRestore(entry, job)) restored = true;
      pairs.set(key, job);
      if (restored && onCached) onCached(job);
    }
    if (job.servers) return job;
    // Faction / server lookup runs alongside (never in front of the cached head-to-head); the warning shows when it lands.
    if (!job.infoP) {
      job.infoP = Promise.resolve().then(() => getJson(charInfoUrl(job.base, [a.cid, b.cid]))).then(parseCharInfo, () => new Map())
        .then((m) => { job.info = m; if (mode === "pair" && pairs.get(pairKey()) === job) renderWarn(job); });
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
          job.st.done = !!r.done;
          job.st.pages = (job.st.pages || 0) + (r.pages || 0);
          job.st.oldest = r.lo || (job.st.all.length ? job.st.all[job.st.all.length - 1][0] : 0);
          // The server's creation dates win (same Census source; the files can be older).
          if (Array.isArray(r.created) && Math.max(...r.created) > 0) {
            const [cp, cq] = r.created.map(Number), pA = job.st.pid === String(a.cid);
            const ca = pA ? cp : cq, cb = pA ? cq : cp;
            job.fl = { floor: Math.max(ca, cb) - DUEL_GAP, created: Math.max(ca, cb), newer: ca >= cb ? a : b };
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
        const u = weaponShotUrls(job.base, [a.cid, b.cid], items.slice(0, 100));
        const [plain, kills] = await Promise.all([getJson(u.plain), getJson(u.kills)]);
        if (plain && kills && !plain.error && !kills.error) { parseShotStats(plain, kills, job.stats); items.forEach((w) => job.asked.add(w)); }
      } catch (_) { /* the ≈ columns stay "–" */ }
    }
    saveCache(key, job);
    return job;
  }

  function cmpHtml(s, items, aName, bName) {
    const ca = crowdSummary(crowdRows(a), b.display), cb = crowdSummary(crowdRows(b), a.display);
    const wTxt = (w) => (w ? `${wName(items, w[0])} (${int(w[1])})` : "–");
    const cTxt = (c) => (c ? `${clsFull(c[0])} (${int(c[1])})` : "–");
    const row = (label, hint, x, y, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}</th><td>${x}</td><td>${y}</td></tr>`;
    return `<thead><tr><th scope="col"></th><th scope="col" class="duel-a">${esc(aName)}</th><th scope="col" class="duel-b">${esc(bName)}</th></tr></thead><tbody>` +
      row(tr("duel.m.kills", "Kills on the other"), "", int(s.a.kills), int(s.b.kills), "duel-big") +
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
    table.classList.remove("duel-crowd"); table.classList.add("duel-pair");
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
      cmpWrap.hidden = true; wrap.hidden = true; sum.hidden = true;
      return;
    }
    sum.textContent = tr("duel.summary", "{a} {ka} – {kb} {b} · fights: {fights} (1v1: {ones}) · first {first} · last {last}", {
      a: aName, b: bName, ka: int(s.a.kills), kb: int(s.b.kills), fights: int(s.fights), ones: int(s.ones), first: dateOnly(s.first), last: dateOnly(s.last),
    });
    sum.hidden = false;
    setStatus(read);
    cmp.innerHTML = cmpHtml(s, items, aName, bName);
    cmpWrap.hidden = false;

    colgroup(["num", "time", "killer", "weapon", "cls", "n", "n", "gap"]);
    const shotsTip = tr("duel.shotsTip", "Census does not record the bullets of one kill. This is the killer's lifetime average with that weapon: shots fired per kill (hits per kill).");
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      `<th class="duel-c-time" scope="col">${esc(tr("duel.c.time", "Time"))}</th>` +
      `<th class="duel-c-killer" scope="col">${esc(tr("duel.c.killer", "Kill by"))}</th>` +
      `<th class="duel-c-weapon" scope="col">${esc(tr("kf.colWeapon", "Weapon"))}</th>` +
      `<th class="duel-c-cls" scope="col" title="${esc(tr("duel.c.clsTip", "Killer's class → victim's class."))}">${esc(tr("duel.c.cls", "Classes"))}</th>` +
      `<th scope="col" title="${esc(shotsTip)}">${esc(tr("duel.c.shots", "Shots ≈"))}</th>` +
      `<th scope="col" title="${esc(shotsTip)}">${esc(tr("duel.c.hits", "Hits ≈"))}</th>` +
      `<th scope="col" title="${esc(tr("duel.c.gapTip", "Time since the previous kill between them in this fight."))}">${esc(tr("duel.c.gap", "Gap"))}</th></tr>`;
    const oneTip = tr("duel.oneTip", "1v1: {pct}+ of the kills & deaths in that time were between these two.", { pct: `${ONE_V_ONE.focus * 100}%` });
    const open = tr("duel.fightOpen", "Show the fight's kills");
    if (!opened.size && fights.length) opened.add(0);
    table.querySelector("tbody").innerHTML = fights.map((f, i) => {
      const res = fightResult(f);
      const mins = Math.max(1, Math.round((f.t1 - f.t0) / 60));
      const head = `<tr class="kf-scr-row duel-fight duel-${res}" data-fight="${i}"><td class="rk-num"><button type="button" class="kf-caret" aria-expanded="false" aria-label="${esc(open)}" title="${esc(open)}">${fights.length - i}</button></td>` +
        `<td class="duel-fight-cell" colspan="7">${esc(dateTime(f.t0))} · <span class="scr-res scr-${res}">${esc(fightResLabel(res, aName, bName))}</span> ${int(f.a)}–${int(f.b)}` +
        ` · ${esc(tr("scr.min", "{n} min", { n: mins.toLocaleString(lang()) }))}${f.one ? ` · <span class="scr-group" title="${esc(oneTip)}">1v1</span>` : ""}` +
        `${f.z ? ` · ${esc(zoneName(f.z))}` : ""}</td></tr>`;
      let prev = 0;
      const subs = f.ev.map((e) => {
        const gap = prev ? gapTxt(e.t - prev) : "–";
        prev = e.t;
        const pk = perKill(job.stats, e.aKill ? a.cid : b.cid, e.w);
        const killer = e.aKill ? aName : bName;
        const wTxt = `${e.veh ? "🚜 " : ""}${wName(items, e.w)}`;
        return `<tr class="kf-row kf-sub-row duel-ev ${e.aKill ? "is-kill" : "is-death"}" data-of="${i}" hidden><td class="rk-num"></td>` +
          `<td class="duel-c-time" title="${esc(dateTime(e.t))}">${esc(clock(e.t))}</td>` +
          `<td class="duel-c-killer"><span class="kf-mark ${e.aKill ? "kf-kill" : "kf-death"}">${esc(killer)}</span></td>` +
          `<td class="duel-c-weapon" title="${esc(wTxt)}">${e.hs ? `<span class="kf-hs" title="${esc(tr("kf.headshot", "Headshot"))}">🎯</span> ` : ""}${esc(wTxt)}</td>` +
          `<td class="duel-c-cls">${((k, v) => (k || v ? `${clsHtml(k)} → ${clsHtml(v)}` : "–"))(classOf(e.aKill ? e.aL : e.bL), classOf(e.aKill ? e.bL : e.aL))}</td>` +
          `<td>${pk ? `≈${num1(pk.shots)}` : "–"}</td><td>${pk && pk.hits != null ? `≈${num1(pk.hits)}` : "–"}</td><td>${esc(gap)}</td></tr>`;
      }).join("");
      return head + subs;
    }).join("");
    for (const i of opened) setOpen(i, true);
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

  async function show(more = false) {
    if (!section.open || !mode) return;
    if (mode === "crowd") {
      if (shownKey === `c:${a.cid}`) return;
      shownKey = `c:${a.cid}`;
      clear();
      renderCrowd();
      return;
    }
    const key = pairKey();
    if (!more && shownKey === `p:${key}`) return;
    if (busy) return;
    busy = true;
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
      if (job.servers) { setStatus(tr("duel.servers", "These two play on different servers: they never meet.")); return; }
      renderPair(job, items);
    } catch (_) {
      if (mode !== "pair" || pairKey() !== key) return;
      setStatus(tr("duel.error", "Census is busy: close and open this tab to try again."));
    } finally {
      busy = false;
      moreBtn.disabled = false;
      moreBtn.textContent = moreLabel();
      spin.remove();
      clearInterval(waitTimer);
      wait.remove();
    }
  }

  section.addEventListener("toggle", () => { if (section.open) show(); });
  moreBtn.addEventListener("click", () => { if (busy) { stopAsked = true; moreBtn.disabled = true; return; } show(true); });
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
    /** Loaded players on the page: one → vs the crowd, two → head-to-head, else hidden. */
    setPlayers(list) {
      const ok = (list || []).filter((p) => p && p.cid);
      const next = ok.length === 1 ? "crowd" : ok.length === 2 ? "pair" : null;
      section.hidden = !next;
      if (!next) { mode = null; a = b = null; shownKey = ""; return; }
      const na = ok[0], nb = ok[1] || null;
      if (mode === next && a && a.cid === na.cid && (b ? b.cid : null) === (nb ? nb.cid : null)) { a = na; b = nb; return; }
      mode = next; a = na; b = nb; shownKey = "";
      if (next === "crowd") { sortKey = "share"; sortDir = "desc"; }
      opened.clear();
      clear();
      show();
    },
  };
}
