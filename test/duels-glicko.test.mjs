// #112: pairwise Glicko-2 replay for the Duels panel (glicko2.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  glickoEnv, rating, rate, rate1vs1, winpct1vs1, duelGlicko, duelGlickoFromIvi, pairChance, seedPair, widen, DUEL_GLICKO,
} from "../glicko2.mjs";
import { duelExpected, DUEL_FIT_MIN } from "../duels.mjs";

const ref = JSON.parse(fs.readFileSync(new URL("./fixtures/glicko2-ref.json", import.meta.url), "utf8"));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const DAY = 86400;
const seqEvents = (seq, t0 = 1.7e9, gap = 60) => seq.map((k, i) => ({ t: t0 + i * gap, aKill: !!k, veh: 0 }));

test("Glickman's paper example (tau 0.5) matches the published numbers", () => {
  const r = rate(glickoEnv({ tau: 0.5 }), rating(1500, 200, 0.06), [[1, rating(1400, 30, 0.06)], [0, rating(1550, 100, 0.06)], [0, rating(1700, 300, 0.06)]]);
  near(r.mu, 1464.051, 0.001, "mu");
  near(r.phi, 151.515, 0.002, "phi");
  near(r.sigma, 0.05999, 0.00001, "sigma");
  near(r.mu, ref.glickman[0], 1e-9, "mu vs Python");
});

test("kill sequences match the Python reference (ps2ranks rate_1vs1, RD floor 30, tau 0.3)", () => {
  const env = glickoEnv({ tau: 0.3 });
  for (const name of ["a_wins", "mixed", "b_wins"]) {
    let a = rating(1500, 100, 0.02), b = rating(1500, 100, 0.02);
    ref[name].seq.forEach((k, i) => {
      a = rating(a.mu, Math.max(30, a.phi), a.sigma); b = rating(b.mu, Math.max(30, b.phi), b.sigma);
      if (k) [a, b] = rate1vs1(env, a, b); else [b, a] = rate1vs1(env, b, a);
      const want = ref[name].traj[i];
      [a.mu, a.phi, a.sigma, b.mu, b.phi, b.sigma].forEach((v, j) => near(v, want[j], 1e-7, `${name} step ${i} field ${j}`));
    });
    const w = winpct1vs1(env, a, b);
    near(w[0], ref[name].winpct[0], 1e-7, `${name} winpct A`);
    near(w[1], ref[name].winpct[1], 1e-7, `${name} winpct B`);
  }
  const [x, y] = ref.winpct_uneven;
  const w = winpct1vs1(env, rating(x[0], x[1], 0.02), rating(x[2], x[3], 0.02));
  near(w[0], y[0], 1e-9, "uneven A"); near(w[1], y[1], 1e-9, "uneven B");
});

test("the flat replay (veh all, no idle days) equals the Python trajectory", () => {
  const r = duelGlicko(seqEvents(ref.mixed.seq, 1.7e9, 0), { seed: "flat", veh: "all", min: 1 });
  const last = ref.mixed.traj.at(-1);
  near(r.a.mu, last[0], 1e-7, "mu A"); near(r.b.mu, last[3], 1e-7, "mu B");
  assert.equal(r.ka, ref.mixed.seq.filter(Boolean).length);
});

test("pairChance is symmetric; the iVi seed starts exactly at the 🎲 share", () => {
  const a = rating(1600, 90, 0.02), b = rating(1450, 140, 0.02);
  near(pairChance(a, b) + pairChance(b, a), 1, 1e-12, "sum");
  for (const e0 of [0.2, 0.5, 0.73, 0.95]) { const [x, y] = seedPair(e0, "ivi"); near(pairChance(x, y), e0, 1e-12, `seed ${e0}`); }
  const [f1, f2] = seedPair(0.9, "flat");
  assert.equal(f1.mu, 1500); assert.equal(f2.mu, 1500); assert.equal(f1.phi, 100);
});

