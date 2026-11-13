/**
 * 🟢 Online now — every player Honu sees online, with the server they are
 * actually playing on and the stats we collect for them.
 *
 * Sources (both fetched live from the visitor's browser):
 * - Honu `GET /api/character/online/players` — one call, CORS `*`, no Honu
 *   quota used and no snapshot to go stale. Refreshed every 60 s.
 * - `data/ranks.json` — the same file the Rankings table reads, joined by
 *   (lowercased, tag-stripped) name. Names are unique in ranks.json
 *   (17,497 rows, 0 duplicates after normalising), so the join is exact.
 *
 * Stats shown are the Rankings numbers, not recomputed lookalikes:
 * - ⚔️ iVi = ranks.json `adj` (the evened value the Rankings table shows).
 * - 🪳 Zerg = trait-scores.mjs zergScore over the ranks.json pools, same as
 *   the Rankings table (live.mjs does the same).
 * - 🧘 Pure = pureIvI(adjs, zerg) — plain ⚔️ iVi with the uncentered 🪳
 *   charge, same formula as the Rankings Pure column.
 * - K/D, KPM = lifetime Census values (`kd`, `kpm`); 🤝 Assists = `apk`;
 *   🪖 Infantry = `inf` (% of kills on foot).
 * 🌈 G is NOT shown: it needs cross-row brave ranks and lives on the
 * player sheet (open a ranked name). Unranked players — including all
 * PlayStation players, who have no PC ranks — show "—", never 0.
 *
 * Server is the LIVE world from Honu (worldID), not the home server in
 * ranks.json: Osprey 1, Wainwright 10, SolTech 40, Jaeger 19,
 * Genudine 1000, Ceres 2000 (duels.mjs WORLD_NAME).
 * Continent is the live zoneID: Indar 2, Hossin 4, Amerish 6, Esamir 8,
 * Oshur 344 (live-caps.mjs ZONE).
 */
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { pureIvI } from "./pure-ivi.mjs";

export const HONU_ONLINE_API = "https://wt.honu.pw/api/character/online/players";
export const RANKS_URL = "data/ranks.json";
export const ONLINE_REFRESH_MS = 60_000;

