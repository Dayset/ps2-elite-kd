import { ready as i18nReady } from "./i18n.mjs";
await i18nReady;
/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - lists the last 6 opponents (one row per person, repeats bump the count);
 *     on a kill our name sits on top, on a death the killer's name does;
 *   - pops cached opponents onto the skill graph (target + last 5 cached);
 *   - uncached opponents first show Census K/D · KPM, then get a full 200-opponent Census
 *     fetch in the background (one at a time, newest first, #32) and upgrade in place.
 * Pure helpers are exported for tests; the DOM part runs only in a browser.
 */
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261022-wpc1";
import { isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { vehicleCutTip } from "./vehicle-cut.mjs?v=20261022-wpc1";

export const FEED_MAX = 6;
export const GRAPH_OPPONENTS = 5; // + the target = MAX_NAMES (6)
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

/** Graph list: target + the most recent cached opponents, newest first, no repeats. */
export function graphNames(target, cachedNewestFirst) {
  const seen = new Set([String(target).toLowerCase()]);
  const out = [target];
  for (const n of cachedNewestFirst) {
    const k = String(n).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length > GRAPH_OPPONENTS) break;
  }
  return out;
}

/** Lifetime K/D and KPM from a Census character with c:resolve=stat_history ("time" is seconds played). */
export function censusStats(ch) {
  const list = (ch && ch.stats && ch.stats.stat_history) || [];
  const at = (name) => +((list.find((s) => s.stat_name === name) || {}).all_time || 0);
  const k = at("kills"), d = at("deaths"), t = at("time");
  return { kd: d > 0 ? k / d : null, kpm: t > 0 ? k / (t / 60) : null };
}

/** ✨ Adjusted columns as on the main page (no debug columns); same ids / labels / digits as rankings.mjs VISIBLE. */
export const LIVE_COLS = Object.freeze([
  { id: "adjs", label: "⚔️ iVi", digits: 0, floorZero: true, tip: "Overall rating from how you do against the ~200 players you fight most, worth more the stronger they are." },
  { id: "act", label: "🏃 Activity", digits: 2, tip: "Your K/D against the players you fight most, multiplied by how fast you kill." },
  { id: "pvs", label: "🦁 Brave", digits: 2, tip: "Activity that keeps up as enemies get stronger." },
  { id: "rf", label: "🛡️ Resist", digits: 2, tip: "How well you stand up to strong players." },
  { id: "cons", label: "⚡ Const", digits: 2, tip: "K/D kept against the strongest third of opponents vs the weakest third (1.00 = holds completely)." },
  { id: "apk", label: "🤝 Assists", digits: 2, tip: "Assists per kill in recent Honu sessions." },
  { id: "rkd", label: "☠️ K/D", digits: 3, tip: "Kills ÷ deaths against the ~200 players you fight most." },
]);

/**
 * Background-fetch queue step (#32): next opponent cid to fetch = newest-first queue entry
 * that is still in the feed and was never tried this page load; or null.
 */
export function nextBgFetch(queue, rows, tried) {
  const inFeed = new Set((rows || []).map((r) => r.opp));
  return (queue || []).find((cid) => inFeed.has(cid) && !(tried && tried.has(cid))) || null;
}

/** A fetched player (app.js loadOne) → the LIVE_COLS row the cache would give; Assists is Honu-only (null). */
export function liveRowFromPlayer(player, name) {
  const m = playerMetrics(normalizePlayer(player));
  const o = { name: name || (player && player.display) || "" };
  for (const c of LIVE_COLS) {
    const v = c.id === "apk" ? null : shownValue(m, c.id);
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
  return v.toLocaleString("en-US", { minimumFractionDigits: col.digits, maximumFractionDigits: col.digits });
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
  let cachedOrder = []; // cached opponent names, newest first
  let me = null; // { cid, name, faction }
  let ranks = null; // slug -> { adjs, kd }

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
  const N = LIVE_COLS.length;
  const shortLab = (c) => c.label.split(" ")[0];
  /** 💩 after a confirmed padder's name (padding.mjs): hover explains the −10% iVi penalty. */
  const poopFor = (name) => (isPenalizedPadder(name) ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "");
  /** One player = name cell + stats cells on one row (columns aligned across events). */
  function side(p, isMe) {
    // 💩 confirmed padder (padding.mjs): hover explains the −10% iVi penalty.
    const poop = poopFor(p.name);
    const name = `<td class="lv-name-cell"><span class="lv-name fac-${p.faction || ""}" title="${esc(p.name)}">${esc(p.name)}</span>${poop}</td>`;
    let stats;
    // 🚜 vehicle / MAX cut: no visible mark (owner), reason in the iVi cell's hover.
    const vcut = (o, c) => (c.id === "adjs" && o.vcut > 0 ? ". " + vehicleCutTip(o.infVeh, o.infMax, o.vcut) : "");
    if (p.cached) stats = LIVE_COLS.map((c) => `<td class="lv-num" title="${esc(c.label + ": " + c.tip + vcut(p.cached, c))}">${cellText(c, p.cached[c.id])}</td>`).join("");
    else if (isMe) stats = `<td class="lv-num lv-uncached" colspan="${N}"></td>`;
    else stats = `<td class="lv-num lv-uncached" colspan="${N}" title="Not in our cache: Census lifetime numbers">K/D ${fmt(p.kd, 2)} · KPM ${fmt(p.kpm, 2)} · not in cache</td>`;
    return { name, stats };
  }
  function eventHtml(r, i) {
    const p = people.get(r.opp) || { name: r.opp };
    const meP = { name: me.name, faction: me.faction, cached: me.cached };
    const kill = r.last === "kill";
    // Winner on the left: on a kill that's us, on a death the killer.
    const left = kill ? side(meP, true) : side(p, false);
    const right = kill ? side(p, false) : side(meP, true);
    const t = r.gap == null ? `<span class="lv-timer" data-at="${r.at}">${fmtGap(Date.now() - r.at)}</span>` : `${fmtGap(r.gap)}`;
    return `<tbody class="lv-ev lv-${r.last}${i === 0 ? " lv-new" : ""}"><tr><td class="lv-time">${t}</td>${left.name}${left.stats}<td class="lv-arrow">❯</td>${right.name}${right.stats}</tr></tbody>`;
  }
  function render(dropped) {
    if (!listEl) return;
    // Fixed layout: the ❯ arrow sits at the exact page middle. The timer column
    // (10ch, left only) is balanced by making each right-side stat column
    // 10ch/7 wider than the left-side ones — no dead space anywhere.
    const cols = `<colgroup><col class="lv-c-time"><col class="lv-c-name">${'<col class="lv-c-statL">'.repeat(N)}<col class="lv-c-arrow"><col class="lv-c-name">${'<col class="lv-c-statR">'.repeat(N)}</colgroup>`;
    const head = `<thead><tr><th></th><th></th>${LIVE_COLS.map((c) => `<th title="${esc(c.label + ": " + c.tip)}">${shortLab(c)}</th>`).join("")}<th></th><th></th>${LIVE_COLS.map((c) => `<th title="${esc(c.label + ": " + c.tip)}">${shortLab(c)}</th>`).join("")}</tr></thead>`;
    // No events yet: skeleton first row — em dashes stand in for the numbers
    // until real data arrives and fills the rows.
    const dashCells = `<td class="lv-num">—</td>`.repeat(N);
    const body = rows.length ? rows.map(eventHtml).join("")
      : `<tbody class="lv-ev lv-wait"><tr><td class="lv-time">—</td><td class="lv-name-cell"><span class="lv-name fac-${me.faction || ""}">${esc(me.name)}</span>${poopFor(me.name)}</td>${dashCells}<td class="lv-arrow">❯</td><td class="lv-name-cell">—</td>${dashCells}</tr></tbody>`;
    listEl.innerHTML = cols + head + body + (dropped ? eventHtml(dropped, -1).replace('class="lv-ev', 'class="lv-ev lv-fade') : "");
    if (dropped) setTimeout(() => { const f = listEl.querySelector(".lv-fade"); if (f) f.remove(); }, 600);
  }
  setInterval(() => {
    if (!listEl) return;
    for (const el of listEl.querySelectorAll(".lv-timer[data-at]")) el.textContent = `${fmtGap(Date.now() - +el.dataset.at)}`;
  }, 1000);

  // Graph: re-run quietly when the cached set changes; one run at a time.
  let graphWant = null, graphBusy = false;
  async function syncGraph() {
    const a = app();
    if (!a || graphBusy || !graphWant) return;
    if (a.isAnalyzing && a.isAnalyzing()) { setTimeout(syncGraph, 1000); return; }
    const want = graphWant; graphWant = null; graphBusy = true;
    try {
      a.setNameTokens(want);
      await a.analyzeNames(want, { quiet: true });
    } catch { /* keep the old graph */ }
    graphBusy = false;
    if (graphWant) syncGraph();
  }

  function toGraph(p) {
    cachedOrder = [p.cached.name, ...cachedOrder.filter((n) => n !== p.cached.name)];
    const want = graphNames(target, cachedOrder);
    const now = (app() && app().getNameTokens()) || [];
    if (want.join("\n") !== now.join("\n")) { graphWant = want; syncGraph(); }
  }

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
        if (rows.some((r) => r.opp === cid)) toGraph(p);
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
    if (p.cached) toGraph(p);
    else if (!bgTried.has(ev.opp)) { bgQueue = [ev.opp, ...bgQueue.filter((c) => c !== ev.opp)]; bgPump(); }
  }

  let ws = null, backoff = 2000;
  function connect() {
    setState("Connecting to Census…");
    try { ws = new WebSocket(STREAM); } catch { retry(); return; }
    ws.onopen = () => {
      backoff = 2000;
      ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death"] }));
      setState(`<span class="live-dot">●</span> Live: <strong class="fac-${me.faction}">${esc(me.name)}</strong> — waiting for kills and deaths…`, "on");
      render();
    };
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (j.type !== "serviceMessage") return;
      const ev = classifyDeath(j.payload, me.cid);
      if (ev) {
        if (!rows.length) setState(`<span class="live-dot">●</span> Live: <strong class="fac-${me.faction}">${esc(me.name)}</strong>`, "on");
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
