#!/usr/bin/env node
/**
 * One-off / occasional: add Census account times (flairs.mjs 🪦 / 👴🏽) to
 * cached player files that don't have them yet. New fetches store them
 * already (same character lookup, no extra call); this fills older files with
 * batched lookups (100 characters per Census call, times only).
 *
 *   node scripts/backfill-times.mjs          # only files without times
 *   node scripts/backfill-times.mjs --all    # refresh times on every file
 *
 * Only `player.times` changes; everything else (savedAt, rows…) is untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountTimes } from "../flairs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "players");
const SID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const BATCH = 100;

/** Same file with player.times set (null times = file returned unchanged). */
export function withTimes(raw, times) {
  if (!raw || !raw.player || !times) return raw;
  return { ...raw, player: { ...raw.player, times } };
}

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.character_list)) return j;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error("Census unavailable");
}

async function main() {
  const all = process.argv.includes("--all");
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  const todo = new Map(); // cid -> [file]
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const p = raw && raw.player;
    if (!p || !/^\d{16,}$/.test(String(p.cid || ""))) continue;
    if (!all && p.times) continue;
    if (!todo.has(p.cid)) todo.set(p.cid, []);
    todo.get(p.cid).push(f);
  }
  const ids = [...todo.keys()];
  let written = 0, calls = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const url = `https://census.daybreakgames.com/s:${SID}/get/ps2:v2/character?character_id=${chunk.join(",")}&c:show=character_id,times&c:limit=${chunk.length}`;
    const j = await getJson(url);
    calls++;
    for (const c of j.character_list) {
      const t = accountTimes(c);
      for (const f of todo.get(c.character_id) || []) {
        const file = path.join(DIR, f);
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const next = withTimes(raw, t);
        if (next !== raw) {
          fs.writeFileSync(file, JSON.stringify(next) + "\n");
          written++;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`times: ${ids.length} character(s) looked up in ${calls} Census call(s), ${written} file(s) updated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
