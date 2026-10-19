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
  async function loadRanks() {
    try {
      const j = await getJson("data/ranks.json");
      const ci = (c) => j.cols.indexOf(c);
      const iS = ci("slug"), iN = ci("name");
      const idx = LIVE_COLS.map((c) => [c.id, ci(c.id)]);
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
  function line(p, isMe) {
    const stats = isMe ? "" : p.cached
      ? `<span class="lv-cells">${LIVE_COLS.map((c) => `<span class="lv-cell" title="${esc(c.tip)}"><span class="lv-lab">${c.label}</span><span class="lv-val">${cellText(c, p.cached[c.id])}</span></span>`).join("")}</span>`
      : `<span class="lv-cells lv-uncached" title="Not in our cache: Census lifetime numbers only"><span class="lv-cell"><span class="lv-lab">K/D</span><span class="lv-val">${fmt(p.kd, 2)}</span></span><span class="lv-cell"><span class="lv-lab">KPM</span><span class="lv-val">${fmt(p.kpm, 2)}</span></span><span class="lv-cell lv-nocache"><span class="lv-lab">&nbsp;</span><span class="lv-val">not in cache</span></span></span>`;
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
