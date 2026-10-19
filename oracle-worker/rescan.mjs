#!/usr/bin/env node
/**
 * Rescan past alerts: standard odds vs cut-aware odds (oracle-worker/src/cut.js).
 *
 * For every finished alert it can get (archive bundles first, then the main
 * database's 30-day /alert/frames), it rebuilds the map minute by minute and
 * re-runs the live engine twice from the same snapshots:
 *   std — the raw Census map (what the live odds use today)
 *   cut — bases cut off from their warpgate removed from their owner
 * and scores both against the result (Brier, lower is better; uniform 0.2222).
 * It also checks which view matches Census' final scores at the end of the
 * alert, which tells whether the game really stops counting cut bases.
 *
 * Runs in GitHub Actions (oracle-rescan.yml); the Worker's 10 ms CPU can't.
 *   ORACLE_API=https://ps2-oracle.dayset.workers.dev node oracle-worker/rescan.mjs [--days 30]
 * Pure scoring is exported for tests (rescanAlert, summarize).
 */
import { forecast, alertKind, brier, FACS } from "./src/engine.js";
import { binGetter, hasTree, regionMap, latticeFor } from "./src/models.js";
import { cutAwareSnap } from "./src/cut.js";

const INV = { VS: "1", NC: "2", TR: "3" };

/** Region snapshots per frame from delta frames: [{t, snap}]. */
export function snapsFromFrames(frames, zone) {
  const r2f = regionMap(zone);
  if (!r2f) return [];
  const f2r = new Map(Object.entries(r2f).map(([r, f]) => [String(f), r]));
  const own = {};
  const out = [];
  for (const fr of frames) {
    for (const [fid, o] of Object.entries(fr.set)) own[fid] = o;
    const snap = {};
    for (const [fid, o] of Object.entries(own)) {
      const r = f2r.get(String(fid));
      if (r != null) snap[r] = o ? INV[o] : "0";
    }
    out.push({ t: fr.t, snap });
  }
  return out;
}

const at = (snaps, m) => { let s = null; for (const x of snaps) { if (x.t <= m) s = x; else break; } return s; };

/** Score shares the way Census does: warpgates excluded from the denominator. */
function scoreShares(snap, zone) {
  const r2f = regionMap(zone), L = latticeFor(zone);
  const c = { VS: 0, NC: 0, TR: 0 };
  let n = 0;
  for (const [r, v] of Object.entries(snap)) {
    const fid = r2f[String(r)];
    if (L && fid && /warpgate/i.test(L.names[fid] || "")) continue;
    n++;
    const f = { 1: "VS", 2: "NC", 3: "TR" }[v];
    if (f) c[f]++;
  }
  return Object.fromEntries(FACS.map((f) => [f, (100 * c[f]) / (n || 1)]));
}
const mae = (a, b) => FACS.reduce((s, f) => s + Math.abs(a[f] - b[f]), 0) / 3;

/** Minutes to score: every 5 min, plus the last few minutes where cuts decide. */
export function grid(dur) {
  const g = [];
  for (let m = 5; m < dur; m += 5) g.push(m);
  for (const m of [dur - 4, dur - 2, dur - 1]) if (m > 0 && !g.includes(m)) g.push(m);
  return g.sort((a, b) => a - b);
}

/**
 * One alert -> {key, kind, rows:[{m, phase, cutN, std, cut}], end:{raw, cut, final}} or {key, skip}.
 * a: {key, zone, event_id, dur, winner, final}; frames: delta frames.
 */
export function rescanAlert(a, frames) {
  if (!FACS.includes(a.winner)) return { key: a.key, skip: "no winner" };
  if (!hasTree(a.zone) || !latticeFor(a.zone)) return { key: a.key, skip: "no model" };
  const kind = alertKind(a.event_id);
  if (kind === "meltdown") return { key: a.key, skip: "meltdown" };
  const snaps = snapsFromFrames(frames || [], a.zone);
  if (snaps.length < 10) return { key: a.key, skip: "few frames" };
  const getBin = binGetter(a.zone);
  const dur = a.dur || 90;
  const rows = [];
  for (const m of grid(dur)) {
    const now = at(snaps, m), then = at(snaps, m - 15);
    if (!now) continue;   // frames hold only changes, so the latest earlier frame is the map at m
    const std = forecast({ getBin, kind, snapNow: now.snap, snap15: then ? then.snap : null, t: m, dur });
    const c = cutAwareSnap(now.snap, a.zone), c15 = then ? cutAwareSnap(then.snap, a.zone) : null;
    const cut = c.cut.length || (c15 && c15.cut.length)
      ? forecast({ getBin, kind, snapNow: c.snap, snap15: c15 ? c15.snap : null, t: m, dur })
      : std;
    const p = (w) => Object.fromEntries(FACS.map((f) => [f, w[f].pct / 100]));
    const ps = p(std.win), pc = p(cut.win);
    rows.push({ m, phase: m / dur < 0.5 ? "early" : m / dur < 0.8 ? "mid" : "late", cutN: c.cut.length,
      cutBases: c.cut.map((x) => `${x.name} (${x.fac})`), std: brier(ps, a.winner), cut: brier(pc, a.winner),
      pStd: ps[a.winner], pCut: pc[a.winner] });
  }
  let end = null;
  const last = at(snaps, dur - 0.01);
  if (last && a.final && FACS.every((f) => typeof a.final[f] === "number")) {
    const cs = cutAwareSnap(last.snap, a.zone);
    const raw = scoreShares(last.snap, a.zone), cut = scoreShares(cs.snap, a.zone);
    end = { t: last.t, cutN: cs.cut.length, cutBases: cs.cut.map((x) => `${x.name} (${x.fac})`), rawErr: mae(raw, a.final), cutErr: mae(cut, a.final) };
  }
  return { key: a.key, kind, rows, end };
}

