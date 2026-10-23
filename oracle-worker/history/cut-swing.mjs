#!/usr/bin/env node
/**
 * Measurement for #63: what does losing a chokepoint (a capture that cuts our
 * bases off from the warpgate) cost, compared with losing an ordinary base?
 *
 * Read-only. Uses the alert archive (PS2Alerts backfill + Worker alerts): map
 * frames per capture, lattice from src/models.js, the game's cut rule from
 * src/focus.js (cut bases count for nobody).
 *
 * For every capture of a victim's base in a territory alert (not Meltdowns,
 * not Oshur: lattice gaps) with 15 in-alert minutes after it:
 *   imm   victim's game-scored share right after minus right before
 *   d15   victim's game-scored share 15 min later minus right before (raw too)
 *   prev  victim's scored change over the 15 min before (momentum control)
 *   fate  of the bases the capture cut off, 15 min later: reconnected / still cut / taken
 *   won   did the victim win the alert
 * Cut captures are compared with ordinary captures (same victim, no new cut),
 * matched on momentum, and on the victim's margin right after the capture
 * read raw vs game-scored (tells which reading of the map explains the outcome).
 *
 *   ORACLE_API=https://ps2-oracle.dayset.workers.dev node oracle-worker/history/cut-swing.mjs
 * Runs only where the Worker is reachable (GitHub Actions). First run 2026-10-23,
 * 6,539 alerts: project doc claude/cut-cost-measurement.md.
 */
import { latticeFor } from "../src/models.js";
import { alertKind } from "../src/engine.js";
import { cutOff } from "../src/focus.js";

const FAC = { VS: 1, NC: 2, TR: 3 };
const NAME = { 1: "VS", 2: "NC", 3: "TR" };
const WINDOW = 15;

function shares(own, nonWg, cut) {
  const raw = { 1: 0, 2: 0, 3: 0 }, sc = { 1: 0, 2: 0, 3: 0 };
  for (const fid of nonWg) {
    const o = own.get(fid);
    if (!NAME[o]) continue;
    raw[o]++;
    if (!cut.has(fid)) sc[o]++;
  }
  const n = nonWg.length || 1;
  for (const k of [1, 2, 3]) { raw[k] = (100 * raw[k]) / n; sc[k] = (100 * sc[k]) / n; }
  return { raw, sc };
}

