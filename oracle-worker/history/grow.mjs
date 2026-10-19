#!/usr/bin/env node
/**
 * Grow win trees from PS2Alerts history (history/fetch.mjs records) in two
 * flavours and compare them on held-out alerts:
 *
 *   std — territory as the Census map shows it (every owned base counts); the
 *         same recipe as oracle/backend/build_winbins_growtree.py
 *   cut — bases cut off from their faction's warpgate count for nobody, which is
 *         how the game scores them (src/cut.js)
 *
 * Also checks the cut rule itself against PS2Alerts' own score at every capture
 * (`mapControl`: vs/nc/tr/cutoff), which validates the lattice per alert.
 *
 *   node oracle-worker/history/grow.mjs --in history/alerts.jsonl --out oracle/backend [--commit true]
 *
 * --commit true writes cut-aware trees grown on ALL usable alerts
 * (winbins_growtree_cut*.json, winbins_xtrunk_cut.json) only when they beat both
 * the regrown standard trees and the production trees on the held-out alerts.
 * First run (2026-10-19, 8,300 alerts): they beat the regrown standard trees but
 * not the production trees (grown on ~36k alerts), so the Worker keeps the
 * production trees and reads the map cut-aware from 80 % of the alert on
 * (engine.CUT_AWARE_FROM), which the same comparison backs.
 * history_eval.json is always written. Exports are pure, for tests.
 */
import fs from "node:fs";
import path from "node:path";
import { computeWin, FACS, brier, MELTDOWN } from "../src/engine.js";
import { latticeFor } from "../src/models.js";
import { splitTree, splitCells } from "../build-trees.mjs";

export const TREE_ZONES = [2, 4, 6, 8, 344];
const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const MIN_N = 20, XTRUNK_MIN_N = 50;
const LEVELS = ["trunk", "branch", "twig", "shoot", "leaf"];

const momBucket = (m) => (m >= 3 ? "up" : m <= -3 ? "down" : "flat");
const margBucket = (g) => (g < 0 ? "behind" : g < 10 ? "close" : g < 20 ? "clear" : "dominant");
const magBucket = (mb, m) => (mb === "up" ? (m >= 8 ? "hot" : "warm") : mb === "down" ? (m <= -8 ? "cold" : "cool") : null);

/** Lattice helpers for a zone: {adj, names, wg:Set(fid), nodes:Set(fid)}. */
const latCache = new Map();
export function lat(zone) {
  if (!latCache.has(zone)) {
    const L = latticeFor(zone);
    // Facilities with no lattice link (Esamir's The Wash and Shattered Warpgate) are out of
    // play: PS2Alerts leaves them out, the Census map shows them neutral.
    const linked = new Set();
    if (L) for (const [a, l] of L.adj) { linked.add(a); l.forEach((x) => linked.add(x)); }
    latCache.set(zone, L ? { adj: L.adj, names: L.names, nodes: new Set(Object.keys(L.names)), linked,
      wg: new Set(Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f]))) } : null);
  }
  return latCache.get(zone);
}

/** fids owned by faction f that are not linked to any warpgate f owns. */
export function cutSet(own, L) {
  const reach = new Set();
  const stack = [];
  for (const w of L.wg) if (FAC[own.get(w)]) stack.push(w);
  while (stack.length) {
    const c = stack.pop();
    if (reach.has(c)) continue;
    reach.add(c);
    const o = own.get(c);
    for (const nb of L.adj.get(c) || []) if (!reach.has(nb) && own.get(nb) === o) stack.push(nb);
  }
  const cut = new Set();
  for (const [fid, o] of own) if (FAC[o] && !reach.has(fid)) {
    // A faction with no warpgate on the map (shouldn't happen on territory alerts) is left alone.
    let hasWg = false;
    for (const w of L.wg) if (own.get(w) === o) { hasWg = true; break; }
    if (hasWg) cut.add(fid);
  }
  return cut;
}

function shares(own, cut, total) {
  const c = { VS: 0, NC: 0, TR: 0 };
  for (const [fid, o] of own) if (FAC[o] && !(cut && cut.has(fid))) c[FAC[o]]++;
  return { VS: (100 * c.VS) / total, NC: (100 * c.NC) / total, TR: (100 * c.TR) / total };
}

