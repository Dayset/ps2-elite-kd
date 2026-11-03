#!/usr/bin/env node
/**
 * 🎲 Head-to-head "vs expected" fit (owner 2026-11-02, t845u; v2 t847u). Offline, no network.
 * Only feeds the 🎲 row of the duels comparison: iVi, rankings and every other number stay as they are.
 *
 * Data: every cached killboard pair. Player P's row for opponent O gives P's kills on O and O's
 * kills on P (one row per pair, the bigger count when both sides are cached). Both need a ⚔️ iVi
 * (ranks-lite "adjs"); MIN+ kills between them.
 *
 * v2 model (duels.mjs duelExpected): logit(share of A) = curve(ln iVi_A/iVi_B) + veh · (vA − vB)
 *   curve: odd, monotonic, piecewise linear on |ln ratio| (knots at quantiles of the data), flat
 *          past the last knot. The single-k formula underrated the stronger player in normal gaps
 *          and overrated them in huge ones.
 *   vA, vB: share of each player's kills made from vehicles (ranks-lite "infVeh"). Killboard pairs
 *          don't mark which kills were from a vehicle, so the split can't be infantry-only; the
 *          vehicle player's edge (infantry often can't shoot back) is fitted instead.
 * Safety: 20% of pairs (fixed by name hash) are held out. v2 is written only if it beats the
 * single-k formula on them (log loss per kill and the miss across iVi-gap groups); else v1.
 * Spread: binomial z shrunk by √(1 + (n − 1)·ρ); q90 / q99 / pct from the fitted pairs.
 *
 * Usage: node scripts/fit-duel-ivi.mjs [dataDir=data/] [--players-only]  → <dataDir>duel-ivi-fit.json + duel-ivi-player.json
 *   --players-only: keep the committed fit, only rebuild the per-player file.
 */
import fs from "node:fs";
import path from "node:path";
import { DUEL_FIT_MIN, duelExpected } from "../duels.mjs";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) || "data/";
const lite = JSON.parse(fs.readFileSync(path.join(dir, "ranks-lite.json"), "utf8"));
const c = lite.cols, ni = c.indexOf("name"), si = c.indexOf("slug"), ai = c.indexOf("adjs"), vi = c.indexOf("infVeh");
const ivi = new Map(), veh = new Map();
for (const r of lite.rows) {
  const v = r[ai];
  if (!Number.isFinite(v) || v <= 0) continue;
  for (const k of [String(r[ni]).toLowerCase(), String(r[si]).toLowerCase()]) {
    ivi.set(k, v);
    if (vi >= 0 && Number.isFinite(r[vi])) veh.set(k, r[vi] / 100);
  }
}
const vs = vi >= 0 ? lite.rows.map((r) => r[vi]).filter(Number.isFinite).sort((a, b) => a - b) : [];
const vehMed = vs.length ? +(vs[vs.length >> 1] / 100).toFixed(4) : 0;
const bare = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase();
const pairs = new Map();
const pdir = path.join(dir, "players");
for (const f of fs.readdirSync(pdir)) {
  if (!f.endsWith(".json")) continue;
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(pdir, f), "utf8")).player || {}; } catch { continue; }
  const me = bare(p.display);
  if (!ivi.has(me)) continue;
  for (const r of p.rows || []) {
    const o = bare(r.name);
    if (!o || o === "0" || o === me || !ivi.has(o)) continue;
    const k = +r.kills || 0, d = +r.deaths || 0, n = k + d;
    if (n < DUEL_FIT_MIN) continue;
    const [A, B] = me < o ? [me, o] : [o, me];
    const old = pairs.get(`${A}|${B}`);
    if (!old || n > old.n) pairs.set(`${A}|${B}`, { A, B, x: me < o ? k : d, n });
  }
}
const vOf = (k) => (veh.has(k) ? veh.get(k) : vehMed);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const list = [...pairs.values()].map((q) => ({ ...q, L: Math.log(ivi.get(q.A) / ivi.get(q.B)), va: vOf(q.A), vb: vOf(q.B), dv: vOf(q.A) - vOf(q.B), test: hash(`${q.A}|${q.B}`) < 0.2 }));
const sig = (t) => 1 / (1 + Math.exp(-t));

