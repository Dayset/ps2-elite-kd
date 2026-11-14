/**
 * 🧬 Player archetypes — groups of players by how they actually play,
 * from the stats the site already collects.
 *
 * Method (2026-11-14 prototype, PC snapshot 2026-11-03, 17,497 rows):
 * a plain k-means over the same fields mostly just re-sorted players by
 * skill, so the groups below are a decision tree on the site's own
 * numbers instead — reproducible from ranks.json alone, no black box.
 * Rules run in order; the first match wins, so every player lands in
 * exactly one archetype (or none, when ⚔️ iVi is missing).
 *
 * Stats are the Rankings numbers, not recomputed lookalikes:
 * - 🪳 Zerg = trait-scores.mjs zergScore over the ranks.json pools,
 *   same as the Rankings table (revive/crowd softening included).
 * - 🧘 Pure = pureIvI(adjs, zerg) — plain ⚔️ iVi with the uncentered
 *   🪳 charge, same formula as the Rankings Pure column.
 * - 🔀 Diff = trait-scores.mjs aimGap (percentile(⚔️ iVi) − percentile
 *   (public IvI), hut/vehicle/newbie damped), same as the Rankings
 *   Diff column. ⚔️ iVi shown is ranks.json `adj` (the evened value);
 *   `adjs` is the pre-evening value the tree tests against.
 *
 * PC and PlayStation are computed separately, from their own ranks.json
 * (owner rule: no PC constant carried onto PlayStation). The tree is the
 * same shape in both rooms; 🦁 Brave is already room-scaled in the
 * stored `pvs`, and 🪳 Zerg is known only where 🤝 assists exist.
 * Hidden players are already left out of ranks.json, so they never
 * appear here. The ALandWhale case is a known gap, not a group: his
 * low-assist pattern is not captured by 🪳 (min of inflation and
 * assists percentiles), so he lands in Solid — assist forensics stays
 * a separate flag, not an archetype.
 */
import { traitPools, zergScore, aimGap } from "./trait-scores.mjs?v=20261027-z79";
import { pureIvI } from "./pure-ivi.mjs";

export const RANKS_URL_PC = "data/ranks.json";
export const RANKS_URL_PS = "data-ps/ranks.json";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Same key as rank-row.mjs slugKey: tag stripped, lowercase a–z0–9. */
export function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
}

/** Ranked names open their sheet on the Players page (share-add.mjs ?names=). */
export function playerSheetUrl(name) { return `index.html?names=${encodeURIComponent(String(name))}`; }

/**
 * The eleven archetypes, in tree order. `rule` is the exact test, in
 * words; `blurb` is what the group means. Medians below are the live
 * values from the current snapshot, recomputed on every load — the
 * 2026-11-03 PC prototype medians are in test/archetypes.test.mjs.
 */
export const ARCHETYPES = Object.freeze([
  { id: "vehicle", label: "Vehicle-heavy", icon: "🚜", rule: "🪖 Infantry < 50%", blurb: "Most kills from a vehicle or MAX seat. Headshot rate collapses (vehicle weapons barely headshot) and the vehicle cut keeps ⚔️ iVi low even when K/D looks fine." },
  { id: "zerg", label: "Zerg-rider", icon: "🪳", rule: "🪳 Zerg ≥ 75, or 🎈 Inflation ≥ 3.5", blurb: "K/D inflated by soft fights AND many shared kills — riding a big group. Realistic K/D collapses once the crowd is taken away." },
  { id: "peaky", label: "Peaky", icon: "⛰️", rule: "🦁 Brave ≤ 0.5, K/D ≥ 3, ⚔️ iVi (adjs) ≥ 800", blurb: "Gaudy K/D with a collapsed Brave: the score holds against nobody fast. Rare — only a few dozen players." },
  { id: "selective", label: "Selective", icon: "🎯", rule: "K/D ≥ 4 and own KPM < 1", blurb: "Ultra-selective fight picking: huge K/D at a slow pace. Results beat the aim on paper (🔀 Diff far positive)." },
  { id: "elite", label: "Elite solo", icon: "⚔️", rule: "⚔️ iVi (adjs) ≥ 1500, own KPM ≥ 1.4, 🦁 Brave ≥ 3", blurb: "Fast, brave, and good against the hardest opposition — the top of the solo game." },
  { id: "grinder", label: "Fast grinder", icon: "🏃", rule: "own KPM ≥ 1.4 and 🦁 Brave ≥ 3", blurb: "High-volume legit grinder: keeps fighting fast enemies at a fast pace, just below elite iVi." },
  { id: "soft", label: "Soft-fight", icon: "🫧", rule: "🎈 Inflation ≥ 3", blurb: "K/D built on soft opposition. The overall K/D is roughly three times the K/D against enemies at 0.5 KPM or better." },
  { id: "steady", label: "Steady", icon: "🧱", rule: "⚡ Const ≥ 0.8", blurb: "Keeps their (usually low) K/D against the strongest third of opponents as well as the weakest. Consistency alone is not skill — most of this group sits below the rating scale." },
  { id: "solid", label: "Solid", icon: "🛡️", rule: "⚔️ iVi (adjs) ≥ 1000", blurb: "Strong all-rounders who miss the elite pace/brave bars." },
  { id: "mid", label: "Mid", icon: "🧑‍🚀", rule: "⚔️ iVi (adjs) ≥ 0", blurb: "The broad middle: average players, including the ShloDog baseline." },
  { id: "below", label: "Below scale", icon: "📉", rule: "⚔️ iVi (adjs) < 0", blurb: "Below the rating scale — the bottom sixth of tracked players." },
]);

