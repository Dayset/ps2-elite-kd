/**
 * 🥊 PlayStation scrims runner.
 *   node scripts/ps-scrims.mjs --probe "Name1,Name2" [--pages 20]
 *     Measurement only: pages back through each named PS player's KILL / DEATH history
 *     (1,000 events per Census call) and writes the compact events to scrim-probe/<key>.json.
 *     Nothing under data-ps/ changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { censusRequest, tokenBucket } from "../census-fetch.mjs";
import { PS_SERVERS, censusNsBase, parsePsKey } from "../rooms.mjs";
import { eventsUrl, compactEvent, mergeEvents, EVENT_PAGE } from "../scrims.mjs";
import { viaCensusProxy } from "./refresh-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data-ps");
const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset; room ps scrims)";
const SERVICE_ID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const PROXY = String(process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const PROXY_KEY = String(process.env.CENSUS_PROXY_KEY || "");
const bucket = tokenBucket({ capacity: 3, perMinute: Number(process.env.CENSUS_RPM) > 0 ? Number(process.env.CENSUS_RPM) : 30 });

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const arg = (name, d = "") => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] || d : d; };
const slugKey = (s) => String(s || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");

async function getCensus(url) {
  const proxied = viaCensusProxy(url, PROXY);
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (proxied !== url && PROXY_KEY) headers["X-Proxy-Key"] = PROXY_KEY;
  return censusRequest(proxied, { bucket, retries: 4, timeoutMs: 60_000, headers, baseMs: 2000, capMs: 30000,
    onRetry: ({ attempt, retries, reason, waitMs }) => console.warn(`  Census retry ${attempt}/${retries} in ${waitMs}ms (${reason})`) });
}

/** Page back from `before` (0 = now): up to `pages` calls. → { events newest first, oldest, done } */
export async function pageBack(base, cid, { before = 0, pages = 1, get = getCensus } = {}) {
  let events = [];
  let cursor = before;
  let done = false;
  for (let i = 0; i < pages; i++) {
    const j = await get(eventsUrl(base, cid, { before: cursor }));
    const list = (j && j.characters_event_list) || [];
    const page = list.map((e) => compactEvent(e, cid)).filter(Boolean);
    events = mergeEvents(events, page);
    if (list.length < EVENT_PAGE || !page.length) { done = true; break; }
    const oldest = page.reduce((m, x) => Math.min(m, x[0]), Infinity);
    // The edge second is asked again (+1) so a second split across two pages is never lost; mergeEvents dedupes.
    const next = oldest + 1;
    if (cursor && next >= cursor) { cursor = oldest; } else cursor = next;
  }
  const oldest = events.length ? events[events.length - 1][0] : 0;
  return { events, oldest, done };
}

async function probe() {
  const names = arg("--probe").split(",").map((s) => s.trim()).filter(Boolean);
  const pages = Math.max(1, Math.min(200, Number(arg("--pages", "20")) || 20));
  const budgetMs = (Number(process.env.TIME_BUDGET_MIN) || 25) * 60_000;
  const t0 = Date.now();
  const index = readJson(path.join(DATA_DIR, "index.json"), { players: [] });
  const outDir = path.join(ROOT, "scrim-probe");
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const want of names) {
    if (Date.now() - t0 > budgetMs) { console.log(`time budget reached before ${want}`); break; }
    const e = index.players.find((p) => p.key === want) || index.players.find((p) => p.slug === slugKey(want));
    if (!e) { console.log(`::warning::${want}: not in data-ps/index.json`); continue; }
    const { ns, cid } = parsePsKey(e.key);
    const base = censusNsBase(ns, SERVICE_ID);
    try {
      const r = await pageBack(base, cid, { pages });
      fs.writeFileSync(path.join(outDir, `${e.key}.json`), JSON.stringify({ name: e.name, key: e.key, server: PS_SERVERS[ns].name, cid, done: r.done, events: r.events }));
      const line = `${e.name} (${e.key}): ${r.events.length} events back to ${r.oldest ? new Date(r.oldest * 1000).toISOString().slice(0, 10) : "-"}${r.done ? " (whole history)" : ""}`;
      console.log(line);
      summary.push(line);
    } catch (err) {
      console.log(`::warning::${e.name}: ${err.message || err}`);
    }
  }
  console.log(`::notice::scrim probe: ${summary.length} players. ${summary.slice(0, 6).join(" | ")}`.slice(0, 3900));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--probe")) await probe();
  else { console.error("usage: node scripts/ps-scrims.mjs --probe \"Name1,Name2\" [--pages 20]"); process.exit(2); }
}
