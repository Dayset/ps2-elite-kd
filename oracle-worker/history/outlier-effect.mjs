#!/usr/bin/env node
/**
 * Do extreme players decide alerts? (owner idea 2026-10-23: Bauminator45, TR, Wainwright
 * Hossin 10-4-46377, 398 kills / 1 death, VS population fell 59 % and VS ended at 0 %.)
 *
 * Attribution only: nothing here feeds the odds or the Commander. The question is
 * whether "an extreme player on the winning side" explains results our odds didn't
 * expect, so those alerts can be marked (and the Brier score read with and without them).
 *
 * Two phases, resumable through the Actions cache:
 *   fetch    for every archived territory alert, find Honu's alert (alerts/time/block,
 *            one call per world-week, matched on instance + continent + start time),
 *            then alerts/{id}/participants (outlier rule of src/outliers.js, vouched
 *            players removed) and alerts/{id}/population. One Honu call a second.
 *            Cache: history/honu-alerts.jsonl, one line per alert.
 *   analyze  joins the cache with the archive frames and re-runs the live odds
 *            (engine.forecast, cut-aware from 80 %) every 5 minutes:
 *            - Brier per alert: all alerts vs alerts with / without an extreme player
 *            - calibration: did the extreme player's faction win more than its odds said?
 *              (mean won − p, by alert phase, 95 % interval resampling alerts)
 *            - population: enemy population change (end vs start, relative to the
 *              other factions) when the other side has an extreme player, vs the same
 *              outcome without one
 *            Writes oracle/backend/outlier_effect.json (aggregates only, no names).
 *
 *   node oracle-worker/history/outlier-effect.mjs --cache history/honu-alerts.jsonl --minutes 300 [--phase fetch|analyze|both] [--probe]
 */
import fs from "node:fs";
import path from "node:path";
import { forecast, alertKind, brier, FACS } from "../src/engine.js";
import { binGetter, hasTree, latticeFor } from "../src/models.js";
import { cutAwareSnap } from "../src/cut.js";
import { outlierReport } from "../src/outliers.js";
import { snapsFromFrames } from "../rescan.mjs";

const HONU = "https://wt.honu.pw/api";
const UA = "ps2-elite-kd-oracle/1.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const WEEK = 7 * 86400;
const STRONG = new Set(["confirmed", "burst"]);

