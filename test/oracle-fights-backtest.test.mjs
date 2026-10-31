// ⚔️ #87 fights backtest (oracle-worker/history/fights-backtest.mjs): plumbing and that it
// finds a signal when one exists and none when the crowds are random.
import test from "node:test";
import assert from "node:assert/strict";
import { latticeFor } from "../oracle-worker/src/models.js";
import { warpgateConnected } from "../oracle-worker/src/commander.js";
import {
  fitLogit, predLogit, mulberry, prepAlert, ownAt, frontier, label, noisyRow, samplesFor, runAll, verdict,
  rosterSample, iviIndex, scoreRosters, bootMean,
} from "../oracle-worker/history/fights-backtest.mjs";

const ZONE = 2; // Indar
const FN = { 1: "VS", 2: "NC", 3: "TR" };

/** Synthetic Indar alert: owners by distance from the three warpgates, captures along the front;
 * the fights row shows a lopsided crowd and the point being taken at a base about to fall
 * (signal = true) or random crowds everywhere (signal = false). */
function synthAlert(seed, signal, spawns = false) {
  const rnd = mulberry(seed);
  const L = latticeFor(ZONE);
  const wgs = Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f])).slice(0, 3);
  const own = new Map(), dist = new Map(), q = [];
  wgs.forEach((w, i) => { own.set(w, i + 1); dist.set(w, 0); q.push(w); });
  while (q.length) { const c = q.shift(); for (const nb of L.adj.get(c) || []) if (!dist.has(nb)) { dist.set(nb, dist.get(c) + 1); own.set(nb, own.get(c)); q.push(nb); } }
  for (const f of Object.keys(L.names)) if (!own.has(f)) own.set(f, 1);
  const start = 1793300000, dur = 90;
  const frames = [{ t: 0, set: Object.fromEntries([...own].map(([f, o]) => [f, FN[o]])) }];
  const flips = [], fights = [];
  const cur = new Map(own);
  const planned = []; // [minute, fid, B]
  for (let m = 2; m < dur - 2; m += 1) {
    // About one capture a minute somewhere on the front.
    const reach = warpgateConnected(cur, L.adj, L.names);
    const front = [];
    for (const [fid, A] of cur) { if (wgs.includes(fid)) continue; for (const B of [1, 2, 3]) if (B !== A && (L.adj.get(fid) || []).some((nb) => cur.get(nb) === B && reach.get(B) && reach.get(B).has(nb))) front.push([fid, A, B]); }
    if (front.length && rnd() < 0.8) {
      const [fid, A, B] = front[Math.floor(rnd() * front.length)];
      if (!planned.some((p) => p[1] === fid && p[0] > m - 1)) planned.push([m + 1 + rnd() * 2, fid, B, A]);
    }
    for (const p of planned.filter((p) => p[0] <= m && !p.done)) {
      p.done = true;
      const rc = warpgateConnected(cur, L.adj, L.names);
      const still = cur.get(p[1]) === p[3] && (L.adj.get(p[1]) || []).some((nb) => cur.get(nb) === p[2] && rc.get(p[2]) && rc.get(p[2]).has(nb));
      if (!still) { p.dropped = true; continue; }
      cur.set(p[1], p[2]); flips.push([start + Math.round(p[0] * 60), p[1], p[3], p[2]]); frames.push({ t: Math.ceil(p[0]) + 0.5, set: { [p[1]]: FN[p[2]] } });
    }
    const rows = [];
    const soon = signal ? planned.filter((p) => !p.done && p[0] > m && p[0] <= m + 3) : [];
    for (const p of soon) {
      const n = [0, 0, 0];
      if (signal) { n[p[2] - 1] = 20 + Math.floor(rnd() * 10); n[p[3] - 1] = 3 + Math.floor(rnd() * 4); }
      else { n[p[2] - 1] = 2 + Math.floor(rnd() * 20); n[p[3] - 1] = 2 + Math.floor(rnd() * 20); }
      const row = [p[1], ...n, 10, signal ? FN[p[2]] : null, signal ? 30 : null];
      if (spawns) { const sp = [0, 0, 0, 0, 0, 0]; sp[p[2] - 1] = 3; sp[p[2] + 2] = 40; row.push(sp, [0, 0, 0].map((_, i) => (i === p[2] - 1 ? 250 : 80))); }
      rows.push(row);
    }
    // Decoy fights at front bases that don't fall.
    for (let i = 0; i < (signal ? 4 : 8) && front.length; i++) {
      const [fid, A, B] = front[Math.floor(rnd() * front.length)];
      if (rows.some((r) => r[0] === fid)) continue;
      const n = [0, 0, 0]; n[A - 1] = 2 + Math.floor(rnd() * 20); n[B - 1] = 2 + Math.floor(rnd() * 20);
      rows.push([fid, ...n, 5, null, null]);
    }
    fights.push({ t: m + 0.2, pop: null, b: rows.slice(0, 8) });
  }
  frames.sort((a, b) => a.t - b.t);
  return { key: `syn-${seed}`, world: 1, zone: ZONE, event_id: 147, start_ts: start, dur, winner: "VS", frames, flips, fights };
}

