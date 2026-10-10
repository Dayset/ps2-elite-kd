#!/usr/bin/env node
/**
 * 🛰️ PS2 Radar second opinion (radar.mjs): once per UTC day, look up ONLY the
 * players on build-log's review lists (🚩, 📉 🌾/†/🧪, 🔎, 🤖, 🙈) via the public
 * read-only API v1 (GET https://ps2radar.com/api/v1/players/{id}, no token) and
 * cache tier / Sus score / moderator mark in data/radar.json.
 *
 * Politeness (their /api/v1/info: 10 burst, 0.5/s refill per client):
 *   - ≤ RADAR_RULE.DAILY_CAP (50) lookups per UTC day, counted in radar.json;
 *   - one request at a time, 2–3 s apart, clear User-Agent naming the project;
 *   - 429 / 503 / 5xx: honour Retry-After, exponential backoff, ≤ 3 retries;
 *     two players in a row failing (busy, network, odd reply) → skip the rest of today.
 * Strictly optional: if the API fails or disappears this exits 0, records
 * radar.json "unavailableSince" (build-log: "Radar unavailable since …") and
 * keeps every cached answer as a record. Nothing else in the site reads it.
 *   - each player rechecked at most every 3 days; 404 = "not stored" (cached).
 * One pass per UTC day: once a pass finishes, later runs that day do nothing
 * (no network). A pass cut short by the time budget continues on the next run.
 *
 *   node scripts/radar-lookup.mjs           # RADAR_BUDGET_SEC (default 240)
 *   RADAR_DRY_RUN=1 node scripts/radar-lookup.mjs   # list today's picks, no network
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RADAR_RULE, RADAR_USER_AGENT, radarApiUrl, radarEntry, pickDue, retryAfterMs, utcDay, isNotStored } from "../radar.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readRadar(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && typeof j === "object" && j.players) return j;
  } catch {}
  return { players: {} };
}

/**
 * One lookup with polite retries. Returns { status, body } (200 / 404), or
 * { busy: true } after MAX_RETRIES 429 / 503 / 5xx, or { error } on other failures.
 */
export async function lookupOne(target, { fetchImpl = fetch, rule = RADAR_RULE, wait = sleep, log = () => {} } = {}) {
  const url = radarApiUrl(target);
  if (!url) return { error: "no id or name" };
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { "User-Agent": RADAR_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      // DNS / TLS / timeout: one retry only (a vanished site should cost seconds, not minutes).
      if (attempt >= 1) return { error: "network: " + (e && e.message) };
      await wait(5000);
      continue;
    }
    if (res.status === 200 || res.status === 404) {
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.status === 200 && !(body && body.player)) return { error: "unexpected reply (no player)" };
      if (res.status === 404 && !isNotStored(404, body)) return { error: "HTTP 404 (API gone?)" };
      return { status: res.status, body };
    }
    const busy = res.status === 429 || res.status === 503 || res.status >= 500;
    if (!busy) return { error: "HTTP " + res.status };
    if (attempt >= rule.MAX_RETRIES) return { busy: true, status: res.status };
    const ra = retryAfterMs(res.headers && res.headers.get && res.headers.get("retry-after"));
    const ms = Math.min(rule.MAX_BACKOFF_MS, Math.max(ra ?? 0, 5000 * 2 ** attempt));
    log(`  ${res.status} for ${target.slug}; waiting ${Math.round(ms / 1000)} s (Retry-After ${ra == null ? "none" : Math.round(ra / 1000) + " s"})`);
    await wait(ms);
  }
}

/**
 * Today's pass. review = status.json review.players (priority order).
 * Mutates and returns the cache object. Never throws on network trouble.
 */
