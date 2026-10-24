#!/usr/bin/env node
/**
 * Predicted heat (owner 2026-10-24): which front-line bases will be fought over next?
 * Target: the base changes hands within the next 10 minutes. Built from the alert archive
 * (territory alerts, every capture), sampled every 2 minutes on every front-line base.
 *
 * Features (all live-available in the Worker):
 *   p     per-base capture chance under pressure from the capture model (src/models.js)
 *   nb    captures at the base's neighbours in the last 10 min (0, 1, 2, 3+)
 *   self  the base itself changed hands in the last 10 min (0 / 1)
 *   fronts number of enemy factions touching it (1 / 2)
 * Cells (p bucket × nb × self × fronts) with at least MIN_N samples on the training alerts;
 * smaller cells fall back to (p × nb), then p. Checked on the newest 20 % of alerts (log loss
 * and Brier vs the capture model's chance alone).
 * Output: oracle/backend/heat_model.json {cells, fallback, eval}.
 *
 *   ORACLE_API=https://ps2-oracle.dayset.workers.dev node oracle-worker/history/heat-model.mjs
 */
import fs from "node:fs";
import { latticeFor, captureModel } from "../src/models.js";
import { alertKind } from "../src/engine.js";

const FAC = { VS: 1, NC: 2, TR: 3 };
const HORIZON = 10, STEP = 2, MIN_N = 200;
import { pBucket, cellKey, midKey } from "../src/heat.js";
export { pBucket, cellKey, midKey };

/** One archived alert -> samples [{p, nb, self, fronts, y}]. */
export function samples(b) {
  if (!b || !Array.isArray(b.frames) || !b.frames.length || alertKind(b.event_id) === "meltdown") return [];
  const L = latticeFor(b.zone);
  if (!L) return [];
  const pf = captureModel(b.zone), dur = +b.dur || 90;
  const own = new Map();
  for (const [f, o] of Object.entries(b.frames[0].set || {})) own.set(String(f), o ? FAC[o] || 0 : 0);
  const flips = [];
  for (const fr of b.frames.slice(1)) for (const [f, o] of Object.entries(fr.set || {})) flips.push([+fr.t, String(f), o ? FAC[o] || 0 : 0]);
  flips.sort((x, y) => x[0] - y[0]);
  const byFac = new Map();
  for (const [t, f] of flips) { let l = byFac.get(f); if (!l) byFac.set(f, (l = [])); l.push(t); }
  const count = (f, a, z) => (byFac.get(f) || []).filter((t) => t > a && t <= z).length;
  const out = [];
  let fi = 0;
  for (let t = 4; t <= dur - HORIZON; t += STEP) {
    while (fi < flips.length && flips[fi][0] <= t) { own.set(flips[fi][1], flips[fi][2]); fi++; }
    for (const [f, o] of own) {
      if (!o || /warpgate/i.test(L.names[f] || "")) continue;
      const nbs = L.adj.get(f) || [];
      const enemies = new Set(nbs.map((n) => own.get(n)).filter((x) => x && x !== o));
      if (!enemies.size) continue;
      const e = pf[`${f}|P1:pressured`];
      const p = e ? e.p : 0.33;
      let nb = 0; for (const n of nbs) nb += count(n, t - 10, t);
      out.push({ p, nb, self: count(f, t - 10, t) > 0, fronts: enemies.size, y: count(f, t, t + HORIZON) > 0 ? 1 : 0 });
    }
  }
  return out;
}

export function fit(train) {
  const acc = (key) => { const m = new Map(); for (const s of train) { const k = key(s); const c = m.get(k) || [0, 0]; c[0]++; c[1] += s.y; m.set(k, c); } return m; };
  const pack = (m) => Object.fromEntries([...m].filter(([, c]) => c[0] >= MIN_N).map(([k, c]) => [k, { n: c[0], p: Math.round((c[1] / c[0]) * 1e4) / 1e4 }]));
  return { cells: pack(acc(cellKey)), mid: pack(acc(midKey)), pb: pack(acc((s) => String(pBucket(s.p)))) };
}

