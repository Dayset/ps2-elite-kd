/**
 * 🕸️ Web (radar) view for the skill graph (owner 2026-11-11): the plotted
 * players as webs on 10 axes. Every axis is a population percentile — the
 * floored share of players strictly below, to 1 decimal (the same
 * convention the tryout used) — so a web reads the same for everyone and
 * no raw 2.47 / 0.65 numbers show up as headlines.
 *
 * Axes (emoji only on the vertices; full names live in tooltips / the
 * footer, never as vertex text):
 *   1. ⚔️ iVi — ranks.json adjs
 *   2. 🏃 Activity — act
 *   3. 🦁 Brave — pvs (NOT rf; rf is 🛡️ Resist)
 *   4. 🛡️ Resist — rf
 *   5. ☠️ K/D — rkd (K/D vs the ~200 most-fought players)
 *   6. 🎲 Luck — luckPoints from data/duel-ivi-player.json
 *   7. 🤝 Assists — apk, INVERTED (100 − percentile): low assists means
 *      finishing your own kills, which is good
 *   8. 🪳 Solo — 🪳 Zerg (trait-scores.mjs + zerg-revive.mjs crowd check),
 *      INVERTED as the percentile of −Zerg among players with a Zerg score
 *   9. 🧼 Clean — combinedIvI(pureIvI(adjs, zerg), G): the public stat.
 *      Public 🧘 Pure is gone — do NOT show a Pure axis.
 *  10. 🪖 Infantry — inf
 * No ⚡ Const axis (owner: it ruins the picture) and no public Census
 * stats (no Accuracy / Headshot / lifetime K/D / KPM / IvI).
 *
 * Missing data is never invented: a player with no Luck value gets no
 * Luck vertex (the polygon jumps across it), a player with no ranks.json
 * row gets no web at all. All inputs come from the one shared ranks.json
 * payload (shared-index.mjs loadRanksPayload) plus the cached Luck file
 * (luck-col.mjs loadLuckData) — no second ranks fetch.
 *
 * DOM-free; chart.mjs owns the SVG, app.js owns the view cycle.
 */
import { lowerBound, sortedFinite } from "./dist.mjs?v=20261010-sav1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { pureIvI } from "./pure-ivi.mjs?v=20261029-purevis1";
import { gScores } from "./g-score.mjs?v=20261108-g2f1";
import { combinedIvI } from "./combined-ivi.mjs?v=20261110-cmb1";
import { playerLuck, luckPoints } from "./luck-col.mjs?v=20261102-luck5";

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** The 10 web axes, in order. Emoji only — no text labels on the vertices. */
export const WEB_AXES = Object.freeze([
  { id: "adjs", emoji: "⚔️" },
  { id: "act", emoji: "🏃" },
  { id: "pvs", emoji: "🦁" },
  { id: "rf", emoji: "🛡️" },
  { id: "rkd", emoji: "☠️" },
  { id: "luck", emoji: "🎲" },
  { id: "apk", emoji: "🤝" },
  { id: "solo", emoji: "🪳" },
  { id: "clean", emoji: "🧼" },
  { id: "inf", emoji: "🪖" },
]);

/** Chart views in carousel order: 💀 iVi → 🧘 Pure → 🕸️ Web. */
export const CHART_VIEWS = Object.freeze(["kd", "pure", "web"]);

/** Views on offer: iVi always; Pure / Web only when their gate is open. */
export function chartViews({ pure = false, web = false } = {}) {
  const out = ["kd"];
  if (pure) out.push("pure");
  if (web) out.push("web");
  return out;
}

/**
 * Next view in the carousel from `mode`, `dir` steps (+1 next, −1 previous),
 * skipping gated views. An unknown mode (e.g. the retired "ivi") counts as iVi.
 */
export function nextChartView(mode, dir = 1, gates = {}) {
  const views = chartViews(gates);
  const n = views.length;
  if (n <= 1) return "kd";
  const from = views.indexOf(mode);
  const i = from < 0 ? 0 : from;
  return views[(((i + dir) % n) + n) % n];
}

/**
 * Population percentile, floored to 1 decimal: share of `sorted` strictly
 * below `v`. null when v is missing or the pool is empty. (dist.mjs
 * percentileOf floors to an integer; the web keeps 1 decimal so the
 * inversions read exactly — 100 − 13.7 = 86.3, not 87.)
 */
export function percentile1dp(sorted, v) {
  if (!fin(v) || !Array.isArray(sorted) || !sorted.length) return null;
  return Math.floor((1000 * lowerBound(sorted, v)) / sorted.length) / 10;
}

/**
 * Build every pool the web needs from one ranks.json payload
 * ({ cols, rows }) plus the Luck file (duel-ivi-player.json, or null/false
 * when it hasn't loaded — Luck vertices are then missing, never guessed).
 * Returns null when the payload has no usable rows.
 */
