#!/usr/bin/env node
/**
 * PS2Alerts history -> compact alert records (one JSON line each) for growing
 * the win trees and for the archive. Runs in GitHub Actions (oracle-history.yml).
 *
 *   node oracle-worker/history/fetch.mjs --out history/alerts.jsonl [--minutes 300] [--probe]
 *
 * Record: { id, world, zone, event, start, end, dur, result:{victor,draw,vs,nc,tr,cutoff,outOfPlay},
 *           init:{fid:fac}, flips:[[sec_from_start, fid, newFac, oldFac]], ctl?:[[sec, vs, nc, tr, cutoff]] }
 * fac: 0 neutral, 1 VS, 2 NC, 3 TR. Resumable: ids already in --out are skipped.
 * Polite: one request at a time, >= 1.1 s apart, own User-Agent, retries with backoff.
 */
import fs from "node:fs";

const BASE = "https://api.ps2alerts.com";
const UA = "ps2-elite-kd-oracle/1.0 (+https://dayset.github.io/ps2-elite-kd/oracle/; github.com/dayset/ps2-elite-kd; history for win trees, ~1 req/s)";
const WORLDS = [1, 10, 13, 17, 19, 40];
const ZONES = new Set([2, 4, 6, 8, 344]);
const GAP_MS = 1100;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const notice = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/\n/g, " ").slice(0, 900)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0, calls = 0;
async function get(path) {
  for (let i = 0; i < 5; i++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now(); calls++;
    try {
      const r = await fetch(BASE + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) return { error: r.status };
      return await r.json();
    } catch (e) { await sleep(5000 * (i + 1)); }
  }
  return { error: "retries" };
}

const ts = (s) => Math.floor(Date.parse(s) / 1000);
const facOf = (x) => (x == null ? 0 : +x || 0);

/** PS2Alerts instance + facility entries -> compact record, or {skip}. */
export function compact(inst, entries) {
  const start = ts(inst.timeStarted), end = inst.timeEnded ? ts(inst.timeEnded) : null;
  const init = {}, flips = [], ctl = [];
  for (const e of entries) {
    const fid = String(e.facility && typeof e.facility === "object" ? e.facility.id ?? e.facility.facilityId : e.facility);
    if (e.isInitial) { init[fid] = facOf(e.newFaction); continue; }
    const sec = ts(e.timestamp) - start;
    if (facOf(e.oldFaction) !== facOf(e.newFaction)) flips.push([sec, fid, facOf(e.newFaction), facOf(e.oldFaction)]);
    const mc = e.mapControl;
    if (mc && typeof mc === "object") ctl.push([sec, +mc.vs || 0, +mc.nc || 0, +mc.tr || 0, +(mc.cutoff ?? 0) || 0]);
  }
  flips.sort((a, b) => a[0] - b[0]);
  const r = inst.result || {};
  return {
    id: inst.instanceId, world: inst.world, zone: inst.zone, event: inst.censusMetagameEventType ?? null,
    start, end, dur: inst.duration ? Math.round(inst.duration / 60000) : null,
    result: { victor: r.victor ?? null, draw: !!r.draw, vs: r.vs ?? null, nc: r.nc ?? null, tr: r.tr ?? null, cutoff: r.cutoff ?? null, outOfPlay: r.outOfPlay ?? null },
    init, flips, ...(ctl.length ? { ctl } : {}),
  };
}

async function listWorld(w, page) {
  const d = await get(`/instances/territory-control?world=${w}&pageSize=1000&page=${page}&sortBy=timeStarted&order=desc`);
  return Array.isArray(d) ? d : Array.isArray(d && d.data) ? d.data : [];
}

