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
import { setPsKpmRatio } from "../ps-baseline.mjs";
import { markNote, statMark, confirmedPadderSlugs, isFarmListed, isNotFarm, farmListEntry, isPenalizedPadder, PADDER_PENALTY, PADDER_PENALTY_REF, setNotFarm, setFarmList, setReviewed, setRoomRule } from "../padding.mjs";
import { setVehicleCutReviewed } from "../vehicle-cut.mjs";
import { roomById } from "../rooms.mjs";
import { sprout, sampleEvents, farmAccount } from "../sprouts.mjs";
import { findOutliers, guardStatus, KNOWN_EXTREMES, isEstablished, carveOutReason } from "../outlier-guard.mjs";
import { infantryTagCounts, INFANTRY_TAG, infantryShares } from "../infantry.mjs";
import { VEH_CUT } from "../vehicle-cut.mjs";
import { nbdCuts, newbieFactor, newbieCleared, newPlayerHours, NBD_BAND, NBD_NEW_Q } from "../newbie-diff.mjs";
import { heavySupportSlugs, familyIndex } from "../heavy-support.mjs";
import { hutHsCleared, hutCuts, hutParts, hutCleared, deathsPerMin, HUT_ACT_MULT, HUT_ACT_MULT_TOP, HUT_EXP_BAND, playMinutes, HUT_DPM_BAND, HUT_INF_BAND, HUT_ACC_BAND, HUT_MARK_MIN } from "../hut.mjs";
import { traitPools, aimGap, zergScore } from "../trait-scores.mjs";
import { zergChargedAdjs, ZERG_CHARGE, zergFresh, dayOf } from "../zerg-charge.mjs";
import { crowdSample, crowdPercentiles, zergEstimate, zergCleared, CROWD_MIN_DEATHS, CROWD_MIN_MIN, REV_SOFT_BAND, REV_CONFIRM, ZEST_MIN, HL_MIN, HL_W } from "../zerg-revive.mjs";
import { tracXpIds, tracSample, tractorCuts, tractorRule, tractorCleared, TRAC_INF_Q, TRAC_XP_Q, TRAC_FALLBACK_Q, TRAC_XP_MIN } from "../tractor.mjs";
import { vehDiffStart, vehDiffFactor, vehDiffCleared } from "../diff-vehicle.mjs";
import { percentileOf } from "../dist.mjs";
import { forensicsSummary, honuSessionUrl } from "../session-forensics.mjs";
import { hiddenList, isConfirmedCheater } from "../hidden.mjs";
import { cleanTimes, flairsFor } from "../flairs.mjs";
import { sessionMetrics, sessionFlag, sessionRuleText, distribution, SESSION_METRICS, SESSION_METRIC_IDS, SESSION_MIN, SESSION_RULE, ASSIST_GAP } from "../session-stats.mjs";

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
    players.push({ slug, name: pl.display || e.name || slug, cid: pl.cid, kd: pl.global_kd, assists: pl.assists, xp: readXp(dataDir, slug),
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
import { removedList } from "../opt-out.mjs";
import { burstSessions, burstReviewed, storedSessions } from "../burst-sessions.mjs";
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
  let reviewed = null; // owner "cleared" decision in reviewed.json skips the player (t640, same as the marathon rule)
  try { reviewed = JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")); } catch {}
  const clearedSlugs = new Set(Object.entries((reviewed && reviewed.players) || {}).filter(([, v]) => v && v.decision === "cleared").map(([k]) => k));
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
    if (clearedSlugs.has(slug) || hidden.match({ slug, name, cid: pl && pl.cid })) continue;
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

/**
 * Marathon-rampage auto-hide (Dayset rule 2026-10-22): one stored session
 * (data/forensics.json, analyzed once by session forensics) with 100+ kills
 * at K/D ≥ 25 and ≥ 50% headshots is a cheater session — it needs no human
 * review, whatever the account's age or history (a degenerate account that
 * suddenly enables cheats posts exactly this; the fresh-account rule above
 * cannot see those). Session-level, not account-level. Measured on the
 * stored corpus 2026-10-22: 15/15 matches are the already-hidden confirmed
 * cheaters (K/D 25.7–189); the best legit control sessions reach K/D 14
 * (Simplenubb) and 8.3 (Zyr0sNCx), so the bar sits ~2x above them. The
 * headshot leg is load-bearing: a pure-K/D bar false-fires on A2G vehicle
 * farmers (179 kills / 1 death at 0% headshots is degenerate, not aimbot).
 * Auto-entries carry their own reason (never "confirmed cheater"), so they
 * stay distinguishable from Dayset's manual hides. Owner override: a
 * "cleared" decision in data/reviewed.json skips the player. CLI main only,
 * before the build; reads the previous run's forensics.json, so a new crazy
 * session is hidden from the build after its analysis run.
 */
export const MARATHON_HOLD = Object.freeze({ MIN_KILLS: 100, MIN_KD: 25, MIN_HS: 0.5 });

/** The worst (highest K/D) marathon-rampage session in a forensics sessions map, or null. */
export function marathonSession(sessions) {
  let worst = null;
  for (const [id, s] of Object.entries(sessions || {})) {
    if (!s) continue;
    const kills = s.kills || 0;
    const deaths = s.deaths || 0;
    const kd = Number.isFinite(s.kd) ? s.kd : kills / Math.max(deaths, 1);
    const hs = s.hs;
    if (kills < MARATHON_HOLD.MIN_KILLS || kd < MARATHON_HOLD.MIN_KD || !Number.isFinite(hs) || hs < MARATHON_HOLD.MIN_HS) continue;
    if (!worst || kd > worst.kd) worst = { id, kills, deaths, kd, hs };
  }
  return worst;
}

/**
 * Append marathon-rampage players to hidden.json (CLI main only, before the
 * build). Idempotent: skips players already on the list and players the
 * owner cleared in reviewed.json. Returns the newly added entries. The
 * file's ASCII-escaped style is preserved, same as the fresh-account rule.
 */
export function autoHideMarathonRampage(dataDir, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const hiddenPath = path.join(dataDir, "hidden.json");
  let hiddenJson = {};
  try {
    hiddenJson = JSON.parse(fs.readFileSync(hiddenPath, "utf8"));
  } catch {}
  if (!hiddenJson || typeof hiddenJson !== "object") hiddenJson = {};
  const hidden = hiddenList(hiddenJson);
  const players = (hiddenJson.players && typeof hiddenJson.players === "object") ? hiddenJson.players : {};
  let forensics = null;
  try {
    forensics = JSON.parse(fs.readFileSync(path.join(dataDir, "forensics.json"), "utf8"));
  } catch {}
  if (!forensics || !forensics.players) return [];
  let reviewed = null;
  try {
    reviewed = JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8"));
  } catch {}
  const cleared = new Set(Object.entries((reviewed && reviewed.players) || {}).filter(([, v]) => v && v.decision === "cleared").map(([k]) => k));
  const added = [];
  for (const [slug, p] of Object.entries(forensics.players)) {
    if (!p || cleared.has(slug)) continue;
    const name = p.name || slug;
    if (hidden.match({ slug, name, cid: p.cid })) continue;
    const worst = marathonSession(p.sessions);
    if (!worst) continue;
    const key = bareName(name);
    if (!key || players[key]) continue;
    const reason = "auto-hidden: marathon rampage session " + worst.id + " (" + worst.kills + " kills / " + worst.deaths + " deaths, K/D " + (Math.round(worst.kd * 10) / 10) + ", " + Math.round(worst.hs * 100) + "% headshots) — no manual review";
    players[key] = { reason, at: today };
    added.push({ slug, name: key, cid: String(p.cid || ""), session: worst.id });
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
  const keyOf = new Map(); // row → PS room key (us-<cid> / eu-<cid>)
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
      if (e.key) keyOf.set(row, String(e.key));
      rows.push(row);
      if (onPlayer) onPlayer(raw, row, { hidden: false });
    }
  }
  uniqueQueries(rows, keyOf);
  return { updatedAt: new Date().toISOString(), count: rows.length, cols: RANK_COLS.slice(), rows };
}

/**
 * PlayStation room (#55): the same name can be two characters, one per server
 * (e.g. Furkancimen3NS0 on Genudine and on Ceres). The table picks rows by
 * query, so a shared bare-name query ticked both. Namesakes get their server
 * key (us-<cid> / eu-<cid>) as query, which the page opens by key. PC rows have
 * no key and never change.
 */
export function uniqueQueries(rows, keyOf = new Map()) {
  const lc = (r) => String(r[1]).toLowerCase();
  const n = new Map();
  for (const r of rows) n.set(lc(r), (n.get(lc(r)) || 0) + 1);
  for (const r of rows) {
    if (n.get(lc(r)) > 1 && keyOf.get(r)) r[1] = keyOf.get(r);
  }
  // Anything still shared (PC has no server keys; owner 2026-10-22: "never again"):
  // keep the newest save, drop the rest, and say so. One tick = one player, always.
  const best = new Map();
  for (const r of rows) {
    const k = lc(r), b = best.get(k);
    if (!b || (+r[3] || 0) > (+b[3] || 0)) best.set(k, r);
  }
  const dropped = rows.filter((r) => best.get(lc(r)) !== r);
  for (const r of dropped) console.log(`::warning::ranks: ${r[0]} (${r[2]}) shares its pick name with ${best.get(lc(r))[2]}; kept the newest save only`);
  if (dropped.length) {
    const keep = new Set(best.values());
    for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(rows[i])) rows.splice(i, 1);
  }
  return rows;
}

/** Ranks + 🧪 outlier guard over the same shown values (one pass over the cache) + 🙈 hidden summary. */
export function buildRanksWithGuard(dataDir, { known = KNOWN_EXTREMES, zergCharge: zergChargeOn = true } = {}) {
  const players = [];
  const hidden = readHidden(dataDir);
  const confirmed = readConfirmedPadders(dataDir);
  const hiddenFound = [];
  const revShare = new Map(); // 🪳 revive check: slug → { share, revived, deaths, kills } (data/xp detail)
  const tracS = new Map(); // 🚜 name mark: slug → { rep, vk } per minute (data/xp, 2+ h; owner t622u)
  const tracIds = readTracIds(dataDir);
  const playMin = new Map(); // 🛖 experience: estimated lifetime play minutes by slug (owner t508u)
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
      playMin.set(row[2], playMinutes(pl.infantry && pl.infantry.kills, pl.global_kpm));
      const xpd = readXp(dataDir, row[2]);
      const sm = sessionMetrics({ assists: pl.assists, xp: xpd });
      const rs = crowdSample(xpd); // 🪳 crowd check (zerg-revive.mjs): null below the sample minimum
      if (rs) revShare.set(row[2], rs);
      const ts = tracSample(xpd, tracIds); // 🚜 XP confirmation sample (null under 2 h)
      if (ts) tracS.set(row[2], ts);
      const sf = sessionFlag(sm, { hsr: pl.hsr, kd: pl.global_kd });
      // 🛡️ Established-player carve-out (owner 2026-10-30): established players are
      // never listed by the outlier guard (outlier-guard.mjs explains them).
      const tt = pl.times || {};
      const spanDays = Number.isFinite(tt.created) && Number.isFinite(tt.last) ? (tt.last - tt.created) / 86400 : null;
      const established = isEstablished({ spanDays, ekpm: values.ekpm, sessions: Object.keys(storedSessions(pl.assists, xpd)).length });
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
      // 🪳⚔️ freshness (#84): day of the newest counted Honu session; stale → ⚔️ iVi not evened out.
      if (!info || !info.hidden) row.push(dayOf(pl.assists && pl.assists.last));
      // 🪖 Infantry: % of lifetime weapon-stat kills on foot (MAX counted as infantry) + MAX / vehicle % for hover; null until filled.
      if (!info || !info.hidden) { const sh = infantryShares(pl.infantry); row.push(sh ? sh.inf : null, sh ? sh.max : null, sh ? sh.veh : null); }
      // 🚜 vehicle cut on ⚔️ iVi (vehicle-cut.mjs, inside playerMetrics): cut % (1 decimal) for the iVi hover; null = no cut.
      const vcut = m.vehCut > 0 && !m.thin ? Math.round(m.vehCut * 1000) / 10 : null;
      if (!info || !info.hidden) row.push(vcut);
      players.push({ vehCut: vcut, vehCutVeh: vcut != null ? Math.round(m.vehCutVeh * 1000) / 10 : null, vehCutMax: vcut != null ? Math.round(m.vehCutMax * 1000) / 10 : null, vehShare: Number.isFinite(m.vehShare) ? m.vehShare : null, vehOnly: Number.isFinite(m.vehOnly) ? m.vehOnly : null, maxShare: Number.isFinite(m.maxShare) ? m.maxShare : null, adjsPreVeh: vcut != null ? m.adjsPreVeh : null, vehCutCleared: !!m.vehCutCleared, poop: !!m.poop, adjsBase: m.poop && !m.thin ? m.adjsBase : null, confirmedPadder: confirmed.has(row[2]), infTag: (pl.infantry && pl.infantry.v >= 2 && pl.infantry.tag) || null, slug: row[2], name: row[0], cid: String(np.cid || ""), farmAcct: !!(fa && fa.farm), flagged: f.flagged || sf.flagged || fx.flagged, patterns, values, session: sm, sessionFlag: sf, forensics: fx, row, hidden: !!(info && info.hidden), confirmedCheater: !!(info && info.confirmedCheater), established });
    },
  });
  ranks.cols.push("apk"); // 🤝 trailing column (see onPlayer); not part of RANK_COLS / rankRow
  ranks.cols.push("zat"); // 🪳⚔️ day of the newest 🤝 session (zerg-charge.mjs zergFresh)
  ranks.cols.push("inf", "infMax", "infVeh"); // 🪖 trailing columns (see onPlayer), % of lifetime kills
  ranks.cols.push("vcut"); // 🚜 vehicle cut % on adjs (adjs is already cut)
  const reviewedJson = readReviewed(dataDir);
  const hut = applyHutColumn(ranks, reviewedJson, { playMin, hsSlugs: readHeavySupportSlugs(dataDir) }); // 🛖 trailing "hut" column (damping factor on positive 🔀 Diff)
  const vehDiff = applyVehDiffColumn(ranks, reviewedJson); // 🔀🚜 trailing "vdf" column (vehicle damp on positive 🔀 Diff)
  const newbieDiff = applyNewbieDiffColumn(ranks, reviewedJson, playMin); // 🐣 trailing "nbd" column (play-time factor on negative 🔀 Diff)
  const zergRevive = applyReviveColumn(ranks, reviewedJson, revShare); // 🪳 trailing "rvp" / "crp" columns (revive / crowd percentiles)
  const tractor = applyTractorColumn(ranks, reviewedJson, tracS); // 🚜 trailing "trc" column (1 = name mark)
  const zergCharge = applyZergChargeColumn(ranks, { enabled: zergChargeOn }); // 🪳⚔️ ⚔️ iVi evened out for 🪳 Zerg (#84); trailing "adjs0" = before
  const found = findOutliers(players, [...METRIC_COLS, ...SESSION_METRIC_IDS], { known });
  found.items.push(...forensicsGuardItems(players));
  const guard = guardStatus(found);
  return {
    ranks, guard, hidden: hiddenSummary(dataDir, hiddenFound), bins: binCounts(players, guard), session: sessionStatus(players, guard, dataDir),
    forensics: forensicsStatus(players, guard, forensics),
    review: reviewStatus(players, guard, forensics, farmFound),
    padderPenalty: padderPenaltyStatus(players, ranks),
    vehicleCut: vehicleCutStatus(players, ranks),
    hut,
    vehDiff,
    zergRevive,
    tractor,
    zergCharge,
    newbieDiff,
    assistGroups: assistGroups(players), // 🤝 groups stay build-log only (the 🤝 apk column itself is public since t382u)
    assistGap: assistGapStatus(players),
  };
}

