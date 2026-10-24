#!/usr/bin/env node
/**
 * Does 🥶 ("almost cut") warn in time? (owner 2026-10-24: "great farm but lost the alert".)
 * Replays every archived territory alert with the live 🥶 rule (commander.js freezingSet:
 * the base's only warpgate link runs through a chokepoint with heat >= 30 or an enemy
 * capture at / next to it in the last 10 min). Every 2 minutes, for every base of every
 * faction still linked to its warpgate, the outcome 10 minutes later:
 *   cut     still ours but cut off from the warpgate (or cut, then taken)
 *   taken   lost to an enemy without being cut first
 *   fine    still ours and linked
 * Groups: 🥶 bases, bases behind a chokepoint that is NOT under attack, other front-line
 * bases, rear bases. Also 🥶 bases split by heat (is the hot fight inside a pocket a trap?).
 *   ORACLE_API=https://ps2-oracle.dayset.workers.dev node oracle-worker/history/freeze-check.mjs
 */
import fs from "node:fs";
import { latticeFor } from "../src/models.js";
import { alertKind } from "../src/engine.js";
import { findCutPoints, freezingSet, warpgateConnected, heatScore } from "../src/commander.js";

const FAC = { VS: 1, NC: 2, TR: 3 }, NAME = { 1: "VS", 2: "NC", 3: "TR" };
const HORIZON = 10, STEP = 2;

export function alertRows(b) {
  if (!b || !Array.isArray(b.frames) || !b.frames.length || alertKind(b.event_id) === "meltdown") return [];
  const L = latticeFor(b.zone);
  if (!L) return [];
  const dur = +b.dur || 90;
  const own0 = new Map();
  for (const f of L.adj.keys()) own0.set(f, 0);
  for (const [f, o] of Object.entries(b.frames[0].set || {})) if (own0.has(String(f))) own0.set(String(f), o ? FAC[o] || 0 : 0);
  const flips = [];   // Worker shape [ts, newName, oldName, fid], ts = minutes * 60
  const cur = new Map(own0);
  for (const fr of b.frames.slice(1)) for (const [f, o] of Object.entries(fr.set || {})) {
    const fid = String(f); if (!cur.has(fid)) continue;
    const nw = o ? FAC[o] || 0 : 0, old = cur.get(fid);
    if (nw !== old) { flips.push([Math.round(+fr.t * 60), NAME[nw] || null, NAME[old] || null, fid]); cur.set(fid, nw); }
  }
  const stateAt = (m) => { const o = new Map(own0); for (const [ts, nw, , fid] of flips) { if (ts > m * 60) break; o.set(fid, FAC[nw] || 0); } return o; };
  const rows = [];
  for (let t = 4; t <= dur - HORIZON; t += STEP) {
    const own = stateAt(t), later = stateAt(t + HORIZON), nowTs = t * 60;
    const recent = flips.filter((x) => x[0] > nowTs - 600 && x[0] <= nowTs);
    const conn = warpgateConnected(own, L.adj, L.names), connL = warpgateConnected(later, L.adj, L.names);
    const cuts = findCutPoints(own, L.adj, L.names);
    for (const fo of [1, 2, 3]) {
      const f = NAME[fo], myConn = conn.get(fo);
      if (!myConn) continue;
      const frz = freezingSet(f, cuts, L.adj, recent, nowTs);
      const behind = new Set(); for (const [, , sev] of cuts.get(fo) || []) sev.forEach((s) => behind.add(s));
      for (const fid of myConn) {
        if (own.get(fid) !== fo || /warpgate/i.test(L.names[fid] || "")) continue;
        const front = (L.adj.get(fid) || []).some((n) => { const x = own.get(n); return x && x !== fo; });
        const group = frz.has(fid) ? "freezing" : behind.has(fid) ? "behind_quiet_chokepoint" : front ? "front" : "rear";
        const o2 = later.get(fid), lc = connL.get(fo);
        const outcome = o2 !== fo ? "lost" : lc && lc.has(fid) ? "fine" : "cut";
        const heat = heatScore(fid, recent, nowTs, L.adj);
        rows.push({ group, outcome, hot: heat >= 40 });
      }
    }
  }
  return rows;
}

export function summarize(rows) {
  const agg = {};
  const add = (k, r) => { const g = (agg[k] ||= { n: 0, cut: 0, lost: 0, fine: 0 }); g.n++; g[r.outcome]++; };
  for (const r of rows) { add(r.group, r); if (r.group === "freezing") add(r.hot ? "freezing_hot" : "freezing_quiet", r); else if (r.hot) add("not_freezing_hot", r); }
  const pct = (x, n) => Math.round((1000 * x) / (n || 1)) / 10;
  return Object.fromEntries(Object.entries(agg).map(([k, g]) => [k, { n: g.n, cut_pct: pct(g.cut, g.n), lost_pct: pct(g.lost, g.n), gone_pct: pct(g.cut + g.lost, g.n) }]));
}

async function main() {
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const get = async (p) => { for (let i = 0; i < 3; i++) { const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-freeze-check" } }).catch(() => null); if (r && r.ok) return r.json(); await new Promise((ok) => setTimeout(ok, 1000 * (i + 1))); } return null; };
  const list = [];
  for (let before = 4e9, page = 0; page < 50; page++) {
    const l = await get(`/archive/list?limit=500&before=${before}`);
    if (!l || !l.alerts || !l.alerts.length) break;
    list.push(...l.alerts); before = l.alerts[l.alerts.length - 1].start_ts;
    if (l.alerts.length < 500) break;
  }
  const todo = list.filter((a) => [2, 4, 6, 8].includes(+a.zone));
  const rows = []; let next = 0, used = 0;
  const worker = async () => { while (next < todo.length) { const a = todo[next++]; const b = await get(`/archive?key=${a.key}`); if (!b) continue; const r = alertRows({ ...a, ...b }); if (r.length) used++; rows.push(...r); } };
  await Promise.all(Array.from({ length: 8 }, worker));
  const s = { alerts: used, horizon_min: HORIZON, groups: summarize(rows) };
  fs.writeFileSync("oracle/backend/freeze_check.json", JSON.stringify(s, null, 1) + "\n");
  console.log(`::notice title=freeze check::${JSON.stringify(s)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
