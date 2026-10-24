import { ready as i18nReady } from "./i18n.mjs";
await i18nReady;
/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - lists the last 6 opponents (one row per person, repeats bump the count);
 *     on a kill our name sits on top, on a death the killer's name does;
 *   - shows each player's stats in one fixed slot that switches every 20 s (owner t557u):
 *     phase A = ⚔️ iVi number with its emoji inline, phase B = the other columns as emojis
 *     sized by the player's percentile with a small number under each (no skill graph in Live);
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
 *   "ivi"   = phase A: the number with the sized emoji inline after it ("1,883⚔️", owner t557u);
 *   "stack" = phase B: sized emoji with the small number under it;
 *   "emoji" = phase B: sized emoji only, no number.
 * lowerBetter = smaller value is better (reversed percentile → big emoji for a low value); no LIVE
 * column uses it now (owner t555u: 🪳 Zerg follows the raw number).
 * 🪳 Zerg is computed like the Rankings table (trait-scores.mjs zergScore from the ranks.json pools).
 * 🪖 Infantry is the ranks.json "inf" value; players without it show "—" and no emoji.
 */
export const LIVE_COLS = Object.freeze([
  { id: "adjs", label: "⚔️ iVi", digits: 0, floorZero: true, mode: "ivi" },
  { id: "act", label: "🏃 Activity", digits: 2, mode: "stack" },
  { id: "pvs", label: "🦁 Brave", digits: 2, mode: "stack" },
  { id: "rf", label: "🛡️ Resist", digits: 2, mode: "stack" },
  { id: "zerg", label: "🪳 Zerg", digits: 0, mode: "stack" }, // t555u: bigger Zerg = bigger 🪳 (not reversed)
  { id: "inf", label: "🪖 Infantry", digits: 1, mode: "stack" },
]);

/**
 * Emoji size from rank (owner t546u, t558u): the cell's emoji is scaled by the player's
 * percentile in that stat (pXX = higher than XX% of ranks.json, same pools as the
 * Rankings table). p50 = 1× (median, not scaled). t558u: much bigger steps so ranks are
 * easy to tell apart — geometric on each side, up to EMOJI_MAX at the best (p99) and down
 * to EMOJI_MIN at the worst (p0); the steps grow toward the top (p75 ≈ 1.5×, p95 ≈ 2.1×).
 * Lower-is-better columns are flipped first, so a low pXX gives a big emoji there.
 */
export const EMOJI_MIN = 0.35;
export const EMOJI_MAX = 2.2;
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
  const s = g >= 50 ? EMOJI_MAX ** ((g - 50) / 49) : EMOJI_MIN ** ((50 - g) / 50);
  return Math.round(s * 100) / 100;
}