/**
 * 🤝 Assist bug weeks (session-stats.mjs ASSIST_GAP, owner t542u): build-log
 * list of every visible player whose counted sessions touch the window, with
 * assists per kill before (all sessions) and after (window skipped; null =
 * fewer than SESSION_MIN.MIN_KILLS kills left → no 🤝 / 🪳 / 🚩 low-assists).
 */
export function assistGapStatus(players) {
  const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const list = players
    .filter((p) => !p.hidden && p.session && p.session.gap && p.session.gap.sessions > 0 && p.session.kills >= SESSION_MIN.MIN_KILLS)
    .map((p) => ({ slug: p.slug, name: p.name, gapSessions: p.session.gap.sessions, gapKills: p.session.gap.kills, kept: p.session.gap.kept,
      apkBefore: r3(p.session.gap.apkAll), apk: r3(p.session.values.s_apk) }))
    .sort((a, b) => b.gapKills / (b.gapKills + b.kept) - a.gapKills / (a.gapKills + a.kept) || a.name.localeCompare(b.name));
  return {
    checkedAt: new Date().toISOString(),
    start: new Date(ASSIST_GAP.start).toISOString(), end: new Date(ASSIST_GAP.end).toISOString(), url: ASSIST_GAP.url,
    minKills: SESSION_MIN.MIN_KILLS,
    count: list.length, lost: list.filter((x) => x.apk == null).length,
    players: list,
  };
}

