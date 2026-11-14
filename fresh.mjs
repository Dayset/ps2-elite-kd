/**
 * 🌱 Fresh accounts — 1-month-old accounts and the top 1% 🧘 Pure.
 *
 * Two lists from the same snapshot, both computed live from ranks.json:
 *  1. fresh accounts in the top 1% Pure — the intersection (the headline);
 *  2. every fresh account with a Pure value, best Pure first.
 *  3. fresh accounts in the bottom 1% Pure — the other end of the same
 *     list, worst first (same cut, mirrored).
 *
 * Definitions (same numbers as the Rankings table, no lookalikes):
 * - Fresh = Census character age at the snapshot ≤ 30 days:
 *   age = (ranks.json `updatedAt` − `created`) / 86400. Snapshot-anchored,
 *   not wall-clock, so the page is reproducible per snapshot. The site's
 *   other "new" windows are wider (discovery queue 91 days, forensics
 *   90 days) — this page uses the 30 days the owner asked for.
 * - 🧘 Pure = pureIvI(adjs, zerg) — plain ⚔️ iVi with the uncentered
 *   🪳 charge, same formula as the Rankings Pure column; 🪳 Zerg =
 *   trait-scores.mjs zergScore over the ranks.json pools (revive/crowd
 *   softening included).
 * - Top 1% = the top 1% of the players WITH a Pure value in that room
 *   (players without 🤝 assists have no 🪳, so no Pure — they cannot be
 *   ranked on it). n = ceil(1% × withPure); cutoff = the Pure of rank n;
 *   every player at or above the cutoff counts (ties included).
 *   Bottom 1% mirrors it: n = ceil(1% × withPure); bottom cutoff = the
 *   Pure of rank (withPure − n + 1); every player at or below it counts.
 * - PC and PlayStation are computed separately, from their own ranks.json
 *   (owner rule: no PC constant carried onto PlayStation).
 *
 * What the page does NOT claim: a fresh account with a huge Pure is not
 * a new player who got good in a month. The top of this list is mostly
 * experienced players on new accounts — alts (SimplenubbTR/NC), smurfs,
 * and peaky low-🦁-Brave sheets — which is why 🦁 Brave sits in the
 * table next to Pure. Two filters already shape the list before it
 * reaches this page: ranks.json leaves out hidden players, and the
 * fresh-account auto-hide (≤7 days, adj ≥ 2200, ekpm ≤ 0.729) hides
 * fresh-exceptional accounts permanently — this page shows the survivors.
 */
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { pureIvI } from "./pure-ivi.mjs";

export const RANKS_URL_PC = "data/ranks.json";
export const RANKS_URL_PS = "data-ps/ranks.json";

/** Fresh = created at most this many days before the snapshot. */
export const FRESH_DAYS = 30;

const DAY_S = 86400;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Same key as rank-row.mjs slugKey: tag stripped, lowercase a–z0–9. */
export function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

/** Ranked names open their sheet on the Players page (share-add.mjs ?names=). */
export function playerSheetUrl(name) { return `index.html?names=${encodeURIComponent(String(name))}`; }

/** ranks.json `srv` values: PC worlds lowercase, PS us/eu. Unknown → raw. */
export const SERVER_LABEL = Object.freeze({
  osprey: "Osprey", wainwright: "Wainwright", soltech: "SolTech", jaeger: "Jaeger",
  cobalt: "Cobalt", emerald: "Emerald", briggs: "Briggs",
  us: "Genudine", eu: "Ceres",
});
export function serverLabel(srv) {
  if (srv == null || String(srv).trim() === "") return "—";
  return SERVER_LABEL[String(srv).toLowerCase()] || String(srv);
}

/** Age in days at the snapshot, or null when `created` is missing. */
export function ageDaysAt(created, snapshotSec) {
  if (!fin(created) || !fin(snapshotSec)) return null;
  return (snapshotSec - created) / DAY_S;
}