/** One bundle -> capture events (see header). */
export function alertEvents(b) {
  if (!b || !Array.isArray(b.frames) || !b.frames.length) return [];
  if (alertKind(b.event_id) === "meltdown" || +b.zone === 344) return [];
  const L = latticeFor(b.zone);
  if (!L) return [];
  const dur = +b.dur || 90;
  const lat = new Set(L.adj.keys());
  const wg = [...lat].filter((f) => /warpgate/i.test(L.names[f] || ""));
  const nonWg = [...lat].filter((f) => !wg.includes(f));
  // Replay frames into states: one state per single capture.
  const own = new Map();
  for (const f of lat) own.set(f, 0);
  const steps = [];   // {t, fid, from, to, before: Map}
  const states = [];  // {t, own}
  let first = true;
  for (const fr of b.frames) {
    for (const [fid, o] of Object.entries(fr.set || {})) {
      if (!lat.has(fid)) continue;
      const to = o ? FAC[o] || 0 : 0;
      if (first) { own.set(fid, to); continue; }
      const from = own.get(fid);
      if (from === to) continue;
      steps.push({ t: fr.t, fid, from, to, before: new Map(own) });
      own.set(fid, to);
    }
    if (first) { first = false; states.push({ t: 0, own: new Map(own) }); continue; }
    states.push({ t: fr.t, own: new Map(own) });
  }
  const memo = new Map();
  const view = (o) => {
    let v = memo.get(o);
    if (!v) { const { cut, reach } = cutOff(o, L.adj, wg); v = { cut, reach, ...shares(o, nonWg, cut) }; memo.set(o, v); }
    return v;
  };
  const stateAt = (m) => { let s = states[0]; for (const x of states) { if (x.t <= m) s = x; else break; } return s.own; };
  const out = [];
  for (const s of steps) {
    if (!NAME[s.from] || !NAME[s.to]) continue;
    if (s.t + WINDOW > dur - 1) continue;          // no full window inside the alert (end-lock flips)
    const V = s.from;
    const before = view(s.before);
    if (before.cut.has(s.fid)) continue;           // already cut off: not a defendable loss
    const afterOwn = new Map(s.before); afterOwn.set(s.fid, s.to);
    const after = view(afterOwn);
    const newly = [...after.cut].filter((f) => afterOwn.get(f) === V && !before.cut.has(f));
    const o15 = stateAt(s.t + WINDOW), v15 = view(o15);
    const prevOwn = s.t >= WINDOW ? stateAt(s.t - WINDOW) : null;
    const fate = { reconn: 0, still: 0, taken: 0 };
    for (const f of newly) {
      if (o15.get(f) !== V) fate.taken++;
      else if (v15.cut.has(f)) fate.still++;
      else fate.reconn++;
    }
    const others = [1, 2, 3].filter((k) => k !== V);
    out.push({
      key: b.key, zone: +b.zone, t: s.t, frac: s.t / dur, V, sev: newly.length,
      imm: after.sc[V] - before.sc[V], immR: after.raw[V] - before.raw[V],
      d15: v15.sc[V] - before.sc[V], d15R: v15.raw[V] - before.raw[V],
      prev: prevOwn ? before.sc[V] - view(prevOwn).sc[V] : null,
      mSc: after.sc[V] - Math.max(...others.map((k) => after.sc[k])),
      mRaw: after.raw[V] - Math.max(...others.map((k) => after.raw[k])),
      fate, won: b.winner === NAME[V],
    });
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const sevBucket = (n) => (n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : n <= 7 ? "4-7" : "8+");
const momBucket = (p) => (p == null ? "na" : p <= -5 ? "<=-5" : p <= -1 ? "-5..-1" : p < 1 ? "-1..1" : ">=1");
const phase = (f) => (f < 1 / 3 ? "early" : f < 2 / 3 ? "mid" : "late");

/** Cut minus ordinary on `field`, matched on stratum `strat` (weights = cut counts). */
function matchedDiff(evs, field, strat) {
  const g = new Map();
  for (const e of evs) {
    const v = e[field]; if (v == null) continue;
    const k = strat(e); if (k == null) continue;
    let x = g.get(k); if (!x) g.set(k, (x = { c: [], o: [] }));
    (e.sev > 0 ? x.c : x.o).push(typeof v === "boolean" ? +v : v);
  }
  let w = 0, s = 0;
  for (const x of g.values()) if (x.c.length && x.o.length >= 5) { w += x.c.length; s += x.c.length * (mean(x.c) - mean(x.o)); }
  return w ? s / w : NaN;
}

/** 95 % interval by resampling whole alerts (events inside one alert are not independent). */
function boot(evs, fn, n = 200) {
  const by = new Map();
  for (const e of evs) { let a = by.get(e.key); if (!a) by.set(e.key, (a = [])); a.push(e); }
  const keys = [...by.keys()], out = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    const sample = [];
    for (let j = 0; j < keys.length; j++) sample.push(...by.get(keys[Math.floor(rnd() * keys.length)]));
    const v = fn(sample); if (Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]];
}

export function summarize(evs) {
  const cut = evs.filter((e) => e.sev > 0), ord = evs.filter((e) => e.sev === 0);
  const stat = (xs, f) => ({ n: xs.length, mean: r2(mean(xs.map((e) => e[f]))), median: r2(median(xs.map((e) => e[f]))) });
  const bySev = {};
  for (const e of evs) (bySev[sevBucket(e.sev)] ||= []).push(e);
  const sev = Object.fromEntries(Object.entries(bySev).map(([k, xs]) => [k, { n: xs.length, imm: r2(mean(xs.map((e) => e.imm))), d15: r2(mean(xs.map((e) => e.d15))), d15R: r2(mean(xs.map((e) => e.d15R))) }]));
  const momStrat = (e) => `${e.zone}|${momBucket(e.prev)}|${phase(e.frac)}`;
  const d15Matched = matchedDiff(evs, "d15", momStrat), d15RMatched = matchedDiff(evs, "d15R", momStrat);
  const follow = (xs) => mean(xs.map((e) => e.d15 - e.imm));
  const fates = cut.reduce((a, e) => ({ reconn: a.reconn + e.fate.reconn, still: a.still + e.fate.still, taken: a.taken + e.fate.taken }), { reconn: 0, still: 0, taken: 0 });
  const nf = fates.reconn + fates.still + fates.taken || 1;
  const mb = (m) => Math.round(m / 5) * 5;
  const winRaw = (xs) => matchedDiff(xs, "won", (e) => `${e.zone}|${phase(e.frac)}|${mb(e.mRaw)}`);
  const winSc = (xs) => matchedDiff(xs, "won", (e) => `${e.zone}|${phase(e.frac)}|${mb(e.mSc)}`);
  const zones = {};
  for (const z of [2, 4, 6, 8]) {
    const xs = evs.filter((e) => e.zone === z), c = xs.filter((e) => e.sev > 0);
    zones[z] = { cuts: c.length, d15cut: r2(mean(c.map((e) => e.d15))), d15ord: r2(mean(xs.filter((e) => e.sev === 0).map((e) => e.d15))), excess: r2(matchedDiff(xs, "d15", momStrat)) };
  }
  return {
    alerts: new Set(evs.map((e) => e.key)).size, events: evs.length, cuts: cut.length, ordinary: ord.length,
    imm: { cut: stat(cut, "imm"), ord: stat(ord, "imm") },
    d15: { cut: stat(cut, "d15"), ord: stat(ord, "d15") },
    d15R: { cut: stat(cut, "d15R"), ord: stat(ord, "d15R") },
    followOn: { cut: r2(follow(cut)), ord: r2(follow(ord)) },
    excessD15: { matched: r2(d15Matched), ci: boot(evs, (s) => matchedDiff(s, "d15", momStrat)).map(r2) },
    excessD15R: { matched: r2(d15RMatched) },
    excessFollowOn: { matched: r2(matchedDiff(evs.map((e) => ({ ...e, fo: e.d15 - e.imm })), "fo", momStrat)) },
    fates: { n: nf, reconn: r2((100 * fates.reconn) / nf), still: r2((100 * fates.still) / nf), taken: r2((100 * fates.taken) / nf) },
    winGap: { givenRawMargin: r2(100 * winRaw(evs)), ciRaw: boot(evs, winRaw).map((x) => r2(100 * x)), givenScoredMargin: r2(100 * winSc(evs)), ciScored: boot(evs, winSc).map((x) => r2(100 * x)) },
    sev, zones,
  };
}

async function main() {
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const get = async (p) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-cut-swing" } }).catch(() => null);
      if (r && r.ok) return r.json();
      await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
    }
    return null;
  };
  const list = [];
  for (let before = 4e9, page = 0; page < 50; page++) {
    const l = await get(`/archive/list?limit=500&before=${before}`);
    if (!l || !l.alerts || !l.alerts.length) break;
    list.push(...l.alerts);
    before = l.alerts[l.alerts.length - 1].start_ts;
    if (l.alerts.length < 500) break;
  }
  const todo = list.filter((a) => [2, 4, 6, 8].includes(+a.zone));
  const evs = [];
  let next = 0, missing = 0;
  const worker = async () => {
    while (next < todo.length) {
      const a = todo[next++];
      const b = await get(`/archive?key=${a.key}`);
      if (!b) { missing++; continue; }
      evs.push(...alertEvents({ ...a, ...b }));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const s = summarize(evs);
  const j = (o) => JSON.stringify(o);
  console.log(`::notice title=cut-swing coverage::listed ${list.length}, used zones 2/4/6/8 ${todo.length}, missing ${missing}, alerts with events ${s.alerts}, events ${s.events} (cut ${s.cuts}, ordinary ${s.ordinary})`);
  console.log(`::notice title=cut-swing d15 (scored, raw)::scored ${j(s.d15)} raw ${j(s.d15R)}`);
  console.log(`::notice title=cut-swing immediate + follow-on::imm ${j(s.imm)} followOn ${j(s.followOn)}`);
  console.log(`::notice title=cut-swing excess vs ordinary (momentum-matched)::d15 scored ${j(s.excessD15)} raw ${j(s.excessD15R)} followOn ${j(s.excessFollowOn)}`);
  console.log(`::notice title=cut-swing fates of cut bases at +15::${j(s.fates)}`);
  console.log(`::notice title=cut-swing win gap (cut minus ordinary, pp of win rate)::${j(s.winGap)}`);
  console.log(`::notice title=cut-swing by severed count::${j(s.sev)}`);
  console.log(`::notice title=cut-swing by continent::${j(s.zones)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