function readReviewed(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")); } catch { return null; }
}

/**
 * 🛖 Safe-spot damping (hut.mjs, owner t504u / t505u): cuts from this population,
 * then trailing columns "hut" = damping factor m on positive 🔀 Diff (3 decimals;
 * null = no reduction or cleared by the owner in reviewed.json "hut": "cleared")
 * and "hutMk" = 1 where 🛖 shows (Diff reduced by ≥ HUT_MARK_MIN points).
 * Returns the status.json "hut" block for build-log: cuts, counts, the 🛖-marked (t512u)
 * player with Diff before / after and the gate weights, and the owner-cleared ones.
 */
/** owner t781u: ⛑️ Heavy support slugs (and their linked accounts) from data/heavysupport.json + the alt data; empty when absent (PS room). */
export function readHeavySupportSlugs(dataDir) {
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return null; } };
  const store = rd("heavysupport.json");
  if (!store) return new Set();
  return heavySupportSlugs(store, familyIndex({ altFamilies: rd("alt-families.json"), alts: rd("alts.json"), extra: store.families }));
}

export function applyHutColumn(ranks, reviewed, { playMin = null, hsSlugs = null } = {}) {
  const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
  const get = (r, k) => (ix[k] != null ? r[ix[k]] : null);
  // playMin: Map slug → estimated play minutes; without the map (tests / old callers) the experience ramp is off (e = 1).
  const feat = (r) => ({ act: get(r, "act"), kpm: get(r, "kpm"), kd: get(r, "kd"), acc: get(r, "acc"), inf: get(r, "inf"), playMin: playMin ? (playMin.get(get(r, "slug")) ?? null) : undefined });
  const cuts = hutCuts(ranks.rows.map(feat));
  const colOf = (k) => ranks.rows.map((r) => get(r, k));
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi") });
  const players = [], cleared = [];
  let dieHardBefore = 0, dieHardAfter = 0;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  ranks.cols.push("hut", "hutMk");
  for (const r of ranks.rows) {
    const g = aimGap(tp, get(r, "adjs"), get(r, "ivi"));
    const f = { ...feat(r), iviPct: g ? g.practice : null };
    const parts = hutParts(f, cuts);
    let h = parts && parts.m < 1 ? r3(parts.m) : null;
    if (h === 1) h = null;
    const slug = get(r, "slug"), name = get(r, "name");
    const after0 = g ? aimGap(tp, get(r, "adjs"), get(r, "ivi"), h).score : null;
    const info = () => ({ name, slug, act: f.act, dpm: r3(deathsPerMin(f.kpm, f.kd)), acc: f.acc, inf: f.inf, diffRaw: g ? g.raw : null, iviPct: f.iviPct, playH: Number.isFinite(f.playMin) ? Math.round(f.playMin / 60) : null, exp: r3(parts.exp), cut: r3(parts.cut), factor: h, w: r3(parts.w), wDpm: r3(parts.wDpm), wInf: r3(parts.wInf), wAcc: r3(parts.wAcc) });
    if (h != null && hutCleared(reviewed, slug)) {
      if (g && after0 !== g.raw) cleared.push({ ...info(), diffWould: after0 });
      h = null;
    }
    const after = g ? aimGap(tp, get(r, "adjs"), get(r, "ivi"), h).score : null;
    let mk = g && h != null && g.raw - after >= HUT_MARK_MIN ? 1 : null;
    // ⛑️ instead of 🛖 for Heavy support players (owner t781u); reviewed.json "heavySupport": "cleared" keeps 🛖.
    if (mk && hsSlugs && hsSlugs.has(slug) && !hutHsCleared(reviewed, slug)) mk = 2;
    r.push(h, mk);
    if (g && g.raw >= 33) dieHardBefore++;
    if (after != null && after >= 33) dieHardAfter++;
    if (mk) players.push({ ...info(), diff: after, marked: true, ...(mk === 2 ? { hs: true } : {}) }); // build-log lists only 🛖-marked players (owner t512u); smaller reductions still apply in ranks.json
  }
  players.sort((a, b) => (b.diffRaw ?? -999) - (a.diffRaw ?? -999));
  const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
  const pc = (q) => "p" + Math.round(q * 100);
  return {
    builtAt: new Date().toISOString(),
    cuts: {
      actMedian: r4(cuts.actMedian), actMult: HUT_ACT_MULT, actMultTop: HUT_ACT_MULT_TOP, actCut: r4(cuts.actCut), actCutTop: r4(cuts.actMedian * HUT_ACT_MULT_TOP),
      expLoH: Number.isFinite(cuts.expLo) ? Math.round(cuts.expLo / 60) : null, expHiH: Number.isFinite(cuts.expHi) ? Math.round(cuts.expHi / 60) : null, expBand: HUT_EXP_BAND.map(pc),
      dpmLo: r4(cuts.dpmLo), dpmHi: r4(cuts.dpmHi), dpmBand: HUT_DPM_BAND.map(pc),
      accLo: r4(cuts.accLo), accHi: r4(cuts.accHi), accBand: HUT_ACC_BAND.map(pc),
      infLo: cuts.infLo, infHi: cuts.infHi, markMin: HUT_MARK_MIN, n: cuts.n,
    },
    marked: players.length,
    hsSwapped: players.filter((p) => p.hs).length, // ⛑️ instead of 🛖 (owner t781u)
    dieHardBefore, dieHardAfter,
    rule: `🛖 safe-spot damping, gradual, all cuts from this build's players. a = (🏃 Activity ÷ cut)², cut = median × (${HUT_ACT_MULT} + (${HUT_ACT_MULT_TOP} − ${HUT_ACT_MULT}) × ⚔️ iVi percentile ÷ 100 × e), a straight line, where e = experience 0 → 1 on estimated play time (lifetime kills ÷ lifetime KPM) from ${pc(HUT_EXP_BAND[0])} to ${pc(HUT_EXP_BAND[1])} of this build's players (new accounts stay near ×${HUT_ACT_MULT}), so weaker players get a lower cut and the top of the board up to ×${HUT_ACT_MULT_TOP} (Activity at or above the cut → no change). w = product of three 0–1 ramps: deaths/min (KPM ÷ K/D) 1 at ${pc(HUT_DPM_BAND[0])} → 0 at ${pc(HUT_DPM_BAND[1])}; 🪖 infantry 0 at ${HUT_INF_BAND[0]}% → 1 at ${HUT_INF_BAND[1]}%; accuracy 1 at the median → 0 at ${pc(HUT_ACC_BAND[1])}. A positive 🔀 Diff × (1 − w × (1 − a)), rounded; a negative Diff is untouched. 🛖 next to the name only when Diff drops by ${HUT_MARK_MIN}+ points. Owner override: "hut": "cleared" on the data/reviewed.json entry (no 🛖, no damping).`,
    players,
    cleared,
  };
}