test("fitLogit recovers a simple rule", () => {
  const rnd = mulberry(1), X = [], y = [];
  for (let i = 0; i < 2000; i++) { const x = rnd() * 4 - 2; X.push([x, rnd()]); y.push(rnd() < 1 / (1 + Math.exp(-2 * x)) ? 1 : 0); }
  const m = fitLogit(X, y);
  assert.ok(predLogit(m, [1.5, 0.5]) > 0.85);
  assert.ok(predLogit(m, [-1.5, 0.5]) < 0.15);
});

test("owners, front line and labels line up with exact capture times", () => {
  const a = prepAlert(synthAlert(11, true));
  assert.ok(!a.skip, a.skip);
  const x = a.flips[3];
  const before = ownAt(a, x.m - 0.01), after = ownAt(a, x.m + 0.01);
  assert.equal(before.get(x.fid), x.old);
  assert.equal(after.get(x.fid), x.nw);
  assert.equal(label(a, x.fid, x.nw, x.m - 1, 3), 1);
  assert.equal(label(a, x.fid, x.nw, x.m, 3), 0, "the window starts after m");
  assert.equal(label(a, x.fid, x.nw, a.dur - 1, 3), null, "past the alert end");
  const fr = frontier(a, before, x.m - 0.01);
  assert.ok(fr.some((p) => p.fid === x.fid && p.B === x.nw), "the captured base was on the front");
});

test("skips alerts without fights, Meltdowns and unknown winners", () => {
  assert.equal(prepAlert({ key: "k", fights: [] }).skip, "no fights");
  assert.equal(prepAlert({ ...synthAlert(2, true), event_id: 176 }).skip, "meltdown");
  assert.equal(prepAlert({ ...synthAlert(2, true), winner: "draw" }).skip, "no winner");
});

test("noise keeps head counts but moves some players", () => {
  const r = { t: 5, b: new Map([["a", { n: [40, 10, 0], k: 30, cf: 1, ca: 20 }], ["b", { n: [0, 0, 20], k: 5, cf: 0, ca: null }]]) };
  const z = noisyRow(r, mulberry(5));
  const tot = (m) => [...m.values()].reduce((s, x) => s + x.n[0] + x.n[1] + x.n[2], 0);
  assert.equal(tot(z.b), 70);
  assert.notDeepEqual(z.b.get("a").n, [40, 10, 0]);
  assert.deepEqual(r.b.get("a").n, [40, 10, 0], "input untouched");
});

