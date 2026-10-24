import { ready as i18nReady } from "./i18n.mjs";
await i18nReady;
/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - lists the last 6 opponents (one row per person, repeats bump the count);
 *     on a kill our name sits on top, on a death the killer's name does;
 *   - shows each stat cell as a number that crossfades into the column's emoji,
 *     sized by the player's percentile (owner t546u: no skill graph in Live);
 *   - uncached opponents first show Census K/D · KPM, then get a full 200-opponent Census
 *     fetch in the background (one at a time, newest first, #32) and upgrade in place.
 * Pure helpers are exported for tests; the DOM part runs only in a browser.
 */
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261022-wpc1";
import { isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261022-nbd1";
import { infantryShares } from "./infantry.mjs?v=20261023-short1";

export const FEED_MAX = 6;
const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;
const FACTION = { 1: "vs", 2: "nc", 3: "tr", 4: "nso" };

/** Death payload → { kind: "kill" | "death", opp, headshot } for target cid, or null (suicide / unrelated / no attacker). */
export function classifyDeath(payload, cid) {
  if (!payload || payload.event_name !== "Death") return null;
  const att = String(payload.attacker_character_id || "0");
  const vic = String(payload.character_id || "0");
  const me = String(cid);
  if (att === "0" || att === vic) return null;
  const headshot = String(payload.is_headshot) === "1";
  if (att === me) return { kind: "kill", opp: vic, headshot };
  if (vic === me) return { kind: "death", opp: att, headshot };
  return null;
}

/**
 * Feed state step: newest event on top; a repeat opponent's row moves up (no
 * repeats in the list); a new opponent pushes the oldest row out past FEED_MAX.
 * ⏱️ stopwatch: the top row runs (gap null); when a new event lands, the old
 * top row freezes at the time between the two events.
 * Returns { rows, dropped } (dropped = the row pushed out, or null).
 */
export function feedPush(rows, ev, now = Date.now()) {
  const prev = rows.map((r, i) => (i === 0 && r.gap == null ? { ...r, gap: Math.max(0, now - r.at) } : r));
  const row = { opp: ev.opp, last: ev.kind, headshot: !!ev.headshot, at: now, gap: null };
  const rest = prev.filter((r) => r.opp !== ev.opp);
  const next = [row, ...rest];
  const dropped = next.length > FEED_MAX ? next[next.length - 1] : null;
  return { rows: next.slice(0, FEED_MAX), dropped };
}

/** ⏱️ "4s", "1m 05s", "1h 02m". */
export function fmtGap(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
  return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m`;
}

/** Lifetime K/D and KPM from a Census character with c:resolve=stat_history ("time" is seconds played). */
export function censusStats(ch) {
  const list = (ch && ch.stats && ch.stats.stat_history) || [];
  const at = (name) => +((list.find((s) => s.stat_name === name) || {}).all_time || 0);
  const k = at("kills"), d = at("deaths"), t = at("time");
  return { kd: d > 0 ? k / d : null, kpm: t > 0 ? k / (t / 60) : null };
}

/**
 * LIVE columns (owner t546u, t550u): one config list, in this order — change a mode or the order here.
 * Same ids / labels / digits as rankings.mjs VISIBLE. mode:
 *   "ivi-wide" = double-width cell, number + emoji together, no flipping (emoji still sized by rank);
 *   "flip"     = number ⇄ sized emoji loop (CSS, see CYCLE);
 *   "emoji"    = sized emoji only, no number.
 * lowerBetter = smaller value is better (reversed percentile → big emoji for a low value); no LIVE
 * column uses it now (owner t555u: 🪳 Zerg follows the raw number).
 * 🪳 Zerg is computed like the Rankings table (trait-scores.mjs zergScore from the ranks.json pools).
 * 🪖 Infantry is the ranks.json "inf" value; players without it show "—" and no emoji.
 */
export const LIVE_COLS = Object.freeze([
  { id: "adjs", label: "⚔️ iVi", digits: 0, floorZero: true, mode: "ivi-wide" },
  { id: "act", label: "🏃 Activity", digits: 2, mode: "flip" },
  { id: "pvs", label: "🦁 Brave", digits: 2, mode: "flip" },
  { id: "rf", label: "🛡️ Resist", digits: 2, mode: "flip" },
  { id: "zerg", label: "🪳 Zerg", digits: 0, mode: "flip" }, // t555u: bigger Zerg = bigger 🪳 (not reversed)
  { id: "inf", label: "🪖 Infantry", digits: 1, mode: "flip" },
]);
/** Width of a column in layout units (the wide iVi cell = 2). */
export const colUnits = (c) => (c.mode === "ivi-wide" ? 2 : 1);

/**
 * Emoji size from rank (owner t546u): the cell's emoji is scaled by the player's
 * percentile in that stat (pXX = higher than XX% of ranks.json, same pools as the
 * Rankings table). p50 = 1× (median, not scaled); straight line up to EMOJI_MAX at
 * the best (p99) and down to EMOJI_MIN at the worst (p0). Lower-is-better columns
 * (🤝 Assists) are flipped first, so a low pXX gives a big emoji there.
 */
export const EMOJI_MIN = 0.55;
export const EMOJI_MAX = 1.8;
/** "How good" percentile 0..99 (99 = best) from the plain pXX. */
export function goodPct(col, p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const q = Math.min(99, Math.max(0, p));
  return col && col.lowerBetter ? 99 - q : q;
}
/** Emoji scale for one cell (null = no value → no emoji). */
export function emojiScale(col, p) {
  const g = goodPct(col, p);
  if (g == null) return null;
  const s = g >= 50 ? 1 + ((g - 50) / 49) * (EMOJI_MAX - 1) : 1 - ((50 - g) / 50) * (1 - EMOJI_MIN);
  return Math.round(s * 100) / 100;
}
/**
 * Number ⇄ emoji loop (owner t546u; t554u: top 2 rows only; t555u: 20 s each): number NUM ms,
 * crossfade FADE ms, emoji EMOJI ms, crossfade back. One CSS animation (styles.css lvNum /
 * lvEm, 40.266s). Each row's clock starts when it arrives (row.at), so a new top row always
 * starts on a fresh number phase and re-renders never restart or jump the loop.
 */
export const CYCLE = Object.freeze({ num: 20000, fade: 133, emoji: 20000 });
export const CYCLE_MS = CYCLE.num + CYCLE.emoji + 2 * CYCLE.fade;
/** Owner t554u: only the newest FLIP_ROWS rows flip; older rows show the sized emoji only. */
export const FLIP_ROWS = 2;
/** CSS phase offset for a row that arrived at `at`: a negative delay = time already spent in the loop. */
export function cyclePhase(now = Date.now(), at = 0) {
  return `-${Math.max(0, Math.floor(now - at)) % CYCLE_MS}ms`;
}
/** Cell mode for feed row r (0 = newest; -1 = the row fading out): "flip" only in the top FLIP_ROWS. */
export function rowMode(c, r) {
  return c.mode === "flip" && !(r >= 0 && r < FLIP_ROWS) ? "emoji" : c.mode;
}

/**
 * Background-fetch queue step (#32): next opponent cid to fetch = newest-first queue entry
 * that is still in the feed and was never tried this page load; or null.
 */
export function nextBgFetch(queue, rows, tried) {
  const inFeed = new Set((rows || []).map((r) => r.opp));
  return (queue || []).find((cid) => inFeed.has(cid) && !(tried && tried.has(cid))) || null;
}

/** A fetched player (app.js loadOne) → the LIVE_COLS row the cache would give; 🪳 Zerg needs Honu (null). */
export function liveRowFromPlayer(player, name) {
  const m = playerMetrics(normalizePlayer(player));
  const o = { name: name || (player && player.display) || "" };
  for (const c of LIVE_COLS) {
    // 🪳 Zerg needs Honu assists (not in a Census fetch); 🪖 Infantry = the same share build-ranks.mjs stores.
    const sh = c.id === "inf" ? infantryShares(player && player.infantry) : null;
    const v = c.id === "zerg" ? null : c.id === "inf" ? (sh ? sh.inf : null) : shownValue(m, c.id);
    o[c.id] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  // 🚜 cut on ⚔️ iVi (same fields as ranks.json vcut / infVeh / infMax).
  o.vcut = m.vehCut > 0 ? Math.round(m.vehCut * 1000) / 10 : null;
  o.infVeh = Number.isFinite(m.vehOnly) ? m.vehOnly * 100 : null;
  o.infMax = Number.isFinite(m.maxShare) ? m.maxShare * 100 : null;
  return o;
}

/** Shared-cache batching (#33): at most one POST /add a minute, at most 10 names each. */
export const SHARE_EVERY_MS = 60000;
export const SHARE_MAX = 10;
/** ms to wait before the next /add flush: a full batch goes as soon as allowed, a partial one waits for the window. */
export function shareDelay(now, lastSent, firstPendingAt, pending) {
  if (!pending) return null;
  const allowed = lastSent == null ? now : lastSent + SHARE_EVERY_MS;
  const due = pending >= SHARE_MAX ? allowed : Math.max(allowed, firstPendingAt + SHARE_EVERY_MS);
  return Math.max(0, due - now);
}

/** "1,357" / "2.80" / "—" for one cell. */
export function cellText(col, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (col.floorZero && v < 0) v = 0;
  // Flip cells are sized for 5 characters ("12.34", "100.0"): rare big values drop decimals (329.63 → "329.6").
  let d = col.digits;
  if (col.mode === "flip") while (d > 0 && Math.abs(v).toFixed(d).length > 5) d--;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const slugKey = (name) => String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");

/* ---------------- browser part ---------------- */
if (typeof window !== "undefined" && typeof document !== "undefined") start();

function start() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const target = (new URLSearchParams(location.search).get("names") || "").split(",")[0].trim();
  const stateEl = $("liveState");
  const listEl = $("liveList");
  const setState = (html, cls = "") => { if (stateEl) { stateEl.innerHTML = html; stateEl.className = "live-state " + cls; } };
  if (!target) { setState("Add a name on the main page, then press 🎥.", "err"); return; }

  const people = new Map(); // cid -> { name, faction, kd, cached: {adjs, kd} | null }
  let rows = [];
  let me = null; // { cid, name, faction }
  let ranks = null; // slug -> { adjs, kd }
  const pools = {}; // col id -> sorted finite values (percentiles, same as the Rankings table)

  const app = () => window.__ps2EliteKd || null;

  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  let ranksP = null;
  function loadRanks() { return ranksP || (ranksP = loadRanksOnce()); }
  async function loadRanksOnce() {
    try {
      const j = await getJson("data/ranks.json");
      const ci = (c) => j.cols.indexOf(c);
      const iS = ci("slug"), iN = ci("name");
      const idx = LIVE_COLS.map((c) => [c.id, ci(c.id)]).concat([["vcut", ci("vcut")], ["infVeh", ci("infVeh")], ["infMax", ci("infMax")]]);
      ranks = new Map(j.rows.map((r) => {
        const o = { name: r[iN] };
        for (const [id, i] of idx) o[id] = i >= 0 ? r[i] : null;
        return [r[iS], o];
      }));
      // 🪳 Zerg: same score as the Rankings table (rankings.mjs: traitPools over ranks.json, zergScore per row).
      const colOf = (id) => (ci(id) >= 0 ? j.rows.map((r) => r[ci(id)]) : []);
      const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
      const iF = ci("inflation"), iA = ci("apk"), iR = ci("rvp");
      const zergOf = (r) => { const z = zergScore(tp, iF >= 0 ? r[iF] : null, iA >= 0 ? r[iA] : null, iR >= 0 ? r[iR] : null); return z ? z.score : null; };
      const fin = (v) => typeof v === "number" && Number.isFinite(v);
      const zergCol = j.rows.map(zergOf);
      j.rows.forEach((r, k) => { const o = ranks.get(r[iS]); if (o) o.zerg = zergCol[k]; });
      for (const c of LIVE_COLS) {
        const vals = c.id === "zerg" ? zergCol : colOf(c.id);
        pools[c.id] = vals.filter(fin).sort((a, b) => a - b);
      }
    } catch { ranks = new Map(); }
  }
  async function person(cid) {
    if (people.has(cid)) return people.get(cid);
    const p = { name: `#${cid}`, faction: "", kd: null, kpm: null, cached: null };
    people.set(cid, p);
    try {
      const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id&c:resolve=stat_history(stat_name,all_time)`);
      const ch = (j.character_list || [])[0];
      if (ch) {
        p.name = (ch.name && ch.name.first) || p.name;
        p.faction = FACTION[ch.faction_id] || "";
        Object.assign(p, censusStats(ch));
      }
    } catch { /* keep #id */ }
    if (!ranks) await loadRanks();
    const c = ranks.get(slugKey(p.name));
    if (c) p.cached = c;
    return p;
  }

  const fmt = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
  const N = LIVE_COLS.reduce((n, c) => n + colUnits(c), 0); // grid units a side (wide ⚔️ iVi = 2)
  const shortLab = (c) => c.label.split(" ")[0];
  /** 💩 after a confirmed padder's name (padding.mjs): hover explains the −10% iVi penalty. */
  const poopFor = (name) => (isPenalizedPadder(name) ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "");
  /** One stat cell by its LIVE_COLS mode; r = feed row (only the top FLIP_ROWS flip, rowMode). */
  function statCell(c, v, r) {
    const mode = rowMode(c, r);
    const s = emojiScale(c, percentileOf(pools[c.id] || [], v));
    const span = colUnits(c) > 1 ? ` colspan="${colUnits(c)}"` : "";
    if (s == null) return `<td class="lv-num"${span}>—</td>`;
    const em = `<b class="lv-e" aria-hidden="true">${shortLab(c)}</b>`;
    if (mode === "ivi-wide") return `<td class="lv-num lv-wide" colspan="2" style="--s:${s}"><span class="lv-v">${cellText(c, v)}</span>${em}</td>`;
    if (mode === "emoji") return `<td class="lv-num lv-emo" style="--s:${s}" aria-label="${esc(c.label)}">${em}</td>`;
    return `<td class="lv-num lv-cyc" style="--s:${s}"><span class="lv-v">${cellText(c, v)}</span><span class="lv-em">${em}</span></td>`;
  }
  /** One player = name cell + stats cells on one row (columns aligned across events). */
  function side(p, isMe, r = 0) {
    // 💩 confirmed padder (padding.mjs): hover explains the −10% iVi penalty.
    const poop = poopFor(p.name);
    const name = `<td class="lv-name-cell"><span class="lv-name fac-${p.faction || ""}" title="${esc(p.name)}">${esc(p.name)}</span>${poop}</td>`;
    let stats;
    // Number ⇄ scaled emoji loop, no hover hint (owner t546u); "—" stays still.
    if (p.cached) stats = LIVE_COLS.map((c) => statCell(c, p.cached[c.id], r)).join("");
    else if (isMe) stats = `<td class="lv-num lv-uncached" colspan="${N}"></td>`;
    else stats = `<td class="lv-num lv-uncached" colspan="${N}">K/D ${fmt(p.kd, 2)} · KPM ${fmt(p.kpm, 2)} · not in cache</td>`;
    return { name, stats };
  }
  function eventHtml(r, i) {
    const p = people.get(r.opp) || { name: r.opp };
    const meP = { name: me.name, faction: me.faction, cached: me.cached };
    const kill = r.last === "kill";
    // Winner on the left: on a kill that's us, on a death the killer.
    const ri = i; // -1 = the dropped row fading out (emoji only)
    const left = kill ? side(meP, true, ri) : side(p, false, ri);
    const right = kill ? side(p, false, ri) : side(meP, true, ri);
    const t = r.gap == null ? `<span class="lv-timer" data-at="${r.at}">${fmtGap(Date.now() - r.at)}</span>` : `${fmtGap(r.gap)}`;
    const clock = i >= 0 && i < FLIP_ROWS ? ` style="--lv-t0:${cyclePhase(Date.now(), r.at)}"` : "";
    return `<tbody class="lv-ev lv-${r.last}${i === 0 ? " lv-new" : ""}"${clock}><tr><td class="lv-time">${t}</td>${left.name}${left.stats}<td class="lv-arrow">❯</td>${right.name}${right.stats}</tr></tbody>`;
  }
  function render(dropped) {
    if (!listEl) return;
    // Fixed layout, N equal stat units a side (the wide ⚔️ iVi cell spans 2). The ❯ arrow
    // sits at the page middle: the right name column also takes the timer column's width.
    const colTags = (sd) => `<col class="lv-c-stat${sd}">`.repeat(N);
    const cols = `<colgroup><col class="lv-c-time"><col class="lv-c-name">${colTags("L")}<col class="lv-c-arrow"><col class="lv-c-name lv-c-nameR">${colTags("R")}</colgroup>`;
    const ths = LIVE_COLS.map((c) => `<th${colUnits(c) > 1 ? ` colspan="${colUnits(c)}"` : ""}>${shortLab(c)}</th>`).join("");
    const head = `<thead><tr><th></th><th></th>${ths}<th></th><th></th>${ths}</tr></thead>`;
    // No events yet: skeleton first row — em dashes stand in for the numbers
    // until real data arrives and fills the rows.
    const dashCells = LIVE_COLS.map((c) => `<td class="lv-num"${colUnits(c) > 1 ? ` colspan="${colUnits(c)}"` : ""}>—</td>`).join("");
    const body = rows.length ? rows.map(eventHtml).join("")
      : `<tbody class="lv-ev lv-wait"><tr><td class="lv-time">—</td><td class="lv-name-cell"><span class="lv-name fac-${me.faction || ""}">${esc(me.name)}</span>${poopFor(me.name)}</td>${dashCells}<td class="lv-arrow">❯</td><td class="lv-name-cell">—</td>${dashCells}</tr></tbody>`;
    listEl.innerHTML = cols + head + body + (dropped ? eventHtml(dropped, -1).replace('class="lv-ev', 'class="lv-ev lv-fade') : "");
    if (dropped) setTimeout(() => { const f = listEl.querySelector(".lv-fade"); if (f) f.remove(); }, 600);
  }
  setInterval(() => {
    if (!listEl) return;
    for (const el of listEl.querySelectorAll(".lv-timer[data-at]")) el.textContent = `${fmtGap(Date.now() - +el.dataset.at)}`;
  }, 1000);

  // Owner t546u: no skill graph in Live any more (it stays on the main page).

  // #32: uncached opponents → full Census fetch in the background, one at a time.
  let bgQueue = []; // cids, newest first
  const bgTried = new Set();
  let bgBusy = false;
  async function bgPump() {
    const a = app();
    if (bgBusy || !a || !a.fetchPlayerBg) return;
    const cid = nextBgFetch(bgQueue, rows, bgTried);
    bgQueue = bgQueue.filter((c) => rows.some((r) => r.opp === c) && !bgTried.has(c));
    if (!cid) return;
    bgTried.add(cid);
    bgQueue = bgQueue.filter((c) => c !== cid);
    const p = people.get(cid);
    if (!p || p.cached || p.name.startsWith("#")) { bgPump(); return; }
    bgBusy = true;
    try {
      const player = await a.fetchPlayerBg(p.name);
      if (player) {
        p.cached = liveRowFromPlayer(player, p.name);
        render();
        if (typeof onBgFetched === "function") onBgFetched(p.name, player);
      }
    } catch { /* keep the K/D · KPM row; never retried this page load */ }
    bgBusy = false;
    bgPump();
  }
  // #33: background-fetched opponents → shared cache (/add), batched.
  let sharePending = [], shareFirstAt = 0, shareLast = null, shareTimer = null;
  function shareFlush() {
    shareTimer = null;
    const a = app();
    if (!a || !a.queueSharedCache || !sharePending.length) return;
    const batch = sharePending.splice(0, SHARE_MAX);
    shareLast = Date.now();
    shareFirstAt = shareLast;
    a.queueSharedCache(batch);
    shareSchedule();
  }
  function shareSchedule() {
    if (shareTimer) clearTimeout(shareTimer);
    const d = shareDelay(Date.now(), shareLast, shareFirstAt, sharePending.length);
    shareTimer = d == null ? null : setTimeout(shareFlush, d);
  }
  const onBgFetched = (name, player) => {
    if (!sharePending.length) shareFirstAt = Date.now();
    sharePending.push({ name, player });
    shareSchedule();
  };

  async function onEvent(ev) {
    const p = await person(ev.opp);
    const res = feedPush(rows, ev);
    rows = res.rows;
    render(res.dropped);
    if (!p.cached && !bgTried.has(ev.opp)) { bgQueue = [ev.opp, ...bgQueue.filter((c) => c !== ev.opp)]; bgPump(); }
  }

  let ws = null, backoff = 2000;
  function connect() {
    setState("Connecting to Census…");
    try { ws = new WebSocket(STREAM); } catch { retry(); return; }
    ws.onopen = () => {
      backoff = 2000;
      ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death"] }));
      setState(`<span class="live-dot">●</span> waiting for kills and deaths…`, "on");
      render();
    };
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (j.type !== "serviceMessage") return;
      const ev = classifyDeath(j.payload, me.cid);
      if (ev) {
        if (!rows.length) setState("", "on"); // owner t550u: no title above the table
        onEvent(ev);
      }
    };
    ws.onclose = () => retry();
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function retry() {
    setState(`Census stream dropped — reconnecting in ${Math.round(backoff / 1000)} s…`, "err");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60000);
  }

  (async () => {
    try {
      const bare = target.replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
      const j = await getJson(`${CENSUS}character?name.first_lower=${encodeURIComponent(bare)}&c:show=character_id,name.first,faction_id`);
      const ch = (j.character_list || [])[0];
      if (!ch) { setState(`No character named <strong>${esc(target)}</strong> on Census.`, "err"); return; }
      me = { cid: String(ch.character_id), name: ch.name.first, faction: FACTION[ch.faction_id] || "", cached: null };
      loadRanks().then(() => { me.cached = ranks.get(slugKey(me.name)) || null; });
      connect();
    } catch {
      setState("Census is not answering — reload to retry.", "err");
    }
  })();
}