const utc = (s) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`) / 1000;

/** Honu alert list -> our alert's Honu id (instance + continent + start within 15 min). */
export function matchHonu(list, a) {
  const hit = (list || []).find((x) => +x.instanceID === +a.instance_id && ((+x.zoneID) & 0xFFFF) === +a.zone
    && +x.worldID === +a.world && Math.abs(utc(x.timestamp) - a.start_ts) <= 900);
  return hit ? hit.id : null;
}

/** Honu participants -> compact list of flagged players (names kept only in the cache). */
export function compactReport(body) {
  const rep = outlierReport(body);
  return { players: rep.players, faction: rep.faction,
    flagged: rep.outliers.map((o) => [o.name, o.faction, o.severity, o.kills, o.deaths, o.minutes]) };
}

/** Honu AlertPopulation list -> [[minute, vs, nc, tr]]. */
export function compactPop(list, startTs) {
  return (Array.isArray(list) ? list : []).map((p) => [Math.round((utc(p.timestamp) - startTs) / 60), +p.countVS || 0, +p.countNC || 0, +p.countTR || 0])
    .sort((x, y) => x[0] - y[0]);
}

/** Population change end vs start (avg of first / last 20 min), per faction and relative to the mean of the three. */
export function popChange(pop, dur) {
  const avg = (rows) => (rows.length ? [1, 2, 3].map((i) => rows.reduce((s, r) => s + r[i], 0) / rows.length) : null);
  const a = avg(pop.filter((r) => r[0] >= 0 && r[0] < 20)), b = avg(pop.filter((r) => r[0] > dur - 20 && r[0] <= dur));
  if (!a || !b || a.some((x) => x < 15) || b.some((x) => x < 5)) return null;   // empty end window = Honu stopped counting
  const ratio = a.map((x, i) => b[i] / x), mean = ratio.reduce((s, x) => s + x, 0) / 3;
  return Object.fromEntries(FACS.map((f, i) => [f, { ratio: ratio[i], rel: ratio[i] / mean }]));
}

/** Factions with an extreme (confirmed / burst) player. */
export const strongFactions = (c) => [...new Set((c.rep ? c.rep.flagged : []).filter((x) => STRONG.has(x[2]) && FAC[{ VS: 1, NC: 2, TR: 3 }[x[1]]]).map((x) => x[1]))];

/** One alert: odds every 5 min (live engine, cut-aware from 80 %) -> [{m, frac, p:{VS,NC,TR}}]. */
export function oddsSeries(a, frames) {
  if (!hasTree(a.zone) || !latticeFor(a.zone) || alertKind(a.event_id) === "meltdown") return null;
  const snaps = snapsFromFrames(frames || [], a.zone);
  if (snaps.length < 5) return null;
  const at = (m) => { let s = null; for (const x of snaps) { if (x.t <= m) s = x; else break; } return s; };
  const getBin = binGetter(a.zone), dur = a.dur || 90, out = [];
  for (let m = 5; m < dur; m += 5) {
    const now = at(m), then = at(m - 15);
    if (!now) continue;
    const w = forecast({ getBin, kind: "territory", snapNow: now.snap, snap15: then ? then.snap : null, t: m, dur, cutSnap: (s) => cutAwareSnap(s, a.zone).snap }).win;
    out.push({ m, frac: m / dur, p: Object.fromEntries(FACS.map((f) => [f, w[f].pct / 100])) });
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const phase = (f) => (f < 1 / 3 ? "early" : f < 2 / 3 ? "mid" : "late");

function bootCI(groups, stat, n = 300) {
  const keys = [...groups.keys()], out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    const s = [];
    for (let j = 0; j < keys.length; j++) s.push(...groups.get(keys[Math.floor(rnd() * keys.length)]));
    const v = stat(s); if (Number.isFinite(v)) out.push(v);
  }
  out.sort((x, y) => x - y);
  return [r3(out[Math.floor(out.length * 0.025)]), r3(out[Math.floor(out.length * 0.975)])];
}

/** Per alert: worst loser's population change (raw end/start) and the winner's. */
function popAlerts(as) {
  const xs = as.filter((a) => a.pop && FACS.includes(a.winner)).map((a) => ({
    loser: Math.min(...FACS.filter((f) => f !== a.winner).map((f) => a.pop[f].ratio)), winner: a.pop[a.winner].ratio }));
  const med = (v) => { const s = [...v].sort((x, y) => x - y); return r3(s[Math.floor(s.length / 2)]); };
  return { n: xs.length, worst_loser_ratio_median: med(xs.map((x) => x.loser)), winner_ratio_median: med(xs.map((x) => x.winner)),
    share_loser_below_060: r3(xs.filter((x) => x.loser < 0.6).length / (xs.length || 1)) };
}

/** alerts: [{key, winner, dur, strong:[fac], odds:[...], pop}] -> summary. */
export function analyze(alerts) {
  const scored = alerts.filter((a) => a.odds && a.odds.length && FACS.includes(a.winner));
  const alertBrier = (a) => mean(a.odds.map((o) => brier(o.p, a.winner)));
  const B = (xs) => ({ n: xs.length, brier: r3(mean(xs.map(alertBrier))) });
  const withX = scored.filter((a) => a.strong.length), without = scored.filter((a) => !a.strong.length);
  const winnerX = withX.filter((a) => a.strong.includes(a.winner));
  // Calibration rows: (alert, faction, minute).
  const rows = [];
  for (const a of scored) for (const o of a.odds) for (const f of FACS) {
    const mine = a.strong.includes(f), theirs = a.strong.some((g) => g !== f);
    const cls = mine && !theirs ? "has" : !mine && theirs ? "faces" : !mine && !theirs ? "none" : "both";
    rows.push({ key: a.key, cls, ph: phase(o.frac), d: (a.winner === f ? 1 : 0) - o.p[f], p: o.p[f] });
  }
  const calib = {};
  for (const cls of ["has", "faces", "none"]) {
    calib[cls] = {};
    for (const ph of ["early", "mid", "late", "all"]) {
      const xs = rows.filter((r) => r.cls === cls && (ph === "all" || r.ph === ph));
      const g = new Map(); for (const r of xs) { let l = g.get(r.key); if (!l) g.set(r.key, (l = [])); l.push(r); }
      calib[cls][ph] = { alerts: g.size, rows: xs.length, won_minus_p: r3(mean(xs.map((r) => r.d))), ci: g.size >= 10 ? bootCI(g, (s) => mean(s.map((r) => r.d))) : null };
    }
  }
  // Population: losing factions' relative change, facing an extreme player vs not.
  const loserRel = (sel) => {
    const xs = [];
    for (const a of alerts) {
      if (!a.pop || !FACS.includes(a.winner)) continue;
      for (const f of FACS) if (f !== a.winner && sel(a, f) && Number.isFinite(a.pop[f].rel)) xs.push(a.pop[f].rel);
    }
    const s = [...xs].sort((x, y) => x - y);
    return { n: xs.length, mean_rel: r3(mean(xs)), median_rel: r3(s[Math.floor(s.length / 2)]), share_below_075: r3(xs.filter((x) => x < 0.75).length / (xs.length || 1)) };
  };
  return {
    alerts_scored: scored.length, with_extreme: withX.length, extreme_on_winner: winnerX.length,
    brier: { all: B(scored), without_extreme: B(without), with_extreme: B(withX), extreme_on_winner: B(winnerX), extreme_only_on_losers: B(withX.filter((a) => !a.strong.includes(a.winner))) },
    calibration: calib,
    population_alerts: {
      winner_has_extreme: popAlerts(alerts.filter((a) => a.strong.includes(a.winner) && a.strong.length === 1)),
      no_extreme: popAlerts(alerts.filter((a) => !a.strong.length)),
    },
    population_losers: {
      facing_winner_extreme: loserRel((a, f) => a.strong.includes(a.winner) && !a.strong.includes(f)),
      no_extreme_anywhere: loserRel((a) => !a.strong.length),
    },
  };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const cacheFile = arg("--cache", "history/honu-alerts.jsonl"), budgetMin = +arg("--minutes", "300"), ph = arg("--phase", "both");
  const probe = process.argv.includes("--probe");
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const t0 = Date.now();
  const notice = (t, m) => console.log(`::notice title=${t}::${m}`);
  const getJ = async (url, headers = {}) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
        const txt = await r.text();
        let body = null; try { body = JSON.parse(txt); } catch { /* challenge / html */ }
        if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000 * (i + 1))); continue; }
        return { status: r.status, body };
      } catch { await new Promise((ok) => setTimeout(ok, 3000 * (i + 1))); }
    }
    return { status: 0, body: null };
  };
  let last = 0;
  const honu = async (p) => { const w = last + 1000 - Date.now(); if (w > 0) await new Promise((ok) => setTimeout(ok, w)); last = Date.now(); return getJ(`${HONU}/${p}`); };

  // Archive list (our alerts with frames).
  const list = [];
  for (let before = 4e9, page = 0; page < 50; page++) {
    const l = (await getJ(`${API}/archive/list?limit=500&before=${before}`)).body;
    if (!l || !l.alerts || !l.alerts.length) break;
    list.push(...l.alerts);
    before = l.alerts[l.alerts.length - 1].start_ts;
    if (l.alerts.length < 500) break;
  }
  const todo = list.filter((a) => [2, 4, 6, 8, 344].includes(+a.zone) && alertKind(a.event_id) !== "meltdown" && a.instance_id);
  const cache = new Map();
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, "utf8").split("\n")) if (l) { const x = JSON.parse(l); cache.set(x.key, x); }

  if (ph === "fetch" || ph === "both") {
    const need = todo.filter((a) => !cache.has(a.key)).sort((x, y) => y.start_ts - x.start_ts);   // newest first
    const weeks = new Map();
    for (const a of need) { const k = `${a.world}|${Math.floor(a.start_ts / WEEK)}`; (weeks.get(k) || weeks.set(k, []).get(k)).push(a); }
    let done = 0, missing = 0, failed = 0;
    const out = fs.createWriteStream(cacheFile, { flags: "a" });
    const put = (x) => { cache.set(x.key, x); out.write(JSON.stringify(x) + "\n"); };
    const deadline = t0 + budgetMin * 60000;
    outer: for (const [k, as] of weeks) {
      const [world, wk] = k.split("|").map(Number);
      const iso = (t) => new Date(t * 1000).toISOString();
      const blk = await honu(`alerts/time/block?start=${encodeURIComponent(iso(wk * WEEK - 3600))}&end=${encodeURIComponent(iso((wk + 1) * WEEK + 3600))}&worldID=${world}`);
      const alertsH = blk.body && (blk.body.alerts || (Array.isArray(blk.body) ? blk.body : null));
      if (blk.status !== 200 || !alertsH) { failed++; if (probe) notice("probe block", `status ${blk.status}`); continue; }
      for (const a of as) {
        if (Date.now() > deadline || (probe && done >= 5)) break outer;
        const id = matchHonu(alertsH, a);
        if (!id) { put({ key: a.key, status: "no-honu" }); missing++; continue; }
        const pr = await honu(`alerts/${id}/participants?excludeOutfits=true`);
        if (pr.status !== 200 || !pr.body) { failed++; if (pr.status === 404 || pr.status === 400) put({ key: a.key, id, status: `honu-${pr.status}` }); continue; }
        const rep = compactReport(pr.body);
        const pp = await honu(`alerts/${id}/population`);
        put({ key: a.key, id, status: "ok", rep, pop: pp.status === 200 ? compactPop(pp.body, a.start_ts) : null });
        done++;
        if (probe) notice(`probe ${a.key}`, `honu ${id}: players ${rep.players}, flagged ${rep.flagged.length}, pop rows ${pp.status === 200 && Array.isArray(pp.body) ? pp.body.length : pp.status}`);
      }
    }
    out.end();
    const ok = [...cache.values()].filter((x) => x.status === "ok").length;
    notice("outlier-effect fetch", `this run: ${done} fetched, ${missing} not in Honu, ${failed} failed; cache ${cache.size}/${todo.length} (ok ${ok}); ${Math.round((Date.now() - t0) / 60000)} min`);
  }

  if (!probe && (ph === "analyze" || ph === "both")) {
    const okKeys = todo.filter((a) => (cache.get(a.key) || {}).status === "ok");
    const alerts = [];
    let next = 0;
    const worker = async () => {
      while (next < okKeys.length) {
        const a = okKeys[next++], c = cache.get(a.key);
        const b = (await getJ(`${API}/archive?key=${a.key}`)).body;
        if (!b) continue;
        const info = { ...a, ...b };
        alerts.push({ key: a.key, winner: info.winner, dur: info.dur || 90, strong: strongFactions(c),
          odds: oddsSeries(info, b.frames), pop: c.pop ? popChange(c.pop, info.dur || 90) : null });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    const s = analyze(alerts);
    s.built = new Date().toISOString(); s.cache = { alerts: todo.length, ok: okKeys.length };
    fs.writeFileSync("oracle/backend/outlier_effect.json", JSON.stringify(s, null, 1) + "\n");
    const j = JSON.stringify;
    notice("outlier-effect coverage", `scored ${s.alerts_scored}, with extreme player ${s.with_extreme}, extreme on winner ${s.extreme_on_winner}`);
    notice("outlier-effect brier", j(s.brier));
    notice("outlier-effect calibration (won - p)", j(Object.fromEntries(Object.entries(s.calibration).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([p, x]) => [p, [x.won_minus_p, x.ci, x.alerts]]))]))));
    notice("outlier-effect population (losers)", j(s.population_losers));
    notice("outlier-effect population (per alert, end/start)", j(s.population_alerts));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
