#!/usr/bin/env node
/**
 * Per-base capture chances for every continent ("Model B" of
 * oracle/backend/hossin_models.py, which only covered Hossin): P(a frontier base
 * is captured by attacker B within 15 min | pressure), per base.
 *
 *   frontier  base f owned by A with at least one lattice neighbour owned by B
 *   pressure  P1 when one of those B neighbours flipped to B in the last 15 min, else P0
 *   sampled   every 5 minutes, t = 0 .. duration − 15, territory alerts only
 *
 * Output per continent: oracle/backend/<slug>_capture_model.json
 *   {n_alerts, global: {"P1:pressured|mid:30-60": {n, caps, p, ci}}, per_facility: {"<fid>|P1:pressured": {...}}}
 * — the format commander_live.load_capture_model() and build-trees.mjs read.
 * Hossin keeps its own model (7,385 alerts); it is rebuilt here only as a check of
 * the method (capture_model_eval.json: per-base agreement with the existing file).
 *
 * Input: PS2Alerts history records (history/fetch.mjs, the Actions cache) or, when
 * that file is missing, the alert archive via the Worker.
 *   node oracle-worker/history/capture-model.mjs --in history/alerts.jsonl --out oracle/backend
 * Pure parts exported for tests.
 */
import fs from "node:fs";
import path from "node:path";
import { latticeFor } from "../src/models.js";
import { MELTDOWN } from "../src/engine.js";

