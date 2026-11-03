#!/usr/bin/env node
/**
 * 📊 Rival measurement (replay #92): pick ~300 pairs from the cached PC
 * killboards, read one player's Census history per pair (through the cache
 * Worker proxy in Actions, direct locally), and measure the shape of fights
 * between two regulars for the duel planner (#96).
 *
 *   node scripts/measure-rivalries.mjs [--budget-min 25] [--limit N] [--dry]
 *
 * Resumable by design: the per-pair checkpoint (data/replay/
 * pair-measure-checkpoint.json, keyed by "slug|slug", numbers only) persists
 * across runs; each run measures the pairs the checkpoint lacks until its
 * time budget runs out, then recomputes data/replay/pair-model.json
 * (aggregates only, no names or ids) and commits both. A later run picks up
 * where the last one stopped — no pair list file to go stale, because the
 * candidate list is recomputed from the cache each run (hourly refreshes
 * move KPM slightly; measured pairs keep their checkpoint entries).
 *
 * Pair rules: both players in the data/replay shards, pair kills+deaths ≥ 10
 * from a cached killboard row, both KPM 0.11–1.7, different factions, neither
 * opted out (data/opt-out.json, by cid or by name), stratifiable by iVi
 * (both adjs > 0). Stratified 3 volume bands (10–23 / 24–47 / 48+) × 3
 * expected-share bands (<0.4 / 0.4–0.6 / >0.6), round-robin, plus
 * Tolyano vs Fantom220TR forced in. Per pair: the pagerOf player's history
 * (fewer kills+deaths per minute reaches further back per page) until the
 * killboard count is found or 20 pages, respecting pairFloor.
 *
 * Pacing: CENSUS_RPM (default 40) between Census calls; the cache Worker
 * proxy when CENSUS_PROXY is set (Actions), direct Census otherwise.
 * A pair that errors is skipped, not stored, so a later run retries it.
 * Exit 1 only when nothing could be measured at all (proxy auth failure,
 * Census down, selection failure) — a partial run still commits progress.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pagerOf, readPairPages, pairEvents, fightsOf, pairFloor, duelExpected, bareName } from "../duels.mjs";
import { slugOf } from "../replay/shard.mjs";
import { measurePair, aggregate } from "../replay/pair-model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS_HOST = "https://census.daybreakgames.com";
const CENSUS = `${CENSUS_HOST}/s:${encodeURIComponent((process.env.CENSUS_SERVICE_ID || "daysetps2legends").replace(/^s:/, ""))}/get/ps2:v2/`;
const PROXY = (process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const PROXY_KEY = process.env.CENSUS_PROXY_KEY || "";
const RPM = Math.max(1, Number(process.env.CENSUS_RPM) || 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0, calls = 0;
async function fetchJson(url, retries = 4) {
  let target = url, headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (ps2-elite-kd measure-rivalries)" };
  if (PROXY && url.startsWith(CENSUS_HOST + "/")) {
    target = `${PROXY}/census${url.slice(CENSUS_HOST.length)}`;
    if (PROXY_KEY) headers["X-Proxy-Key"] = PROXY_KEY;
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = (60000 / RPM) - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); calls++;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(target, { headers, signal: ctrl.signal });
      clearTimeout(to);
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`proxy auth ${res.status}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j && j.error) throw new Error(`Census error: ${j.error}`);
      return j;
    } catch (e) {
      if (e.fatal) throw e;
      if (attempt === retries) throw e;
      await sleep(2000 * (attempt + 1) + Math.random() * 1000);
    }
  }
}
const get = (url) => fetchJson(url);
const notice = (s) => console.log(`::notice::${s}`);

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
  if (!m) continue;
  if (m[2] !== undefined) args[m[1]] = m[2];
  else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[m[1]] = argv[++i];
  else args[m[1]] = true;
}
const BUDGET_MIN = Number(args["budget-min"]) || 25;
const LIMIT = Number(args.limit) || 0;
const DRY = !!args.dry;
const t0 = Date.now();
const budgetLeft = () => (BUDGET_MIN * 60000 - (Date.now() - t0)) / 1000;

// ---------------------------------------------------------------- selection
// Shards are keyed by slug (replay/shard.mjs); player files live at
// data/players/<slug>.json and carry the cid the Census reads need.
const shards = {};
for (const f of readdirSync(join(ROOT, "data/replay")).filter((x) => /^[0-9a-f]{2}\.json$/.test(x))) {
  const d = JSON.parse(readFileSync(join(ROOT, "data/replay", f), "utf8"));
  for (const [slug, e] of Object.entries(d.p || {})) shards[slug] = e;
}
const bySlug = new Map(); // slug -> { cid, created, kpm, kd, rows }
for (const f of readdirSync(join(ROOT, "data/players")).filter((x) => x.endsWith(".json")).sort()) {
  let d;
  try { d = JSON.parse(readFileSync(join(ROOT, "data/players", f), "utf8")); } catch { continue; }
  const p = d && d.player;
  if (!p || !p.cid) continue;
  bySlug.set(f.slice(0, -5), { cid: String(p.cid), created: +(p.times && p.times.created) || 0, kpm: +p.global_kpm, kd: +p.global_kd, rows: p.rows || [] });
}
const optOut = JSON.parse(readFileSync(join(ROOT, "data/opt-out.json"), "utf8")).players || {};
const outCids = new Set(), outSlugs = new Set();
for (const k of Object.keys(optOut)) {
  if (/^\d+$/.test(k)) outCids.add(k);
  else outSlugs.add(slugOf(k));
}
const fit = JSON.parse(readFileSync(join(ROOT, "data/duel-ivi-fit.json"), "utf8"));
const shardStat = (slug) => {
  const e = shards[slug];
  if (!e || !Array.isArray(e.v)) return null;
  return { kpm: e.v[1], kd: e.v[0], adjs: e.v[9], hsr: e.v[4] != null ? e.v[4] / 100 : null, veh: e.v[8] != null ? e.v[8] / 100 : null, faction: e.f || null, main: Array.isArray(e.m) ? e.m[0] : null };
};
const optedOut = (slug) => outCids.has(bySlug.get(slug)?.cid || "") || outSlugs.has(slug);
const volBand = (v) => (v < 24 ? "10-23" : v < 48 ? "24-47" : "48+");
const shareBand = (s) => (s < 0.4 ? "<0.4" : s <= 0.6 ? "0.4-0.6" : ">0.6");
const seen = new Set(), cells = {};
for (const [aSlug, a] of [...bySlug.entries()].sort()) {
  for (const row of a.rows) {
    const bSlug = slugOf(row.name || "");
    if (!bSlug || bSlug === aSlug || !bySlug.has(bSlug)) continue;
    const [s1, s2] = aSlug < bSlug ? [aSlug, bSlug] : [bSlug, aSlug];
    const pairKey = `${s1}|${s2}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const st1 = shardStat(s1), st2 = shardStat(s2);
    if (!st1 || !st2 || !st1.faction || !st2.faction || st1.faction === st2.faction) continue;
    if (optedOut(s1) || optedOut(s2)) continue;
    const kpm1 = bySlug.get(s1).kpm, kpm2 = bySlug.get(s2).kpm;
    if (!(kpm1 >= 0.11 && kpm1 <= 1.7 && kpm2 >= 0.11 && kpm2 <= 1.7)) continue;
    const vol = (+row.kills || 0) + (+row.deaths || 0);
    if (vol < 10) continue;
    if (!(st1.adjs > 0) || !(st2.adjs > 0)) continue;
    const share = duelExpected(st1.adjs, st2.adjs, fit, st1.veh, st2.veh);
    if (share == null) continue;
    const killsA = aSlug === s1 ? (+row.kills || 0) : (+row.deaths || 0);
    const band = `${volBand(vol)}|${shareBand(share)}`;
    (cells[band] ||= []).push({ a: s1, b: s2, key: pairKey, vol, killsA, band, share });
  }
}
const cellNames = Object.keys(cells).sort();
for (const c of cellNames) cells[c].sort((x, y) => (x.key < y.key ? -1 : 1));
const picked = [];
{
  const idx = Object.fromEntries(cellNames.map((c) => [c, 0]));
  while (picked.length < 300) {
    let took = false;
    for (const c of cellNames) {
      if (picked.length >= 300) break;
      if (idx[c] < cells[c].length) { picked.push(cells[c][idx[c]++]); took = true; }
    }
    if (!took) break;
  }
}
if (bySlug.has("tolyano") && bySlug.has("fantom220tr") && shards.tolyano && shards.fantom220tr) {
  const [s1, s2] = "tolyano" < "fantom220tr" ? ["tolyano", "fantom220tr"] : ["fantom220tr", "tolyano"];
  const key = `${s1}|${s2}`;
  if (!picked.some((p) => p.key === key)) {
    const row = (bySlug.get(s1).rows || []).find((r) => slugOf(r.name || "") === s2)
      || (bySlug.get(s2).rows || []).find((r) => slugOf(r.name || "") === s1);
    const vol = row ? (+row.kills || 0) + (+row.deaths || 0) : 0;
    const killsA = row ? (bySlug.get(s1).rows.includes(row) ? (+row.kills || 0) : (+row.deaths || 0)) : 0;
    const st1 = shardStat(s1), st2 = shardStat(s2);
    const share = (st1 && st2) ? duelExpected(st1.adjs, st2.adjs, fit, st1.veh, st2.veh) : null;
    picked.unshift({ a: s1, b: s2, key, vol, killsA, band: `${volBand(vol)}|${share != null ? shareBand(share) : "?"}`, share });
    console.log(`  forced pair Tolyano-Fantom220TR in (vol ${vol})`);
  }
} else console.log("  WARNING: Tolyano/Fantom220TR not in shards+cache, forced pair skipped");
console.log(`picked ${picked.length} pairs across ${cellNames.length} cells; row pairs seen ${seen.size}`);
for (const c of cellNames) console.log(`  cell ${c}: ${cells[c].length} candidates`);
if (DRY) { console.log("dry run: no Census calls"); process.exit(0); }

// ---------------------------------------------------------------- checkpoint
const CKPT = join(ROOT, "data/replay/pair-measure-checkpoint.json");
const MODEL = join(ROOT, "data/replay/pair-model.json");
let ckpt = { v: 1, at: new Date().toISOString(), pairs: {} };
if (existsSync(CKPT)) {
  try { ckpt = JSON.parse(readFileSync(CKPT, "utf8")); } catch { console.log("  WARNING: checkpoint unreadable, starting fresh"); }
  if (!ckpt.pairs) ckpt.pairs = {};
}
const measuredKeys = new Set(Object.keys(ckpt.pairs));
const todo = picked.filter((p) => !measuredKeys.has(p.key));
notice(`measure start: ${picked.length} picked, ${measuredKeys.size} already measured, ${todo.length} to do, budget ${BUDGET_MIN} min at ${RPM} RPM`);
console.log(`to do: ${todo.length} pairs, budget ${budgetLeft().toFixed(0)} s left`);

// ---------------------------------------------------------------- measure
let done = 0, failed = 0, pages = 0;
for (const pair of todo) {
  if (LIMIT && done >= LIMIT) break;
  if (budgetLeft() < 120) { console.log(`budget nearly out (${budgetLeft().toFixed(0)} s), stopping`); break; }
  const s1 = shardStat(pair.a), s2 = shardStat(pair.b);
  const p1 = bySlug.get(pair.a), p2 = bySlug.get(pair.b);
  if (!s1 || !s2 || !p1 || !p2) { failed++; continue; }
  const pager = pagerOf({ global_kpm: p1.kpm, global_kd: p1.kd, slug: pair.a },
    { global_kpm: p2.kpm, global_kd: p2.kd, slug: pair.b });
  const pagerSlug = pager.slug, pagerCid = bySlug.get(pagerSlug).cid;
  const qid = pagerSlug === pair.a ? p2.cid : p1.cid;
  const pIsA = pagerSlug === pair.a;
  const floor = pairFloor({ times: { created: p1.created } }, { times: { created: p2.created } }).floor;
  const st = { pid: pagerCid, qid, all: [], cursor: 0 };
  try {
    await readPairPages(st, { base: CENSUS, get, pages: 20, need: pair.vol, floor });
    pages += st.pages || 0;
    const pe = pairEvents(st.all, qid, pIsA);
    if (!pe.length) { console.log(`  ${pair.key}: no pair events in ${st.pages || 0} pages, skipped (retry later)`); failed++; continue; }
    const found = st.all.filter((x) => String(x[2]) === String(qid)).length;
    const complete = found >= pair.vol || !!st.done;
    const fights = fightsOf(pe, st.all, pagerCid);
    const m = measurePair(pe, fights, st.all, pagerCid, qid,
      { hsr: s1.hsr, veh: s1.veh }, { hsr: s2.hsr, veh: s2.veh },
      s1.main, s2.main);
    ckpt.pairs[pair.key] = {
      ...m, band: pair.band, vol: pair.vol, killsA_kb: pair.killsA,
      complete: complete ? 1 : 0,
      shareKillboard: pair.vol ? pair.killsA / pair.vol : null,
      shareExpected: pair.share,
      pages: st.pages || 0, truncated: complete ? 0 : 1,
    };
    ckpt.at = new Date().toISOString();
    writeFileSync(CKPT, JSON.stringify(ckpt, null, 1) + "\n");
    done++;
    if (done % 25 === 0) console.log(`  ${done} measured this run, ${Object.keys(ckpt.pairs).length} total, ${pages} pages, ${calls} calls, ${budgetLeft().toFixed(0)} s left`);
  } catch (e) {
    if (e.fatal) { console.log(`::error::${e.message} — aborting run`); process.exitCode = 1; break; }
    console.log(`  ${pair.key}: FAILED (${e.message}), skipped`);
    failed++;
  }
}

// ---------------------------------------------------------------- model
const nonEmpty = Object.values(ckpt.pairs).filter((m) => m && m.pairKills > 0);
if (nonEmpty.length) {
  const model = aggregate(nonEmpty);
  writeFileSync(MODEL, JSON.stringify(model, null, 1) + "\n");
  const d = model.defaults;
  notice(`measure done: ${done} this run, ${nonEmpty.length} pairs total, ${pages} pages, ${calls} calls, ${failed} failed — gap median ${d.gapMedianS?.toFixed(0)}s σ ${d.gapSigma?.toFixed(2)}, kills/fight p50 ${d.killsPerFight?.[1]}, streakP ${d.streakP?.toFixed(2)}, 1v1 ${d.oneVoneShare?.toFixed(2)}, crowd ${d.crowdPerMin?.toFixed(2)}/min`);
  console.log(`model: ${nonEmpty.length} pairs, ${Object.keys(model.bands).length} bands`);
} else {
  console.log("no non-empty measurements yet, pair-model.json not written");
  if (done === 0 && failed >= 5) { console.log("::error::nothing measured and failures present"); process.exitCode = 1; }
}
console.log(`run: done ${done}, failed ${failed}, pages ${pages}, calls ${calls}, elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