/**
 * 🔀 Diff vehicle damp (diff-vehicle.mjs, owner-approved 2026-10-22): start =
 * median 🪖 vehicle share of this build; trailing column "vdf" = factor on a
 * positive Diff (3 decimals; null = none or cleared). Stacks with 🛖 as the lower
 * factor. Returns the status.json "vehDiff" block: every player whose shown Diff
 * changes, Diff with 🛖 only vs with both, and the 😤 DieHard counts.
 */
export function applyVehDiffColumn(ranks, reviewed) {
  const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
  const get = (r, k) => (ix[k] != null ? r[ix[k]] : null);
  const colOf = (k) => ranks.rows.map((r) => get(r, k));
  const start = vehDiffStart(colOf("infVeh"));
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi") });
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const players = [], cleared = [];
  let dieHardHut = 0, dieHardAfter = 0, damped = 0;
  ranks.cols.push("vdf");
  for (const r of ranks.rows) {
    const slug = get(r, "slug"), veh = get(r, "infVeh"), hut = get(r, "hut");
    let f = vehDiffFactor(veh, start);
    if (f != null) f = r3(f);
    const g0 = aimGap(tp, get(r, "adjs"), get(r, "ivi"), hut);
    const would = g0 ? aimGap(tp, get(r, "adjs"), get(r, "ivi"), hut, f) : null;
    if (f != null && vehDiffCleared(reviewed, slug)) {
      if (g0 && would.score !== g0.score) cleared.push({ name: get(r, "name"), slug, veh, diffRaw: g0.raw, diffHut: g0.score, diffWould: would.score });
      f = null;
    }
    r.push(f);
    const g = g0 ? aimGap(tp, get(r, "adjs"), get(r, "ivi"), hut, f) : null;
    if (g0 && g0.score >= 33) dieHardHut++;
    if (g && g.score >= 33) dieHardAfter++;
    if (g && g.score !== g0.score) {
      damped++;
      players.push({ name: get(r, "name"), slug, veh, factor: f, hut: g.hut, by: g.by, diffRaw: g.raw, diffHut: g0.score, diff: g.score });
    }
  }
  players.sort((a, b) => (b.diffRaw ?? -999) - (a.diffRaw ?? -999));
  return {
    builtAt: new Date().toISOString(),
    start: Number.isFinite(start) ? Math.round(start * 10) / 10 : null,
    damped, dieHardHut, dieHardAfter,
    rule: `🔀 Diff vehicle damp, gradual, start from this build's players: start = median 🪖 vehicle share (${Number.isFinite(start) ? start.toFixed(1) : "—"}%). Vehicle share at or below the start → no change; above → factor = (100 − vehicle %) ÷ (100 − start), so only the on-foot part of a positive Diff counts (all-vehicle → 0). Negative Diff untouched. ⚔️ iVi already carries the 🚜 cut; this one keeps the Diff comparison about infantry. With 🛖 the lower factor applies (never both multiplied). Diff before = with 🛖 only. No mark next to the name; the Diff hover says “🚜 Reduced from …”. Owner override: "vehDiff": "cleared" on the data/reviewed.json player entry, or the 🚜 "vehicleCutCleared" exemption.`,
    players,
    cleared,
  };
}

