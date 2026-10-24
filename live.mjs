import { ready as i18nReady } from "./i18n.mjs";
await i18nReady;
/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - owner t575u layout (replaces the t557u–t572u two-player rows that flipped A/B): a narrow, fixed overlay
 *     centred on the tracked player — ONE line above for the latest player who killed them (each new killer
 *     replaces it), the tracked player on the centre line, and the last 6 players they killed below
 *     (newest on top; t587u: every kill is its own line, the same victim twice = two lines);
 *   - every line shows everything at once, in one shared column order: [⏱️][name][iVi][🏃][🦁][🛡️][🪖][☠️][🤝][🔀][⚡][🪳] (t580u: 🪳 last; t588u order),
 *     the emojis as fill meters (t564u, t573u) with glow tiers (t568u) — no flip, no skill graph;
 *   - a missing stat is an empty (hollow, t589u) emoji, never "—" (t567u); uncached opponents show all-empty emojis
 *     (Census K/D · KPM only in the name's hover title), then get a full 200-opponent Census
 *     fetch in the background (one at a time, newest first, #32) and upgrade in place.
 * Pure helpers are exported for tests; the DOM part runs only in a browser.
 */
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261022-wpc1";
import { isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { traitPools, zergScore, aimGap } from "./trait-scores.mjs?v=20261022-nbd1";
import { infantryShares } from "./infantry.mjs?v=20261023-short1";

export const FEED_MAX = 6; // victim lines below the centre (owner t575u: "back to 6 lines"; t563u had 3)
export const VICTIM_LINES = FEED_MAX;
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
 * Feed state step: newest event on top, every event its own row (owner t587u: no dedupe — a repeat
 * opponent gets a new row too); the oldest row drops out past FEED_MAX.
 * ⏱️ stopwatch: the top row runs (gap null); when a new event lands, the old
 * top row freezes at the time between the two events.
 * Returns { rows, dropped } (dropped = the row pushed out, or null).
 */
export function feedPush(rows, ev, now = Date.now()) {
  const prev = rows.map((r, i) => (i === 0 && r.gap == null ? { ...r, gap: Math.max(0, now - r.at) } : r));
  const row = { opp: ev.opp, last: ev.kind, headshot: !!ev.headshot, at: now, gap: null };
  // Owner t587u: no dedupe — every kill is its own new line on top (the same victim twice = two lines, two times).
  const next = [row, ...prev];
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
 *   "ivi"   = the plain number right after the name ("CloneKanoVS 1883", owner t560u: no ⚔️; t564u: no comma);
 *   "stack" / "emoji" = a fill-meter emoji column (owner t564u: one size for all, no number under it).
 * lowerBetter = smaller value is better (reversed percentile → more fill for a low value); no LIVE
 * column uses it now (owner t555u: 🪳 Zerg follows the raw number).
 * 🪳 Zerg is computed like the Rankings table (trait-scores.mjs zergScore from the ranks.json pools).
 * 🪖 Infantry is the ranks.json "inf" value; players without it get an empty (0%) 🪖 (owner t567u).
 */
export const LIVE_COLS = Object.freeze([
  { id: "adjs", label: "⚔️ iVi", tip: "iVi", digits: 0, floorZero: true, mode: "ivi" },
  { id: "act", label: "🏃 Activity", tip: "Activity", digits: 2, mode: "stack" },
  { id: "pvs", label: "🦁 Brave", tip: "Brave", digits: 2, mode: "stack" },
  { id: "rf", label: "🛡️ Resist", tip: "Resist", digits: 2, mode: "stack" },
  { id: "inf", label: "🪖 Infantry", tip: "Infantry", digits: 1, unit: "%", mode: "stack", fill: "value" }, // t564u: fill = infantry % itself
  // Owner t581u: after 🪖 — t588u order ☠️ K/D · 🤝 Assists · 🔀 Diff · ⚡ Const, the main table's emojis; fill = their percentile
  // (same p50 → p91 mapping and glow tiers). 🔀 Diff (−99…+99, computed like the Rankings: trait-scores.mjs aimGap)
  // is filled by its percentile among players and never shown as a number on the overlay (hover only, t584u).
  // 🤝 Assists: ranks.json already has no value for the assist-bug cases (session-stats.mjs ASSIST_GAP) → empty emoji.
  { id: "rkd", label: "☠️ K/D", tip: "K/D", digits: 2, mode: "stack" }, // owner t581u: K/D back on purpose (the main table's ☠️ K/D vs usual foes)
  { id: "apk", label: "🤝 Assists", tip: "Assists", digits: 2, mode: "stack" },
  { id: "diff", label: "🔀 Diff", tip: "Diff", digits: 0, mode: "stack" },
  { id: "cons", label: "⚡ Const", tip: "Consistency", digits: 2, mode: "stack" },
  { id: "zerg", label: "🪳 Zerg", tip: "Zerg", digits: 0, mode: "stack", unknown: "full" }, // t555u: bigger Zerg = bigger 🪳 (not reversed); t569u: unknown = full roach — t580u/t581u: last column
]);
/** Owner t584u hover text for one emoji / the iVi number: short label + the real value ("K/D 2.40", "Zerg 41", "Infantry 95.4%"), or "unknown". */
export function tipText(col, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${col.tip} unknown`;
  if (col.floorZero && v < 0) v = 0;
  const d = col.digits || 0;
  return `${col.tip} ${(Math.round(v * 10 ** d) / 10 ** d + 0).toFixed(d)}${col.unit || ""}`;
}

/**
 * Emoji fill meter (owner t564u, replaces the t546u/t558u rank-based sizes): every emoji has one size;
 * a hollow copy (t589u: light inner ring, dark 18% greyscale inside; was 25%-visible) shows the whole emoji and a solid copy on top fills it from the bottom up to:
 *   🪖 Infantry → the player's infantry % itself (50% infantry = half filled);
 *   🏃 🦁 🛡️ 🪳 → the player's percentile in that column (pXX = higher than XX% of ranks.json, the
 *   Rankings pools; 🪳 Zerg = percentile of the raw Zerg score, so a higher Zerg number fills more).
 * Lower-is-better columns are flipped first (none in LIVE now).
 * Owner t568u: the solid part was min(1, value / 91); t573u: clamp((value - 50) / 41, 0, 1), so p50 and below (50%- infantry) is empty and p91+ (91%+ infantry) completely full.
 */
export const FILL_DIM = 0.18; // owner t589u: the empty part = a dark greyscale interior at 18% (was a 25% colour copy) …
export const HOLLOW_PX = 1.75; // … inside a light-grey inner ring this wide, just inside the black outline: a hollow, readable shape at 0%
export const HOLLOW_INK = "#e6e6e6"; // the inner ring colour (light grey, stands out on any stream background)
/** "How good" percentile 0..99 (99 = best) from the plain pXX. */
export function goodPct(col, p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const q = Math.min(99, Math.max(0, p));
  return col && col.lowerBetter ? 99 - q : q;
}
/** The value that drives a cell's fill and glow: the "good" percentile 0..99, or 🪖's infantry % 0..100; null = no value. */
export function fillDriver(col, v, p) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (col && col.fill === "value") return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return goodPct(col, p);
}
/** Owner t568u: p91 (or 91% infantry) and up = completely solid. Owner t573u: p50 (or 50% infantry) and below — the
 *  no-glow tier — is empty (faint 25%), linear in between: fill = clamp((driver - 50) / (91 - 50), 0, 1). */
export const FULL_AT = 91;
export const EMPTY_AT = 50;
/** Fill 0..100 (% of the emoji drawn solid, from the bottom) for one cell; null = no value → an empty 0% emoji (t567u). */
export function emojiFill(col, v, p) {
  const d = fillDriver(col, v, p);
  return d == null ? null : Math.round(Math.min(100, Math.max(0, ((d - EMPTY_AT) / (FULL_AT - EMPTY_AT)) * 100)) * 10) / 10;
}
/** Fill shown when a cell has no value: 0 (empty 25% emoji, t567u), or 100 for a column marked unknown: "full" —
 *  owner t569u: an unknown 🪳 Zerg (most often unknown) is drawn as a full roach. Display only, nothing is stored. */
export function unknownFill(col) { return col && col.unknown === "full" ? 100 : 0; }
/** Owner t577u: a raw 🪳 Zerg score above ZERG_GOLD_OVER always gets the top (gold ✦) glow, whatever its percentile tier;
 *  an unknown 🪳 (drawn full, t569u) gets that full top glow too. Every other column keeps its percentile tier. */
export const ZERG_GOLD_OVER = 35;
/** Owner t579u: emoji outline thickness in CSS px (all sides). */
export const OUTLINE_PX = 2.25; // t581u: bolder (was 1.75)
export function unitGlow(col, v, driver) {
  if (col && col.id === "zerg" && (v == null || !Number.isFinite(v) || v > ZERG_GOLD_OVER)) return 3;
  return v == null ? 0 : glowTier(driver);
}
/** Owner t568u glow tiers from the same driver: 3 = TOP (91+), 2 = HIGH (71–90), 1 = AVERAGE (51–70), 0 = none (50 and below or no value). */
export function glowTier(d) {
  if (typeof d !== "number" || !Number.isFinite(d)) return 0;
  return d >= 91 ? 3 : d >= 71 ? 2 : d >= 51 ? 1 : 0;
}

/**
 * Owner t576u: when the event really happened (ms). Census sends whole seconds; real events arrive 0.1–1.1 s
 * after that stamp. A stamp that is missing or more than EVENT_SKEW_MS off this PC's clock (wrong system time)
 * falls back to the moment the message arrived, so a bad clock never shows negative or huge times.
 */
export const EVENT_SKEW_MS = 15000;
export function eventAt(payload, received = Date.now()) {
  const ts = Number(payload && payload.timestamp) * 1000;
  return Number.isFinite(ts) && ts > 0 && received - ts >= -1000 && received - ts <= EVENT_SKEW_MS ? Math.min(ts, received) : received;
}

/**
 * Overlay state step (owner t575u): a kill puts the victim on top of the lines below the centre (feedPush:
 * every kill its own line — t587u, at most VICTIM_LINES); a death makes that attacker THE killer line above (replacing the last one).
 * Owner t576u: a kill also clears the killer line ("once we start to kill, clear the top"); it fills again on
 * the next death. ⏱️ one stopwatch, as before t575u: only the newest event runs; every other line is frozen at
 * the time until the next event. ev.at = the event's own time (eventAt), else `now`.
 * State = { killer: row | null, victims: rows, lastEv: the row that just arrived, gone: the killer just cleared | null }.
 */
export function overlayPush(state, ev, now = Date.now()) {
  const s = state || { killer: null, victims: [], lastEv: null, gone: null };
  const at = Number.isFinite(ev.at) ? ev.at : now;
  const stop = (r) => (r && r.gap == null ? { ...r, gap: Math.max(0, at - r.at) } : r);
  const killer = stop(s.killer);
  const victims = s.victims.map((r, i) => (i === 0 ? stop(r) : r));
  if (ev.kind === "death") {
    const k = { opp: ev.opp, last: "death", headshot: !!ev.headshot, at, gap: null };
    return { killer: k, victims, lastEv: k, gone: null };
  }
  const { rows } = feedPush(victims, ev, at);
  return { killer: null, victims: rows, lastEv: rows[0], gone: killer };
}
/** Every opponent on screen (killer first), for the background-fetch queue. */
export function overlayRows(state) { return state ? [state.killer, ...state.victims].filter(Boolean) : []; }
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
    // 🪳 Zerg and 🤝 Assists need Honu (not in a Census fetch); 🔀 Diff needs the build's 🛖/🚜/🐣 factors → unknown
    // (empty emoji) until the player is in the cache. 🪖 Infantry = the same share build-ranks.mjs stores.
    const sh = c.id === "inf" ? infantryShares(player && player.infantry) : null;
    const v = c.id === "zerg" || c.id === "apk" || c.id === "diff" ? null : c.id === "inf" ? (sh ? sh.inf : null) : shownValue(m, c.id);
    o[c.id] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  // 🚜 cut on ⚔️ iVi (same fields as ranks.json vcut / infVeh / infMax).
  o.vcut = m.vehCut > 0 ? Math.round(m.vehCut * 1000) / 10 : null;
  o.infVeh = Number.isFinite(m.vehOnly) ? m.vehOnly * 100 : null;
  o.infMax = Number.isFinite(m.maxShare) ? m.maxShare * 100 : null;
  return o;
}

/** Owner t586u: the tracked (centre) player's numbers are re-fetched from Census every ME_REFRESH_MS while the tab
 *  is visible. Measured cost of one refresh: 9 Census calls (name, killboard, 2 × 3 opponent batches, infantry
 *  split), 0 Honu calls, ~9–20 s — too heavy for every viewer once a minute, so every 5 minutes. */
export const ME_REFRESH_MS = 5 * 60000;
/** Fresh row over the cached one: a fresh number wins; what a Census fetch can't give (🪳 Zerg, 🤝 Assists, 🔀 Diff) stays cached. */
export function mergeFresh(cached, fresh) {
  const o = { ...(cached || {}) };
  for (const [k, v] of Object.entries(fresh || {})) if (v != null && (typeof v !== "number" || Number.isFinite(v))) o[k] = v;
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
  // Owner t564u: the iVi number has no thousands separator ("1600", not "1,600").
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: col.mode !== "ivi" });
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
  // Owner t579u: the emoji outline filter (styles.css .lv-eo): grow the glyph's shape by OUTLINE_PX (2.25 px), paint it black,
  // cut the glyph itself out → a ring that hugs the whole silhouette. Hidden, zero-size, added once.
  // Owner t589u "hollow but standing-out shape": the unfilled copy (.lv-e0) runs through #lvHollow — its interior turns
  // greyscale, darkened and FILL_DIM (18%) visible, and a HOLLOW_PX light-grey ring is drawn just inside the silhouette
  // (the glyph's shape minus itself shrunk by HOLLOW_PX). The black outer outline (#lvOutline) and the solid filled copy are unchanged.
  const HOLLOW_FILTER = `<filter id="lvHollow" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0.13 0.43 0.04 0 0 0.13 0.43 0.04 0 0 0.13 0.43 0.04 0 0 0 0 0 ${FILL_DIM} 0" result="dim"/><feMorphology in="SourceAlpha" operator="erode" radius="${HOLLOW_PX}" result="inner"/><feComposite in="SourceAlpha" in2="inner" operator="out" result="edge"/><feFlood flood-color="${HOLLOW_INK}" flood-opacity="1"/><feComposite in2="edge" operator="in" result="rim"/><feMerge><feMergeNode in="dim"/><feMergeNode in="rim"/></feMerge></filter>`;
  if (listEl && !document.getElementById("lvOutline")) {
    // t581u "more work on outlines": thicker, and smoothed — the dilated shape is softened a little and then cut
    // back to a hard edge (blur + a steep alpha ramp), so the ring is even and round instead of blocky.
    listEl.insertAdjacentHTML("beforebegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><filter id="lvOutline" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${OUTLINE_PX}" result="grown"/><feGaussianBlur in="grown" stdDeviation="0.7" result="soft"/><feComponentTransfer in="soft" result="even"><feFuncA type="linear" slope="4" intercept="-1"/></feComponentTransfer><feFlood flood-color="#000" flood-opacity="1"/><feComposite in2="even" operator="in" result="ring"/><feComposite in="ring" in2="SourceAlpha" operator="out"/></filter>${HOLLOW_FILTER}</svg>`);
  }
  if (listEl) {
    listEl.style.setProperty("--lv-n", String(LIVE_COLS.length - 1)); // emoji units per line (owner t581u: 9)
    // Owner t584u: hover any emoji (or the iVi number) → its real value ("K/D 2.40", "Zerg 41", "Diff unknown").
    // One floating box, fixed position, no pointer events — the overlay layout never changes.
    const tipEl = document.createElement("div");
    tipEl.className = "lv-tip";
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    const place = (e) => { tipEl.style.left = `${e.clientX + 12}px`; tipEl.style.top = `${e.clientY + 14}px`; };
    listEl.addEventListener("mouseover", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t || !listEl.contains(t)) { tipEl.hidden = true; return; }
      tipEl.textContent = t.dataset.tip;
      tipEl.hidden = false;
      place(e);
    });
    listEl.addEventListener("mousemove", (e) => { if (!tipEl.hidden) place(e); });
    listEl.addEventListener("mouseleave", () => { tipEl.hidden = true; });
  }
  const setState = (html, cls = "") => { if (stateEl) { stateEl.innerHTML = html; stateEl.className = "live-state " + cls; } };
  if (!target) { setState("Add a name on the main page, then press 🎥.", "err"); return; }

  const people = new Map(); // cid -> { name, faction, kd, cached: {adjs, kd} | null }
  let st = { killer: null, victims: [], lastEv: null, gone: null }; // owner t575u overlay state (overlayPush)
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
      // 🔀 Diff (owner t581u): same score as the Rankings table (rankings.mjs: aimGap with the ranks.json 🛖 hut / 🚜 vdf / 🐣 nbd factors,
      // reviewed.json clearances already applied at build time).
      const iAd = ci("adjs"), iIv = ci("ivi"), iH = ci("hut"), iV = ci("vdf"), iNb = ci("nbd");
      const at = (r, i) => (i >= 0 ? r[i] : null);
      const diffCol = j.rows.map((r) => { const g = aimGap(tp, at(r, iAd), at(r, iIv), at(r, iH), at(r, iV), at(r, iNb)); return g ? g.score : null; });
      j.rows.forEach((r, k) => { const o = ranks.get(r[iS]); if (o) { o.zerg = zergCol[k]; o.diff = diffCol[k]; } });
      for (const c of LIVE_COLS) {
        const vals = c.id === "zerg" ? zergCol : c.id === "diff" ? diffCol : colOf(c.id);
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
  const IVI = LIVE_COLS.filter((c) => c.mode === "ivi"); // the iVi number column
  const REST = LIVE_COLS.filter((c) => c.mode !== "ivi"); // the emoji columns, same order on every line (owner t575u)
  const shortLab = (c) => c.label.split(" ")[0];
  /** 💩 after a confirmed padder's name (padding.mjs): hover explains the −10% iVi penalty. */
  const poopFor = (name) => (isPenalizedPadder(name) ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "");
  const fillOf = (c, v) => emojiFill(c, v, percentileOf(pools[c.id] || [], v));
  /** Emoji unit (owner t564u): one-size emoji as a fill meter — a 25% copy under a solid copy clipped
   *  from the bottom up to the fill. The number is in the hover title only.
   *  Owner t567u: no value (not cached, assist bug, no 🪖 data) = the same emoji at 0% (only the faint copy), never "—". */
  /** Owner t568u (replaces the t562u single p95 glow): three glow tiers by the fill driver (glowTier) — lv-g3 gold, lv-g2 blue, lv-g1 green. */
  const driverOf = (c, v) => fillDriver(c, v, percentileOf(pools[c.id] || [], v));
  const goodOf = (c, v) => { const pc = percentileOf(pools[c.id] || [], v); return pc == null ? null : goodPct(c, pc); };
  /** Owner t564u fill: where the emoji's ink sits inside its 1em box (line-height 1), measured once per emoji
   *  in the viewer's own emoji font, so "p90" = the bottom 90% of the visible glyph, not of the box. */
  const inkCache = new Map();
  function inkOf(e) {
    if (inkCache.has(e)) return inkCache.get(e);
    let r = "";
    try {
      const fam = (listEl && getComputedStyle(listEl).fontFamily) || "sans-serif";
      // 1) where the baseline sits in a 100px, line-height 1 box (same CSS as .lv-e)
      const box = document.createElement("b");
      box.style.cssText = `position:absolute;left:-999px;top:0;visibility:hidden;display:block;font:400 100px/1 ${fam};white-space:nowrap`;
      box.innerHTML = `${esc(e)}<i style="display:inline-block;width:0;height:0;vertical-align:baseline"></i>`;
      document.body.appendChild(box);
      const base = box.lastChild.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.remove();
      // 2) the glyph's real ink rows, drawn on a canvas on that baseline
      const cv = document.createElement("canvas"); cv.width = 240; cv.height = 300;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.font = `400 100px ${fam}`; cx.textBaseline = "alphabetic"; cx.fillStyle = "#000"; cx.fillText(e, 40, 200);
      const px = cx.getImageData(0, 0, 240, 300).data;
      let top = -1, bot = -1;
      for (let y = 0; y < 300; y++) { for (let x = 0; x < 240; x++) if (px[(y * 240 + x) * 4 + 3] > 24) { if (top < 0) top = y; bot = y; break; } }
      if (top >= 0 && base > 0) r = ` style="--it:${(base - (200 - top)).toFixed(1)}%;--ih:${(bot + 1 - top).toFixed(1)}%"`;
    } catch { /* default: the whole box */ }
    inkCache.set(e, r);
    return r;
  }
  const meter = (e, f) => `<span class="lv-em" aria-hidden="true"${inkOf(e)}><b class="lv-e lv-eo">${e}</b><b class="lv-e lv-e0">${e}</b>${f > 0 ? `<b class="lv-e lv-e1">${e}</b>` : ""}</span>`;
  function unit(c, v) {
    const f = fillOf(c, v);
    if (f == null) { // no value: empty emoji, or (t569u) a full 🪳 — owner t577u: that full 🪳 gets the full top glow
      const u = unknownFill(c);
      const ug = unitGlow(c, null);
      return `<span class="lv-u lv-fl lv-nil${ug ? ` lv-g${ug}` : ""}" style="--f:${u}" data-tip="${esc(tipText(c, null))}">${meter(shortLab(c), u)}</span>`;
    }
    const g = unitGlow(c, v, driverOf(c, v)); // t568u tiers from the fill's own driver; t577u: 🪳 > 35 = gold
    const top = g ? ` lv-g${g}` : "";
    return `<span class="lv-u lv-fl${top}" style="--f:${f}" data-tip="${esc(tipText(c, v))}">${meter(shortLab(c), f)}</span>`;
  }
  /** iVi number, no ⚔️ (owner t560u), no comma, 4 digits of room (t564u); no iVi (t567u) = an empty 25% ⚔️ in the same box. */
  function iviText(c, v) {
    if (fillOf(c, v) == null) return `<span class="lv-iv lv-nil" style="--f:0" data-tip="${esc(tipText(c, null))}">${meter(shortLab(c), 0)}</span>`;
    return `<span class="lv-iv" data-tip="${esc(tipText(c, v))}">${cellText(c, v)}</span>`;
  }
  /** Name (faction colour) + 💩; a long name is cut with … at the end. Uncached: Census K/D · KPM in the hover. */
  function nameHtml(p, tip) {
    return `<span class="lv-pn"><span class="lv-name fac-${p.faction || ""}" title="${esc(p.name + (tip || ""))}"><bdi>${esc(p.name)}</bdi></span>${poopFor(p.name)}</span>`;
  }
  /**
   * Owner t575u: one line = one player, everything at once (no flip), ONE shared column order for every line:
   *   [⏱️ time][name][iVi][🏃][🦁][🛡️][🪖][☠️][🤝][🔀][⚡][🪳] (t580u: 🪳 last; t588u order) — so the emojis line up down the whole overlay.
   * Owner t567u: not cached = all-empty emojis; the Census numbers stay in the name's hover.
   */
  function cells(p, isMe) {
    const vals = p.cached || {};
    const tip = p.cached || isMe ? "" : ` · not in cache · K/D ${fmt(p.kd, 2)} · KPM ${fmt(p.kpm, 2)}`;
    return `<td class="lv-nm">${nameHtml(p, tip)}</td>${IVI.map((c) => `<td class="lv-ivc">${iviText(c, vals[c.id])}</td>`).join("")}<td class="lv-ems"><span class="lv-row">${REST.map((c) => unit(c, vals[c.id])).join("")}</span></td>`;
  }
  const blank = `<td class="lv-nm"></td><td class="lv-ivc"></td><td class="lv-ems"><span class="lv-row"></span></td>`; // same box as a filled line, so the overlay never grows
  /** Owner t562u juice: an upset = the winner's iVi percentile is ≥ UPSET_GAP points below the loser's → a short shake. */
  const UPSET_GAP = 50;
  const iviPct = (p) => { const c = IVI[0]; return p && p.cached ? goodOf(c, p.cached[c.id]) : null; };
  let shown = null; // the newest event that already played its entrance (a re-render must not replay it)
  let fresh = null;
  let goneShown = null; // the cleared killer whose fade-out already played
  /** Owner t578u: emoji fill grows 0 → level over FILL_MS when a line first shows (or its stats arrive later: the key
   *  changes from "u" to "c"). Re-renders pass the time already played as a negative delay, so nothing restarts. */
  const FILL_MS = 10000; // owner t588u: 10 s (was 5 s)
  const fillStart = new Map(); // line key → when its fill started
  const NO_FILL = { cls: "", sty: "" };
  function fillIn(key) {
    const now = Date.now();
    if (!fillStart.has(key)) {
      fillStart.set(key, now);
      if (fillStart.size > 300) fillStart.delete(fillStart.keys().next().value); // oldest first
    }
    const played = now - fillStart.get(key);
    return played >= FILL_MS ? NO_FILL : { cls: " lv-fillin", sty: ` style="--fd:-${played}ms"` };
  }
  /** ⏱️ the newest event runs (ticks every second), every older line shows its frozen gap (owner t576u). */
  const ageHtml = (r) => (r.gap == null ? `<span class="lv-timer" data-at="${r.at}">${fmtGap(Date.now() - r.at)}</span>` : fmtGap(r.gap));
  /** One opponent line: the killer above (lv-death) or a victim below (lv-kill). */
  function oppLine(r, where, extra = "") {
    const fi = extra ? NO_FILL : fillIn(`${r.opp}@${r.at}:${(people.get(r.opp) || {}).cached ? "c" : "u"}`);
    const p = people.get(r.opp) || { name: r.opp };
    const kill = r.last === "kill";
    const isNew = r === fresh;
    const wP = iviPct(kill ? me : p), lP = iviPct(kill ? p : me);
    const upset = isNew && wP != null && lP != null && lP - wP >= UPSET_GAP ? " lv-upset" : "";
    return `<tbody class="lv-ev lv-${where} lv-${r.last}${isNew ? " lv-new" : ""}${upset}${extra}${fi.cls}"${fi.sty}><tr><td class="lv-time">${ageHtml(r)}</td>${cells(p, false)}</tr></tbody>`;
  }
  const emptyLine = (where) => `<tbody class="lv-ev lv-${where} lv-empty"><tr><td class="lv-time"></td>${blank}</tr></tbody>`;
  function render() {
    if (!listEl) return;
    // Owner t575u: a fixed grid of 1 + 1 + VICTIM_LINES lines — killer above, the tracked player in the centre,
    // the players they killed below (newest on top). Empty slots keep their height, so the overlay never changes size.
    const cols = `<colgroup><col class="lv-c-time"><col class="lv-c-nm"><col class="lv-c-iv"><col class="lv-c-em"></colgroup>`;
    const newest = st.lastEv || null;
    fresh = newest && newest !== shown ? newest : null;
    shown = newest;
    // owner t576u: a kill clears the killer line — the cleared killer fades out once, then the slot stays empty
    const fade = !st.killer && st.gone && st.gone !== goneShown;
    goneShown = st.gone;
    const atk = st.killer ? oppLine(st.killer, "atk") : fade ? oppLine(st.gone, "atk", " lv-out") : emptyLine("atk");
    const fm = fillIn(`me:${me.cached ? "c" : "u"}`);
    const mid = `<tbody class="lv-ev lv-me${fm.cls}"${fm.sty}><tr><td class="lv-time"></td>${cells(me, true)}</tr></tbody>`;
    const low = Array.from({ length: VICTIM_LINES }, (_, i) => (st.victims[i] ? oppLine(st.victims[i], "vic") : emptyLine("vic"))).join("");
    listEl.innerHTML = cols + atk + mid + low;
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
    const shownRows = overlayRows(st);
    const cid = nextBgFetch(bgQueue, shownRows, bgTried);
    bgQueue = bgQueue.filter((c) => shownRows.some((r) => r.opp === c) && !bgTried.has(c));
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
  // Owner t586u: refresh the centre player every ME_REFRESH_MS (paused while the tab is hidden). Only this browser:
  // no browser copy, nothing sent to the shared cache, nothing committed. The new iVi / fills ease in (no jump).
  let meNext = 0, meBusy = false;
  async function refreshMe() {
    const a = app();
    if (meBusy || !me || !a || !a.fetchPlayerFresh || document.hidden) return;
    meBusy = true;
    meNext = Date.now() + ME_REFRESH_MS;
    try {
      const player = await a.fetchPlayerFresh(me.name);
      if (player && me) {
        me.fresh = liveRowFromPlayer(player, me.name);
        const before = meSnapshot();
        me.cached = mergeFresh(me.cached, me.fresh);
        render();
        easeMe(before);
      }
    } catch { /* keep the shown numbers; try again next round */ }
    meBusy = false;
  }
  function meRefreshLoop() {
    meNext = Date.now() + ME_REFRESH_MS;
    setInterval(() => { if (!document.hidden && Date.now() >= meNext) refreshMe(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() >= meNext) refreshMe(); });
  }
  const meSnapshot = () => {
    const t = listEl && listEl.querySelector("tbody.lv-me");
    if (!t) return null;
    const iv = t.querySelector(".lv-iv:not(.lv-nil)");
    return { f: [...t.querySelectorAll(".lv-u")].map((u) => u.style.getPropertyValue("--f")), ivi: iv ? +iv.textContent : null };
  };
  function easeMe(before) {
    const t = listEl && listEl.querySelector("tbody.lv-me");
    if (!before || !t || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const us = [...t.querySelectorAll(".lv-u")];
    const to = us.map((u) => u.style.getPropertyValue("--f"));
    us.forEach((u, i) => { if (before.f[i] !== "" && before.f[i] != null) u.style.setProperty("--f", before.f[i]); });
    void t.offsetWidth; // start from the old fill
    us.forEach((u, i) => { u.classList.add("lv-ease"); u.style.setProperty("--f", to[i]); });
    const iv = t.querySelector(".lv-iv:not(.lv-nil)");
    const end = iv ? +iv.textContent : NaN;
    if (!iv || !Number.isFinite(end) || !Number.isFinite(before.ivi) || before.ivi === end) return;
    const t0 = performance.now(), from = before.ivi;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1200), e = 1 - (1 - k) ** 3;
      if (!iv.isConnected) return;
      iv.textContent = String(Math.round(from + (end - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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

  // owner t576u: events go through one queue (a slow name lookup can't reorder them) and keep their own time.
  let evChain = Promise.resolve();
  const onEvent = (ev) => { evChain = evChain.then(() => onEventNow(ev), () => onEventNow(ev)); };
  async function onEventNow(ev) {
    const p = await person(ev.opp);
    st = overlayPush(st, ev);
    render();
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
      if (ev) ev.at = eventAt(j.payload); // owner t576u: the time of the kill/death, not of the (later) name lookup
      if (ev) {
        if (!st.lastEv) setState("", "on"); // owner t550u: no title above the table
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
      loadRanks().then(() => {
        me.cached = me.fresh ? mergeFresh(ranks.get(slugKey(me.name)), me.fresh) : ranks.get(slugKey(me.name)) || null;
        if (!me.cached) refreshMe(); // not in the cache: fetch the centre player once right away (t586u)
      });
      connect();
      meRefreshLoop();
    } catch {
      setState("Census is not answering — reload to retry.", "err");
    }
  })();
}
