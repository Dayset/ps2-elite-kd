/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - lists the last 6 opponents (one row per person, repeats bump the count);
 *     on a kill our name sits on top, on a death the killer's name does;
 *   - pops cached opponents onto the skill graph (target + last 5 cached);
 *   - never fetches an uncached opponent's history: name + Census K/D only.
 * Pure helpers are exported for tests; the DOM part runs only in a browser.
 */
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";

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
 * Feed state step: the opponent's row moves to the top with its counts bumped;
 * a new opponent pushes the oldest row out once there are FEED_MAX.
 * Returns { rows, dropped } (dropped = the row pushed out, or null).
 */
export function feedPush(rows, ev, now = Date.now()) {
  const old = rows.find((r) => r.opp === ev.opp);
  const row = old
    ? { ...old }
    : { opp: ev.opp, kills: 0, deaths: 0 };
  if (ev.kind === "kill") row.kills += 1; else row.deaths += 1;
  row.last = ev.kind;
  row.headshot = !!ev.headshot;
  row.at = now;
  const rest = rows.filter((r) => r.opp !== ev.opp);
  const next = [row, ...rest];
  const dropped = next.length > FEED_MAX ? next[next.length - 1] : null;
  return { rows: next.slice(0, FEED_MAX), dropped };
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

/** K/D from a Census character with c:resolve=stat_history. */
export function censusKd(ch) {
  const list = (ch && ch.stats && ch.stats.stat_history) || [];
  const at = (name) => +((list.find((s) => s.stat_name === name) || {}).all_time || 0);
  const k = at("kills"), d = at("deaths");
  return d > 0 ? k / d : null;
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
  async function loadRanks() {
    try {
      const j = await getJson("data/ranks.json");
      const ci = (c) => j.cols.indexOf(c);
      const iS = ci("slug"), iA = ci("adjs"), iK = ci("kd"), iN = ci("name");
      ranks = new Map(j.rows.map((r) => [r[iS], { adjs: r[iA], kd: r[iK], name: r[iN] }]));
    } catch { ranks = new Map(); }
  }
  async function person(cid) {
    if (people.has(cid)) return people.get(cid);
    const p = { name: `#${cid}`, faction: "", kd: null, cached: null };
    people.set(cid, p);
    try {
      const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id&c:resolve=stat_history(stat_name,all_time)`);
      const ch = (j.character_list || [])[0];
      if (ch) {
        p.name = (ch.name && ch.name.first) || p.name;
        p.faction = FACTION[ch.faction_id] || "";
        p.kd = censusKd(ch);
      }
    } catch { /* keep #id */ }
    if (!ranks) await loadRanks();
    const c = ranks.get(slugKey(p.name));
    if (c) p.cached = c;
    return p;
  }

  const fmt = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
  function line(p, isMe) {
    const stats = isMe ? "" : p.cached
      ? `<span class="lv-stat" title="From our cache">⚔️ ${fmt(p.cached.adjs, 0)} · K/D ${fmt(p.cached.kd, 2)}</span>`
      : `<span class="lv-stat lv-uncached" title="Not in our cache: Census lifetime K/D only">K/D ${fmt(p.kd, 2)}</span>`;
    return `<div class="lv-line${isMe ? " lv-me" : ""}"><span class="lv-name fac-${p.faction}">${esc(p.name)}</span>${stats}</div>`;
  }
  function render(fadeOpp) {
    if (!listEl) return;
    listEl.innerHTML = rows.map((r, i) => {
      const p = people.get(r.opp) || { name: r.opp };
      const meP = { name: me.name, faction: me.faction };
      const top = r.last === "kill" ? line(meP, true) : line(p, false);
      const bottom = r.last === "kill" ? line(p, false) : line(meP, true);
      const icon = r.last === "kill" ? "⚔️" : "💀";
      const hs = r.headshot ? `<span title="Headshot">🎯</span>` : "";
      const count = r.kills + r.deaths > 1 ? `<span class="lv-count" title="Kills / deaths against this player">⚔️${r.kills} 💀${r.deaths}</span>` : "";
      return `<li class="lv-row lv-${r.last}${i === 0 ? " lv-new" : ""}" data-opp="${esc(r.opp)}"><span class="lv-icon">${icon}${hs}</span><div class="lv-pair">${top}${bottom}</div>${count}</li>`;
    }).join("");
    if (fadeOpp) {
      const p = people.get(fadeOpp) || { name: fadeOpp };
      const li = document.createElement("li");
      li.className = "lv-row lv-fade";
      li.innerHTML = `<div class="lv-pair">${line(p, false)}</div>`;
      listEl.appendChild(li);
      setTimeout(() => li.remove(), 600);
    }
  }

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

  async function onEvent(ev) {
    const p = await person(ev.opp);
    const res = feedPush(rows, ev);
    rows = res.rows;
    render(res.dropped && res.dropped.opp);
    if (p.cached) {
      cachedOrder = [p.cached.name, ...cachedOrder.filter((n) => n !== p.cached.name)];
      const want = graphNames(target, cachedOrder);
      const now = (app() && app().getNameTokens()) || [];
      if (want.join("\n") !== now.join("\n")) { graphWant = want; syncGraph(); }
    }
  }

  let ws = null, backoff = 2000;
  function connect() {
    setState("Connecting to Census…");
    try { ws = new WebSocket(STREAM); } catch { retry(); return; }
    ws.onopen = () => {
      backoff = 2000;
      ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death"] }));
      setState(`<span class="live-dot">●</span> Live: <strong class="fac-${me.faction}">${esc(me.name)}</strong> — waiting for kills and deaths…`, "on");
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
      me = { cid: String(ch.character_id), name: ch.name.first, faction: FACTION[ch.faction_id] || "" };
      connect();
    } catch {
      setState("Census is not answering — reload to retry.", "err");
    }
  })();
}