export const SLUG = { 2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur" };
export const WRITE_ZONES = [2, 6, 8, 344];   // Hossin: check only
const FAC = { VS: 1, NC: 2, TR: 3 };
const MIN_GLOBAL = 50, MIN_FAC = 30;

/** hossin_models.wilson */
export function wilson(p, n, z = 1.96) {
  if (!n) return [0, 0];
  const d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return [r4(Math.max(0, (c - m) / d)), r4(Math.min(1, (c + m) / d))];
}

const minuteBucket = (t) => (t < 30 ? "early:0-30" : t < 60 ? "mid:30-60" : "late:60-90");

/** History record (fetch.mjs compact) -> {key, zone, dur, init: Map, flips: [[min, fid, new]]} or null. */
export function fromRecord(rec) {
  if (!rec || !rec.init || !rec.start || !rec.end) return null;
  if (rec.event != null && MELTDOWN.has(+rec.event)) return null;
  const init = new Map(Object.entries(rec.init).map(([f, o]) => [String(f), +o || 0]));
  const flips = (rec.flips || []).map(([sec, fid, nw]) => [sec / 60, String(fid), +nw || 0]).sort((a, b) => a[0] - b[0]);
  return { key: `${rec.world}-${rec.zone}-${rec.id}`, zone: +rec.zone, dur: (rec.end - rec.start) / 60, init, flips };
}

/** Archive bundle (src/archive.js) -> same shape, or null. */
export function fromBundle(b) {
  if (!b || !Array.isArray(b.frames) || !b.frames.length) return null;
  if (b.event_id != null && MELTDOWN.has(+b.event_id)) return null;
  const fac = (o) => (o ? FAC[o] || 0 : 0);
  const init = new Map(Object.entries(b.frames[0].set || {}).map(([f, o]) => [String(f), fac(o)]));
  const flips = [];
  for (const fr of b.frames.slice(1)) for (const [f, o] of Object.entries(fr.set || {})) flips.push([+fr.t, String(f), fac(o)]);
  flips.sort((a, b2) => a[0] - b2[0]);
  return { key: b.key, zone: +b.zone, dur: +b.dur || 90, init, flips };
}

/** Add one alert's samples to cells: glob[(pb|minb)] and fac[(fid|pb)] = [n, caps]. */
export function addAlert(tl, adj, glob, fac) {
  const byFac = new Map();
  for (const [tm, fid, nw] of tl.flips) { let l = byFac.get(fid); if (!l) byFac.set(fid, (l = [])); l.push([tm, nw]); }
  const own = new Map(tl.init);
  let fi = 0;
  const last = Math.floor(tl.dur) - 15;
  for (let t = 0; t <= last; t += 5) {
    while (fi < tl.flips.length && tl.flips[fi][0] <= t) { own.set(tl.flips[fi][1], tl.flips[fi][2]); fi++; }
    const minb = minuteBucket(t);
    for (const [f, owner] of own) {
      if (!adj.has(f) || !owner) continue;
      const nbs = adj.get(f);
      for (const B of [1, 2, 3]) {
        if (B === owner) continue;
        const bNeigh = [...nbs].filter((nb) => own.get(nb) === B);
        if (!bNeigh.length) continue;
        let press = 0;
        for (const nb of bNeigh) if ((byFac.get(nb) || []).some(([tm, nf]) => t - 15 < tm && tm <= t && nf === B)) { press = 1; break; }
        const cap = (byFac.get(f) || []).some(([tm, nf]) => t < tm && tm <= t + 15 && nf === B) ? 1 : 0;
        const pb = press ? "P1:pressured" : "P0:none";
        const g = `${pb}|${minb}`, k = `${f}|${pb}`;
        const gc = glob.get(g) || [0, 0]; gc[0]++; gc[1] += cap; glob.set(g, gc);
        const fc = fac.get(k) || [0, 0]; fc[0]++; fc[1] += cap; fac.set(k, fc);
      }
    }
  }
}

export function pack(cells, minN) {
  const out = {};
  for (const k of [...cells.keys()].sort()) {
    const [n, c] = cells.get(k);
    if (n < minN) continue;
    const p = c / n;
    out[k] = { n, caps: c, p: Math.round(p * 1e4) / 1e4, ci: wilson(p, n) };
  }
  return out;
}

/** Timelines (any zone) -> {zone: model}. */
export function buildModels(timelines) {
  const acc = new Map();
  for (const tl of timelines) {
    const L = latticeFor(tl.zone);
    if (!L || !SLUG[tl.zone]) continue;
    let a = acc.get(tl.zone);
    if (!a) acc.set(tl.zone, (a = { n: 0, glob: new Map(), fac: new Map() }));
    addAlert(tl, L.adj, a.glob, a.fac);
    a.n++;
  }
  const out = {};
  for (const [z, a] of acc) out[z] = { n_alerts: a.n, global: pack(a.glob, MIN_GLOBAL), per_facility: pack(a.fac, MIN_FAC) };
  return out;
}

/** Agreement of a rebuilt model with a reference one on shared per-base cells. */
export function compare(model, ref) {
  const xs = [], ys = [];
  for (const [k, v] of Object.entries(model.per_facility || {})) {
    const r = (ref.per_facility || {})[k];
    if (r && v.n >= 100 && r.n >= 100) { xs.push(v.p); ys.push(r.p); }
  }
  const n = xs.length;
  if (!n) return { n: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0, mad = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; mad += Math.abs(xs[i] - ys[i]); }
  const g = (m, k) => (m.global || {})[k] ? m.global[k].p : null;
  const gk = Object.keys(ref.global || {});
  return { n, r: Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000, mad: Math.round((mad / n) * 1e4) / 1e4,
    global: Object.fromEntries(gk.map((k) => [k, [g(model, k), g(ref, k)]])) };
}

async function loadArchive() {
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const get = async (p) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-capture-model" } }).catch(() => null);
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
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const a = list[next++];
      const b = await get(`/archive?key=${a.key}`);
      const tl = b && fromBundle({ ...a, ...b });
      if (tl) out.push(tl);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const inFile = arg("--in", "history/alerts.jsonl"), outDir = arg("--out", "oracle/backend");
  let timelines = [], source;
  if (fs.existsSync(inFile)) {
    source = "ps2alerts history";
    const seen = new Set();
    for (const line of fs.readFileSync(inFile, "utf8").split("\n")) {
      if (!line) continue;
      const tl = fromRecord(JSON.parse(line));
      if (tl && !seen.has(tl.key)) { seen.add(tl.key); timelines.push(tl); }
    }
  } else {
    source = "alert archive";
    timelines = await loadArchive();
  }
  const models = buildModels(timelines);
  const evalOut = { built: new Date().toISOString(), source, zones: {} };
  for (const [z, m] of Object.entries(models)) {
    const pr = Object.entries(m.per_facility).filter(([k]) => k.endsWith("P1:pressured"));
    evalOut.zones[z] = { slug: SLUG[z], n_alerts: m.n_alerts, bases_pressured: pr.length, bases_none: Object.keys(m.per_facility).length - pr.length,
      written: WRITE_ZONES.includes(+z) && m.n_alerts >= 100 && pr.length > 0 };
    if (evalOut.zones[z].written) fs.writeFileSync(path.join(outDir, `${SLUG[z]}_capture_model.json`), JSON.stringify(m));
    console.log(`::notice title=capture model ${SLUG[z]}::alerts ${m.n_alerts}, bases with a pressured value ${pr.length}, global ${JSON.stringify(Object.fromEntries(Object.entries(m.global).map(([k, v]) => [k, v.p])))}${evalOut.zones[z].written ? " (written)" : ""}`);
  }
  const refFile = path.join(outDir, "hossin_capture_model.json");
  if (models[4] && fs.existsSync(refFile)) {
    evalOut.hossin_check = compare(models[4], JSON.parse(fs.readFileSync(refFile, "utf8")));
    console.log(`::notice title=capture model method check (Hossin rebuilt vs existing)::${JSON.stringify(evalOut.hossin_check)}`);
  }
  fs.writeFileSync(path.join(outDir, "capture_model_eval.json"), JSON.stringify(evalOut, null, 1) + "\n");
  console.log(`::notice title=capture model source::${source}, ${timelines.length} territory alerts`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