/** Predicted chance (0..1) the base changes hands in the next 10 min. */
export function predict(model, x) {
  const c = model.cells[cellKey(x)] || model.mid[midKey(x)] || model.pb[String(pBucket(x.p))];
  return c ? c.p : x.p;
}

function score(test, f) {
  let ll = 0, br = 0;
  for (const s of test) { const q = Math.min(0.999, Math.max(0.001, f(s))); ll -= s.y ? Math.log(q) : Math.log(1 - q); br += (q - s.y) ** 2; }
  return { n: test.length, logloss: +(ll / test.length).toFixed(4), brier: +(br / test.length).toFixed(4) };
}

function auc(test, f) {
  const xs = test.map((s) => [f(s), s.y]).sort((a, b) => a[0] - b[0]);
  let pos = 0, neg = 0, rank = 0, sumPos = 0;
  for (let i = 0; i < xs.length;) { let j = i; while (j < xs.length && xs[j][0] === xs[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (xs[k][1]) { pos++; sumPos += r; } else neg++; i = j; rank++; }
  return pos && neg ? +((sumPos - (pos * (pos + 1)) / 2) / (pos * neg)).toFixed(4) : null;
}

async function main() {
  const API = process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev";
  const get = async (p) => { for (let i = 0; i < 3; i++) { const r = await fetch(API + p, { headers: { "User-Agent": "ps2-oracle-heat-model" } }).catch(() => null); if (r && r.ok) return r.json(); await new Promise((ok) => setTimeout(ok, 1000 * (i + 1))); } return null; };
  const list = [];
  for (let before = 4e9, page = 0; page < 50; page++) {
    const l = await get(`/archive/list?limit=500&before=${before}`);
    if (!l || !l.alerts || !l.alerts.length) break;
    list.push(...l.alerts); before = l.alerts[l.alerts.length - 1].start_ts;
    if (l.alerts.length < 500) break;
  }
  const todo = list.filter((a) => [2, 4, 6, 8].includes(+a.zone)).sort((a, b) => a.start_ts - b.start_ts);
  const cut = Math.floor(todo.length * 0.8), train = [], test = [];
  let next = 0;
  const worker = async () => { while (next < todo.length) { const i = next++, a = todo[i]; const b = await get(`/archive?key=${a.key}`); if (!b) continue; const ss = samples({ ...a, ...b }); (i < cut ? train : test).push(...ss); } };
  await Promise.all(Array.from({ length: 8 }, worker));
  const model = fit(train);
  const pOnly = fit(train.map((s) => ({ ...s, nb: 0, self: false, fronts: 1 })));
  const base = train.reduce((s, x) => s + x.y, 0) / train.length;
  const ev = {
    alerts: todo.length, train: train.length, test: test.length, base_rate: +base.toFixed(4),
    model: { ...score(test, (s) => predict(model, s)), auc: auc(test, (s) => predict(model, s)) },
    capture_chance_only: { ...score(test, (s) => pOnly.pb[String(pBucket(s.p))] ? pOnly.pb[String(pBucket(s.p))].p : s.p), auc: auc(test, (s) => s.p) },
    neighbour_activity_only: { auc: auc(test, (s) => s.nb) },
  };
  fs.writeFileSync("oracle/backend/heat_model.json", JSON.stringify({ built: new Date().toISOString(), horizon_min: HORIZON, ...fit([...train, ...test]), eval: ev }) + "\n");
  console.log(`::notice title=heat model eval::${JSON.stringify(ev)}`);
  const show = Object.entries(model.mid).map(([k, v]) => `${k}:${v.p}`).join(" ");
  console.log(`::notice title=heat model (p bucket|nb -> chance)::${show}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
