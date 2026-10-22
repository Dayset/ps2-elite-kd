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
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";
import { reviewFlags } from "../red-flags.mjs";
import { classifyBins } from "../bins.mjs";
import { markNote, statMark, confirmedPadderSlugs, isFarmListed, isNotFarm, farmListEntry, isPenalizedPadder, PADDER_PENALTY, PADDER_PENALTY_REF, setNotFarm, setFarmList, setReviewed, setRoomRule } from "../padding.mjs";
import { setVehicleCutReviewed } from "../vehicle-cut.mjs";
import { roomById } from "../rooms.mjs";
import { sprout, sampleEvents, farmAccount } from "../sprouts.mjs";
import { findOutliers, guardStatus, KNOWN_EXTREMES } from "../outlier-guard.mjs";
import { infantryTagCounts, INFANTRY_TAG, infantryShares } from "../infantry.mjs";
import { VEH_CUT } from "../vehicle-cut.mjs";
import { forensicsSummary, honuSessionUrl } from "../session-forensics.mjs";
import { hiddenList, isConfirmedCheater } from "../hidden.mjs";
import { cleanTimes } from "../flairs.mjs";
import { sessionMetrics, sessionFlag, sessionRuleText, distribution, SESSION_METRICS, SESSION_METRIC_IDS, SESSION_MIN, SESSION_RULE } from "../session-stats.mjs";