/**
 * 🐣 Newbie softening (newbie-diff.mjs, owner 2026-10-22): ramp ends from this
 * build's estimated play times (lifetime kills ÷ lifetime KPM, like 🛖), trailing
 * column "nbd" = factor on a NEGATIVE 🔀 Diff (3 decimals; null = none, no play
 * time, or cleared in reviewed.json "newbieDiff": "cleared"), plus column "nbh"
 * = play hours (1 decimal) for a 🐣 new player (under NBD_NEW_Q of play times;
 * null = not new or cleared) and ranks.nbdCuts { lo, hi, nw } (minutes) so the
 * page can rate a player fetched after the build the same way. Returns the
 * status.json "newbieDiff" block: every player whose shown Diff changes and the
 * 🤥 Impostor counts.
 */
export function applyNewbieDiffColumn(ranks, reviewed, playMin) {
  const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
  const get = (r, k) => (ix[k] != null ? r[ix[k]] : null);
  const colOf = (k) => ranks.rows.map((r) => get(r, k));
  const pm = (r) => (playMin ? playMin.get(get(r, "slug")) ?? null : null);
  const cuts = nbdCuts(ranks.rows.map(pm));
  const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi") });
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const hrs = (m) => (Number.isFinite(m) ? Math.round(m / 6) / 10 : null);
  const players = [], cleared = [], newPlayers = [];
  let impBefore = 0, impAfter = 0, softened = 0, newCount = 0, marked = 0;
  const graveHidden = []; // 🪦 wins over 🐣 (owner 2026-10-23): mark hidden, softening kept
  const nowMs = Date.now();
  const isGrave = (r) => flairsFor({ created: get(r, "created"), last: get(r, "last") }, nowMs).some((x) => x.id === "inactive");
  ranks.cols.push("nbd", "nbh");
  ranks.nbdCuts = { lo: Math.round(cuts.lo), hi: Math.round(cuts.hi), nw: Math.round(cuts.nw) };
  for (const r of ranks.rows) {
    const slug = get(r, "slug"), m = pm(r);
    let f = newbieFactor(m, cuts);
    if (f != null) f = r3(f);
    const args = [tp, get(r, "adjs"), get(r, "ivi"), get(r, "hut"), get(r, "vdf")];
    const g0 = aimGap(...args);
    let nh = newPlayerHours(m, cuts);
    const clr = newbieCleared(reviewed, slug);
    if (f != null && g0 && g0.raw < 0 && clr) {
      cleared.push({ name: get(r, "name"), slug, h: hrs(m), diffRaw: g0.raw, diffWould: aimGap(...args, f).score });
      f = null;
    }
    if (clr) nh = null; // reviewed.json clearance: no auto 🐣 either
    const g = g0 ? aimGap(...args, f) : null;
    const softMark = !!(g && g0 && g.score - g0.raw >= 10);
    if ((nh != null || softMark) && isGrave(r)) {
      graveHidden.push({ name: get(r, "name"), slug, h: hrs(m), kind: nh != null ? "new" : "softened", diffRaw: g0 ? g0.raw : null, diff: g ? g.score : null });
      nh = null; // 🪦 wins: no 🐣 (the nbd factor stays, so the Diff is still softened)
    } else {
      if (nh != null) { newCount++; newPlayers.push({ name: get(r, "name"), slug, h: nh, diffRaw: g0 ? g0.raw : null, diff: g ? g.score : null }); }
      if (nh != null || softMark) marked++;
    }
    r.push(f, nh);
    if (g0 && g0.score <= -33) impBefore++;
    if (g && g.score <= -33) impAfter++;
    if (g && g.score !== g0.score) {
      softened++;
      players.push({ name: get(r, "name"), slug, h: hrs(m), factor: f, diffRaw: g0.score, diff: g.score });
    }
  }
  players.sort((a, b) => a.diffRaw - b.diffRaw);
  newPlayers.sort((a, b) => a.h - b.h);
  const loH = hrs(cuts.lo), hiH = hrs(cuts.hi);
  return {
    builtAt: new Date().toISOString(),
    loH, hiH, n: cuts.n, softened, impBefore, impAfter,
    newH: hrs(cuts.nw), newQ: NBD_NEW_Q, newCount, marked, graveHiddenCount: graveHidden.length,
    rule: `🐣 Newbie softening of a negative 🔀 Diff, gradual, ends from this build's ${cuts.n} players with a play time (lifetime kills ÷ lifetime KPM, the 🛖 estimate): lo = p${NBD_BAND[0] * 100} (${loH} h), hi = p${NBD_BAND[1] * 100} = the median (${hiH} h). factor = 0 at/below lo, ln(h ÷ lo) ÷ ln(hi ÷ lo) between (log scale: the Impostor share drops by about the same step per doubling of play time), 1 at/above hi. Negative Diff × factor, rounded; positive Diff untouched; no play time → no change. 🐣 next to the name when the softening raised the Diff by 10+ points (hover “Softened from …”), and for every new player: play time below p${NBD_NEW_Q * 100} (${hrs(cuts.nw)} h, the end of the flat ~29% Impostor share at the start), whatever the Diff (hover “New player (about N h played)”). 🪦 inactive (no activity for over a year) wins: no 🐣 mark, the softened Diff stays. Owner override: "newbieDiff": "cleared" on the data/reviewed.json player entry (full negative Diff).`,
    players,
    newPlayers,
    graveHidden,
    cleared,
  };
}

/** data/exp-types.json (room folder first, else the PC one) → 🚜 XP ids (tractor.mjs tracXpIds); null when missing. */
function readTracIds(dataDir) {
  for (const f of [path.join(dataDir, "exp-types.json"), path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "exp-types.json")]) {
    try { return tracXpIds(JSON.parse(fs.readFileSync(f, "utf8")).types); } catch { /* next */ }
  }
  return null;
}

/**
 * 🚜 vehicle name mark (tractor.mjs, owner t622u 2026-10-24, like 🪳: a low percentile + an XP confirmation).
 * Cuts from this build's data: infantry % below p25 of every player with a value AND repair / min or
 * vehicle-kill events / min ≥ p75 of the players with 2+ h of XP detail; OR infantry % below p2 (no XP needed).
 * Trailing column "trc" = 1 marked / 0 not / null no infantry %; reviewed.json "tractor": "cleared" → 0.
 * ranks.tracCuts = { cut, fb, med, rep, vk } (LIVE dial + pages). Returns the status.json "tractorMark" block.
 */