export async function runPass(review, cache, { now = () => Date.now(), budgetMs = 240000, fetchImpl = fetch, wait = sleep, rule = RADAR_RULE, log = console.log, random = Math.random } = {}) {
  const start = now();
  const day = utcDay(start);
  if (cache.day !== day) { cache.day = day; cache.dayCount = 0; cache.passDone = false; }
  cache.players = cache.players || {};
  const stats = { looked: 0, ok: 0, notStored: 0, errors: 0, busy: 0, skipped: false, stopped: "", unavailable: false };
  if (cache.passDone) { stats.skipped = true; stats.stopped = "already ran today"; return stats; }
  const left = rule.DAILY_CAP - (cache.dayCount || 0);
  const todo = pickDue(review, cache, { now: start, left, rule });
  let failRow = 0;
  let cut = false;
  for (let i = 0; i < todo.length; i++) {
    if (now() - start > budgetMs) { cut = true; stats.stopped = "time budget"; break; }
    if (i > 0) await wait(rule.MIN_GAP_MS + Math.floor(random() * (rule.MAX_GAP_MS - rule.MIN_GAP_MS + 1)));
    const t = todo[i];
    const r = await lookupOne(t, { fetchImpl, rule, wait, log });
    cache.dayCount = (cache.dayCount || 0) + 1;
    stats.looked += 1;
    if (r.busy || r.error) {
      if (r.busy) stats.busy += 1; else stats.errors += 1;
      failRow += 1;
      log(`  ${t.slug}: ${r.busy ? "radar busy (HTTP " + r.status + ") after retries" : r.error}`);
      if (failRow >= rule.STOP_AFTER_FAILS) { stats.unavailable = stats.ok + stats.notStored === 0; stats.stopped = r.busy ? "radar busy (429/503)" : "radar unavailable (" + r.error + ")"; break; }
      continue;
    }
    failRow = 0;
    const e = radarEntry(r.body, { status: r.status, checkedAt: new Date(now()).toISOString(), slug: t.slug, name: t.name, cid: t.cid });
    cache.players[t.slug] = e;
    if (e.stored) stats.ok += 1; else stats.notStored += 1;
    log(`  ${t.slug}: ${e.stored ? (e.mark || e.tier || "?") + (e.sus != null ? " sus " + e.sus : "") : "not stored"}`);
  }
  // A failing radar is skipped for the rest of the UTC day (no retry storm); a
  // pass cut only by the time budget continues on the next run.
  if (!cut) cache.passDone = true;
  if ((cache.dayCount || 0) >= rule.DAILY_CAP) cache.passDone = true;
  const iso = new Date(now()).toISOString();
  if (stats.ok + stats.notStored > 0) { delete cache.unavailableSince; delete cache.unavailableReason; }
  else if (stats.unavailable || (stats.looked > 0 && stats.errors + stats.busy === stats.looked)) {
    cache.unavailableSince = cache.unavailableSince || iso;
    cache.unavailableReason = stats.stopped || "every lookup failed";
  }
  cache.lastPassAt = new Date(now()).toISOString();
  cache.lastPass = { ...stats, due: todo.length };
  return stats;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
 try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const file = path.join(dataDir, "radar.json");
  const cache = readRadar(file);
  if (cache.day === utcDay() && cache.passDone) {
    console.log(`radar: today's pass already done (${cache.dayCount || 0} lookups); no network.`);
    process.exit(0);
  }
  // Fresh review lists from the cache (no network; same code as status.json "review").
  const { buildRanksWithGuard } = await import("./build-ranks.mjs");
  const review = buildRanksWithGuard(dataDir).review.players;
  if (process.env.RADAR_DRY_RUN) {
    const due = pickDue(review, cache, { left: RADAR_RULE.DAILY_CAP - (cache.day === utcDay() ? cache.dayCount || 0 : 0) });
    console.log(`radar dry run: ${review.length} on review lists, ${due.length} due: ${due.map((d) => d.slug).join(", ")}`);
    process.exit(0);
  }
  const budgetMs = (+process.env.RADAR_BUDGET_SEC || 240) * 1000;
  console.log(`radar: ${review.length} players on review lists; pass for ${utcDay()} (cap ${RADAR_RULE.DAILY_CAP}/day, ${RADAR_RULE.MIN_GAP_MS / 1000}–${RADAR_RULE.MAX_GAP_MS / 1000} s apart)`);
  const stats = await runPass(review, cache);
  cache._about = "PS2 Radar (ps2radar.com) second opinion for build-log review lists, written by scripts/radar-lookup.mjs (radar.mjs). Keyed by slug. stored=false = 404 not stored. Optional: only build-log reads this file (link, badge, sort hint); a Radar mark never hides or flags anyone. If the API fails or disappears, unavailableSince is set and the cached answers stay as a record.";
  const ordered = { _about: cache._about, day: cache.day, dayCount: cache.dayCount, passDone: cache.passDone, lastPassAt: cache.lastPassAt, lastPass: cache.lastPass,
    ...(cache.unavailableSince ? { unavailableSince: cache.unavailableSince, unavailableReason: cache.unavailableReason } : {}),
    players: Object.fromEntries(Object.keys(cache.players).sort().map((k) => [k, cache.players[k]])) };
  fs.writeFileSync(file, JSON.stringify(ordered, null, 1) + "\n");
  console.log(`radar: ${stats.looked} lookups (${stats.ok} stored, ${stats.notStored} not stored, ${stats.errors} errors, ${stats.busy} busy)${stats.stopped ? "; stopped: " + stats.stopped : ""}; today ${cache.dayCount}/${RADAR_RULE.DAILY_CAP}`);
 } catch (e) {
  // Optional third-party lookup: never fail the refresh run.
  console.log("::warning::PS2 Radar lookup skipped: " + (e && e.message));
 }
 process.exit(0);
}