/**
 * Does a record's starting map fit our lattice for its zone? null when it does, else
 * {skip}. Facilities PS2Alerts leaves out are fine when they have no lattice link
 * (out of play); any facility we don't know, or a linked one missing, is a mismatch.
 * Shared with history/bundle.mjs so the archive keeps exactly the alerts the trees use.
 */
export function latticeCheck(rec, L) {
  const init = Object.entries(rec.init || {});
  if (!init.length) return { skip: "no initial map" };
  const extra = init.filter(([fid]) => !L.nodes.has(fid)).map(([fid]) => fid);
  const have = new Set(init.map(([fid]) => fid));
  const missing = [...L.nodes].filter((fid) => !have.has(fid) && L.linked.has(fid));
  if (extra.length || missing.length) return { skip: "lattice mismatch", extra, missing, lattice: rec.lattice };
  return null;
}

/**
 * One record -> {zone, start, durMin, winner, raw:[91], cut:[91], cutN:[91], ctl:{n, errRaw, errCut}} or {skip}.
 * Minute m = ownership after every capture at or before start + m*60 (build_winbins.territory_minutes).
 */
export function prepare(rec) {
  if (!TREE_ZONES.includes(rec.zone)) return { skip: "zone" };
  if (rec.event != null && MELTDOWN.has(+rec.event)) return { skip: "meltdown" };
  const r = rec.result || {};
  if (r.draw || !FAC[r.victor]) return { skip: "no winner" };
  if (!rec.end || !rec.start) return { skip: "no end" };
  const L = lat(rec.zone);
  if (!L) return { skip: "no lattice" };
  const init = Object.entries(rec.init || {});
  const bad = latticeCheck(rec, L);
  if (bad) return bad;
  const own = new Map(init.map(([f, o]) => [f, +o]));
  for (const fid of L.nodes) if (!own.has(fid)) own.set(fid, 0);   // out-of-play: neutral, as on the Census map
  const total = own.size;                                          // = the map's base count, like the live engine
  const raw = [], cut = [], cutN = [];
  const flips = rec.flips || [];
  let fi = 0;
  for (let m = 0; m <= 90; m++) {
    while (fi < flips.length && flips[fi][0] <= m * 60) { own.set(String(flips[fi][1]), +flips[fi][2]); fi++; }
    const cs = cutSet(own, L);
    raw.push(shares(own, null, total));
    cut.push(shares(own, cs, total));
    cutN.push(cs.size);
  }
  // Rule check against PS2Alerts' score at each capture (warpgates not counted).
  let ctl = null;
  if (rec.ctl && rec.ctl.length) {
    const own2 = new Map(init.map(([f, o]) => [f, +o]));
    const denom = total - L.wg.size;
    let j = 0, n = 0, eRaw = 0, eCut = 0, nCut = 0, eRawC = 0, eCutC = 0;
    for (const [sec, vs, nc, tr] of rec.ctl) {
      while (j < flips.length && flips[j][0] <= sec) { own2.set(String(flips[j][1]), +flips[j][2]); j++; }
      const cs = cutSet(own2, L);
      const cnt = (useCut) => { const c = { VS: 0, NC: 0, TR: 0 }; for (const [fid, o] of own2) if (FAC[o] && !L.wg.has(fid) && !(useCut && cs.has(fid))) c[FAC[o]]++; return c; };
      const a = cnt(false), b = cnt(true), ref = { VS: vs, NC: nc, TR: tr };
      const err = (c) => FACS.reduce((s, f) => s + Math.abs((100 * c[f]) / denom - ref[f]), 0) / 3;
      n++; eRaw += err(a); eCut += err(b);
      if (cs.size) { nCut++; eRawC += err(a); eCutC += err(b); }
    }
    ctl = { n, errRaw: eRaw, errCut: eCut, nCut, errRawCut: eRawC, errCutCut: eCutC };
  }
  return { zone: rec.zone, id: rec.id, start: rec.start, durMin: (rec.end - rec.start) / 60, winner: FAC[r.victor], raw, cut, cutN, ctl };
}