export function applyTractorColumn(ranks, reviewed, tracS) {
  const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
  const get = (r, k) => (ix[k] != null ? r[ix[k]] : null);
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  const pool = [];
  for (const r of ranks.rows) { const s = tracS && tracS.get(get(r, "slug")); if (s && fin(get(r, "inf"))) pool.push(s); }
  const cuts = tractorCuts(ranks.rows.map((r) => get(r, "inf")), pool);
  const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);
  const tc = { cut: cuts.cut, fb: cuts.fb, med: cuts.med, rep: r3(cuts.rep), vk: r3(cuts.vk) };
  ranks.tracCuts = tc;
  ranks.cols.push("trc");
  let marked = 0, byXp = 0, byFallback = 0, medianBefore = 0, withInf = 0;
  const cleared = [], near = [];
  for (const r of ranks.rows) {
    const inf = get(r, "inf"), slug = get(r, "slug"), s = tracS && tracS.get(slug);
    let v = tractorRule(inf, s, cuts);
    if (fin(inf)) { withInf++; if (fin(cuts.med) && inf < cuts.med) medianBefore++; }
    if (v === 1 && tractorCleared(reviewed, slug)) { cleared.push({ name: get(r, "name"), slug, inf }); v = 0; }
    if (v === 1) { marked++; if (fin(cuts.fb) && inf < cuts.fb) byFallback++; else byXp++; }
    r.push(v);
    // Near the cut: under the infantry cut with XP within ±25% of the XP cut, or infantry within 2 points of either cut.
    if (fin(inf) && v != null) {
      const xr = s ? Math.max(fin(tc.rep) && tc.rep > 0 ? s.rep / tc.rep : 0, fin(tc.vk) && tc.vk > 0 ? s.vk / tc.vk : 0) : null;
      const nearXp = inf < cuts.cut && xr != null && xr >= 0.75 && xr < 1.25;
      const nearInf = (s && Math.abs(inf - cuts.cut) <= 2) || Math.abs(inf - cuts.fb) <= 2;
      if (nearXp || nearInf) near.push({ name: get(r, "name"), slug, inf, rep: s ? r3(s.rep) : null, vk: s ? r3(s.vk) : null, xpRatio: xr == null ? null : Math.round(xr * 100) / 100, marked: v === 1 });
    }
  }
  const dist = (n) => (n.xpRatio != null && n.inf < cuts.cut ? Math.abs(n.xpRatio - 1) : Math.min(Math.abs(n.inf - cuts.cut), Math.abs(n.inf - cuts.fb)) / 2);
  near.sort((a, b) => dist(a) - dist(b) || a.inf - b.inf); // closest to a line first (XP ratio 1 or an infantry cut)
  return {
    checkedAt: new Date().toISOString(),
    rule: `🚜 = infantry % < p${TRAC_INF_Q} (${tc.cut}%) and (vehicle repair/min ≥ p${TRAC_XP_Q} (${tc.rep}) or vehicle kills/min ≥ p${TRAC_XP_Q} (${tc.vk}) of the ${pool.length} players with ${TRAC_XP_MIN / 60}+ h of XP detail), or infantry % < p${TRAC_FALLBACK_Q} (${tc.fb}%)`,
    cuts: tc, xpPool: pool.length, withInf, marked, byXp, byFallback, medianBefore,
    cleared, near: near.slice(0, 40),
  };
}

/**
 * 🪳 Zerg crowd check (zerg-revive.mjs; revive check owner-approved 2026-10-22,
 * crowd score / Hardlight / estimate t614, 2026-10-24): per measured player
 * (data/xp, not cleared in reviewed.json) the revive percentile = trailing column
 * "rvp" and the crowd-score percentile = "crp" (0–99; null = no XP detail or
 * cleared). trait-scores.mjs zergScore() softens a high Zerg where both are low
 * and marks rvp or crp ≥ REV_CONFIRM "confirmed"; no Zerg + max ≥ ZEST_MIN = "~N" estimate.
 * Returns the status.json "zergRevive" block for build-log.
 */