export const ARCHETYPE_BY_ID = Object.freeze(Object.fromEntries(ARCHETYPES.map((a) => [a.id, a])));

/**
 * First matching rule wins. `p` carries the Rankings fields:
 * adjs, kd, ownKpm, pvs (🦁 Brave), cons, inf (🪖 %), inflation, zerg.
 * Returns an archetype id, or null when ⚔️ iVi is missing (unassigned).
 */
export function classifyArchetype(p) {
  const q = p || {};
  if (fin(q.inf) && q.inf < 50) return "vehicle";
  if ((fin(q.zerg) && q.zerg >= 75) || (fin(q.inflation) && q.inflation >= 3.5)) return "zerg";
  if (fin(q.pvs) && q.pvs <= 0.5 && fin(q.kd) && q.kd >= 3 && fin(q.adjs) && q.adjs >= 800) return "peaky";
  if (fin(q.kd) && q.kd >= 4 && fin(q.ownKpm) && q.ownKpm < 1) return "selective";
  if (fin(q.adjs) && q.adjs >= 1500 && fin(q.ownKpm) && q.ownKpm >= 1.4 && fin(q.pvs) && q.pvs >= 3) return "elite";
  if (fin(q.ownKpm) && q.ownKpm >= 1.4 && fin(q.pvs) && q.pvs >= 3) return "grinder";
  if (fin(q.inflation) && q.inflation >= 3) return "soft";
  if (fin(q.cons) && q.cons >= 0.8) return "steady";
  if (fin(q.adjs) && q.adjs >= 1000) return "solid";
  if (fin(q.adjs) && q.adjs >= 0) return "mid";
  if (fin(q.adjs) && q.adjs < 0) return "below";
  return null;
}