// Weighted logistic regression on binomial counts (Newton). feats(q) → number[]; free: which coefs to fit.
function logit(rows, feats, p, free = null) {
  const F = rows.map(feats);
  let b = new Array(p).fill(0);
  const on = free || new Array(p).fill(true);
  for (let it = 0; it < 50; it++) {
    const g = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    rows.forEach((q, r) => {
      const f = F[r]; let e = 0; for (let j = 0; j < p; j++) e += b[j] * f[j];
      const pr = sig(e), w = q.n * pr * (1 - pr), res = q.x - q.n * pr;
      for (let j = 0; j < p; j++) { if (!on[j]) continue; g[j] += f[j] * res; for (let l = 0; l < p; l++) if (on[l]) H[j][l] += w * f[j] * f[l]; }
    });
    const idx = [...Array(p).keys()].filter((j) => on[j]);
    const M = idx.map((j) => [...idx.map((l) => H[j][l]), g[j]]);
    for (let i = 0; i < M.length; i++) { // Gauss-Jordan
      let piv = i; for (let r = i + 1; r < M.length; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      [M[i], M[piv]] = [M[piv], M[i]];
      for (let r = 0; r < M.length; r++) if (r !== i) { const fct = M[r][i] / M[i][i]; for (let cc = i; cc <= M.length; cc++) M[r][cc] -= fct * M[i][cc]; }
    }
    let mx = 0; idx.forEach((j, i) => { const st = M[i][M.length] / M[i][i]; b[j] += st; mx = Math.max(mx, Math.abs(st)); });
    if (mx < 1e-8) break;
  }
  return b;
}
const train = list.filter((q) => !q.test), test = list.filter((q) => q.test);

function fitV1(rows) { return { v: 1, k: logit(rows, (q) => [q.L], 1)[0] }; }
function fitV2(rows) {
  const ab = rows.map((q) => Math.abs(q.L)).sort((a, b) => a - b);
  const qs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.97, 0.995];
  const t = [0, ...new Set(qs.map((p) => +ab[Math.floor(p * ab.length)].toFixed(3)))].filter((v, i, a) => i === 0 || v > a[i - 1]);
  const S = t.length - 1; // segment slopes, then veh
  const feats = (q) => { const x = Math.abs(q.L), sg = Math.sign(q.L), f = []; for (let i = 0; i < S; i++) f.push(sg * Math.max(0, Math.min(x, t[i + 1]) - t[i])); f.push(q.dv); return f; };
  const free = new Array(S + 1).fill(true);
  let b;
  for (;;) { // monotonic: a falling segment is held flat and the rest refitted
    b = logit(rows, feats, S + 1, free);
    const bad = b.slice(0, S).findIndex((v, i) => free[i] && v < 0);
    if (bad < 0) break;
    free[bad] = false; b[bad] = 0;
  }
  const y = [0]; for (let i = 0; i < S; i++) y.push(y[i] + b[i] * (t[i + 1] - t[i]));
  return { v: 2, curve: { t, y: y.map((v) => +v.toFixed(5)) }, veh: +b[S].toFixed(4), vehMed };
}
const expOf = (fit, q) => duelExpected(Math.exp(q.L), 1, fit, q.va, q.vb);
// Held-out scores: log loss per kill, and the average miss (points) of the stronger player's share across 10 equal iVi-gap groups.
function score(fit, rows) {
  let ll = 0, nn = 0;
  for (const q of rows) { const p = Math.min(1 - 1e-9, Math.max(1e-9, expOf(fit, q))); ll -= q.x * Math.log(p) + (q.n - q.x) * Math.log(1 - p); nn += q.n; }
  const s = [...rows].sort((a, b) => Math.abs(a.L) - Math.abs(b.L)), G = 10, groups = [];
  for (let g = 0; g < G; g++) {
    const part = s.slice(Math.floor((g * s.length) / G), Math.floor(((g + 1) * s.length) / G));
    let X = 0, N = 0, E = 0, Lm = 0;
    for (const q of part) { const st = q.L >= 0, p = expOf(fit, q); X += st ? q.x : q.n - q.x; E += q.n * (st ? p : 1 - p); N += q.n; Lm += Math.abs(q.L); }
    groups.push({ ratio: +Math.exp(Lm / part.length).toFixed(2), actual: +(X / N).toFixed(4), predicted: +(E / N).toFixed(4) });
  }
  const miss = groups.reduce((a, g) => a + Math.abs(g.actual - g.predicted), 0) / G;
  return { logLoss: +(ll / nn).toFixed(5), missPts: +(miss * 100).toFixed(2), groups };
}
if (process.argv.includes("--players-only")) {
  writePlayers(JSON.parse(fs.readFileSync(path.join(dir, "duel-ivi-fit.json"), "utf8")));
} else {
  const oldT = fitV1(train), newT = fitV2(train);
  const so = score(oldT, test), sn = score(newT, test);
  const wins = sn.logLoss < so.logLoss && sn.missPts < so.missPts;
  let fit = wins ? fitV2(list) : fitV1(list);
  let num = 0, den = 0;
  const zs = list.map((q) => { const p = expOf(fit, q); const z = (q.x - q.n * p) / Math.sqrt(q.n * p * (1 - p)); num += (z * z - 1) * (q.n - 1); den += (q.n - 1) ** 2; return [z, q.n]; });
  const rho = Math.max(0, num / den);
  const az = zs.map(([z, n]) => Math.abs(z) / Math.sqrt(1 + (n - 1) * rho)).sort((a, b) => a - b);
  const q = (p) => az[Math.min(az.length - 1, Math.floor(p * az.length))];
  const out = { ...fit, pairs: list.length, min: DUEL_FIT_MIN, rho: +rho.toFixed(5), q90: +q(0.9).toFixed(3), q99: +q(0.99).toFixed(3),
    // v1 k kept on every file so an older page can still read it.
    k: +(wins ? fitV1(list).k : fit.k).toFixed(4),
    // |z| percentiles (every 1%) so the page can say "more one-sided than N% of pairs".
    pct: Array.from({ length: 99 }, (_, i) => +q((i + 1) / 100).toFixed(3)),
    holdout: { pairs: test.length, old: { logLoss: so.logLoss, missPts: so.missPts }, new: { logLoss: sn.logLoss, missPts: sn.missPts }, used: wins ? "new" : "old", groupsOld: so.groups, groupsNew: sn.groups } };
  fs.writeFileSync(path.join(dir, "duel-ivi-fit.json"), JSON.stringify(out) + "\n");
  console.log(JSON.stringify({ ...out, pct: undefined, holdout: { ...out.holdout, groupsOld: undefined, groupsNew: undefined } }));
  writePlayers(out);
}