/** Grow one zone's tree (build_winbins_growtree.py) from prepared alerts, territory series `mode`. */
export function growTree(alerts, mode, zone) {
  const levels = LEVELS.map(() => new Map());
  let used = 0;
  for (const a of alerts) {
    const mins = a[mode];
    used++;
    for (let b = 0; b < 19; b++) {
      const m = b * 5;
      if (m > a.durMin - 1 || m >= mins.length) continue;
      const terr = mins[m], terr0 = mins[Math.max(0, m - 15)];
      for (const fac of FACS) {
        const t = terr[fac];
        const tb = Math.min(Math.floor(t / 5), 20);
        const mo = t - terr0[fac];
        const mb = momBucket(mo);
        const others = FACS.filter((k) => k !== fac);
        const mg = t - Math.max(...others.map((k) => terr[k]));
        const gb = margBucket(mg);
        const won = a.winner === fac ? 1 : 0;
        const keys = [`${b},${fac},${tb}`, `${b},${fac},${tb},${mb}`, `${b},${fac},${tb},${mb},${gb}`];
        const magb = magBucket(mb, mo);
        if (magb) {
          keys.push(`${b},${fac},${tb},${mb},${gb},${magb}`);
          let rival = null;
          for (const k of others) if (rival === null || terr[k] > terr[rival]) rival = k;
          keys.push(`${b},${fac},${tb},${mb},${gb},${magb},${rival}`);
        }
        keys.forEach((k, d) => { const c = levels[d].get(k) || [0, 0]; c[1]++; c[0] += won; levels[d].set(k, c); });
      }
    }
  }
  const kept = levels.map((lv) => Object.fromEntries([...lv].filter(([, v]) => v[1] >= MIN_N)));
  return { meta: { alerts_used: used, min_n: MIN_N, zone, territory: mode, source: "PS2Alerts history via oracle-worker/history",
    levels: ["(t,fac,terr)", "(t,fac,terr,mom)", "(t,fac,terr,mom,margin)", "(t,fac,terr,mom,margin,mag)", "(t,fac,terr,mom,margin,mag,rival)"],
    cells: Object.fromEntries(LEVELS.map((n, i) => [n, Object.keys(kept[i]).length])) },
    ...Object.fromEntries(LEVELS.map((n, i) => [n, kept[i]])) };
}

/** Cross-continent trunk (t, fac, terr) pooled over all zones, min n 50. */
export function growXtrunk(alerts, mode) {
  const cells = new Map();
  for (const a of alerts) {
    const mins = a[mode];
    for (let b = 0; b < 19; b++) {
      const m = b * 5;
      if (m > a.durMin - 1 || m >= mins.length) continue;
      for (const fac of FACS) {
        const k = `${b},${fac},${Math.min(Math.floor(mins[m][fac] / 5), 20)}`;
        const c = cells.get(k) || [0, 0]; c[1]++; c[0] += a.winner === fac ? 1 : 0; cells.set(k, c);
      }
    }
  }
  return { meta: { min_n: XTRUNK_MIN_N, zones: TREE_ZONES, territory: mode }, cells: Object.fromEntries([...cells].filter(([, v]) => v[1] >= XTRUNK_MIN_N)) };
}

/** getBin(b) for in-memory trees, the same shape models.js serves the engine. */
export function getterFor(tree, xtrunk) {
  const bins = splitTree(tree).map((s) => JSON.parse(s)), xb = splitCells(xtrunk.cells).map((s) => JSON.parse(s));
  return (b) => ({ bin: bins[b], xbin: xb[b] });
}