export function buildWebPools(payload, luckData) {
  if (!payload || !Array.isArray(payload.cols) || !Array.isArray(payload.rows)) return null;
  const i = Object.fromEntries(payload.cols.map((c, k) => [c, k]));
  const need = ["slug", "adjs", "act", "pvs", "rf", "rkd", "apk", "inf", "inflation", "ivi", "rvp", "crp"];
  if (need.some((c) => i[c] == null)) return null;
  const rows = [];
  const rowsBySlug = new Map();
  for (const row of payload.rows) {
    if (!Array.isArray(row) || typeof row[i.slug] !== "string") continue;
    const o = {
      slug: row[i.slug], name: row[i.name],
      adjs: row[i.adjs], act: row[i.act], pvs: row[i.pvs], rf: row[i.rf],
      rkd: row[i.rkd], apk: row[i.apk], inf: row[i.inf],
      inflation: row[i.inflation], ivi: row[i.ivi], rvp: row[i.rvp], crp: row[i.crp],
    };
    rows.push(o);
    rowsBySlug.set(o.slug, o);
  }
  if (!rows.length) return null;
  const col = (id) => sortedFinite(rows.map((r) => r[id]));
  const pools = {
    adjs: col("adjs"), act: col("act"), pvs: col("pvs"), rf: col("rf"),
    rkd: col("rkd"), apk: col("apk"), inf: col("inf"),
  };
  // 🪳 Zerg per slug, the same calls the tables use (trait-scores.mjs).
  const traitP = traitPools({
    adjs: rows.map((r) => r.adjs), ivi: rows.map((r) => r.ivi),
    inflation: rows.map((r) => r.inflation), apk: rows.map((r) => r.apk),
  });
  const zergBySlug = new Map();
  const zergScores = [];
  for (const r of rows) {
    const z = zergScore(traitP, r.inflation, r.apk, r.rvp, r.crp);
    if (z) { zergBySlug.set(r.slug, z.score); zergScores.push(z.score); }
  }
  const negZergPool = zergScores.map((z) => -z).sort((a, b) => a - b);
  // 🌈 G per slug, the same call the tables use (g-score.mjs).
  const gBySlug = new Map();
  try {
    const scores = gScores(rows);
    for (const r of rows) if (scores.has(r)) gBySlug.set(r.slug, scores.get(r));
  } catch { /* no G without rkd/pvs: Clean stays missing, never guessed */ }
  // 🧼 Clean per slug: 🧘 Pure iVi × (1 − 🌈 G) (combined-ivi.mjs).
  const cleanBySlug = new Map();
  const cleanPool = [];
  for (const r of rows) {
    const z = zergBySlug.get(r.slug);
    const g = gBySlug.get(r.slug);
    if (z == null || g == null || !fin(r.adjs)) continue;
    const pure = pureIvI(r.adjs, z);
    const clean = combinedIvI(pure, g);
    if (clean == null) continue;
    cleanBySlug.set(r.slug, clean);
    cleanPool.push(clean);
  }
  cleanPool.sort((a, b) => a - b);
  // 🎲 Luck points per slug (luck-col.mjs); empty when the file is absent.
  const luckBySlug = new Map();
  const luckPool = [];
  if (luckData && luckData.p) {
    for (const [slug, e] of Object.entries(luckData.p)) {
      const l = playerLuck(luckData, slug);
      const pts = l == null ? NaN : luckPoints(l);
      if (fin(pts)) { luckBySlug.set(slug, pts); luckPool.push(pts); }
    }
    luckPool.sort((a, b) => a - b);
  }
  return {
    rowsBySlug, pools, zergBySlug, gBySlug, cleanBySlug, cleanPool,
    negZergPool, luckBySlug, luckPool,
    counts: { rows: rows.length, zerg: zergScores.length, clean: cleanPool.length, luck: luckPool.length },
  };
}

/**
 * The 10 web values for one slug, in WEB_AXES order: population percentiles
 * (0–100, 1 decimal) or null where the player has no value. null (not an
 * empty array) when the slug has no ranks.json row at all.
 */
export function webValuesFor(webPools, slug) {
  if (!webPools || typeof slug !== "string") return null;
  const row = webPools.rowsBySlug.get(slug);
  if (!row) return null;
  const { pools } = webPools;
  const pct = (pool, v) => percentile1dp(pool, v);
  const zerg = webPools.zergBySlug.get(slug);
  const clean = webPools.cleanBySlug.get(slug);
  const luck = webPools.luckBySlug.get(slug);
  const apkRaw = pct(pools.apk, row.apk);
  return [
    pct(pools.adjs, row.adjs), // ⚔️ iVi
    pct(pools.act, row.act), // 🏃 Activity
    pct(pools.pvs, row.pvs), // 🦁 Brave
    pct(pools.rf, row.rf), // 🛡️ Resist
    pct(pools.rkd, row.rkd), // ☠️ K/D
    luck == null ? null : pct(webPools.luckPool, luck), // 🎲 Luck
    apkRaw == null ? null : Math.round((100 - apkRaw) * 10) / 10, // 🤝 Assists, inverted
    zerg == null ? null : pct(webPools.negZergPool, -zerg), // 🪳 Solo (Zerg inverted)
    clean == null ? null : pct(webPools.cleanPool, clean), // 🧼 Clean
    pct(pools.inf, row.inf), // 🪖 Infantry
  ];
}

/** Point for one vertex: value 0–100 maps to radius 0–r, first axis at top. */
export function radarPoint(value, axisIndex, axisCount, cx, cy, r) {
  const a = (Math.PI * 2 * axisIndex) / axisCount - Math.PI / 2;
  const d = (Math.max(0, Math.min(100, value)) / 100) * r;
  return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
}

/**
 * Polygon points for a values array (WEB_AXES order): present vertices
 * only, in axis order — a missing vertex is jumped across, never plotted
 * at 0. Returns [] when nothing is plottable.
 */
export function radarPoints(values, cx, cy, r) {
  if (!Array.isArray(values)) return [];
  const n = values.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const v = values[k];
    if (v == null) continue;
    out.push(radarPoint(v, k, n, cx, cy, r));
  }
  return out;
}