async function probe() {
  const p1 = await listWorld(10, 1), p2 = await listWorld(10, 2);   // pages are 1-based
  notice("probe list", `page0 ${p1.length} rows, page1 ${p2.length} rows, same first id: ${p1[0] && p2[0] ? p1[0].instanceId === p2[0].instanceId : "n/a"}; first ${p1[0] && p1[0].timeStarted}, last ${p1.at(-1) && p1.at(-1).timeStarted}, page1 last ${p2.at(-1) && p2.at(-1).timeStarted}`);
  const a = p1.find((x) => x.state === 2 && ZONES.has(x.zone)) || p1[0];
  if (!a) return;
  notice("probe instance keys", Object.keys(a).join(","));
  notice("probe instance", JSON.stringify({ ...a, features: undefined }).slice(0, 800));
  const f = await get(`/instance-entries/${a.instanceId}/facility?pageSize=2000&sortBy=timestamp&order=asc`);
  const list = Array.isArray(f) ? f : (f && f.data) || [];
  notice("probe facility", `${list.length} entries; keys ${list[0] ? Object.keys(list[0]).join(",") : "none"}`);
  const cap = list.find((e) => !e.isInitial && e.oldFaction !== e.newFaction) || list[0];
  if (cap) notice("probe capture", JSON.stringify(cap).slice(0, 800));
  const c = compact(a, list);
  notice("probe compact", `init ${Object.keys(c.init).length}, flips ${c.flips.length}, ctl ${c.ctl ? c.ctl.length : 0}, sample fid ${Object.keys(c.init)[0]}; result ${JSON.stringify(c.result)}`);
  const years = {};
  for (const x of [...p1, ...p2]) { const y = String(x.timeStarted).slice(0, 4); years[y] = (years[y] || 0) + 1; }
  notice("probe years (world 10, 2 pages)", JSON.stringify(years));
}

async function main() {
  if (flag("--probe")) return probe();
  const out = arg("--out", "history/alerts.jsonl");
  const budgetMs = +arg("--minutes", 300) * 60000;
  const t0 = Date.now();
  fs.mkdirSync(out.replace(/\/[^/]*$/, ""), { recursive: true });
  const have = new Set();
  if (fs.existsSync(out)) for (const line of fs.readFileSync(out, "utf8").split("\n")) if (line) { try { have.add(JSON.parse(line).id); } catch {} }
  const done = out + ".done";                  // worlds/pages fully listed
  const lists = fs.existsSync(done) ? JSON.parse(fs.readFileSync(done, "utf8")) : {};
  let added = 0, skipped = 0, failed = 0;
  const todo = [];
  for (const w of WORLDS) {
    for (let page = 1; page <= 100; page++) {
      if (Date.now() - t0 > budgetMs * 0.1 && todo.length > 5000) break;
      const rows = await listWorld(w, page);
      const fresh = rows.filter((a) => a.state === 2 && ZONES.has(a.zone) && !have.has(a.instanceId));
      todo.push(...fresh);
      if (rows.length < 1000 || (page > 1 && rows.length && lists[`${w}`] && rows.every((a) => have.has(a.instanceId)))) break;
    }
    lists[`${w}`] = Date.now();
  }
  notice("history todo", `${todo.length} new alerts listed (${have.size} already stored), ${calls} list calls`);
  const fd = fs.openSync(out, "a");
  for (const a of todo) {
    if (Date.now() - t0 > budgetMs) break;
    const f = await get(`/instance-entries/${a.instanceId}/facility?pageSize=5000&sortBy=timestamp&order=asc`);
    const list = Array.isArray(f) ? f : (f && f.data) || null;
    if (!list) { failed++; continue; }
    if (!list.some((e) => e.isInitial)) { skipped++; continue; }
    fs.writeSync(fd, JSON.stringify(compact(a, list)) + "\n");
    have.add(a.instanceId); added++;
  }
  fs.closeSync(fd);
  fs.writeFileSync(done, JSON.stringify(lists));
  notice("history fetch", `added ${added}, skipped ${skipped} (no initial map), failed ${failed}, stored ${have.size}, calls ${calls}, ${Math.round((Date.now() - t0) / 60000)} min; ${todo.length - added - skipped - failed} left for the next run`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack}`); process.exit(1); });