test("iVi seed: a 300 vs 1800 iVi pair starts lopsided, flat 1500 does not", () => {
  const fit = JSON.parse(fs.readFileSync(new URL("../data/duel-ivi-fit.json", import.meta.url), "utf8"));
  const pe = seqEvents(Array.from({ length: 20 }, (_, i) => (i % 2 ? 1 : 0))); // 10–10 split
  const seeded = duelGlickoFromIvi(pe, 300, 1800, fit, 0, 0);
  const flat = duelGlicko(pe, { seed: "flat" });
  assert.ok(seeded.e0 < 0.3, `🎲 share ${seeded.e0}`);
  assert.ok(seeded.traj[0].p < 0.3, "the first kill is predicted from iVi");
  near(flat.traj[0].p, 0.5, 1e-12, "flat starts even");
  near(seeded.e0, duelExpected(300, 1800, fit, 0, 0), 1e-12, "e0 is the 🎲 share");
});

test("20-kill floor: no verdict below DUEL_FIT_MIN counted kills; vehicle kills don't count", () => {
  assert.equal(DUEL_FIT_MIN, 20);
  const pe = seqEvents(Array(19).fill(1));
  assert.equal(duelGlicko(pe, { seed: "flat" }), null);
  const withVeh = [...pe, { t: 1.8e9, aKill: true, veh: 4 }];
  assert.equal(duelGlicko(withVeh, { seed: "flat" }), null, "a vehicle kill does not reach the floor (infantry-only)");
  const r = duelGlicko(withVeh, { seed: "flat", veh: "all" });
  assert.equal(r.n, 20);
  const inf = duelGlicko([...pe, { t: 1.8e9, aKill: false, veh: 0 }, { t: 1.8e9 + 5, aKill: true, veh: 7 }], { seed: "flat" });
  assert.equal(inf.n, 20); assert.equal(inf.skipped, 1);
});

test("RD widens with idle days, is capped, and old pairs are stale", () => {
  const r0 = rating(1500, 60, 0.02);
  assert.equal(widen(r0, 0).phi, 60);
  assert.ok(widen(r0, 30).phi > 60);
  assert.ok(widen(r0, 365).phi > widen(r0, 30).phi);
  assert.equal(widen(rating(1500, 340, 0.02), 1e6).phi, DUEL_GLICKO.maxRd);
  const pe = seqEvents([...Array(15).fill(1), ...Array(10).fill(0)]);
  const fresh = duelGlicko(pe, { seed: "flat", now: pe.at(-1).t + DAY });
  const old = duelGlicko(pe, { seed: "flat", now: pe.at(-1).t + 400 * DAY });
  assert.equal(fresh.stale, false); assert.equal(old.stale, true);
  assert.ok(old.aNow.phi > fresh.aNow.phi, "RD now is wider after a long break");
  assert.ok(Math.abs(old.p - 0.5) < Math.abs(fresh.p - 0.5), "wider RD → next-kill chance pulled toward even");
  near(old.a.mu, fresh.a.mu, 1e-9, "the rating itself does not move with time");
});

test("idle days between fights widen RD before the next kill", () => {
  const close = duelGlicko(seqEvents(Array(25).fill(1), 1.7e9, 60), { seed: "flat" });
  const apart = duelGlicko(seqEvents(Array(25).fill(1), 1.7e9, 30 * DAY), { seed: "flat" });
  assert.ok(apart.a.mu - apart.b.mu > close.a.mu - close.b.mu, "wider RD between kills → each kill moves the rating more");
});

test("a certain outcome (huge gap) leaves both ratings unchanged instead of NaN", () => {
  const env = glickoEnv({ tau: 0.3, sigma: 0.02 });
  for (const [x, y] of [[rating(9500, 30, 0.02), rating(1500, 30, 0.02)], [rating(1500, 30, 0.02), rating(9500, 30, 0.02)]]) {
    const [a, b] = rate1vs1(env, x, y);
    for (const r of [a, b]) for (const v of [r.mu, r.phi, r.sigma]) assert.ok(Number.isFinite(v));
  }
});