export function median(vals) {
  const v = vals.filter(fin).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * ranks.json → { updatedAt, total, players, byName, groups, unassigned }.
 * `players` are flat rows with the stats the page shows plus their
 * archetype; `groups` hold the live medians and top players per group.
 * Exported for tests.
 */
export function buildArchetypes(ranksJson) {
  const out = { updatedAt: (ranksJson && ranksJson.updatedAt) || null, total: 0, players: [], byName: new Map(), groups: {}, unassigned: 0 };
  if (!ranksJson || !Array.isArray(ranksJson.cols) || !Array.isArray(ranksJson.rows)) return out;
  const ci = (c) => ranksJson.cols.indexOf(c);
  const colOf = (id) => (ci(id) >= 0 ? ranksJson.rows.map((r) => r[ci(id)]) : []);
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
  const iN = ci("name"), iS = ci("slug");
  const iAdj = ci("adj"), iAdjs = ci("adjs"), iIvi = ci("ivi");
  const iKd = ci("kd"), iKpm = ci("kpm"), iOwn = ci("ownKpm"), iPvs = ci("pvs"), iCons = ci("cons");
  const iInf = ci("inf"), iInfl = ci("inflation"), iApk = ci("apk"), iAcc = ci("acc"), iHsr = ci("hsr"), iRkd = ci("rkd");
  const iHut = ci("hut"), iVdf = ci("vdf"), iNbd = ci("nbd"), iRvp = ci("rvp"), iCrp = ci("crp");
  const num = (r, i) => (i >= 0 && fin(r[i]) ? r[i] : null);
  for (const r of ranksJson.rows) {
    const name = iN >= 0 ? r[iN] : "";
    const key = normName(name);
    if (!key || out.byName.has(key)) continue;
    const adjs = num(r, iAdjs);
    const z = zergScore(tp, num(r, iInfl), num(r, iApk), num(r, iRvp), num(r, iCrp));
    const zerg = z ? z.score : null;
    const gap = aimGap(tp, adjs, num(r, iIvi), num(r, iHut), num(r, iVdf), num(r, iNbd));
    const p = {
      name,
      slug: iS >= 0 ? r[iS] : "",
      adj: num(r, iAdj), // ⚔️ iVi, evened (Rankings value)
      adjs,
      pure: pureIvI(adjs, zerg),
      zerg,
      diff: gap ? gap.score : null,
      rkd: num(r, iRkd),
      kd: num(r, iKd),
      kpm: num(r, iKpm),
      ownKpm: num(r, iOwn),
      pvs: num(r, iPvs),
      cons: num(r, iCons),
      inf: num(r, iInf),
      inflation: num(r, iInfl),
      apk: num(r, iApk),
      acc: num(r, iAcc),
      hsr: num(r, iHsr),
    };
    p.archetype = classifyArchetype(p);
    if (!p.archetype) out.unassigned++;
    out.players.push(p);
    out.byName.set(key, p);
  }
  out.total = out.players.length;
  const keys = ["adjs", "pure", "rkd", "kd", "ownKpm", "inflation", "zerg", "pvs", "cons", "inf", "acc", "hsr", "diff"];
  for (const a of ARCHETYPES) {
    const members = out.players.filter((p) => p.archetype === a.id);
    const med = {};
    for (const k of keys) med[k] = median(members.map((p) => p[k]));
    out.groups[a.id] = {
      ...a,
      n: members.length,
      share: out.total ? (members.length / out.total) * 100 : 0,
      med,
      top: [...members].sort((x, y) => (fin(y.adjs) ? y.adjs : -Infinity) - (fin(x.adjs) ? x.adjs : -Infinity)).slice(0, 10),
    };
  }
  return out;
}

export function fmtInt(v) { return fin(v) ? Math.round(v).toLocaleString("en-US") : "—"; }
export function fmt2(v) { return fin(v) ? v.toFixed(2) : "—"; }
export function fmt1(v) { return fin(v) ? v.toFixed(1) : "—"; }
export function fmtShare(v) { return fin(v) ? `${v.toFixed(1)}%` : "—"; }
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// ---- browser shell ----

function groupRowHtml(g, selected) {
  const m = g.med;
  return `<tr data-arch="${esc(g.id)}" class="${selected ? "arch-selected" : ""}" tabindex="0">` +
    `<td><span class="arch-name">${esc(g.icon)} ${esc(g.label)}</span><br /><span class="arch-rule">${esc(g.rule)}</span></td>` +
    `<td>${g.n.toLocaleString("en-US")}</td><td>${fmtShare(g.share)}</td>` +
    `<td>${fmtInt(m.adjs)}</td><td>${fmtInt(m.pure)}</td><td>${fmt2(m.rkd)}</td><td>${fmt2(m.kd)}</td>` +
    `<td>${fmt2(m.ownKpm)}</td><td>${fmt2(m.pvs)}</td><td>${fmtInt(m.zerg)}</td><td>${fin(m.inf) ? `${Math.round(m.inf)}%` : "—"}</td></tr>`;
}

function detailHtml(data, id) {
  const g = data.groups[id];
  if (!g) return "";
  const m = g.med;
  const rows = g.top.map((p, i) =>
    `<tr><td>${i + 1}</td><td><a href="${esc(playerSheetUrl(p.name))}">${esc(p.name)}</a></td>` +
    `<td>${fmtInt(p.adj)}</td><td>${fmtInt(p.pure)}</td><td>${fmt2(p.rkd)}</td><td>${fmt2(p.kd)}</td>` +
    `<td>${fmt2(p.ownKpm)}</td><td>${fmt2(p.pvs)}</td><td>${fmtInt(p.zerg)}</td></tr>`).join("");
  return `<h2>${esc(g.icon)} ${esc(g.label)} — ${g.n.toLocaleString("en-US")} players (${fmtShare(g.share)})</h2>` +
    `<p>${esc(g.blurb)}</p><p class="arch-rule-line">Rule: ${esc(g.rule)} — first match wins, in the order shown in the table.</p>` +
    `<p>Group medians: ⚔️ iVi ${fmtInt(m.adjs)} · 🧘 Pure ${fmtInt(m.pure)} · ☠️ K/D ${fmt2(m.rkd)} · K/D ${fmt2(m.kd)} · ` +
    `own KPM ${fmt2(m.ownKpm)} · 🎈 Inflation ${fmt2(m.inflation)} · 🪳 Zerg ${fmtInt(m.zerg)} · 🦁 Brave ${fmt2(m.pvs)} · ` +
    `⚡ Const ${fmt2(m.cons)} · 🪖 Infantry ${fin(m.inf) ? `${Math.round(m.inf)}%` : "—"} · Acc ${fmt1(m.acc)}% · HSR ${fmt1(m.hsr)}% · 🔀 Diff ${fmtInt(m.diff)}</p>` +
    (rows
      ? `<div class="arch-wrap"><table class="ranks-table" aria-label="Top players in ${esc(g.label)}"><thead><tr><th>#</th><th>Player</th><th>⚔️ iVi</th><th>🧘 Pure</th><th>☠️ K/D</th><th>K/D</th><th>own KPM</th><th>🦁 Brave</th><th>🪳 Zerg</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p>No players in this group in this room.</p>`);
}

export function startArchetypes() {
  const $ = (id) => document.getElementById(id);
  const body = $("archBody"), statusEl = $("archStatus"), detailEl = $("archDetail");
  const roomPc = $("archRoomPc"), roomPs = $("archRoomPs"), searchEl = $("archSearch"), foundEl = $("archFound");
  const noteEl = $("archNote");
  if (!body || !statusEl) return;

  let room = "pc";
  let data = null;
  let selected = "elite";
  let loaded = { pc: null, ps: null };

  function render() {
    if (!data) { body.innerHTML = `<tr><td colspan="11">Loading…</td></tr>`; return; }
    body.innerHTML = ARCHETYPES.map((a) => groupRowHtml(data.groups[a.id], a.id === selected)).join("");
    const zergKnown = data.players.filter((p) => fin(p.zerg)).length;
    statusEl.textContent = `${data.total.toLocaleString("en-US")} players · snapshot ${fmtDate(data.updatedAt)} · ` +
      `🪳 Zerg known for ${zergKnown.toLocaleString("en-US")} · ${data.unassigned} unassigned (no ⚔️ iVi)`;
    if (detailEl) detailEl.innerHTML = detailHtml(data, selected);
    if (noteEl) {
      noteEl.textContent = room === "pc"
        ? "PC room. 🪳 Zerg and 🧘 Pure use the same formulas as the Rankings table."
        : "PlayStation room. Same rules, but 🦁 Brave is already PS-scaled in the stored numbers and 🪳 Zerg is known only for players with 🤝 assists — the rest fall back to the inflation rule, so the counts are not comparable with PC.";
    }
    for (const tr of body.querySelectorAll("tr[data-arch]")) {
      tr.addEventListener("click", () => { selected = tr.dataset.arch; render(); });
      tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selected = tr.dataset.arch; render(); } });
    }
  }

  function renderFound() {
    if (!foundEl || !searchEl) return;
    const q = normName(searchEl.value);
    if (!q || !data) { foundEl.innerHTML = ""; return; }
    const p = data.byName.get(q) || data.players.find((x) => normName(x.name).includes(q));
    if (!p) { foundEl.innerHTML = `<p>No ranked player matches “${esc(searchEl.value)}” in this room.</p>`; return; }
    const g = p.archetype ? ARCHETYPE_BY_ID[p.archetype] : null;
    foundEl.innerHTML = `<p><a href="${esc(playerSheetUrl(p.name))}"><strong>${esc(p.name)}</strong></a> → ` +
      (g ? `<strong>${esc(g.icon)} ${esc(g.label)}</strong> (${esc(g.rule)})` : "unassigned (no ⚔️ iVi)") +
      ` — ⚔️ iVi ${fmtInt(p.adj)} · 🧘 Pure ${fmtInt(p.pure)} · ☠️ K/D ${fmt2(p.rkd)} · K/D ${fmt2(p.kd)} · ` +
      `own KPM ${fmt2(p.ownKpm)} · 🦁 Brave ${fmt2(p.pvs)} · 🪳 Zerg ${fmtInt(p.zerg)} · 🪖 Infantry ${fin(p.inf) ? `${Math.round(p.inf)}%` : "—"}</p>`;
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
      data = buildArchetypes(await res.json());
      loaded[roomKey] = data;
    } catch {
      statusEl.textContent = "ranks.json failed to load — archetypes unavailable";
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

// Self-start on the Archetypes page only (node test imports stay side-effect free).
if (typeof document !== "undefined" && document.getElementById("archBody")) startArchetypes();