export function isFreshAge(ageDays, days = FRESH_DAYS) {
  return fin(ageDays) && ageDays >= 0 && ageDays <= days;
}

/**
 * ranks.json → { updatedAt, total, withPure, topN, cutoff, bottomN,
 *   bottomCutoff, fresh, freshPure, freshNoPure, topFresh, worstFresh, byName }.
 * `fresh` = every fresh account (with or without Pure); `freshPure` =
 * the fresh ones with a Pure value, best first; `topFresh` = the fresh
 * ones in the room's top 1% Pure; `worstFresh` = the fresh ones in the
 * room's bottom 1% Pure, worst first. `overallRank` is the player's rank
 * among everyone with a Pure value (1 = best Pure). Exported for tests.
 */
export function buildFresh(ranksJson) {
  const out = {
    updatedAt: (ranksJson && ranksJson.updatedAt) || null,
    total: 0, withPure: 0, topN: 0, cutoff: null, bottomN: 0, bottomCutoff: null,
    players: [], fresh: [], freshPure: [], freshNoPure: 0, topFresh: [], worstFresh: [],
    byName: new Map(),
  };
  if (!ranksJson || !Array.isArray(ranksJson.cols) || !Array.isArray(ranksJson.rows)) return out;
  const snapshotSec = out.updatedAt ? Date.parse(out.updatedAt) / 1000 : Date.now() / 1000;
  const ci = (c) => ranksJson.cols.indexOf(c);
  const colOf = (id) => (ci(id) >= 0 ? ranksJson.rows.map((r) => r[ci(id)]) : []);
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
  const iN = ci("name"), iS = ci("slug");
  const iAdjs = ci("adjs"), iKd = ci("kd"), iRkd = ci("rkd"), iOwn = ci("ownKpm"), iPvs = ci("pvs");
  const iInf = ci("inf"), iInfl = ci("inflation"), iApk = ci("apk");
  const iCreated = ci("created"), iSrv = ci("srv");
  const num = (r, i) => (i >= 0 && fin(r[i]) ? r[i] : null);
  const players = [];
  for (const r of ranksJson.rows) {
    const name = iN >= 0 ? r[iN] : "";
    const key = normName(name);
    if (!key || out.byName.has(key)) continue;
    const adjs = num(r, iAdjs);
    const z = zergScore(tp, num(r, iInfl), num(r, iApk), num(r, ci("rvp")), num(r, ci("crp")));
    const pure = pureIvI(adjs, z ? z.score : null);
    const created = num(r, iCreated);
    const age = ageDaysAt(created, snapshotSec);
    const p = {
      name,
      slug: iS >= 0 ? r[iS] : "",
      ageDays: age,
      fresh: isFreshAge(age),
      created,
      srv: iSrv >= 0 ? r[iSrv] : null,
      adjs,
      pure,
      top1: false,
      worst1: false,
      overallRank: null,
      zerg: z ? z.score : null,
      kd: num(r, iKd),
      rkd: num(r, iRkd),
      ownKpm: num(r, iOwn),
      pvs: num(r, iPvs),
      inf: num(r, iInf),
    };
    players.push(p);
    out.byName.set(key, p);
  }
  out.total = players.length;
  out.players = players;
  const ranked = players.filter((p) => fin(p.pure))
    .sort((a, b) => (b.pure - a.pure) || String(a.name).localeCompare(String(b.name)));
  out.withPure = ranked.length;
  out.topN = Math.max(0, Math.ceil(ranked.length * 0.01));
  out.cutoff = out.topN > 0 ? ranked[out.topN - 1].pure : null;
  ranked.forEach((p, i) => {
    p.overallRank = i + 1;
    p.top1 = fin(out.cutoff) && p.pure >= out.cutoff;
  });
  out.bottomN = Math.max(0, Math.ceil(ranked.length * 0.01));
  out.bottomCutoff = out.bottomN > 0 ? ranked[ranked.length - out.bottomN].pure : null;
  ranked.forEach((p) => {
    p.worst1 = fin(out.bottomCutoff) && p.pure <= out.bottomCutoff;
  });
  out.fresh = players.filter((p) => p.fresh);
  out.freshPure = out.fresh.filter((p) => fin(p.pure))
    .sort((a, b) => (b.pure - a.pure) || String(a.name).localeCompare(String(b.name)));
  out.freshNoPure = out.fresh.length - out.freshPure.length;
  out.topFresh = out.freshPure.filter((p) => p.top1);
  out.worstFresh = out.freshPure.filter((p) => p.worst1)
    .sort((a, b) => (a.pure - b.pure) || String(a.name).localeCompare(String(b.name)));
  return out;
}