export const WORLD_NAME = Object.freeze({ 1: "Osprey", 10: "Wainwright", 13: "Cobalt", 17: "Emerald", 19: "Jaeger", 25: "Briggs", 40: "SolTech", 1000: "Genudine", 2000: "Ceres" });
export const ZONE_NAME = Object.freeze({ 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur" });
export const FACTION_NAME = Object.freeze({ 1: "VS", 2: "NC", 3: "TR", 4: "NS" });

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Same key as rank-row.mjs slugKey: tag stripped, lowercase a–z0–9. */
export function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

export function honuProfileUrl(cid) { return `https://wt.honu.pw/c/${encodeURIComponent(String(cid))}`; }
export function honuSessionUrl(id) { return `https://wt.honu.pw/s/${encodeURIComponent(String(id))}`; }
/** Ranked names open their sheet on the Players page (share-add.mjs ?names=). */
export function playerSheetUrl(name) { return `index.html?names=${encodeURIComponent(String(name))}`; }

/**
 * Honu /api/character/online/players → flat rows. Tolerates missing
 * character/player blocks (skips the entry) and missing session ids.
 * Exported for tests.
 */
export function parseOnlinePlayers(json) {
  const list = Array.isArray(json) ? json : [];
  const out = [];
  for (const e of list) {
    const c = (e && e.character) || {};
    const p = (e && e.player) || {};
    const cid = String(e && e.characterID ? e.characterID : c.id || "");
    const name = String(c.name || "");
    if (!cid || !name) continue;
    out.push({
      cid,
      name,
      tag: c.outfitTag || "",
      faction: fin(+c.factionID) ? +c.factionID : null,
      world: fin(+c.worldID) ? +c.worldID : (fin(+p.worldID) ? +p.worldID : null),
      zone: fin(+p.zoneID) ? +p.zoneID : null,
      br: fin(+c.battleRank) ? +c.battleRank : null,
      prestige: fin(+c.prestige) ? +c.prestige : 0,
      sessionId: p.sessionID != null ? String(p.sessionID) : "",
      lastLoginMs: c.dateLastLogin ? Date.parse(c.dateLastLogin) : NaN,
      latestEventMs: fin(+p.latestEventTimestamp) ? +p.latestEventTimestamp : NaN,
      stats: null,
    });
  }
  return out;
}

/**
 * ranks.json → Map normName → stats, with 🪳 Zerg and 🧘 Pure computed
 * exactly like the Rankings table. Exported for tests.
 */
export function buildStatsMap(ranksJson) {
  const map = new Map();
  if (!ranksJson || !Array.isArray(ranksJson.cols) || !Array.isArray(ranksJson.rows)) return map;
  const ci = (c) => ranksJson.cols.indexOf(c);
  const colOf = (id) => (ci(id) >= 0 ? ranksJson.rows.map((r) => r[ci(id)]) : []);
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
  const iN = ci("name"), iS = ci("slug");
  const iAdj = ci("adj"), iAdjs = ci("adjs"), iKd = ci("kd"), iKpm = ci("kpm");
  const iApk = ci("apk"), iInf = ci("inf"), iInfl = ci("inflation"), iRvp = ci("rvp"), iCrp = ci("crp");
  for (const r of ranksJson.rows) {
    const name = iN >= 0 ? r[iN] : "";
    const key = normName(name);
    if (!key || map.has(key)) continue;
    const adjs = iAdjs >= 0 ? r[iAdjs] : null;
    const z = zergScore(tp, iInfl >= 0 ? r[iInfl] : null, iApk >= 0 ? r[iApk] : null, iRvp >= 0 ? r[iRvp] : null, iCrp >= 0 ? r[iCrp] : null);
    const zerg = z ? z.score : null;
    map.set(key, {
      slug: iS >= 0 ? r[iS] : "",
      adj: iAdj >= 0 && fin(r[iAdj]) ? r[iAdj] : null, // ⚔️ iVi, evened (Rankings value)
      kd: iKd >= 0 && fin(r[iKd]) ? r[iKd] : null,
      kpm: iKpm >= 0 && fin(r[iKpm]) ? r[iKpm] : null,
      apk: iApk >= 0 && fin(r[iApk]) ? r[iApk] : null, // 🤝 Assists per kill
      inf: iInf >= 0 && fin(r[iInf]) ? r[iInf] : null, // 🪖 Infantry %
      zerg,
      pure: pureIvI(adjs, zerg),
    });
  }
  return map;
}

/** Attach stats (or leave null for unranked). Exported for tests. */
export function joinOnline(players, statsMap) {
  for (const p of players) p.stats = (statsMap && statsMap.get(normName(p.name))) || null;
  return players;
}

/** "1h 12m" / "4m" / "12s" since a timestamp. Exported for tests. */
export function fmtAgo(ms, nowMs = Date.now()) {
  if (!fin(ms) || !fin(nowMs)) return "";
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtInt(v) { return fin(v) ? Math.round(v).toLocaleString("en-US") : "—"; }
export function fmt2(v) { return fin(v) ? v.toFixed(2) : "—"; }

/** Sort key → value; missing stats sort last on every numeric sort. Exported for tests. */
export function sortVal(row, sort) {
  const s = row.stats;
  switch (sort) {
    case "name": return row.name.toLowerCase();
    case "faction": return row.faction ?? 99;
    case "server": return WORLD_NAME[row.world] || `~${row.world ?? ""}`;
    case "zone": return ZONE_NAME[row.zone] || "~";
    case "br": return row.br ?? -1;
    case "ivi": return s && fin(s.adj) ? s.adj : -Infinity;
    case "kd": return s && fin(s.kd) ? s.kd : -Infinity;
    case "kpm": return s && fin(s.kpm) ? s.kpm : -Infinity;
    case "assists": return s && fin(s.apk) ? s.apk : Infinity; // low assists first = most solo
    case "zerg": return s && fin(s.zerg) ? s.zerg : Infinity; // low zerg first
    case "pure": return s && fin(s.pure) ? s.pure : -Infinity;
    case "inf": return s && fin(s.inf) ? s.inf : -Infinity;
    case "session": return fin(row.lastLoginMs) ? row.lastLoginMs : Infinity; // longest online first
    default: return s && fin(s.adj) ? s.adj : -Infinity;
  }
}

/** Sort rows in place. `dir` is -1 for high-first, 1 for low-first. Exported for tests. */
export function sortRows(rows, sort) {
  const lowFirst = sort === "assists" || sort === "zerg" || sort === "session";
  const dir = sort === "name" || sort === "faction" || sort === "server" || sort === "zone" ? 1 : (lowFirst ? 1 : -1);
  rows.sort((a, b) => {
    const va = sortVal(a, sort), vb = sortVal(b, sort);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return rows;
}

/** Filter rows: { server: "all"|worldId, faction: "all"|"1".., rankedOnly, query }. Exported for tests. */
export function filterRows(rows, { server = "all", faction = "all", rankedOnly = false, query = "" } = {}) {
  const q = normName(query);
  return rows.filter((r) => {
    if (server !== "all" && String(r.world) !== String(server)) return false;
    if (faction !== "all" && String(r.faction) !== String(faction)) return false;
    if (rankedOnly && !r.stats) return false;
    if (q && !normName(r.name).includes(q)) return false;
    return true;
  });
}

export function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

// ---- browser shell ----

function rowHtml(r, nowMs) {
  const s = r.stats;
  const name = s
    ? `<a href="${esc(playerSheetUrl(r.name))}" title="Open ${esc(r.name)} on the Players page"><span class="on-name">${esc(r.name)}</span></a>`
    : `<a href="${esc(honuProfileUrl(r.cid))}" target="_blank" rel="noopener noreferrer" title="Not ranked — open ${esc(r.name)} on Honu"><span class="on-name">${esc(r.name)}</span></a>`;
  const tag = r.tag ? `<span class="on-tag">[${esc(r.tag)}] </span>` : "";
  const dash = `<span class="on-dash">—</span>`;
  const session = r.sessionId
    ? `<a href="${esc(honuSessionUrl(r.sessionId))}" target="_blank" rel="noopener noreferrer">view ↗</a>` +
      (fin(r.lastLoginMs) ? `<br /><span class="on-since" title="Logged in ${esc(new Date(r.lastLoginMs).toLocaleString())}">${esc(fmtAgo(r.lastLoginMs, nowMs))} ago</span>` : "")
    : dash;
  return `<tr><td>${tag}${name}</td>` +
    `<td>${r.faction ? esc(FACTION_NAME[r.faction] || "?") : dash}</td>` +
    `<td>${r.world ? esc(WORLD_NAME[r.world] || `World ${r.world}`) : dash}</td>` +
    `<td>${r.zone ? esc(ZONE_NAME[r.zone] || "unknown") : "unknown"}</td>` +
    `<td>${r.br != null ? `${r.br}~${r.prestige}` : dash}</td>` +
    `<td>${s ? fmtInt(s.adj) : dash}</td>` +
    `<td>${s ? fmt2(s.kd) : dash}</td>` +
    `<td>${s ? fmt2(s.kpm) : dash}</td>` +
    `<td>${s ? fmt2(s.apk) : dash}</td>` +
    `<td>${s && fin(s.inf) ? `${Math.round(s.inf)}%` : dash}</td>` +
    `<td>${s ? fmtInt(s.zerg) : dash}</td>` +
    `<td>${s ? fmtInt(s.pure) : dash}</td>` +
    `<td>${session}</td></tr>`;
}

export function startOnline() {
  const $ = (id) => document.getElementById(id);
  const body = $("onlineBody"), statusEl = $("onlineStatus");
  const serverSel = $("onlineServer"), factionSel = $("onlineFaction"), sortSel = $("onlineSort");
  const searchEl = $("onlineSearch"), rankedOnlyEl = $("onlineRankedOnly"), refreshBtn = $("onlineRefresh");
  if (!body || !statusEl) return;

  let players = [];
  let statsMap = null;
  let ranksFailed = false;
  let lastOkAt = null;
  let honuError = "";
  let timer = null;

  const state = () => ({
    server: serverSel ? serverSel.value : "all",
    faction: factionSel ? factionSel.value : "all",
    rankedOnly: !!(rankedOnlyEl && rankedOnlyEl.checked),
    query: searchEl ? searchEl.value : "",
    sort: sortSel ? sortSel.value : "ivi",
  });

  function render() {
    const st = state();
    const shown = sortRows(filterRows(players, st), st.sort);
    const nowMs = Date.now();
    body.innerHTML = shown.length
      ? shown.map((r) => rowHtml(r, nowMs)).join("")
      : `<tr><td colspan="13">No players match these filters.</td></tr>`;
    const ranked = players.filter((p) => p.stats).length;
    const byServer = countBy(players, (r) => WORLD_NAME[r.world] || `World ${r.world ?? "?"}`);
    const serverBits = [...byServer.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(" · ");
    const updated = lastOkAt ? `Updated ${new Date(lastOkAt).toLocaleTimeString()}` : "Not updated yet";
    statusEl.innerHTML =
      `${players.length.toLocaleString("en-US")} online · ${ranked} ranked · ${players.length - ranked} unranked` +
      (serverBits ? ` — ${serverBits}` : "") +
      ` · ${esc(updated)} · refreshes every 60 s` +
      (ranksFailed ? ` · <span class="err">ranks.json failed to load — stats unavailable</span>` : "") +
      (honuError ? ` · <span class="err">${esc(honuError)} — showing the last list</span>` : "");
  }

  function fillServerOptions() {
    if (!serverSel) return;
    const worlds = [...new Set(players.map((p) => p.world).filter((w) => w != null))].sort((a, b) => a - b);
    const cur = serverSel.value;
    serverSel.innerHTML = `<option value="all">All servers</option>` +
      worlds.map((w) => `<option value="${w}">${esc(WORLD_NAME[w] || `World ${w}`)} (${players.filter((p) => p.world === w).length})</option>`).join("");
    if ([...serverSel.options].some((o) => o.value === cur)) serverSel.value = cur;
  }

  async function loadRanksOnce() {
    try {
      const res = await fetch(RANKS_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      statsMap = buildStatsMap(await res.json());
      joinOnline(players, statsMap);
      ranksFailed = false;
    } catch {
      ranksFailed = true;
      statsMap = null;
    }
  }

  async function loadOnline() {
    try {
      const res = await fetch(HONU_ONLINE_API, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      players = joinOnline(parseOnlinePlayers(await res.json()), statsMap);
      lastOkAt = Date.now();
      honuError = "";
      fillServerOptions();
    } catch (e) {
      honuError = `Honu online list unreachable (${(e && e.message) || "network error"})`;
    }
    render();
  }

  async function refresh() {
    if (document.visibilityState === "hidden") return; // tab in background: skip, next tick
    await loadOnline();
  }

  for (const el of [serverSel, factionSel, sortSel, rankedOnlyEl]) if (el) el.addEventListener("change", render);
  if (searchEl) searchEl.addEventListener("input", render);
  if (refreshBtn) refreshBtn.addEventListener("click", () => { loadOnline(); });
  for (const th of document.querySelectorAll("#onlineTable th[data-sort]")) {
    th.addEventListener("click", () => {
      if (sortSel) { sortSel.value = th.dataset.sort; }
      render();
    });
  }

  (async () => {
    await loadRanksOnce();
    await loadOnline();
    timer = setInterval(refresh, ONLINE_REFRESH_MS);
  })();
  return { stop: () => { if (timer) clearInterval(timer); } };
}

// Self-start on the Online page only (node test imports stay side-effect free).
if (typeof document !== "undefined" && document.getElementById("onlineBody")) startOnline();
