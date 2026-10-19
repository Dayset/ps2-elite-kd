#!/usr/bin/env node
/**
 * Backfill the alert archive from the PS2Alerts history cache (history/fetch.mjs
 * output), via the Worker's keyed POST /archive/ingest. Runs in GitHub Actions
 * (oracle-archive-backfill.yml, hourly while it has work). Incremental: keys the
 * archive already holds are skipped, so new history from later fetches is picked
 * up by the next run and nothing is written twice.
 *
 *   ORACLE_API=… ORACLE_KEY=… node oracle-worker/history/ingest.mjs --in history/alerts.jsonl \
 *     [--max 300] [--since 2024-10-01] [--dry-run] [--no-score]
 *
 * Guards: stops below the D1 cap (BUDGET_BYTES, the database holds 500 MB) and
 * counting what this run would add; at most --max bundles per run; batches of 20
 * (the Worker's limit), halved on a server error.
 *
 * D1 reads are the scarce resource (free plan: 5M rows/day for the whole account,
 * shared with the live oracle). Listing the whole archive reads every row, so it
 * happens at most once a day (LIST_EVERY_S); in between, --state (a small file kept
 * in its own Actions cache) remembers what was posted and the bytes added since.
 */
import fs from "node:fs";
import { bundleFrom } from "./bundle.mjs";

export const BUDGET_BYTES = 350 * 1024 * 1024;
export const LIST_EVERY_S = 86400;
const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
const KEY = process.env.ORACLE_KEY || "";
const UA = "ps2-oracle-archive-backfill (github.com/dayset/ps2-elite-kd)";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const notice = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/\n/g, " ").slice(0, 900)}`);
const warn = (msg) => console.log(`::warning::${String(msg).replace(/\n/g, " ").slice(0, 900)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Records (one per line) -> { todo: bundles newest first, stats }.
 * have: Map key -> {source, start_ts} already in the archive.
 */
export function plan(lines, have, opts = {}) {
  const skipped = {};
  const byKey = new Map();
  let collisions = 0, usable = 0;
  for (const line of lines) {
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { skipped["bad json"] = (skipped["bad json"] || 0) + 1; continue; }
    const r = bundleFrom(rec, opts);
    if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; continue; }
    usable++;
    const b = r.bundle;
    const prev = byKey.get(b.key);
    if (prev) { collisions++; if (prev.start_ts >= b.start_ts) continue; }   // recycled instance id: keep the newest
    byKey.set(b.key, b);
  }
  const todo = [];
  let archived = 0, archiveCollisions = 0;
  for (const b of byKey.values()) {
    const h = have.get(b.key);
    if (h) { archived++; if (h.start_ts !== b.start_ts) archiveCollisions++; continue; }
    todo.push(b);
  }
  todo.sort((a, b) => b.start_ts - a.start_ts);
  return { todo, stats: { usable, unique: byKey.size, collisions, archived, archiveCollisions, skipped } };
}

/** Byte size summary of bundles as the Worker stores them (JSON text). */
export function sizes(bundles) {
  const s = bundles.map((b) => JSON.stringify(b).length).sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0);
  return { n: s.length, total: s.reduce((t, x) => t + x, 0), mean: s.length ? Math.round(s.reduce((t, x) => t + x, 0) / s.length) : 0, p50: q(0.5), p95: q(0.95), max: q(1) };
}

async function getJson(path) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API + path, { headers: { "User-Agent": UA } });
      if (r.ok) return await r.json();
      if (r.status < 500) return null;
    } catch {}
    await sleep(2000 * (i + 1));
  }
  return null;
}

/** Every archived key with its source and start (all sources: Worker bundles must not be re-posted either). */
async function archived() {
  const have = new Map();
  let totalBytes = null, total = null;
  for (let before = 4e9, page = 0; page < 200; page++) {
    // The first page carries the totals (the Worker only computes them without `before`).
    const l = await getJson(`/archive/list?limit=500${page ? `&before=${before}` : ""}`);
    if (!l || !Array.isArray(l.alerts)) { if (page === 0) throw new Error("archive list unavailable"); break; }
    if (page === 0) { totalBytes = l.total_bytes; total = l.total; }
    for (const x of l.alerts) have.set(x.key, { source: x.source, start_ts: x.start_ts });
    if (l.alerts.length < 500) break;
    before = l.alerts[l.alerts.length - 1].start_ts;
  }
  return { have, totalBytes, total };
}

async function post(batch) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API + "/archive/ingest", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Oracle-Key": KEY, "User-Agent": UA },
        body: JSON.stringify({ bundles: batch }),
      });
      if (r.ok) return { ok: true, results: (await r.json()).results || [] };
      if (r.status === 403) return { fatal: "forbidden (check ORACLE_KEY)" };
      if (r.status < 500) return { error: `HTTP ${r.status}` };
    } catch (e) { if (i === 2) return { error: String(e && e.message) }; }
    await sleep(3000 * (i + 1));
  }
  return { error: "server error" };
}

/** Ingest state: keys this job posted (or found archived) and the archive size at the last full listing. */
export function loadState(text) {
  try {
    const s = JSON.parse(text);
    if (s && typeof s.keys === "object") return { keys: s.keys, listed_ts: s.listed_ts || 0, list_bytes: s.list_bytes || 0, list_total: s.list_total || 0, added_bytes: s.added_bytes || 0 };
  } catch {}
  return { keys: {}, listed_ts: 0, list_bytes: 0, list_total: 0, added_bytes: 0 };
}