export function fmtInt(v) { return fin(v) ? Math.round(v).toLocaleString("en-US") : "—"; }
export function fmt2(v) { return fin(v) ? v.toFixed(2) : "—"; }
export function fmtAge(v) { return fin(v) ? `${v.toFixed(1)}d` : "—"; }
export function fmtDateSec(sec) {
  if (!fin(sec)) return "—";
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// ---- browser shell ----

const COLS = 14;

function rowHtml(p, i) {
  return `<tr${p.top1 ? ` class="fresh-top1"` : ""}>` +
    `<td>${i + 1}</td>` +
    `<td><a href="${esc(playerSheetUrl(p.name))}">${esc(p.name)}</a></td>` +
    `<td>${fmtAge(p.ageDays)}</td><td>${fmtDateSec(p.created)}</td><td>${esc(serverLabel(p.srv))}</td>` +
    `<td>${p.top1 ? "★ " : p.worst1 ? "▼ " : ""}${fmtInt(p.pure)}</td><td>${fin(p.overallRank) ? `#${p.overallRank}` : "—"}</td>` +
    `<td>${fmtInt(p.adjs)}</td><td>${fmtInt(p.zerg)}</td>` +
    `<td>${fmt2(p.rkd)}</td><td>${fmt2(p.kd)}</td><td>${fmt2(p.ownKpm)}</td>` +
    `<td>${fmt2(p.pvs)}</td><td>${fin(p.inf) ? `${Math.round(p.inf)}%` : "—"}</td></tr>`;
}

export function startFresh() {
  const $ = (id) => document.getElementById(id);
  const topBody = $("freshTopBody"), body = $("freshBody"), worstBody = $("freshWorstBody"), statusEl = $("freshStatus");
  const roomPc = $("freshRoomPc"), roomPs = $("freshRoomPs"), searchEl = $("freshSearch"), foundEl = $("freshFound");
  const noteEl = $("freshNote");
  if (!topBody || !body || !worstBody || !statusEl) return;

  let room = "pc";
  let data = null;
  let loaded = { pc: null, ps: null };

  function render() {
    if (!data) {
      topBody.innerHTML = `<tr><td colspan="${COLS}">Loading…</td></tr>`;
      body.innerHTML = `<tr><td colspan="${COLS}">Loading…</td></tr>`;
      worstBody.innerHTML = `<tr><td colspan="${COLS}">Loading…</td></tr>`;
      return;
    }
    topBody.innerHTML = data.topFresh.length
      ? data.topFresh.map((p, i) => rowHtml(p, i)).join("")
      : `<tr><td colspan="${COLS}">No fresh account in the top 1% 🧘 Pure in this room — the best fresh Pure here is below the cutoff.</td></tr>`;
    body.innerHTML = data.freshPure.length
      ? data.freshPure.map((p, i) => rowHtml(p, i)).join("")
      : `<tr><td colspan="${COLS}">No fresh account with a 🧘 Pure value in this room yet.</td></tr>`;
    worstBody.innerHTML = data.worstFresh.length
      ? data.worstFresh.map((p, i) => rowHtml(p, i)).join("")
      : `<tr><td colspan="${COLS}">No fresh account in the bottom 1% 🧘 Pure in this room — the worst fresh Pure here is above the cutoff.</td></tr>`;
    statusEl.textContent = `${data.total.toLocaleString("en-US")} players · snapshot ${fmtDate(data.updatedAt)} · ` +
      `${data.fresh.length.toLocaleString("en-US")} fresh (≤${FRESH_DAYS}d), ${data.freshPure.length.toLocaleString("en-US")} with 🧘 Pure · ` +
      `top 1% Pure = ${data.topN.toLocaleString("en-US")} players at 🧘 ≥ ${fmtInt(data.cutoff)} · ` +
      `${data.topFresh.length} fresh in the top 1% · ` +
      `bottom 1% Pure = ${data.bottomN.toLocaleString("en-US")} players at 🧘 ≤ ${fmtInt(data.bottomCutoff)} · ` +
      `${data.worstFresh.length} fresh in the bottom 1%`;
    if (noteEl) {
      noteEl.textContent = room === "pc"
        ? "PC room. 🪳 Zerg and 🧘 Pure use the same formulas as the Rankings table; the top-1% cutoff is computed from this room's own players."
        : "PlayStation room. Same rules, but 🪳 Zerg is known only for players with 🤝 assists — the rest have no 🧘 Pure, so the top 1% is a small group and the cutoff moves a lot between snapshots.";
    }
  }

  function renderFound() {
    if (!foundEl || !searchEl) return;
    const q = normName(searchEl.value);
    if (!q || !data) { foundEl.innerHTML = ""; return; }
    const p = data.byName.get(q) || data.players?.find?.((x) => normName(x.name).includes(q));
    if (!p) { foundEl.innerHTML = `<p>No ranked player matches “${esc(searchEl.value)}” in this room.</p>`; return; }
    if (!p.fresh) {
      foundEl.innerHTML = `<p><a href="${esc(playerSheetUrl(p.name))}"><strong>${esc(p.name)}</strong></a> is not a fresh account — ` +
        `created ${fmtDateSec(p.created)} (${fin(p.ageDays) ? `${Math.round(p.ageDays).toLocaleString("en-US")} days old` : "age unknown"}) at the snapshot.</p>`;
      return;
    }
    foundEl.innerHTML = `<p><a href="${esc(playerSheetUrl(p.name))}"><strong>${esc(p.name)}</strong></a> → fresh, ${fmtAge(p.ageDays)} old · ` +
      (fin(p.pure)
        ? `🧘 Pure ${fmtInt(p.pure)} (overall #${p.overallRank}${p.top1 ? ", ★ top 1%" : ""}) · ⚔️ iVi ${fmtInt(p.adjs)} · 🪳 Zerg ${fmtInt(p.zerg)} · 🦁 Brave ${fmt2(p.pvs)}`
        : "no 🧘 Pure yet (no 🪳 Zerg — needs 🤝 assists data)") +
      `</p>`;
  }

  async function load(roomKey) {
    room = roomKey;
    if (roomPc) roomPc.setAttribute("aria-pressed", String(roomKey === "pc"));
    if (roomPs) roomPs.setAttribute("aria-pressed", String(roomKey === "ps"));
    if (loaded[roomKey]) { data = loaded[roomKey]; render(); renderFound(); return; }
    statusEl.textContent = "Loading ranks…";
    try {
      const res = await fetch(roomKey === "pc" ? RANKS_URL_PC : RANKS_URL_PS, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = buildFresh(await res.json());
      loaded[roomKey] = data;
    } catch {
      statusEl.textContent = "ranks.json failed to load — fresh accounts unavailable";
      data = null;
    }
    render();
    renderFound();
  }

  if (roomPc) roomPc.addEventListener("click", () => load("pc"));
  if (roomPs) roomPs.addEventListener("click", () => load("ps"));
  if (searchEl) searchEl.addEventListener("input", renderFound);
  load("pc");
}

// Self-start on the Fresh page only (node test imports stay side-effect free).
if (typeof document !== "undefined" && document.getElementById("freshBody")) startFresh();