/** Full Honu XP detail for a slug (data/xp/<slug>.json; requested players only), or null. */
/** 💥 Burst sessions over the stored sessions of every cached player (no network). */
export function burstStatus(dataDir) {
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const players = [];
  const seen = new Set();
  const hidden = readHidden(dataDir);
  for (const e of index.players || []) {
    if (!e || !e.file || seen.has(e.file)) continue;
    seen.add(e.file);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
    const pl = (raw && (raw.player || raw)) || {};
    const slug = e.slug || path.basename(e.file, ".json");
    players.push({ slug, name: pl.display || e.name || slug, cid: pl.cid, assists: pl.assists, xp: readXp(dataDir, slug),
      hidden: !!hidden.match({ slug, name: pl.display || e.name, cid: pl.cid }) });
  }
  // Owner decisions: outlier-guard KNOWN_EXTREMES + reviewed.json "burst" entries (reviewed.json wins).
  let rv = null;
  try { rv = JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")); } catch { /* none */ }
  const b = burstSessions(players, { reviewed: { ...KNOWN_EXTREMES, ...burstReviewed(rv) } });
  // 🚨 rampage gate result per session (data/rampage.json, scripts/rampage-gate.mjs).
  let rp = null;
  try { rp = JSON.parse(fs.readFileSync(path.join(dataDir, "rampage.json"), "utf8")); } catch { /* not run yet */ }
  // Owner-cleared players never show a gate result in the UI (owner rule 2026-10-19).
  for (const i of b.items) { const s = rp && rp.sessions && rp.sessions[i.session]; if (s && s.match && !rampageCleared(rv, i.slug)) i.rampage = true; }
  return b;
}

/**
 * 🚨 Rampage gate status for build-log (data/rampage.json + hidden.json + reviewed.json; no network).
 * caught: matching sessions (one row per session) with evidence and how the player is hidden.
 * Owner rule 2026-10-19: players cleared in reviewed.json are left out entirely (their result stays
 * in data/rampage.json only): no row, no count, no "cleared but flagged" note.
 */
export function rampageStatus(dataDir) {
  let rp = null, rv = null, hj = null;
  try { rp = JSON.parse(fs.readFileSync(path.join(dataDir, "rampage.json"), "utf8")); } catch {}
  try { rv = JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")); } catch {}
  try { hj = JSON.parse(fs.readFileSync(path.join(dataDir, "hidden.json"), "utf8")); } catch {}
  const hidden = hiddenList(hj);
  const sessions = Object.entries((rp && rp.sessions) || {}).map(([id, s]) => ({ ...s, session: id }));
  const checked = sessions.filter((s) => !s.error);
  const pc = (a, b) => (b ? Math.round((100 * a) / b) : null);
  const row = (s) => {
    const h = hidden.match({ slug: s.slug, name: s.name, cid: s.cid });
    return { slug: s.slug, name: s.name, cid: s.cid, session: s.session, inf: s.inf, kills: s.kills, minutes: s.minutes, kpm: s.kpm, startMs: s.startMs,
      hsPct: pc(s.hs, s.inf), hipPct: pc(s.hip, s.inf), ads: s.ads, evidence: rampageEvidence(s),
      hiddenBy: !h ? null : String(h.reason || "").startsWith(RAMPAGE_REASON_PREFIX) ? "gate" : "owner" };
  };
  const caught = checked.filter((s) => s.match && !rampageCleared(rv, s.slug)).map(row).sort((a, b) => b.inf - a.inf);
  return { rule: rampageRuleText(), thresholds: RAMPAGE_RULE, checkedAt: (rp && rp.checkedAt) || null, checked: checked.length,
    errors: sessions.length - checked.length, pending: (rp && rp.pending) || 0,
    players: new Set(caught.map((c) => c.slug)).size, caught };
}

export function readXp(dataDir, slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "xp", `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
}


// Row format + rankRow live in ../rank-row.mjs (browser-safe: ranks.html
// recomputes a player's row from a fresher browser copy with the same code).
export { METRIC_COLS, RANK_COLS, bareName, rankRow } from "../rank-row.mjs";
import { METRIC_COLS, RANK_COLS, rankRow, bareName, slugKey } from "../rank-row.mjs";
import { assistGroups } from "../assist-groups.mjs";
import { burstSessions, burstReviewed } from "../burst-sessions.mjs";
import { RAMPAGE_RULE, RAMPAGE_REASON_PREFIX, rampageCleared, rampageEvidence, rampageRuleText } from "../rampage-gate.mjs";

/** data/reviewed.json → Set of slugs confirmed as stat padders (decision "padding"; missing file = none). */
export function readConfirmedPadders(dataDir) {
  try {
    return confirmedPadderSlugs(JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")));
  } catch {
    return new Set();
  }
}

/**
 * Fresh-account auto-hide (Dayset rule 2026-10-15): an account ≤7 days old
 * (Census account age, now − times.created) with exceptional stats is hidden
 * — not top, not bottom, into the hidden list — automatically, permanently,
 * with no manual review. Thresholds are the measured hidden-cheater signature
 * (adj ≥ 2200 is the site's Exceptional bar; ekpm ≤ 0.729 is the population
 * 25th percentile): 15/15 hidden players with data match, 16 false positives
 * in 10,497. Auto-entries carry their own reason (never "confirmed cheater"),
 * so they stay distinguishable from Dayset's manual confirmed-cheater hides.
 * The rule writes to hidden.json (CLI main only, before the build reads it);
 * buildRanks itself never writes. Once hidden, an account stays hidden even
 * after it ages past 7 days — no age-out, no review queue.
 */
export const FRESH_HOLD = Object.freeze({ MAX_AGE_DAYS: 7, MIN_ADJ: 2200, MAX_EKPM: 0.729 });
export const FRESH_HOLD_HIDDEN_REASON = "auto-hidden: fresh account (≤7d) with exceptional stats (adj ≥ 2200, ekpm ≤ 0.729) — no manual review";

/** True when a ranks row is a fresh account with exceptional stats (auto-hide target). */
export function isFreshHeld(row, nowSec = Date.now() / 1000) {
  if (!row) return false;
  const created = row[RANK_COLS.indexOf("created")];
  const adj = row[4 + METRIC_COLS.indexOf("adj")];
  const ekpm = row[4 + METRIC_COLS.indexOf("ekpm")];
  if (!(created > 0) || !Number.isFinite(adj) || !Number.isFinite(ekpm)) return false;
  const ageDays = (nowSec - created) / 86400;
  return ageDays >= 0 && ageDays <= FRESH_HOLD.MAX_AGE_DAYS && adj >= FRESH_HOLD.MIN_ADJ && ekpm <= FRESH_HOLD.MAX_EKPM;
}

/**
 * Append fresh + exceptional players to hidden.json (CLI main only, before
 * the build). Idempotent: skips players already on the list. Returns the
 * newly added entries. The file's existing ASCII-escaped style (non-ASCII as
 * \uXXXX) is preserved so the diff stays minimal.
 */
export function autoHideFreshExceptional(dataDir, { nowSec = Date.now() / 1000 } = {}) {
  const hiddenPath = path.join(dataDir, "hidden.json");
  let hiddenJson = {};
  try {
    hiddenJson = JSON.parse(fs.readFileSync(hiddenPath, "utf8"));
  } catch {}
  if (!hiddenJson || typeof hiddenJson !== "object") hiddenJson = {};
  const hidden = hiddenList(hiddenJson);
  const players = (hiddenJson.players && typeof hiddenJson.players === "object") ? hiddenJson.players : {};
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const added = [];
  const seen = new Set();
  for (const e of index.players || []) {
    const file = e && e.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    } catch {
      continue;
    }
    const slug = e.slug || path.basename(file, ".json");
    const pl = raw && (raw.player || raw);
    const name = (pl && pl.display) || e.name || slug;
    if (hidden.match({ slug, name, cid: pl && pl.cid })) continue;
    const row = rankRow(raw, { slug, savedAt: e.savedAt ?? raw.savedAt });
    if (!row || !isFreshHeld(row, nowSec)) continue;
    const key = bareName(name);
    if (!key || players[key]) continue;
    players[key] = { reason: FRESH_HOLD_HIDDEN_REASON, at: new Date(nowSec * 1000).toISOString().slice(0, 10) };
    added.push({ slug, name: key, cid: String((pl && pl.cid) || "") });
  }
  if (added.length) {
    hiddenJson.players = players;
    const text = JSON.stringify(hiddenJson, null, 2).replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    fs.writeFileSync(hiddenPath, text + "\n");
  }
  return added;
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
export function buildRanks(dataDir, { onPlayer = null, onHidden = null, onFarm = null, hidden = readHidden(dataDir), confirmed = readConfirmedPadders(dataDir) } = {}) {
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
    if (isFarmListed({ name: (pl && pl.display) || e.name || slug, cid: pl && pl.cid }) || isFarmListed({ name: slug })) {
      if (onFarm) onFarm({ slug, name: (pl && pl.display) || e.name || slug, cid: String((pl && pl.cid) || "") });
      continue;
    }
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
export function buildRanksWithGuard(dataDir, { known = KNOWN_EXTREMES } = {}) {
  const players = [];
  const hidden = readHidden(dataDir);
  const confirmed = readConfirmedPadders(dataDir);
  const hiddenFound = [];
  const forensics = readForensics(dataDir);
  const farmFound = [];
  const ranks = buildRanks(dataDir, {
    hidden,
    confirmed,
    onHidden(h) { hiddenFound.push(h); },
    onFarm(f) { farmFound.push(f); },
    onPlayer(raw, row, info) {
      const np = normalizePlayer(raw);
      const m = playerMetrics(np);
      const f = reviewFlags(m, { confirmed: confirmed.has(row[2]) }); // raw metrics: same 🚩 result as build-log.html
      const values = {};
      METRIC_COLS.forEach((k, i) => { values[k] = row[4 + i]; });
      // 🧪 Honu session metrics (assists pass + data/xp detail); only measured players count.
      const pl = raw.player || raw;
      const sm = sessionMetrics({ assists: pl.assists, xp: readXp(dataDir, row[2]) });
      const sf = sessionFlag(sm, { hsr: pl.hsr, kd: pl.global_kd });
      for (const id of SESSION_METRIC_IDS) values[id] = sm && sm.measured ? sm.values[id] : null;
      const patterns = sf.flagged ? [...f.patterns, "session"] : f.patterns.slice();
      // 🔎 session forensics (data/forensics.json, refresh pipeline): ⚡ / 🔥 → 🚩 "session-forensics".
      const fx = forensicsSummary(forensics.players[row[2]]);
      if (fx.flagged) patterns.push("session-forensics");
      // 🤖 likely farm account (same rule as build-log.html: a 🌱 that mostly feeds a few killers).
      const sp = sprout(m.raw || m, sampleEvents(np.rawRows || np.rows));
      const fa = sp.sprout && !isNotFarm({ name: np.display, cid: np.cid }) ? farmAccount(np.rawRows || np.rows, m.ownKpm) : null;
      // 🤝 Assists per kill (t382u: public now) — null below SESSION_MIN.MIN_KILLS session kills.
      if (!info || !info.hidden) row.push(sm && sm.measured && Number.isFinite(sm.values.s_apk) ? Math.round(sm.values.s_apk * 1000) / 1000 : null);
      // 🪖 Infantry: % of lifetime weapon-stat kills on foot (MAX counted as infantry) + MAX / vehicle % for hover; null until filled.
      if (!info || !info.hidden) { const sh = infantryShares(pl.infantry); row.push(sh ? sh.inf : null, sh ? sh.max : null, sh ? sh.veh : null); }
      // 🚜 vehicle cut on ⚔️ iVi (vehicle-cut.mjs, inside playerMetrics): cut % (1 decimal) for the iVi hover; null = no cut.
      const vcut = m.vehCut > 0 && !m.thin ? Math.round(m.vehCut * 1000) / 10 : null;
      if (!info || !info.hidden) row.push(vcut);
      players.push({ vehCut: vcut, vehCutVeh: vcut != null ? Math.round(m.vehCutVeh * 1000) / 10 : null, vehCutMax: vcut != null ? Math.round(m.vehCutMax * 1000) / 10 : null, vehShare: Number.isFinite(m.vehShare) ? m.vehShare : null, vehOnly: Number.isFinite(m.vehOnly) ? m.vehOnly : null, maxShare: Number.isFinite(m.maxShare) ? m.maxShare : null, adjsPreVeh: vcut != null ? m.adjsPreVeh : null, vehCutCleared: !!m.vehCutCleared, poop: !!m.poop, adjsBase: m.poop && !m.thin ? m.adjsBase : null, confirmedPadder: confirmed.has(row[2]), infTag: (pl.infantry && pl.infantry.v >= 2 && pl.infantry.tag) || null, slug: row[2], name: row[0], cid: String(np.cid || ""), farmAcct: !!(fa && fa.farm), flagged: f.flagged || sf.flagged || fx.flagged, patterns, values, session: sm, sessionFlag: sf, forensics: fx, row, hidden: !!(info && info.hidden), confirmedCheater: !!(info && info.confirmedCheater) });
    },
  });
  ranks.cols.push("apk"); // 🤝 trailing column (see onPlayer); not part of RANK_COLS / rankRow
  ranks.cols.push("inf", "infMax", "infVeh"); // 🪖 trailing columns (see onPlayer), % of lifetime kills
  ranks.cols.push("vcut"); // 🚜 vehicle cut % on adjs (adjs is already cut)
  const found = findOutliers(players, [...METRIC_COLS, ...SESSION_METRIC_IDS], { known });
  found.items.push(...forensicsGuardItems(players));
  const guard = guardStatus(found);
  return {
    ranks, guard, hidden: hiddenSummary(dataDir, hiddenFound), bins: binCounts(players, guard), session: sessionStatus(players, guard, dataDir),
    forensics: forensicsStatus(players, guard, forensics),
    review: reviewStatus(players, guard, forensics, farmFound),
    padderPenalty: padderPenaltyStatus(players, ranks),
    vehicleCut: vehicleCutStatus(players, ranks),
    assistGroups: assistGroups(players), // 🤝 groups stay build-log only (the 🤝 apk column itself is public since t382u)
  };
}

/**
 * status.json "padderPenalty" (build-log 💩, user-approved 2026-10-19): every
 * confirmed padder (reviewed.json "padding") with adjusted iVi and board rank
 * before / after the −10% penalty (padding.mjs padderPenalty, applied inside
 * playerMetrics, so ranks.json already carries the "after" numbers). Ranks =
 * position by ⚔️ adjusted iVi among ranked players with a value (thin samples
 * have none). "cleared" = owner override ("penalty": "cleared"): no 💩, no penalty.
 */
export function padderPenaltyStatus(players, ranks) {
  const ia = ranks.cols.indexOf("adjs"), is = ranks.cols.indexOf("slug");
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  const after = new Map(ranks.rows.filter((r) => fin(r[ia])).map((r) => [r[is], r[ia]]));
  const before = new Map(after);
  const pads = players.filter((p) => !p.hidden && (p.poop || p.confirmedPadder));
  for (const p of pads) if (p.poop && fin(p.adjsBase) && before.has(p.slug)) before.set(p.slug, p.adjsBase);
  const rankOf = (map) => { const o = [...map.entries()].sort((a, b) => b[1] - a[1]); return new Map(o.map(([s], i) => [s, i + 1])); };
  const rb = rankOf(before), ra = rankOf(after);
  const r1 = (v) => (fin(v) ? Math.round(v * 10) / 10 : null);
  const list = pads.map((p) => ({
    slug: p.slug, name: p.name, status: p.poop ? "penalized" : "cleared",
    before: r1(before.get(p.slug)), after: r1(after.get(p.slug)),
    rankBefore: rb.get(p.slug) || null, rankAfter: ra.get(p.slug) || null,
    fixedDrop: !!(p.poop && fin(p.adjsBase) && p.adjsBase <= 0),
  })).sort((a, b) => (a.rankBefore || 1e9) - (b.rankBefore || 1e9));
  return {
    checkedAt: new Date().toISOString(), ranked: after.size,
    penalty: PADDER_PENALTY, ref: PADDER_PENALTY_REF,
    rule: `Confirmed stat padders (data/reviewed.json "padding") get 💩 and −${PADDER_PENALTY * 100}% adjusted iVi, on top of the farm-kill removal and the * mark. A score at or below 0 gets a fixed −${Math.round(PADDER_PENALTY * PADDER_PENALTY_REF)} instead (10% of ${PADDER_PENALTY_REF}, the median positive iVi on 2026-10-19), so it always drops. Owner override: "penalty": "cleared" on the reviewed.json entry (or decision "cleared").`,
    penalized: list.filter((x) => x.status === "penalized").length, cleared: list.filter((x) => x.status === "cleared").length,
    players: list,
  };
}

/**
 * status.json "vehicleCut" (build-log 🚜, owner-approved 2026-10-19): players whose
 * ⚔️ adjusted iVi is cut by their vehicle-kill share (vehicle-cut.mjs). ranks.json
 * already carries the cut numbers; "before" = the same score without this cut
 * (the 💩 penalty stays in both). Ranks = position by adjusted iVi among ranked
 * players with a value. Lists the TOP_N highest-ranked cut players (before) plus
 * the owner-exempted ones (data/reviewed.json "vehicleCutCleared").
 */
const WATCH = new Set(["igorrrrrr", "renamedsoldier12345", "pikaqiuill", "loontiq", "zugie", "nebelhexe", "shlodog", "lilkavs", "kijax", "libo2"]);
export function vehicleCutStatus(players, ranks, { topN = 150 } = {}) {
  const ia = ranks.cols.indexOf("adjs"), is = ranks.cols.indexOf("slug");
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  const after = new Map(ranks.rows.filter((r) => fin(r[ia])).map((r) => [r[is], r[ia]]));
  const before = new Map(after);
  const live = players.filter((p) => !p.hidden);
  const cut = live.filter((p) => p.vehCut != null && fin(p.adjsPreVeh) && after.has(p.slug));
  for (const p of cut) before.set(p.slug, p.adjsPreVeh);
  const rankOf = (map) => { const o = [...map.entries()].sort((a, b) => b[1] - a[1]); return new Map(o.map(([s], i) => [s, i + 1])); };
  const rb = rankOf(before), ra = rankOf(after);
  const r1 = (v) => (fin(v) ? Math.round(v * 10) / 10 : null);
  const pc = (v) => (fin(v) ? Math.round(v * 1000) / 10 : null);
  const row = (p) => ({
    slug: p.slug, name: p.name, cid: p.cid, share: pc(p.vehShare), veh: pc(p.vehOnly), max: pc(p.maxShare), cutVeh: p.vehCutVeh, cutMax: p.vehCutMax, cut: p.vehCut,
    before: r1(before.get(p.slug)), after: r1(after.get(p.slug)), rankBefore: rb.get(p.slug) || null, rankAfter: ra.get(p.slug) || null,
  });
  const list = cut.map(row).sort((a, b) => (a.rankBefore || 1e9) - (b.rankBefore || 1e9));
  const buckets = { "≤5%": 0, "5–10%": 0, "10–25%": 0, "25–50%": 0, ">50%": 0 };
  for (const x of list) buckets[x.cut <= 5 ? "≤5%" : x.cut <= 10 ? "5–10%" : x.cut <= 25 ? "10–25%" : x.cut <= 50 ? "25–50%" : ">50%"]++;
  const parts = { vehicle: list.filter((x) => x.cutVeh > 0).length, max: list.filter((x) => x.cutMax > 0).length, both: list.filter((x) => x.cutVeh > 0 && x.cutMax > 0).length };
  const cleared = live.filter((p) => p.vehCutCleared).map((p) => ({ slug: p.slug, name: p.name, cid: p.cid, share: pc(p.vehShare), veh: pc(p.vehOnly), max: pc(p.maxShare) }));
  return {
    checkedAt: new Date().toISOString(), ranked: after.size, cut: list.length, buckets, parts, rule: VEH_CUT,
    withData: live.filter((p) => p.vehShare != null).length,
    players: list.slice(0, topN), cleared,
    watch: list.filter((x) => WATCH.has(x.slug)),
  };
}

/**
 * status.json "review": every player on a build-log review list (🚩, 📉 🌾/†/🧪,
 * 🔎, 🤖, 🙈) with slug / name / character id and the lists it is on, in lookup
 * priority order (REVIEW_LISTS). Built from our own data only; the optional
 * PS2 Radar step (scripts/radar-lookup.mjs) and build-log's Radar links read it.
 */
/** Review lists in priority order (unconfirmed leads first, known cheaters last). Our own; never depends on PS2 Radar. */
export const REVIEW_LISTS = Object.freeze(["red", "outlier", "adjusted", "forensics", "farm", "padding", "hidden"]);

export function reviewStatus(players, guard, store, farmFound = []) {
  const out = new Set((guard.players || []).map((g) => g.slug));
  const by = new Map();
  const add = (p, list) => {
    if (!p || !p.slug) return;
    let e = by.get(p.slug);
    if (!e) by.set(p.slug, (e = { slug: p.slug, name: p.name || p.slug, cid: p.cid || "", lists: [] }));
    if (!e.cid && p.cid) e.cid = p.cid;
    if (!e.lists.includes(list)) e.lists.push(list);
  };
  for (const p of players) {
    const b = classifyBins({ patterns: p.patterns || [], outlier: out.has(p.slug) });
    if (b.red.length) add(p, "red");
    if (out.has(p.slug)) add(p, "outlier");
    if (b.chart.includes("adjusted")) add(p, "adjusted");
    if (b.chart.includes("padding")) add(p, "padding");
    if (store && store.players && store.players[p.slug]) add(p, "forensics");
    if (p.farmAcct) add(p, "farm");
    if (p.hidden) add(p, "hidden");
  }
  for (const f of farmFound) add(f, "farm");
  const rank = (e) => Math.min(...e.lists.map((l) => REVIEW_LISTS.indexOf(l)));
  const list = [...by.values()].map((e) => ({ ...e, lists: e.lists.sort((a, b) => REVIEW_LISTS.indexOf(a) - REVIEW_LISTS.indexOf(b)) }));
  list.sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug));
  return { checkedAt: new Date().toISOString(), count: list.length, players: list };
}

/**
 * status.json "sessionStats" block (build-log.html 🧪 Session stats, never public):
 * coverage, per-metric distributions over measured players, 🚩 "session" hits
 * with evidence, the confirmed-cheater reference table and the session-metric
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
  // Reference: hidden list (confirmed cheaters), whether measured or not.
  const hiddenSlugs = players.filter((p) => p.hidden).map((p) => p.slug);
  const refSlugs = hiddenSlugs;
  const reference = refSlugs.map((s) => players.find((p) => p.slug === s)).filter(Boolean)
    .map((p) => ({ ...evidence(p), group: "confirmed cheater" }));
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
  const c = { red: 0, padding: 0, adjusted: 0, outlier: out.size, chartOnly: 0, both: 0, session: 0, forensics: 0 };
  for (const p of players) {
    const b = classifyBins({ patterns: p.patterns || [], outlier: out.has(p.slug) });
    if (b.bin === "red") c.red += 1;
    if (b.red.includes("session")) c.session += 1;
    if (b.red.includes("session-forensics")) c.forensics += 1;
    if (b.bin === "chart") c.chartOnly += 1;
    if (b.both) c.both += 1;
    if (b.chart.includes("padding")) c.padding += 1;
    if (b.chart.includes("adjusted")) c.adjusted += 1;
  }
  return c;
}

/** data/forensics.json (🔎 session forensics store, refresh pipeline); missing = empty. */
export function readForensics(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, "forensics.json"), "utf8"));
    return j && j.players ? j : { players: {} };
  } catch {
    return { players: {} };
  }
}

/** 🔎 oddities (not ⚡ / 🔥) → 📉 outlier-guard rows "forensics" (explained when the player is in 🚩 or reviewed). */
export function forensicsGuardItems(players) {
  const items = [];
  for (const p of players) {
    const fx = p.forensics;
    if (!fx || !fx.odd || !fx.worst || p.confirmedCheater) continue;
    const red = classifyBins({ patterns: p.patterns || [] }).red;
    const reason = red.length ? "Also in 🚩 red flags (" + red.join(", ") + "), listed there" : KNOWN_EXTREMES[p.slug] || "";
    items.push({
      slug: p.slug, name: p.name, id: "forensics", value: fx.worst.peak60s, red,
      bound: null, z: null, side: "high", explained: !!reason, reason,
      note: (fx.worst.oddities || []).join("; ") + " (session " + fx.worst.sessionId + ")",
    });
  }
  return items;
}

/** Candidate priority for the refresh pipeline's 🔎 phase (status.json forensics.candidates). */
export const FORENSICS_CANDIDATES = Object.freeze({ MAX: 200, TOP_IVI: 30, NEW_DAYS: 90, NEW_OWN_KPM: 1.5, SESSION_MAX_KPM: 3 });

/**
 * status.json "forensics" block: candidates (in priority order) + per-player
 * summary for build-log.html 🔎 Session forensics. Priority: 🚩 red flags,
 * 📉 outliers, 👶 new accounts (< 90 days) with own KPM ≥ 1.5 or top-10% iVi,
 * session KPM peak ≥ 3, top 30 iVi, then hide-list cheaters (references).
 */
export function forensicsStatus(players, guard, store, rule = FORENSICS_CANDIDATES, now = Date.now()) {
  const col = (name) => RANK_COLS.indexOf(name);
  const iAdjs = col("adjs"), iCreated = col("created"), iOwn = col("ownKpm");
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  const outl = new Set((guard.players || []).map((g) => g.slug));
  const adjs = players.map((p) => p.row && p.row[iAdjs]).filter(fin).sort((a, b) => b - a);
  const p90 = adjs.length ? adjs[Math.floor(adjs.length * 0.1)] : Infinity;
  const top = new Set(players.filter((p) => !p.hidden && p.row && fin(p.row[iAdjs])).sort((a, b) => b.row[iAdjs] - a.row[iAdjs]).slice(0, rule.TOP_IVI).map((p) => p.slug));
  const tiers = [[], [], [], [], [], []];
  for (const p of players) {
    const r = p.row || [];
    const created = +r[iCreated] || 0;
    const isNew = created > 0 && now / 1000 - created < rule.NEW_DAYS * 86400;
    if (!p.hidden && classifyBins({ patterns: p.patterns || [] }).red.length) tiers[0].push(p);
    else if (outl.has(p.slug)) tiers[1].push(p);
    else if (isNew && ((fin(r[iOwn]) && r[iOwn] >= rule.NEW_OWN_KPM) || (fin(r[iAdjs]) && r[iAdjs] >= p90))) tiers[2].push(p);
    else if (fin(p.values && p.values.s_maxKpm) && p.values.s_maxKpm >= rule.SESSION_MAX_KPM) tiers[3].push(p);
    else if (top.has(p.slug)) tiers[4].push(p);
    else if (p.confirmedCheater) tiers[5].push(p);
  }
  const candidates = tiers.flat().slice(0, rule.MAX).map((p) => p.slug);
  const rows = [];
  for (const p of players) {
    const e = store.players[p.slug];
    if (!e) continue;
    const fx = p.forensics || forensicsSummary(e);
    const w = fx.worst;
    rows.push({
      slug: p.slug, name: p.name, hidden: !!p.hidden, confirmedCheater: !!p.confirmedCheater,
      flagged: fx.flagged, odd: fx.odd, analyzed: fx.analyzed, checkedAt: e.checkedAt || null,
      worst: w ? {
        sessionId: w.sessionId, url: honuSessionUrl(w.sessionId), start: w.start, kills: w.kills, deaths: w.deaths, kd: w.kd,
        activeMin: w.activeMin, activeKpm: w.activeKpm, max1s: w.max1s, max5s: w.max5s, peak60s: w.peak60s, max5min: w.max5min,
        secs5plus: w.secs5plus, zeroGapShare: w.zeroGapShare, medianGap: w.medianGap, hs: w.hs, vehicleKillShare: w.vehicleKillShare,
        weapons: (w.weapons || []).slice(0, 3), victims: w.victims, account: w.account, reasons: w.reasons || [], oddities: w.oddities || [],
      } : null,
    });
  }
  rows.sort((a, b) => (b.flagged - a.flagged) || (b.odd - a.odd) || ((b.worst && b.worst.kills) || 0) - ((a.worst && a.worst.kills) || 0));
  return {
    checkedAt: new Date().toISOString(),
    candidates,
    analyzed: rows.length,
    flagged: rows.filter((r) => r.flagged).length,
    review: rows.filter((r) => r.odd).length,
    players: rows,
  };
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

/**
 * status.json "infantry" block (build-log only, collected silently): tag counts
 * of the per-player infantry/vehicle split (infantry.mjs), filled in as players refresh.
 */
export function infantryStatus(dataDir) {
  const dir = path.join(dataDir, "players");
  const list = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      list.push({ infantry: (p && p.player && p.player.infantry) || null });
    } catch {}
  }
  // 🪖 v2 summaries (infShare / MAX split, vehicle kills no longer doubled) vs older v1 / none = pending backfill.
  const v2 = list.filter((p) => p.infantry && p.infantry.v >= 2);
  return { checkedAt: new Date().toISOString(), players: list.length, counts: infantryTagCounts(v2), v2: v2.length, pending: list.length - v2.length, rule: INFANTRY_TAG };
}

/**
 * data/names.json: the slim name list the main page needs at startup (2026-10-19).
 * index.json is ~3.4 MB (≈490 KB gzipped) because every entry repeats file,
 * slug, aliases, fmt, top and last; the page only needs the name (slug and
 * file follow from it: players/<slugKey(name)>.json) and savedAt. ≈150 KB gzipped.
 * The page falls back to index.json when this file is missing or older.
 */
export function buildNames(index, { withFile = false } = {}) {
  const players = [];
  const seen = new Set();
  for (const e of (index && index.players) || []) {
    if (!e || !e.name || !e.file) continue;
    if (withFile) {
      // PlayStation room (#55): files are keyed by server + character id, so each
      // row carries its file and slug: [name, savedAt, file, slug].
      const slug = e.slug || slugKey(e.name);
      if (!slug || seen.has(slug) || !/^players\/(us|eu)-\d{5,25}\.json$/.test(e.file)) continue;
      seen.add(slug);
      players.push([e.name, +e.savedAt || 0, e.file, slug]);
      continue;
    }
    const slug = slugKey(e.name);
    if (!slug || seen.has(slug) || e.file !== `players/${slug}.json`) continue; // anything unusual stays in index.json only
    seen.add(slug);
    players.push([e.name, +e.savedAt || 0]);
  }
  return { v: 1, updatedAt: (index && index.updatedAt) || null, count: players.length, players };
}

/**
 * data/ranks-lite.json: the few ranks columns the main page needs before the
 * Rankings section loads (2026-10-19): 🎲 (name, slug, ⚔️ iVi) and the ✨ Stats
 * percentiles (⚡ Const, 🤝 Assists, 🪖 Infantry). ≈400 KB gzipped instead of
 * ≈1.7 MB; the full ranks.json is only fetched by the Rankings section.
 * "ivi" rides along for the 🔀 Diff column's theory percentile pool
 * (owner 2026-10-21; public since t487u); consumers look columns up by name, so appending is safe.
 * "inflation" rides along for 🪳 Zerg (owner 2026-10-21, trait-scores.mjs): the
 * lower of the 🎈 Inflation and 🤝 Assists percentiles needs the Inflation pool.
 */
export const LITE_COLS = ["name", "slug", "adjs", "cons", "apk", "inf", "infMax", "infVeh", "ivi", "inflation"];
const LITE_DIGITS = { adjs: 1, cons: 4, apk: 3, inf: 1, infMax: 1, infVeh: 1, ivi: 1, inflation: 2 };
export function buildRanksLite(ranks) {
  const ix = LITE_COLS.map((k) => (ranks && Array.isArray(ranks.cols) ? ranks.cols.indexOf(k) : -1));
  if (ix.some((i) => i < 0) || !Array.isArray(ranks.rows)) return null;
  const rows = ranks.rows.map((r) => ix.map((i, j) => {
    const v = r[i];
    const d = LITE_DIGITS[LITE_COLS[j]];
    return d != null && typeof v === "number" && Number.isFinite(v) ? +v.toFixed(d) : v;
  }));
  return { v: 1, updatedAt: ranks.updatedAt || null, count: rows.length, cols: LITE_COLS, rows };
}

/**
 * PlayStation room (#55): the review lists padding.mjs / vehicle-cut.mjs load at
 * import are PC's (data/). A PS build replaces them with the PS room's own files
 * (data-ps/*.json; missing = empty), so no PC decision ever touches a PS player
 * that happens to share a name or a character id.
 */
export function usePsReviewLists(dataDir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return null; } };
  setNotFarm(read("not-farm.json"));
  setFarmList(read("farm.json"));
  setReviewed(read("reviewed.json"));
  setVehicleCutReviewed(read("reviewed.json"));
  setRoomRule("ps"); // PS scrim rule (padding.mjs PS_SCRIM): one-sided scrims out, long scrims capped
}

/** PS ranks get a trailing "srv" column ("us" Genudine / "eu" Ceres), looked up by slug in the PS index. */
export function addServerColumn(ranks, index) {
  const bySlug = new Map(((index && index.players) || []).filter((p) => p && p.slug && p.key).map((p) => [p.slug, String(p.key).split("-")[0]]));
  ranks.cols.push("srv");
  for (const r of ranks.rows) r.push(bySlug.get(r[2]) || null);
  return ranks;
}

/**
 * PlayStation room auto-hide (owner 2026-10-22: "crazy outliers are not welcome").
 * An account is hidden (PS hide list, by character id) when its lifetime K/D is
 * >= 50 AND >= 90% of its opponent-sample kills are on farm accounts (10,000+
 * kills on one opponent who killed back <= 2%, whatever that opponent's KPM, so
 * alt rings that farm each other are caught). Writes hidden.json; returns adds.
 */
export const PS_FARM_HIDE = Object.freeze({ MIN_KD: 50, MIN_FARM_SHARE: 0.9, MIN_KILLS: 10000, MAX_BACK: 0.02 });
export function psFarmRingHit(pl, rule = PS_FARM_HIDE) {
  if (!pl || !(+pl.global_kd >= rule.MIN_KD)) return null;
  const rows = Array.isArray(pl.rows) ? pl.rows : [];
  const total = rows.reduce((a, r) => a + (+r.kills || 0), 0);
  const farm = rows.filter((r) => +r.kills >= rule.MIN_KILLS && +r.deaths <= rule.MAX_BACK * +r.kills);
  const fk = farm.reduce((a, r) => a + (+r.kills || 0), 0);
  if (!total || fk / total < rule.MIN_FARM_SHARE) return null;
  return { share: fk / total, kd: +pl.global_kd, on: farm.map((r) => `${r.name} ${r.kills}/${r.deaths}`) };
}
export function autoHidePsFarmRing(dataDir, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const hiddenPath = path.join(dataDir, "hidden.json");
  let hj; try { hj = JSON.parse(fs.readFileSync(hiddenPath, "utf8")); } catch { hj = { players: {} }; }
  if (!hj.players) hj.players = {};
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const added = [];
  for (const e of index.players || []) {
    let raw; try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
    const pl = raw && raw.player;
    const cid = pl && String(pl.cid || "");
    if (!/^\d{5,25}$/.test(cid) || hj.players[cid]) continue;
    const hit = psFarmRingHit(pl);
    if (!hit) continue;
    hj.players[cid] = { reason: `auto-hidden: farm ring — lifetime K/D ${Math.round(hit.kd)}, ${Math.round(hit.share * 100)}% of sample kills on farm accounts (${hit.on.slice(0, 3).join(", ")}). ${pl.display || e.name}`, at: today };
    added.push({ name: pl.display || e.name, cid });
  }
  if (added.length) fs.writeFileSync(hiddenPath, JSON.stringify(hj, null, 2) + "\n");
  return added;
}

/** "--room ps" → "ps"; anything else → "pc" (default: data/, unchanged). */
export function roomArg(argv) {
  const i = argv.indexOf("--room");
  return i >= 0 && argv[i + 1] === "ps" ? "ps" : "pc";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const room = roomArg(process.argv);
  const dataDir = path.join(root, roomById(room).dataDir);
  if (room === "ps") {
    usePsReviewLists(dataDir);
    console.log(`PlayStation room: building ${roomById(room).dataDir}/ only (PS review lists, farm-ring auto-hide).`);
  }
  // Fresh-account auto-hide runs first so this build already excludes the
  // newly hidden players via the normal hidden path. PC only: its thresholds
  // were measured on the PC population (PS pools are never mixed with PC).
  const autoHidden = room === "pc" ? autoHideFreshExceptional(dataDir) : autoHidePsFarmRing(dataDir);
  if (autoHidden.length) console.log(`auto-hide: ${autoHidden.length} fresh exceptional account(s) added to hidden.json: ${autoHidden.map((a) => a.name).join(", ")}`);
  const { ranks: out, guard, hidden: hiddenInfo, bins, session, forensics: forensicsInfo, review, assistGroups: assistInfo, padderPenalty: padderInfo, vehicleCut: vehCutInfo } = buildRanksWithGuard(dataDir, room === "ps" ? { known: {} } : undefined);
  if (room === "ps") addServerColumn(out, JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")));
  fs.writeFileSync(path.join(dataDir, "ranks.json"), JSON.stringify(out) + "\n");
  try {
    const names = buildNames(JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")), { withFile: room === "ps" });
    fs.writeFileSync(path.join(dataDir, "names.json"), JSON.stringify(names) + "\n");
    console.log(`names.json: ${names.count} names`);
  } catch (e) { console.log(`names.json not written: ${e.message}`); }
  const lite = buildRanksLite(out);
  if (lite) fs.writeFileSync(path.join(dataDir, "ranks-lite.json"), JSON.stringify(lite) + "\n");
  console.log(`ranks.json: ${out.count} players (${hiddenInfo.count} on the 🙈 hide list)`);
  // 🧪 Outlier guard → data/status.json (build-log.html). Other status fields are kept.
  const stPath = path.join(dataDir, "status.json");
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stPath, "utf8")); } catch {}
  st.outlierGuard = guard;
  st.hidden = hiddenInfo;
  st.bins = { checkedAt: new Date().toISOString(), ...bins };
  st.sessionStats = session;
  st.forensics = forensicsInfo;
  st.review = review;
  st.assistGroups = assistInfo;
  st.padderPenalty = padderInfo; // 💩 build-log list (ranks.json already has the penalized numbers)
  st.vehicleCut = vehCutInfo; // 🚜 build-log list (ranks.json already has the cut numbers)
  console.log(`vehicle cut: ${vehCutInfo.cut} of ${vehCutInfo.withData} players with infantry data cut, ${vehCutInfo.cleared.length} exempted by the owner`);
  console.log(`padder penalty: ${padderInfo.penalized} penalized, ${padderInfo.cleared} cleared by the owner`);
  st.infantry = infantryStatus(dataDir);
  st.burst = burstStatus(dataDir); // 💥 review signal only: never changes ranks.json
  st.rampage = rampageStatus(dataDir); // 🚨 auto confirmed cheaters (hidden.json synced by scripts/rampage-gate.mjs)
  console.log(`rampage gate: ${st.rampage.caught.length} matching session(s), ${st.rampage.players} player(s), ${st.rampage.checked} checked, ${st.rampage.pending} pending`);
  console.log(`burst sessions: ${st.burst.sessions} session(s), ${st.burst.flaggedPlayers} player(s) to review, ${st.burst.clearedPlayers} cleared`);
  fs.writeFileSync(stPath, JSON.stringify(st, null, 2) + "\n");
  for (const o of guard.items.filter((x) => !x.explained)) {
    console.log(`::warning::outlier guard: ${o.name} ${o.id}=${o.value} (bound ${o.bound}, z ${o.z})`);
  }
  console.log(`outlier guard: ${guard.playersUnexplained} unexplained / ${guard.playersExplained} explained players (${guard.items.length} metric hits)`);
}