/** Aggregate per-alert results into a report object. */
export function summarize(results) {
  const agg = {};
  const add = (k, r) => { const g = (agg[k] ||= { n: 0, std: 0, cut: 0 }); g.n++; g.std += r.std; g.cut += r.cut; };
  let alerts = 0;
  for (const res of results) {
    if (!res.rows) continue;
    alerts++;
    for (const r of res.rows) {
      add("all", r); add(r.phase, r);
      if (r.cutN) add("with_cut", r);
    }
  }
  const out = {};
  for (const [k, g] of Object.entries(agg)) out[k] = { n: g.n, std: +(g.std / g.n).toFixed(4), cut: +(g.cut / g.n).toFixed(4) };
  const ends = results.filter((r) => r.end);
  const endsCut = ends.filter((r) => r.end.cutN);
  const avg = (xs, f) => (xs.length ? +(xs.reduce((s, x) => s + f(x), 0) / xs.length).toFixed(3) : null);
  return {
    alerts, minutes: out,
    final_check: {
      alerts: ends.length, with_cut_at_end: endsCut.length,
      mae_raw: avg(endsCut, (r) => r.end.rawErr), mae_cut: avg(endsCut, (r) => r.end.cutErr),
      cut_closer: endsCut.filter((r) => r.end.cutErr < r.end.rawErr - 1e-9).length,
      raw_closer: endsCut.filter((r) => r.end.rawErr < r.end.cutErr - 1e-9).length,
    },
    skipped: results.filter((r) => r.skip).reduce((m, r) => ((m[r.skip] = (m[r.skip] || 0) + 1), m), {}),
  };
}

async function main() {
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const days = +(process.argv[process.argv.indexOf("--days") + 1] || 30) || 30;
  const get = async (p) => { const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-rescan" } }); return r.ok ? r.json() : null; };
  const seen = new Map();
  // Archive first (kept for good), then the main database's last 30 days.
  for (let before = 4e9, page = 0; page < 50; page++) {
    const l = await get(`/archive/list?limit=500&before=${before}`);
    if (!l || !l.alerts || !l.alerts.length) break;
    for (const x of l.alerts) if (!seen.has(x.key)) seen.set(x.key, { ...x, src: "archive" });
    before = l.alerts[l.alerts.length - 1].start_ts;
    if (l.alerts.length < 500) break;
  }
  const h = await get(`/history?days=${days}`);
  for (const x of (h && h.alerts) || []) if (!seen.has(x.key) || !seen.get(x.key).final) seen.set(x.key, { ...seen.get(x.key), ...x, src: seen.has(x.key) ? "archive" : "live" });
  const results = [];
  for (const a of seen.values()) {
    if (a.status && a.status !== "settled") continue;
    let frames = null, info = a;
    if (a.src === "archive") {
      const b = await get(`/archive?key=${a.key}`);
      if (b) { frames = b.frames; info = { ...a, ...b }; }
    }
    if (!frames) { const f = await get(`/alert/frames?key=${a.key}`); frames = f && f.frames; }
    results.push(rescanAlert(info, frames));
  }
  const s = summarize(results);
  const lines = [`# Cut-aware rescan (${s.alerts} alerts scored)`, "", "Brier per scored minute (lower is better; uniform 0.2222):", "",
    "| slice | minutes | standard | cut-aware | change |", "|---|---|---|---|---|"];
  for (const k of ["all", "early", "mid", "late", "with_cut"]) {
    const g = s.minutes[k];
    if (g) lines.push(`| ${k} | ${g.n} | ${g.std} | ${g.cut} | ${(g.cut - g.std >= 0 ? "+" : "") + (g.cut - g.std).toFixed(4)} |`);
  }
  const fc = s.final_check;
  lines.push("", `Final-score check: ${fc.with_cut_at_end} of ${fc.alerts} alerts ended with cut bases. Mean error vs Census final scores: raw map ${fc.mae_raw} pp, cut-aware ${fc.mae_cut} pp (cut-aware closer in ${fc.cut_closer}, raw closer in ${fc.raw_closer}).`,
    "", `Skipped: ${JSON.stringify(s.skipped)}`, "", "Alerts that ended with cut bases:", "");
  for (const r of results.filter((x) => x.end && x.end.cutN)) lines.push(`- ${r.key}: ${r.end.cutBases.join(", ")} — error raw ${r.end.rawErr.toFixed(2)} / cut ${r.end.cutErr.toFixed(2)} pp`);
  const md = lines.join("\n");
  console.log(md);
  console.log("\nJSON " + JSON.stringify(s));
  if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  for (const k of ["all", "late", "with_cut"]) if (s.minutes[k]) console.log(`::notice title=rescan ${k}::n=${s.minutes[k].n} std=${s.minutes[k].std} cut=${s.minutes[k].cut}`);
  console.log(`::notice title=rescan coverage::alerts scored ${s.alerts}, skipped ${JSON.stringify(s.skipped)}, ends with cuts ${fc.with_cut_at_end}/${fc.alerts}`);
  for (const r of results.filter((x) => x.end && x.end.cutN)) console.log(`::notice title=ended with cut ${r.key}::${r.end.cutBases.join(", ")}; error raw ${r.end.rawErr.toFixed(2)} / cut ${r.end.cutErr.toFixed(2)} pp`);
  console.log(`::notice title=final-score check::cut-aware closer ${fc.cut_closer}, raw closer ${fc.raw_closer}, mae raw ${fc.mae_raw} cut ${fc.mae_cut}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