export function applyReviveColumn(ranks, reviewed, revShare) {
  const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
  const get = (r, k) => (ix[k] != null ? r[ix[k]] : null);
  const colOf = (k) => ranks.rows.map((r) => get(r, k));
  const samples = new Map(), clearedSamples = new Map();
  for (const r of ranks.rows) {
    const slug = get(r, "slug"), rs = revShare && revShare.get(slug);
    if (!rs) continue;
    (zergCleared(reviewed, slug) ? clearedSamples : samples).set(slug, rs);
  }
  const pc = crowdPercentiles(samples);
  const pool = [...samples.values()].map((s) => Math.round(s.rev * 1000) / 1000).sort((a, b) => a - b);
  const q = (p) => (pool.length ? pool[Math.min(pool.length - 1, Math.floor(p / 100 * pool.length))] : null);
  const tp = traitPools({ inflation: colOf("inflation"), apk: colOf("apk") });
  const players = [], cleared = [], estimates = [];
  let zergScored = 0, measured = 0, measuredZerg = 0, confirmed = 0, softened = 0, confirmedHigh = 0, byCrowdOnly = 0, hardlight = 0;
  ranks.cols.push("rvp", "crp");
  for (const r of ranks.rows) {
    const slug = get(r, "slug"), rs = samples.get(slug) || clearedSamples.get(slug), v = pc.get(slug);
    const rvp = v ? v.rvp : null, crp = v ? v.crp : null;
    const z0 = zergScore(tp, get(r, "inflation"), get(r, "apk"));
    if (z0) zergScored++;
    const info = (z) => ({ name: get(r, "name"), slug, share: rs ? Math.round(rs.rev * 1000) / 10 : null, revived: rs ? rs.revived : null, deaths: rs ? rs.deaths : null, minutes: rs ? rs.minutes : null, rvp, crp, hl: v && v.hlp != null ? Math.round(rs.hl * 1000) / 1000 : null, zergRaw: z0 ? z0.raw : null, zerg: z ? z.score : null });
    if (clearedSamples.has(slug)) cleared.push({ ...info(null), zergWould: null });
    r.push(rvp, crp);
    if (!v) continue;
    measured++;
    if (v.hlp != null) hardlight++;
    const z = zergScore(tp, get(r, "inflation"), get(r, "apk"), rvp, crp);
    if (!z) {
      const est = zergEstimate(rvp, crp);
      if (est != null) estimates.push({ ...info(null), est });
      continue;
    }
    measuredZerg++;
    if (z.confirmed) { confirmed++; if (!(rvp >= REV_CONFIRM)) byCrowdOnly++; if (z.raw >= 67) confirmedHigh++; }
    if (z.softened) softened++;
    if (z.softened || (z.confirmed && z.raw >= 67)) players.push({ ...info(z), status: z.softened ? "softened" : "confirmed" });
  }
  players.sort((a, b) => (b.zergRaw ?? -1) - (a.zergRaw ?? -1));
  estimates.sort((a, b) => b.est - a.est);
  const p1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);
  return {
    builtAt: new Date().toISOString(),
    zergScored, measured, measuredZerg, confirmed, confirmedHigh, softened, byCrowdOnly, hardlight, estimated: estimates.length,
    cuts: { minDeaths: CROWD_MIN_DEATHS, minMinutes: CROWD_MIN_MIN, p25: p1(q(REV_SOFT_BAND[0])), p50: p1(q(REV_SOFT_BAND[1])), p75: p1(q(REV_CONFIRM)), n: pool.length },
    rule: `🪳 Zerg crowd check, from Honu XP detail (data/xp, players looked up or discovered; ${CROWD_MIN_DEATHS}+ deaths by enemy players and ${CROWD_MIN_MIN / 60}+ h of play there, no kill minimum). Per death we count what the player RECEIVED: revives (Revive + Squad Revive), heals, shield repairs and resupplies (each + its squad version). rvp = the revived share's percentile among the ${pool.length} measured players of this build (revived share p25 ${p1(q(REV_SOFT_BAND[0]))}%, median ${p1(q(REV_SOFT_BAND[1]))}%, p75 ${p1(q(REV_CONFIRM))}%). Crowd score = mean of the four percentiles; engineers with Hardlight barrier blocking XP (id 1393, only ticks inside a big crowd) at ${HL_MIN}+ events/min get max(crowd, ${1 - HL_W} × crowd + ${HL_W} × their Hardlight percentile) — it can only add (${hardlight} players). crp = the crowd score's percentile again among the same players. rvp ≥ ${REV_CONFIRM} OR crp ≥ ${REV_CONFIRM} → Zerg confirmed (unchanged, said on hover; ${byCrowdOnly} confirmed by the crowd score alone). Softening uses the HIGHER of rvp and crp (check): w = 1 at/below p${REV_SOFT_BAND[0]} → 0 at/above p${REV_SOFT_BAND[1]}, Zerg = raw − round(w × max(0, raw − check)); never raised. No XP detail → unchanged. Estimated 🪳 (no Zerg score, e.g. few kills or assists): max(rvp, crp) when ≥ ${ZEST_MIN}, shown as "~N" — display only, never sorted, pooled or marked (${estimates.length} players). Listed: every softened player, confirmed ones with raw Zerg ≥ 67, and the estimates. Owner override: "zerg": "cleared" on the data/reviewed.json player entry (no crowd result at all; also left out of the pools).`,
    players,
    estimates,
    cleared,
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
/**
 * 🪳⚔️ ⚔️ iVi evened out for 🪳 Zerg (#84, owner 2026-10-29: replaces the plain adjusted iVi).
 * zerg-charge.mjs: (iVi + 3100) · exp(−0.00021 · (🪳 − 26.8)) − 3100, measured on 103,689 PC
 * duel pairs (docs/zerg-adjustment.md). Below 🪳 26.8 up, above down; no 🪳 → unchanged.
 * Runs after the 🪳 inputs exist ("inflation", "apk", "rvp", "crp"); the 🪳 pools don't use adjs,
 * so nothing is circular. Always adds "adjs0" (the value before; PS and no-🪳 rows = adjs)
 * so ranks-lite keeps one column set in both rooms. enabled = false (PlayStation): unchanged.
 */
export function applyZergChargeColumn(ranks, { enabled = true, now = Date.now() } = {}) {
  const ci = (id) => ranks.cols.indexOf(id);
  const iA = ci("adjs");
  const get = (r, id) => { const i = ci(id); return i >= 0 ? r[i] : null; };
  const colOf = (id) => ranks.rows.map((r) => get(r, id));
  const tp = traitPools({ inflation: colOf("inflation"), apk: colOf("apk") });
  ranks.cols.push("adjs0");
  let changed = 0, up = 0, down = 0;
  for (const r of ranks.rows) {
    const a = r[iA];
    r.push(a);
    if (!enabled || typeof a !== "number" || !Number.isFinite(a) || !zergFresh(get(r, "zat"), now)) continue;
    const z = zergScore(tp, get(r, "inflation"), get(r, "apk"), get(r, "rvp"), get(r, "crp"));
    const v = z ? zergChargedAdjs(a, z.score) : null;
    if (v == null) continue;
    const nv = Math.round(v * 10) / 10;
    if (nv !== a) { changed++; if (nv > a) up++; else down++; }
    r[iA] = nv;
  }
  return { enabled, changed, up, down, center: ZERG_CHARGE.CENTER, k: ZERG_CHARGE.K, lambda: ZERG_CHARGE.LAMBDA };
}

export function padderPenaltyStatus(players, ranks) {
  const ia = ranks.cols.indexOf("adjs0") >= 0 ? ranks.cols.indexOf("adjs0") : ranks.cols.indexOf("adjs"), is = ranks.cols.indexOf("slug"); // 💩 / 🚜 steps come before the 🪳 evening-out (#84)
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
  const ia = ranks.cols.indexOf("adjs0") >= 0 ? ranks.cols.indexOf("adjs0") : ranks.cols.indexOf("adjs"), is = ranks.cols.indexOf("slug"); // 💩 / 🚜 steps come before the 🪳 evening-out (#84)
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
    .map((p) => ({ ...evidence(p), group: "excluded after review" }));
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
    const reason = red.length ? "Also in 🚩 red flags (" + red.join(", ") + "), listed there" : KNOWN_EXTREMES[p.slug] || (p.established ? carveOutReason() : "");
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

const CID_NAME_FACTIONS = new Set(["vs", "nc", "tr", "nso"]);

/**
 * data/cid-names.json (#80): character id → name for the 🎥 live page, so a known victim's name shows with no
 * Census call. Flat { "<cid>": "Name" }, or { "<cid>": ["Name", "vs"] } when the faction is known (player files
 * carry `faction` since #80; a character's faction never changes). Sources: every cached player file
 * (player.cid + player.display, tag stripped) and discovery.json queue rows ({ cid, name }) not cached yet.
 * Removed players (opt-out.json) are left out. Sorted by cid, no timestamp: an unchanged cache gives a
 * byte-identical file, so it never makes a bot commit on its own. PC only (the live page is PC-only).
 */
export function buildCidNames(dataDir) {
  let removed;
  try { removed = removedList(JSON.parse(fs.readFileSync(path.join(dataDir, "opt-out.json"), "utf8"))); } catch { removed = removedList(null); }
  const out = new Map();
  const add = (cid, name, faction) => {
    const id = String(cid || "");
    const nm = bareName(name);
    if (!/^\d{5,25}$/.test(id) || !nm || out.has(id) || removed.match({ cid: id, name: nm })) return;
    out.set(id, CID_NAME_FACTIONS.has(faction) ? [nm, faction] : nm);
  };
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const seen = new Set();
  for (const e of index.players || []) {
    if (!e || !e.file || seen.has(e.file)) continue;
    seen.add(e.file);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
    const pl = (raw && (raw.player || raw)) || {};
    add(pl.cid, pl.display || e.name, pl.faction);
  }
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, "discovery.json"), "utf8"));
    for (const q of (d && d.queue) || []) if (q) add(q.cid, q.name);
  } catch { /* no discovery state */ }
  const map = {};
  for (const id of [...out.keys()].sort()) map[id] = out.get(id);
  return map;
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
export const LITE_COLS = ["name", "slug", "adjs", "adjs0", "zat", "cons", "apk", "inf", "infMax", "infVeh", "ivi", "inflation", "hut", "hutMk", "vdf", "rvp", "crp", "nbd", "nbh", "trc"];
const LITE_DIGITS = { adjs: 1, adjs0: 1, zat: 0, cons: 4, apk: 3, inf: 1, infMax: 1, infVeh: 1, ivi: 1, inflation: 2, hut: 3, hutMk: 0, vdf: 3, rvp: 0, crp: 0, nbd: 3, nbh: 1, trc: 0 };
export function buildRanksLite(ranks) {
  const ix = LITE_COLS.map((k) => (ranks && Array.isArray(ranks.cols) ? ranks.cols.indexOf(k) : -1));
  if (ix.some((i) => i < 0) || !Array.isArray(ranks.rows)) return null;
  const rows = ranks.rows.map((r) => ix.map((i, j) => {
    const v = r[i];
    const d = LITE_DIGITS[LITE_COLS[j]];
    return d != null && typeof v === "number" && Number.isFinite(v) ? +v.toFixed(d) : v;
  }));
  const out = { v: 1, updatedAt: ranks.updatedAt || null, count: rows.length, cols: LITE_COLS, rows };
  if (ranks.nbdCuts) out.nbdCuts = ranks.nbdCuts; // 🐣 cuts for players fetched after the build
  if (ranks.tracCuts) out.tracCuts = ranks.tracCuts; // 🚜 cuts (name-mark fallback + LIVE dial)
  return out;
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
  // PS adjusted-iVi baseline (owner t698): 600 ÷ the PC / PS kill-speed gap. Missing file = keep the last value.
  const gap = read("kpm-ratio.json");
  if (gap) setPsKpmRatio(gap);
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
  // Marathon-rampage auto-hide (PC only: session forensics is a PC Honu dataset).
  if (room === "pc") {
    const marathonHidden = autoHideMarathonRampage(dataDir);
    if (marathonHidden.length) console.log(`auto-hide: ${marathonHidden.length} marathon rampage account(s) added to hidden.json: ${marathonHidden.map((a) => a.name).join(", ")}`);
  }
  const { ranks: out, guard, hidden: hiddenInfo, bins, session, forensics: forensicsInfo, review, assistGroups: assistInfo, padderPenalty: padderInfo, vehicleCut: vehCutInfo, hut: hutInfo, vehDiff: vehDiffInfo, zergRevive: zrevInfo, tractor: tracInfo, newbieDiff: nbdInfo, assistGap: gapInfo } = buildRanksWithGuard(dataDir, room === "ps" ? { known: {}, zergCharge: false } : undefined);
  if (room === "ps") addServerColumn(out, JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")));
  fs.writeFileSync(path.join(dataDir, "ranks.json"), JSON.stringify(out) + "\n");
  try {
    const names = buildNames(JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")), { withFile: room === "ps" });
    fs.writeFileSync(path.join(dataDir, "names.json"), JSON.stringify(names) + "\n");
    console.log(`names.json: ${names.count} names`);
  } catch (e) { console.log(`names.json not written: ${e.message}`); }
  const lite = buildRanksLite(out);
  if (lite) fs.writeFileSync(path.join(dataDir, "ranks-lite.json"), JSON.stringify(lite) + "\n");
  if (room === "pc") {
    try {
      const cidNames = buildCidNames(dataDir);
      fs.writeFileSync(path.join(dataDir, "cid-names.json"), JSON.stringify(cidNames) + "\n");
      console.log(`cid-names.json: ${Object.keys(cidNames).length} names (🎥 live victims)`);
    } catch (e) { console.log(`cid-names.json not written: ${e.message}`); }
  }
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
  st.assistGap = gapInfo; // 🤝 assist bug weeks skipped (build-log list)
  console.log(`🤝 assist bug weeks skipped: ${gapInfo.count} players touched, ${gapInfo.lost} left without 🤝 (under ${gapInfo.minKills} kills)`);
  st.padderPenalty = padderInfo; // 💩 build-log list (ranks.json already has the penalized numbers)
  st.vehicleCut = vehCutInfo; // 🚜 build-log list (ranks.json already has the cut numbers)
  st.hut = hutInfo; // 🛖 build-log list (ranks.json "hut" column has the factors)
  st.newbieDiff = nbdInfo; // 🐣 build-log list (ranks.json "nbd")
  console.log(`🐣 newbie softening: ${nbdInfo.loH} h → ${nbdInfo.hiH} h; ${nbdInfo.softened} negative Diffs softened, Impostors ${nbdInfo.impBefore} → ${nbdInfo.impAfter}, ${nbdInfo.cleared.length} cleared; new players < ${nbdInfo.newH} h: ${nbdInfo.newCount}; 🐣 shown: ${nbdInfo.marked}; 🐣 hidden by 🪦: ${nbdInfo.graveHiddenCount}`);
  st.vehDiff = vehDiffInfo; // 🔀🚜 build-log list (ranks.json "vdf")
  st.zergRevive = zrevInfo; // 🪳 crowd check build-log list (ranks.json "rvp" / "crp")
  st.tractorMark = tracInfo; // 🚜 name mark (ranks.json "trc" + "tracCuts")
  console.log(`🚜 vehicle mark: ${tracInfo.marked} of ${tracInfo.withInf} players (${tracInfo.byXp} by infantry < ${tracInfo.cuts.cut}% + XP, ${tracInfo.byFallback} by infantry < ${tracInfo.cuts.fb}%; median rule would give ${tracInfo.medianBefore}), XP pool ${tracInfo.xpPool}, ${tracInfo.cleared.length} cleared`);
  console.log(`🔀🚜 Diff vehicle damp: start ${vehDiffInfo.start}% vehicle share; ${vehDiffInfo.damped} players' Diff lowered, DieHards ${vehDiffInfo.dieHardHut} (after 🛖) → ${vehDiffInfo.dieHardAfter}, ${vehDiffInfo.cleared.length} cleared`);
  console.log(`🪳 crowd check: ${zrevInfo.measured} measured (${zrevInfo.measuredZerg} of ${zrevInfo.zergScored} Zerg-scored), ${zrevInfo.confirmed} confirmed (${zrevInfo.confirmedHigh} with Zerg ≥ 67, ${zrevInfo.byCrowdOnly} by crowd score only), ${zrevInfo.softened} softened, ${zrevInfo.estimated} estimated, ${zrevInfo.cleared.length} cleared`);
  console.log(`🛖 safe-spot: Activity median ${hutInfo.cuts.actMedian} → cut ${hutInfo.cuts.actCut}…${hutInfo.cuts.actCutTop} (by ⚔️ iVi percentile), deaths/min ${hutInfo.cuts.dpmLo}→${hutInfo.cuts.dpmHi}, accuracy ${hutInfo.cuts.accLo}→${hutInfo.cuts.accHi}; ${hutInfo.marked} shown with 🛖, DieHards ${hutInfo.dieHardBefore} → ${hutInfo.dieHardAfter}, ${hutInfo.cleared.length} cleared by the owner`);
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