/** Brier per minute over held-out alerts for {name: {getBin(zone), mode}} variants. */
export function evaluate(alerts, variants) {
  const agg = {};
  const add = (v, k, x) => { const g = ((agg[v] ||= {})[k] ||= { n: 0, s: 0 }); g.n++; g.s += x; };
  for (const a of alerts) {
    if (Math.abs(a.durMin - 90) > 2) continue;
    for (let m = 1; m <= 89; m++) {
      const phase = m < 45 ? "early" : m < 72 ? "mid" : m < 85 ? "late" : "final5";
      for (const [name, v] of Object.entries(variants)) {
        const mins = a[v.mode];
        const terr = mins[m], terr0 = mins[Math.max(0, m - 15)];
        const mom = Object.fromEntries(FACS.map((f) => [f, terr[f] - terr0[f]]));
        const { win } = computeWin(v.getBin(a.zone), terr, mom, m, 90);
        const p = Object.fromEntries(FACS.map((f) => [f, win[f].pct / 100]));
        const br = brier(p, a.winner);
        add(name, "all", br); add(name, phase, br);
        if (a.cutN[m]) add(name, "with_cut", br);
        if (a.cutN[m] >= 3) add(name, "cut3plus", br);
      }
    }
  }
  const out = {};
  for (const [v, g] of Object.entries(agg)) out[v] = Object.fromEntries(Object.entries(g).map(([k, x]) => [k, { n: x.n, brier: +(x.s / x.n).toFixed(5) }]));
  return out;
}

