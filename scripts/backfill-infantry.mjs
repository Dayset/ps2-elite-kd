#!/usr/bin/env node
/**
 * 🫡 Infantry backfill: add the v2 infantry split (infantry.mjs: infShare / MAX /
 * vehicle %) to cached player files that have none or an older v1 summary.
 * ONE kills-only Census call per BATCH characters (≈200 rows each, far under
 * c:limit; a full page is split and retried), ≥ 1.2 s between calls.
 * Normal refreshes store the full v2 summary themselves (refresh-cache.mjs).
 *
 *   node scripts/backfill-infantry.mjs [--limit 1000] [--cache /path/results.jsonl]
 *
 * --cache keeps fetched summaries outside the repo, so a re-run (e.g. after a
 * git conflict) re-applies them without calling Census again.
 * Only `player.infantry` changes; everything else (savedAt, rows…) is untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { infantryKillsUrl, summarizeInfantryKills } from "../infantry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "players");
const SID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const BASE = `https://census.daybreakgames.com/s:${SID}/get/ps2:v2/`;
const BATCH = 10;
const LIMIT_ROWS = 5000;
const GAP_MS = 1200;

/** Needs the backfill: no summary, or one older than v2. */
export function needsInfantry(raw) {
  const p = raw && raw.player;
  if (!p || !/^\d{16,}$/.test(String(p.cid || ""))) return false;
  return !(p.infantry && p.infantry.v >= 2);
}

/** Same file with player.infantry set (stub for characters without weapon stats). */
export function withInfantry(raw, sum) {
  if (!raw || !raw.player || !sum) return raw;
  return { ...raw, player: { ...raw.player, infantry: sum } };
}

let last = 0;
async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.characters_weapon_stat_by_faction_list)) return j.characters_weapon_stat_by_faction_list;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error("Census unavailable");
}

/** cid -> summary for a batch (splits when a page comes back full). */
async function fetchBatch(cids, stats) {
  const rows = await getJson(infantryKillsUrl(BASE, cids));
  stats.calls++;
  if (rows.length >= LIMIT_ROWS && cids.length > 1) {
    const h = Math.ceil(cids.length / 2);
    return { ...(await fetchBatch(cids.slice(0, h), stats)), ...(await fetchBatch(cids.slice(h), stats)) };
  }
  const by = new Map(cids.map((c) => [c, []]));
  for (const r of rows) if (by.has(r.character_id)) by.get(r.character_id).push(r);
  const now = Date.now();
  const out = {};
  for (const [c, list] of by) out[c] = summarizeInfantryKills(list, now) || { v: 2, at: now, kills: 0, part: "kills", tag: null };
  return out;
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const limit = +arg("--limit") || Infinity;
  const cacheFile = arg("--cache");
  const cache = new Map();
  if (cacheFile && fs.existsSync(cacheFile)) {
    for (const line of fs.readFileSync(cacheFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); cache.set(e.cid, e.sum); } catch {}
    }
  }
  const todo = new Map(); // cid -> [file]
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
    if (!needsInfantry(raw)) continue;
    const cid = String(raw.player.cid);
    if (!todo.has(cid)) todo.set(cid, []);
    todo.get(cid).push(f);
  }
  const pending = todo.size;
  const ids = [...todo.keys()];
  const cached = ids.filter((c) => cache.has(c));
  const fresh = ids.filter((c) => !cache.has(c)).slice(0, Math.max(0, limit - cached.length));
  const stats = { calls: 0 };
  let written = 0;
  const write = (cid, sum) => {
    for (const f of todo.get(cid) || []) {
      const file = path.join(DIR, f);
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!needsInfantry(raw)) continue;
      fs.writeFileSync(file, JSON.stringify(withInfantry(raw, sum)) + "\n");
      written++;
    }
  };
  for (const c of cached) write(c, cache.get(c));
  for (let i = 0; i < fresh.length; i += BATCH) {
    const got = await fetchBatch(fresh.slice(i, i + BATCH), stats);
    for (const [c, sum] of Object.entries(got)) {
      if (cacheFile) fs.appendFileSync(cacheFile, JSON.stringify({ cid: c, sum }) + "\n");
      write(c, sum);
    }
  }
  console.log(`infantry: ${pending} pending, ${cached.length} from cache + ${fresh.length} fetched in ${stats.calls} Census call(s), ${written} file(s) updated, ${pending - cached.length - fresh.length} left`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e && e.message); process.exit(1); });
}