/** Is a full listing due? Yes without state, after LIST_EVERY_S, or when asked. */
export const listDue = (st, nowS, force = false) => force || !st.listed_ts || nowS - st.listed_ts >= LIST_EVERY_S;

async function main() {
  const input = arg("--in", "history/alerts.jsonl");
  const statePath = arg("--state", "history-state/ingest.json");
  const max = +arg("--max", 300) || 300;
  const since = Math.floor(Date.parse(arg("--since", "2024-10-01T00:00:00Z")) / 1000);
  const dry = flag("--dry-run");
  if (!fs.existsSync(input)) { notice("archive backfill", `no history cache at ${input}; run oracle-history.yml (fetch) first`); return; }
  if (!dry && !KEY) throw new Error("ORACLE_KEY is not set");

  const nowS = Math.floor(Date.now() / 1000);
  const st = loadState(fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "");
  let have, totalBytes, total;
  if (listDue(st, nowS, flag("--list"))) {
    // A Worker that can't read its database (e.g. D1's daily read limit) is not this job's failure: retry next hour.
    try { ({ have, totalBytes, total } = await archived()); }
    catch (e) { warn(`archive unreachable (${e.message}); nothing posted, next hourly run retries`); return; }
    st.listed_ts = nowS; st.list_bytes = totalBytes || 0; st.list_total = total || 0; st.added_bytes = 0;
    for (const [k, v] of have) st.keys[k] = v.start_ts;
  } else {
    have = new Map(Object.entries(st.keys).map(([k, t]) => [k, { start_ts: t }]));
    totalBytes = st.list_bytes + st.added_bytes; total = st.list_total;
  }
  const saveState = () => { fs.mkdirSync(statePath.replace(/\/[^/]*$/, ""), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(st)); };
  const lines = fs.readFileSync(input, "utf8").split("\n");
  const { todo, stats } = plan(lines, have, { since, score: !flag("--no-score") });
  const all = sizes(todo);
  notice("archive queue", `${stats.usable} usable PS2Alerts alerts since ${new Date(since * 1000).toISOString().slice(0, 10)} (${stats.unique} unique keys, ${stats.collisions} recycled ids), ${stats.archived} already archived (${stats.archiveCollisions} with a different start), ${todo.length} to go; skipped ${JSON.stringify(stats.skipped)}`);
  notice("archive sizes", `to go: mean ${all.mean} B, p50 ${all.p50}, p95 ${all.p95}, max ${all.max}; all of it ${(all.total / 1048576).toFixed(1)} MB; archive ~${((totalBytes || 0) / 1048576).toFixed(1)} MB of ${(BUDGET_BYTES / 1048576).toFixed(0)} MB budget (${st.listed_ts === nowS ? "listed now" : "from state, listed " + new Date(st.listed_ts * 1000).toISOString().slice(0, 16) + "Z"}, ${total} bundles then)`);
  if ((totalBytes || 0) > BUDGET_BYTES) { warn(`archive is over the ${BUDGET_BYTES / 1048576} MB budget (${(totalBytes / 1048576).toFixed(1)} MB); not ingesting`); return; }
  if (!todo.length) { saveState(); notice("archive backfill", "nothing left to ingest"); return; }

  // Take the newest first, within the per-run cap and what is left of the byte budget.
  const run = [];
  let bytes = totalBytes || 0;
  for (const b of todo) {
    if (run.length >= max) break;
    const n = JSON.stringify(b).length;
    if (bytes + n > BUDGET_BYTES) { warn(`stopping at the ${BUDGET_BYTES / 1048576} MB budget`); break; }
    bytes += n; run.push(b);
  }
  if (dry) { notice("archive dry run", `would ingest ${run.length} bundles (${(sizes(run).total / 1048576).toFixed(2)} MB), newest ${run[0].key}, oldest ${run[run.length - 1].key}`); return; }

  const res = { ok: 0, skipped: 0, invalid: 0, failed: 0 };
  let size = 20;
  for (let i = 0; i < run.length;) {
    const batch = run.slice(i, i + size);
    const r = await post(batch);
    if (r.fatal) throw new Error(r.fatal);
    if (r.error) {
      if (size > 5) { size = Math.ceil(size / 2); continue; }   // retry the same bundles in smaller batches
      res.failed += batch.length; i += batch.length; continue;
    }
    const byKey = new Map(batch.map((b) => [b.key, b]));
    for (const x of r.results) {
      const b = byKey.get(x.key);
      if (x.ok) { res.ok++; st.keys[x.key] = b.start_ts; st.added_bytes += x.bytes || JSON.stringify(b).length; }
      else if (x.skipped) { res.skipped++; st.keys[x.key] = b.start_ts; }
      else if (x.error === "invalid") { res.invalid++; if (res.invalid <= 3) warn(`invalid bundle ${x.key}`); } else res.failed++;
    }
    saveState();
    i += batch.length;
    await sleep(250);
  }
  notice("archive backfill", `ingested ${res.ok}, skipped ${res.skipped} (Worker bundle exists), invalid ${res.invalid}, failed ${res.failed}; ${todo.length - run.length} left for later runs`);
  if (res.invalid || res.failed) process.exitCode = res.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack}`); process.exit(1); });