const notice = (t, m) => console.log(`::notice title=${t}::${m}`);

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const inFile = arg("--in", "history/alerts.jsonl"), outDir = arg("--out", "oracle/backend"), commit = arg("--commit", "false") === "true";
  const skips = {}, latticeSkips = {}, mismatchExample = {};
  const FRESH = Date.parse(arg("--fresh", "2026-10-11T00:00:00Z")) / 1000;   // after the production trees were grown
  const byZone = Object.fromEntries(TREE_ZONES.map((z) => [z, []]));
  const ctl = { n: 0, errRaw: 0, errCut: 0, nCut: 0, errRawCut: 0, errCutCut: 0, alerts: 0 };
  let records = 0;
  for (const line of fs.readFileSync(inFile, "utf8").split("\n")) {
    if (!line) continue;
    records++;
    const p = prepare(JSON.parse(line));
    if (p.skip) {
      skips[p.skip] = (skips[p.skip] || 0) + 1;
      if (p.skip === "lattice mismatch") {
        const k = `${JSON.parse(line).zone}:${p.lattice}`; latticeSkips[k] = (latticeSkips[k] || 0) + 1;
        if (!mismatchExample[k]) mismatchExample[k] = { extra: p.extra.slice(0, 12), missing: p.missing.slice(0, 12).map((f) => `${f}:${lat(JSON.parse(line).zone).names[f]}`) };
      }
      continue;
    }
    if (p.ctl) { ctl.alerts++; for (const k of ["n", "errRaw", "errCut", "nCut", "errRawCut", "errCutCut"]) ctl[k] += p.ctl[k]; }
    byZone[p.zone].push(p);
  }
  const usable = Object.values(byZone).reduce((s, l) => s + l.length, 0);
  notice("history usable", `${usable} of ${records} alerts; per zone ${TREE_ZONES.map((z) => `${z}:${byZone[z].length}`).join(" ")}; skipped ${JSON.stringify(skips)}`);
  if (Object.keys(latticeSkips).length) notice("lattice mismatches (zone:latticeVersion)", JSON.stringify(latticeSkips));
  const r3 = (x) => +x.toFixed(3);
  const rule = { captures: ctl.n, alerts: ctl.alerts, mae_raw: ctl.n ? r3(ctl.errRaw / ctl.n) : null, mae_cut: ctl.n ? r3(ctl.errCut / ctl.n) : null,
    captures_with_cut: ctl.nCut, mae_raw_when_cut: ctl.nCut ? r3(ctl.errRawCut / ctl.nCut) : null, mae_cut_when_cut: ctl.nCut ? r3(ctl.errCutCut / ctl.nCut) : null };
  notice("cut rule vs PS2Alerts score", `${rule.captures} captures in ${rule.alerts} alerts: mean error raw ${rule.mae_raw} vs cut-aware ${rule.mae_cut} (score points); when something is cut (${rule.captures_with_cut}): raw ${rule.mae_raw_when_cut} vs cut-aware ${rule.mae_cut_when_cut}`);

  // Time split: newest 20 % of each zone's alerts held out.
  const train = [], test = [];
  for (const z of TREE_ZONES) {
    const l = byZone[z].sort((a, b) => a.start - b.start);
    const cutAt = Math.floor(l.length * 0.8);
    train.push(...l.slice(0, cutAt)); test.push(...l.slice(cutAt));
  }
  const trees = (alerts, mode) => {
    const x = growXtrunk(alerts, mode), t = {};
    for (const z of TREE_ZONES) t[z] = growTree(alerts.filter((a) => a.zone === z), mode, z);
    return { t, x, get: Object.fromEntries(TREE_ZONES.map((z) => [z, getterFor(t[z], x)])) };
  };
  const std = trees(train, "raw"), cut = trees(train, "cut");
  const { binGetter } = await import("../src/models.js");
  const ev = evaluate(test, {
    std: { mode: "raw", getBin: (z) => std.get[z] },
    cut: { mode: "cut", getBin: (z) => cut.get[z] },
    std_tree_cut_input: { mode: "cut", getBin: (z) => std.get[z] },
    production: { mode: "raw", getBin: (z) => binGetter(z) },
    production_cut_input: { mode: "cut", getBin: (z) => binGetter(z) },
  });
  const freshAlerts = test.filter((a) => a.start >= FRESH);
  const evFresh = evaluate(freshAlerts, {
    std: { mode: "raw", getBin: (z) => std.get[z] },
    cut: { mode: "cut", getBin: (z) => cut.get[z] },
    production: { mode: "raw", getBin: (z) => binGetter(z) },
    production_cut_input: { mode: "cut", getBin: (z) => binGetter(z) },
  });
  // GitHub keeps 10 annotations per step: one line per variant; full numbers in history_eval.json.
  const line = (e, v) => ["all", "early", "mid", "late", "final5", "with_cut"].map((k) => (e[v] && e[v][k] ? `${k} ${e[v][k].brier}` : "")).join(" · ");
  for (const v of ["std", "cut", "production", "production_cut_input"]) notice(`holdout ${v}`, `n=${ev.std ? ev.std.all.n : 0} min: ${line(ev, v)}`);
  if (evFresh.std) notice("fresh (after production trees)", `${freshAlerts.length} alerts: ${["std", "cut", "production", "production_cut_input"].map((v) => `${v} ${evFresh[v].all.brier}/final5 ${evFresh[v].final5 ? evFresh[v].final5.brier : "-"}`).join(" | ")}`);
  const better = (k) => ev.cut && ev.cut[k] && ev.cut[k].brier < ev.std[k].brier;
  // Trees are only worth writing if they beat the trees the Worker runs today too.
  const beatsProd = (k) => ev.cut && ev.cut[k] && ev.production && ev.production[k] && ev.cut[k].brier < ev.production[k].brier;
  const verdict = better("all") && better("late") && better("final5") && beatsProd("all") && beatsProd("late");
  notice("verdict", verdict ? "regrown cut-aware trees beat both the regrown standard and the production trees on held-out alerts"
    : `regrown cut-aware trees not written (beat regrown standard: ${better("all") && better("late") && better("final5")}; beat production: ${beatsProd("all") && beatsProd("late")})`);
  const report = { at: new Date().toISOString(), records, usable, train: train.length, test: test.length, skipped: skips, lattice_mismatch: latticeSkips, mismatch_example: mismatchExample, rule, holdout: ev,
    fresh: { since: new Date(FRESH * 1000).toISOString(), alerts: freshAlerts.length, brier: evFresh }, verdict,
    cells: { std: Object.fromEntries(TREE_ZONES.map((z) => [z, std.t[z].meta.cells])), cut: Object.fromEntries(TREE_ZONES.map((z) => [z, cut.t[z].meta.cells])) } };
  fs.writeFileSync(path.join(outDir, "history_eval.json"), JSON.stringify(report, null, 1));
  if (commit && verdict) {
    const all = Object.values(byZone).flat();
    const x = growXtrunk(all, "cut");
    fs.writeFileSync(path.join(outDir, "winbins_xtrunk_cut.json"), JSON.stringify(x));
    for (const z of TREE_ZONES) {
      const t = growTree(byZone[z], "cut", z);
      t.meta.holdout = ev.cut;
      fs.writeFileSync(path.join(outDir, z === 4 ? "winbins_growtree_cut.json" : `winbins_growtree_cut_z${z}.json`), JSON.stringify(t));
    }
    notice("trees written", `cut-aware trees grown on all ${all.length} usable alerts`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${String(e.stack).replace(/\n/g, " | ")}`); process.exit(1); });