/**
 * 🎲 per player (owner 2026-11-02, t849u; debug column first): over every opponent with MIN+ kills between them,
 * the average gap (actual − expected share of those kills, the same model as the duels row), weighted by kills.
 * Shrunk toward 0 by how noisy the player's average is (empirical Bayes: τ² / (τ² + s²)), so few or small
 * matchups pull it in. Only players with OPP_MIN+ such opponents. cuts = the player spread: middle 90% normal,
 * outside 99% "much". → <dataDir>duel-ivi-player.json, {v, model, min, oppMin, pairs, players, cuts, p: {slug: [gap‰, opponents, beat%]}}
 */
function writePlayers(fit) {
  const OPP_MIN = 20;
  const slug = (k) => k.replace(/[^a-z0-9]+/g, "");
  const per = new Map();
  for (const q of list) {
    const e = duelExpected(Math.exp(q.L), 1, fit, q.va, q.vb), r = q.x / q.n - e;
    for (const [k, rr] of [[q.A, r], [q.B, -r]]) { let a = per.get(k); if (!a) per.set(k, (a = [])); a.push([rr, q.n]); }
  }
  const raw = [];
  for (const [k, a] of per) {
    if (a.length < OPP_MIN) continue;
    const N = a.reduce((s, [, n]) => s + n, 0), g = a.reduce((s, [r, n]) => s + r * n, 0) / N;
    const s2 = a.reduce((s, [r, n]) => s + (n * (r - g)) ** 2, 0) / (N * N) * (a.length / (a.length - 1));
    raw.push({ k, g, s2, m: a.length, b: a.filter(([r]) => r > 0).length / a.length });
  }
  const mg = raw.reduce((s, x) => s + x.g, 0) / raw.length;
  const tau2 = Math.max(1e-6, raw.reduce((s, x) => s + (x.g - mg) ** 2, 0) / raw.length - raw.reduce((s, x) => s + x.s2, 0) / raw.length);
  const p = {};
  for (const x of raw) { x.v = x.g * (tau2 / (tau2 + x.s2)); p[slug(x.k)] = [Math.round(x.v * 1000), x.m, Math.round(x.b * 100)]; }
  const vs = raw.map((x) => x.v).sort((a, b) => a - b), qq = (f) => Math.round(vs[Math.min(vs.length - 1, Math.floor(f * vs.length))] * 1000);
  const o = { v: 1, model: fit.v || 1, min: DUEL_FIT_MIN, oppMin: OPP_MIN, pairs: list.length, players: raw.length,
    cuts: { lo99: qq(0.005), lo90: qq(0.05), hi90: qq(0.95), hi99: qq(0.995) }, p };
  fs.writeFileSync(path.join(dir, "duel-ivi-player.json"), JSON.stringify(o) + "\n");
  console.log(JSON.stringify({ players: o.players, cuts: o.cuts, tau: +Math.sqrt(tau2).toFixed(4) }));
}
