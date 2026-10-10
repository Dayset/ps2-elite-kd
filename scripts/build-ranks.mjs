#!/usr/bin/env node
/**
 * Build data/ranks.json for ranks.html: one compact row per cached player with
 * every number the main page's stats tables show, computed by the SAME code
 * (player-metrics.mjs), so ranks match the ✨ Adjusted table exactly.
 * No network: reads data/index.json + data/players/*.json only.
 *
 *   node scripts/build-ranks.mjs            # writes data/ranks.json
 *
 * Called by .github/workflows/refresh-cache.yml right before the run's single
 * data/ commit, so ranks.json is rebuilt whenever players are added/refreshed.
 *
 * Format (columnar, small): { updatedAt, count, cols: [id…], rows: [[…]…] }
 * Row = [display, query, slug, savedAt, …metric values in METRIC_COLS order].
 * Numbers are rounded to 6 decimals (display uses ≤ 3, so shown values match); missing → null.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlayer, playerMetrics, shownValue } from "../player-metrics.mjs";
import { reviewFlags } from "../red-flags.mjs";
import { classifyBins } from "../bins.mjs";
import { markNote, statMark, confirmedPadderSlugs, isFarmListed } from "../padding.mjs";
import { findOutliers, guardStatus } from "../outlier-guard.mjs";
import { hiddenList, isConfirmedCheater } from "../hidden.mjs";
import { cleanTimes } from "../flairs.mjs";
import { sessionMetrics, sessionFlag, sessionRuleText, distribution, SESSION_METRICS, SESSION_METRIC_IDS, SESSION_MIN, SESSION_RULE } from "../session-stats.mjs";

/** Full Honu XP detail for a slug (data/xp/<slug>.json; requested players only), or null. */
export function readXp(dataDir, slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "xp", `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** Confirmed-cheater reference + top legit players shown side by side on build-log (🧪 Session stats). */
export const SESSION_REFERENCE_LEGIT = Object.freeze(["yeezy", "zyr0sncx", "xclonekano", "shlodog", "justv6me"]);

/** Metric ids (same ids as the app.js stats columns). */
export const METRIC_COLS = Object.freeze([
  // ✨ Adjusted (visible by default, main-table order)
  "adjs", "rf", "act", "pvs", "rkd", "mech", "inflation",
  // older debug columns
  "adj", "ekpm", "own", "coi", "slope",
  // 📊 Public
  "kd", "kpm", "ownKpm", "acc", "hsr", "ivi",
]);
/**
 * Values are stored as SHOWN on the main page (shownValue): opponent-sample
 * metrics (THIN_METRICS) are null below MIN_FIGHTS, so ranks / sorting /
 * distributions skip them. Trailing "thin" = 1 when the sample is below
 * MIN_FIGHTS (ranks.html hover text). "mark" = "padding" ("*") / "adjusted" ("†") / null
 * (padding.mjs statMark); "farm" = note on farm-account kills excluded (null when none).
 * "top" = opponents in the sample (50 for older files, 200 for new fetches).
 * "created" / "last" = Census account creation / last activity, UNIX seconds
 * (not shown on Rankings; null when the cache file has no times yet).
 */
export const RANK_COLS = Object.freeze(["name", "query", "slug", "savedAt", ...METRIC_COLS, "thin", "mark", "farm", "top", "created", "last"]);

const round6 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

/** "[TAG] Name" → "Name" (what ?names= / Analyze expects). */
export function bareName(display) {
  return String(display || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

/**
 * One ranks row from a raw cached player JSON (same shape as data/players/*.json).
 * Returns null when the file has no usable player.
 */
export function rankRow(raw, { slug = "", savedAt = null, confirmed = false } = {}) {
  if (!raw) return null;
  const p = normalizePlayer(raw);
  if (!p || !p.display || p.display === "?") return null;
  const m = playerMetrics(p);
  const t = savedAt != null ? +savedAt : +raw.savedAt || null;
  return [p.display, bareName(p.display) || p.display, slug, t, ...METRIC_COLS.map((k) => round6(shownValue(m, k))), m.thin ? 1 : 0, statMark(m.farm, undefined, { confirmed }).kind || null, markNote(m.farm, { confirmed }) || null, p.top, (p.times && p.times.created) || null, (p.times && p.times.last) || null];
}

/** data/reviewed.json → Set of slugs confirmed as stat padders (decision "padding"; missing file = none). */
export function readConfirmedPadders(dataDir) {
  try {
    return confirmedPadderSlugs(JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")));
  } catch {
    return new Set();
  }
}

/** data/hidden.json → hiddenList lookup (missing / broken file = nobody hidden). */
export function readHidden(dataDir) {
  try {
    return hiddenList(JSON.parse(fs.readFileSync(path.join(dataDir, "hidden.json"), "utf8")));
  } catch {
    return hiddenList(null);
  }
}

/**
 * Build the whole ranks object from a data/ directory. Players on the 🙈 hide
 * list (data/hidden.json) are left out of the ranks rows and reported via
 * onHidden; onPlayer still sees them (outlier-guard population / red-flag
 * reference points unchanged); their cache files are untouched.
 */
export function buildRanks(dataDir, { onPlayer = null, onHidden = null, hidden = readHidden(dataDir), confirmed = readConfirmedPadders(dataDir) } = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const rows = [];
  const seen = new Set();
  for (const e of index.players || []) {
    const file = e && e.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    } catch {
      continue; // listed but missing / unreadable: skip, never fail the run
    }
    const slug = e.slug || path.basename(file, ".json");
    const pl = raw && (raw.player || raw);
    // 🤖 confirmed bot / farm accounts (data/farm.json, t322u): not players — never
    // ranked, never a reference point for the outlier guard / session comparison.
    if (isFarmListed({ name: (pl && pl.display) || e.name || slug, cid: pl && pl.cid }) || isFarmListed({ name: slug })) continue;
    const hit = hidden.match({ slug, name: (pl && pl.display) || e.name, cid: pl && pl.cid });
    const row = rankRow(raw, { slug, savedAt: e.savedAt ?? raw.savedAt, confirmed: confirmed.has(slug) });
    if (hit) {
      // Not ranked, but still a reference point for the 🧪 outlier guard (onPlayer).
      if (onHidden) onHidden({ slug, name: (pl && pl.display) || e.name || slug, cid: (pl && pl.cid) || "", key: hit.key, reason: hit.reason, at: hit.at });
      if (row && onPlayer) onPlayer(raw, row, { hidden: true, confirmedCheater: isConfirmedCheater(hit) });
      continue;
    }
    if (row) {
      rows.push(row);
      if (onPlayer) onPlayer(raw, row, { hidden: false });
    }
  }
  return { updatedAt: new Date().toISOString(), count: rows.length, cols: RANK_COLS.slice(), rows };
}

/** Ranks + 🧪 outlier guard over the same shown values (one pass over the cache) + 🙈 hidden summary. */
export function buildRanksWithGuard(dataDir) {
  const players = [];
  const hidden = readHidden(dataDir);
  const confirmed = readConfirmedPadders(dataDir);
  const hiddenFound = [];
  const ranks = buildRanks(dataDir, {
    hidden,
    confirmed,
    onHidden(h) { hiddenFound.push(h); },
    onPlayer(raw, row, info) {
      const m = playerMetrics(normalizePlayer(raw));
      const f = reviewFlags(m, { confirmed: confirmed.has(row[2]) }); // raw metrics: same 🚩 result as build-log.html
      const values = {};
      METRIC_COLS.forEach((k, i) => { values[k] = row[4 + i]; });
      // 🧪 Honu session metrics (assists pass + data/xp detail); only measured players count.
      const pl = raw.player || raw;
      const sm = sessionMetrics({ assists: pl.assists, xp: readXp(dataDir, row[2]) });
      const sf = sessionFlag(sm, { hsr: pl.hsr, kd: pl.global_kd });
      for (const id of SESSION_METRIC_IDS) values[id] = sm && sm.measured ? sm.values[id] : null;
      const patterns = sf.flagged ? [...f.patterns, "session"] : f.patterns;
      players.push({ slug: row[2], name: row[0], flagged: f.flagged || sf.flagged, patterns, values, session: sm, sessionFlag: sf, hidden: !!(info && info.hidden), confirmedCheater: !!(info && info.confirmedCheater) });
    },
  });
  const guard = guardStatus(findOutliers(players, [...METRIC_COLS, ...SESSION_METRIC_IDS]));
  return { ranks, guard, hidden: hiddenSummary(dataDir, hiddenFound), bins: binCounts(players, guard), session: sessionStatus(players, guard, dataDir) };
}

/**
 * status.json "sessionStats" block (build-log.html 🧪 Session stats, never public):
 * coverage, per-metric distributions over measured players, 🚩 "session" hits
 * with evidence, the cheater-vs-top-legit reference table and the session-metric
 * outliers (also inside outlierGuard, so 📉 lists them with everything else).
 */
export function sessionStatus(players, guard, dataDir) {
  const r = (v, d = 3) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  const withData = players.filter((p) => p.session);
  const measured = withData.filter((p) => p.session.measured);
  const xpFull = measured.filter((p) => p.session.xpKills >= SESSION_MIN.MIN_KILLS);
  const dist = {};
  for (const m of SESSION_METRICS) {
    const d = distribution(measured.map((p) => p.values[m.id]));
    dist[m.id] = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "n" ? v : r(v)]));
  }
  const evidence = (p) => ({
    slug: p.slug, name: p.name, hidden: !!p.hidden,
    sessions: p.session ? p.session.sessions : 0, kills: p.session ? p.session.kills : 0, minutes: p.session ? p.session.minutes : 0,
    source: p.session ? p.session.source : "", measured: !!(p.session && p.session.measured),
    apk: r(p.sessionFlag.apk), hs: r(p.sessionFlag.hs), hsSrc: p.sessionFlag.hsSrc, kd: r(p.sessionFlag.kd, 2), kdSrc: p.sessionFlag.kdSrc,
    flagged: !!p.sessionFlag.flagged, otherRed: classifyBins({ patterns: (p.patterns || []).filter((x) => x !== "session") }).red,
    values: p.session ? Object.fromEntries(SESSION_METRIC_IDS.map((id) => [id, r(p.session.values[id])])) : {},
  });
  // Reference: hidden list (confirmed cheaters) + top legit players, whether measured or not.
  const hiddenSlugs = players.filter((p) => p.hidden).map((p) => p.slug);
  const refSlugs = [...hiddenSlugs, ...SESSION_REFERENCE_LEGIT];
  const reference = refSlugs.map((s) => players.find((p) => p.slug === s)).filter(Boolean)
    .map((p) => ({ ...evidence(p), group: p.hidden ? "confirmed cheater" : "top legit" }));
  const outIds = new Set(SESSION_METRIC_IDS);
  const outliers = (guard.players || [])
    .map((g) => ({ ...g, metrics: g.metrics.filter((m) => outIds.has(m.id)) }))
    .filter((g) => g.metrics.length);
  return {
    checkedAt: new Date().toISOString(),
    min: { ...SESSION_MIN }, rule: { ...SESSION_RULE }, ruleText: sessionRuleText(),
    coverage: {
      players: players.length,
      withSessions: withData.length,
      measured: measured.length,
      sessions: withData.reduce((n, p) => n + p.session.sessions, 0),
      kills: withData.reduce((n, p) => n + p.session.kills, 0),
      xpPlayers: withData.filter((p) => p.session.xpSessions > 0).length,
      xpMeasured: xpFull.length,
      xpSessions: withData.reduce((n, p) => n + p.session.xpSessions, 0),
    },
    metrics: SESSION_METRICS.map((m) => ({ id: m.id, tier: m.tier, label: m.label, tip: m.tip })),
    distributions: dist,
    flagged: measured.filter((p) => p.sessionFlag.flagged).map(evidence),
    reference,
    outliers,
    outliersUnexplained: outliers.filter((g) => !g.explained).length,
  };
}

/**
 * status.json "bins" block (bins.mjs classifyBins; user rules t280u + t288u):
 * 🚩 = aim / vehicle / rampage; 📉 = 🌾 padding + † adjusted + 🧪 outliers.
 * Counts are players; "both" = in 🚩 and also a 📉 entry (cross-referenced).
 */
export function binCounts(players, guard) {
  const out = new Set((guard.players || []).map((g) => g.slug));
  const c = { red: 0, padding: 0, adjusted: 0, outlier: out.size, chartOnly: 0, both: 0, session: 0 };
  for (const p of players) {
    const b = classifyBins({ patterns: p.patterns || [], outlier: out.has(p.slug) });
    if (b.bin === "red") c.red += 1;
    if (b.red.includes("session")) c.session += 1;
    if (b.bin === "chart") c.chartOnly += 1;
    if (b.both) c.both += 1;
    if (b.chart.includes("padding")) c.padding += 1;
    if (b.chart.includes("adjusted")) c.adjusted += 1;
  }
  return c;
}

/**
 * status.json "hidden" block for build-log.html: every hide-list entry, with
 * the cached player it matched (or unmatched: not in the cache yet).
 */
export function hiddenSummary(dataDir, found) {
  let entries = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, "hidden.json"), "utf8"));
    entries = (j && j.players) || {};
  } catch {}
  const usedKeys = new Set(found.map((h) => h.key));
  const players = found.map((h) => ({ name: h.name, slug: h.slug, cid: h.cid, reason: h.reason, at: h.at, matched: true }));
  for (const [k, v] of Object.entries(entries)) {
    if (!usedKeys.has(k)) players.push({ name: k, slug: "", cid: "", reason: String((v && v.reason) || ""), at: String((v && v.at) || ""), matched: false });
  }
  return { count: players.length, players };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const { ranks: out, guard, hidden: hiddenInfo, bins, session } = buildRanksWithGuard(dataDir);
  fs.writeFileSync(path.join(dataDir, "ranks.json"), JSON.stringify(out) + "\n");
  console.log(`ranks.json: ${out.count} players (${hiddenInfo.count} on the 🙈 hide list)`);
  // 🧪 Outlier guard → data/status.json (build-log.html). Other status fields are kept.
  const stPath = path.join(dataDir, "status.json");
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stPath, "utf8")); } catch {}
  st.outlierGuard = guard;
  st.hidden = hiddenInfo;
  st.bins = { checkedAt: new Date().toISOString(), ...bins };
  st.sessionStats = session;
  fs.writeFileSync(stPath, JSON.stringify(st, null, 2) + "\n");
  for (const o of guard.items.filter((x) => !x.explained)) {
    console.log(`::warning::outlier guard: ${o.name} ${o.id}=${o.value} (bound ${o.bound}, z ${o.z})`);
  }
  console.log(`outlier guard: ${guard.playersUnexplained} unexplained / ${guard.playersExplained} explained players (${guard.items.length} metric hits)`);
}