/** Owner t557u: the slot switches between phase A (⚔️ iVi) and phase B (the rest) every 20 s, all rows in sync. */
export const PHASE_MS = 20000;
/** Phase at a time since the page started: "A" for the first 20 s, then "B", and so on. */
export function phaseAt(ms) { return Math.floor(Math.max(0, ms) / PHASE_MS) % 2 === 0 ? "A" : "B"; }
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
  // Owner t557u: the small numbers under the emojis fit 4 characters ("0.63", "95.4"): bigger values drop decimals (100.0 → "100").
  let d = col.digits;
  if (col.mode === "stack") while (d > 0 && Math.abs(v).toFixed(d).length > 4) d--;
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
  const IVI = LIVE_COLS.filter((c) => c.mode === "ivi"); // phase A
  const REST = LIVE_COLS.filter((c) => c.mode !== "ivi"); // phase B
  // Owner t559u: the row mirrors itself — the right player's emojis run 🪖 🪳 🛡️ 🦁 🏃, ending at the right name.
  const restFor = (sd) => (sd === "R" ? [...REST].reverse() : REST);
  const shortLab = (c) => c.label.split(" ")[0];
  /** 💩 after a confirmed padder's name (padding.mjs): hover explains the −10% iVi penalty. */
  const poopFor = (name) => (isPenalizedPadder(name) ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "");
  const scaleOf = (c, v) => emojiScale(c, percentileOf(pools[c.id] || [], v));
  /** Phase B unit: sized emoji, small number under it ("—" when there is no value). */
  function unit(c, v) {
    const s = scaleOf(c, v);
    if (s == null) return `<span class="lv-u lv-none" title="${esc(c.label)}">—</span>`;
    const em = `<b class="lv-e" aria-hidden="true">${shortLab(c)}</b>`;
    if (c.mode === "emoji") return `<span class="lv-u lv-emo" style="--s:${s}" title="${esc(c.label)}">${em}</span>`;
    return `<span class="lv-u lv-st" style="--s:${s}" title="${esc(c.label)} ${cellText(c, v)}">${em}<span class="lv-v">${cellText(c, v)}</span></span>`;
  }
  /** Phase A: "1,883⚔️" (number, then the rank-sized emoji). */
  function iviText(c, v) {
    const s = scaleOf(c, v);
    if (s == null) return `<span class="lv-iv lv-none" title="${esc(c.label)}">—</span>`;
    return `<span class="lv-iv" title="${esc(c.label)} ${cellText(c, v)}">${cellText(c, v)}<b class="lv-ie" style="--s:${s}" aria-hidden="true">${shortLab(c)}</b></span>`;
  }
  /** One side's stats slot: both phases stacked in one fixed box, the table crossfades them (owner t557u). */
  function slot(vals, sd) {
    return `<td class="lv-slot lv-s${sd}"><span class="lv-pa">${IVI.map((c) => iviText(c, vals[c.id])).join("")}</span><span class="lv-pb">${restFor(sd).map((c) => unit(c, vals[c.id])).join("")}</span></td>`;
  }
  /** One player = name cell + stats slot. sd "L" / "R" (owner t556u: [name][stats][stats][name];
   *  names hug their stats, a long name ellipsizes on the outer side). */
  function side(p, isMe, sd) {
    // 💩 confirmed padder (padding.mjs): hover explains the −10% iVi penalty.
    const poop = poopFor(p.name);
    const nm = `<span class="lv-name fac-${p.faction || ""}" title="${esc(p.name)}"><bdi>${esc(p.name)}</bdi></span>`;
    const name = `<td class="lv-name-cell lv-n${sd}">${sd === "L" ? poop + nm : nm + poop}</td>`;
    let stats;
    if (p.cached) stats = slot(p.cached, sd);
    else if (isMe) stats = `<td class="lv-slot lv-uncached lv-s${sd}"></td>`;
    else stats = `<td class="lv-slot lv-uncached lv-s${sd}" title="not in cache"><span>K/D ${fmt(p.kd, 2)}</span><span>KPM ${fmt(p.kpm, 2)}</span></td>`;
    return { name, stats };
  }
  function eventHtml(r, i) {
    const p = people.get(r.opp) || { name: r.opp };
    const meP = { name: me.name, faction: me.faction, cached: me.cached };
    const kill = r.last === "kill";
    // Winner on the left: on a kill that's us, on a death the killer.
    const left = kill ? side(meP, true, "L") : side(p, false, "L");
    const right = kill ? side(p, false, "R") : side(meP, true, "R");
    const t = r.gap == null ? `<span class="lv-timer" data-at="${r.at}">${fmtGap(Date.now() - r.at)}</span>` : `${fmtGap(r.gap)}`;
    return `<tbody class="lv-ev lv-${r.last}${i === 0 ? " lv-new" : ""}"><tr><td class="lv-time">${t}</td>${left.name}${left.stats}${right.stats}${right.name}</tr></tbody>`;
  }
  function render(dropped) {
    if (!listEl) return;
    // Fixed layout (owner t556u, t557u): [time][name ▸][slot][slot][◂ name]; the slots never change size.
    const cols = `<colgroup><col class="lv-c-time"><col class="lv-c-name"><col class="lv-c-slot"><col class="lv-c-slot"><col class="lv-c-name"></colgroup>`;
    const th = (sd) => `<th class="lv-slot"><span class="lv-pa">${IVI.map((c) => `<span class="lv-iv" title="${esc(c.label)}">${esc(c.label)}</span>`).join("")}</span><span class="lv-pb">${restFor(sd).map((c) => `<span class="lv-u" title="${esc(c.label)}">${shortLab(c)}</span>`).join("")}</span></th>`;
    const head = `<thead><tr><th></th><th></th>${th("L")}${th("R")}<th></th></tr></thead>`;
    // No events yet: skeleton first row — em dashes stand in for the numbers
    // until real data arrives and fills the rows.
    const dashCells = slot({}, "L"), dashR = slot({}, "R");
    const body = rows.length ? rows.map(eventHtml).join("")
      : `<tbody class="lv-ev lv-wait"><tr><td class="lv-time">—</td><td class="lv-name-cell lv-nL">${poopFor(me.name)}<span class="lv-name fac-${me.faction || ""}"><bdi>${esc(me.name)}</bdi></span></td>${dashCells}${dashR}<td class="lv-name-cell lv-nR">—</td></tr></tbody>`;
    listEl.innerHTML = cols + head + body + (dropped ? eventHtml(dropped, -1).replace('class="lv-ev', 'class="lv-ev lv-fade') : "");
    if (dropped) setTimeout(() => { const f = listEl.querySelector(".lv-fade"); if (f) f.remove(); }, 600);
  }
  // Owner t557u: every row switches together — one class on the table, a quick crossfade in CSS.
  const t0 = Date.now();
  const setPhase = () => { if (listEl) listEl.classList.toggle("lv-phB", phaseAt(Date.now() - t0) === "B"); };
  setPhase();
  setInterval(setPhase, 250);
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