test("finds the gain when crowds foretell captures, and passes the bar", () => {
  const rep = runAll([1, 2, 3, 4, 5, 6, 7].map((s) => synthAlert(s, true)));
  assert.equal(rep.alerts, 7);
  const f = rep.flips[3].buckets.all;
  assert.ok(f.both < f.map * 0.9, `fights should beat the map: ${JSON.stringify(rep.flips[3].buckets)}`);
  assert.ok(f.point < f.map, "point signal alone helps");
  assert.ok(rep.flips[3].delta_both.hi < 0);
  assert.ok(rep.commander.orders > 0);
  assert.ok(rep.win.buckets.all.n > 0);
  if (process.env.FB_DEBUG) console.log(JSON.stringify({ f3: rep.flips[3].buckets.all, f15: rep.flips[15].buckets.all, win: rep.win.buckets, cmd: rep.commander, v: verdict(rep) }));
});

test("finds nothing when crowds are random", () => {
  const rep = runAll([21, 22, 23, 24, 25, 26].map((s) => synthAlert(s, false)));
  const f = rep.flips[3].buckets.all;
  // Random crowds still mark the bases with a fight, so allow a little; no big gain.
  assert.ok(f.both > f.map * 0.9, `no real signal: ${f.both} vs ${f.map}`);
  const v = verdict(rep);
  assert.equal(typeof v.keep_flips, "boolean");
});

test("rosters: skill helps only when it is in the data", () => {
  const ranks = { cols: ["name", "ivi"], rows: [] }, names = {};
  for (let i = 0; i < 400; i++) { names[String(100000 + i)] = `p${i}`; ranks.rows.push([`p${i}`, 50 + (i % 100)]); }
  const idx = iviIndex(names, ranks);
  const rnd = mulberry(9), rows = [];
  for (let i = 0; i < 400; i++) {
    const pl = [];
    const nA = 5 + Math.floor(rnd() * 10), nD = 5 + Math.floor(rnd() * 10);
    let sa = 0, sd = 0;
    for (let j = 0; j < nA; j++) { const c = 100000 + Math.floor(rnd() * 400); sa += 50 + ((c - 100000) % 100); pl.push([String(c), "TR", 1, 1, 0]); }
    for (let j = 0; j < nD; j++) { const c = 100000 + Math.floor(rnd() * 400); sd += 50 + ((c - 100000) % 100); pl.push([String(c), "VS", 1, 1, 0]); }
    const cap = sa / nA - sd / nD + 3 * (nA - nD) + (rnd() - 0.5) * 10 > 0;
    rows.push({ t: i, r: cap ? "cap" : "def", old: "VS", fac: cap ? "TR" : "VS", pl });
  }
  const s = rows.map((r) => rosterSample(r, idx)).filter(Boolean);
  assert.equal(s.length, 400);
  const rep = scoreRosters(s);
  assert.ok(rep.crowd_skill.brier < rep.crowd.brier, JSON.stringify(rep));
  assert.ok(rep.skill_weights.att_mean_ivi > 0 && rep.skill_weights.def_mean_ivi < 0);
});

test("bootMean brackets the mean", () => {
  const b = bootMean([-0.01, -0.02, -0.015, -0.005]);
  assert.ok(b.lo <= b.mean && b.mean <= b.hi && b.hi < 0);
});

test("🚐 / 👥 variants switch on once rows carry spawns and iVi", () => {
  const rep = runAll([31, 32, 33].map((x) => synthAlert(x, true, true)));
  assert.deepEqual(rep.extra_variants, ["spawn", "skill"]);
  assert.equal(rep.with_spawns, 3);
  const f = rep.flips[3].buckets.all;
  assert.ok(Number.isFinite(f.spawn) && Number.isFinite(f.skill));
  const plain = runAll([31, 32, 33].map((x) => synthAlert(x, true, false)));
  assert.deepEqual(plain.extra_variants, []);
  assert.equal(plain.flips[3].buckets.all.spawn, undefined);
  assert.equal(typeof verdict(rep).keep_projection, "boolean");
});
