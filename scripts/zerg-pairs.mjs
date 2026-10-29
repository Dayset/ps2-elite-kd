#!/usr/bin/env node
/**
 * 🪳 Zerg theory pair check (#84). Offline, no network. Run from the repo root:
 *   node scripts/zerg-pairs.mjs [--room pc|ps] [--json out.json]
 *
 * Pairs: every killboard pair in data/players/*.json (data-ps/ for --room ps) where both
 * players are ranked (ranks-lite.json). Both directions averaged when both killboards list
 * each other. Infantry subset = both 🪖 Infantry ≥ 75 %. Killboard rows are LIFETIME counts
 * (Census characters_event_grouped), so a later refresh re-measures the same pairs; the
 * independent check is the DISJOINT pairs with fewer kills (bands below).
 *
 * Reports:
 *  1. The #84 §3 set (≥ 300 kills) and its regression kill_gap ~ adjs_gap + zerg_gap.
 *  2. §7 / §6 exactly as worded, on the §3 set and on disjoint 100–299 pairs.
 *  3. Curve model: log kill ratio = f(adjs_lo) − f(adjs_hi) + g·(zerg_lo − zerg_hi), f piecewise
 *     linear over adjs (knots at player quantiles), Poisson weights, pairs ≥ 30 kills.
 *     g as % kill ratio per 🪳 step, and in adjs points (g / f').
 *  4. Out-of-sample: train ≥ 100 kills, test 30–99 (disjoint): per-kill log-loss, winner hits.
 *  5. Tier × 🪳 grid: players' duel residual vs the curve (no zerg term) by ⚔️ iVi tier and 🪳 band,
 *     with the prototype charge for comparison.
 */
import fs from "node:fs";
import path from "node:path";
import { traitPools, zergScore } from "../trait-scores.mjs";
import { tierOf } from "../tiers.mjs";
import { ZERG_CHARGE, zergChargedAdjs } from "../zerg-charge.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOM = arg("--room", "pc"), JSON_OUT = arg("--json", null);
const DIR = ROOM === "ps" ? "data-ps" : "data";
const R_PROTO = 0.00436, REF = 610.6;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const slugKey = (n) => String(n || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };
const median = (a) => quant(a, 0.5);
const pctOf = (lk) => (Math.exp(lk) - 1) * 100;

// ---------- weighted least squares ----------
function ols(X, y, w = null) {
  const n = X.length, k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  let sw = 0, swy = 0;
  for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1, x = X[i]; sw += wi; swy += wi * y[i]; for (let a = 0; a < k; a++) { A[a][k] += wi * x[a] * y[i]; for (let b = 0; b < k; b++) A[a][b] += wi * x[a] * x[b]; } }
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
  const beta = A.map((r, i) => r[k] / r[i]), ym = swy / sw;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; let f = 0; for (let a = 0; a < k; a++) f += beta[a] * X[i][a]; sse += wi * (y[i] - f) ** 2; sst += wi * (y[i] - ym) ** 2; }
  return { beta, r2: 1 - sse / sst, n };
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** 95 % interval by resampling PLAYERS (pairs share players, so pair resampling is too narrow). */
function playerBoot(rows, stat, B = 100, seed = 7) {
  const ps = [...new Set(rows.flatMap((r) => [r.a, r.b]))], R = rng(seed), out = [];
  for (let b = 0; b < B; b++) {
    const c = new Map(); for (let i = 0; i < ps.length; i++) { const p = ps[Math.floor(R() * ps.length)]; c.set(p, (c.get(p) || 0) + 1); }
    const s = []; for (const r of rows) { const m = (c.get(r.a) || 0) * (c.get(r.b) || 0); for (let q = 0; q < m; q++) s.push(r); }
    if (s.length > 20) out.push(stat(s));
  }
  return [quant(out, 0.025), quant(out, 0.975)];
}

// ---------- players ----------
const lite = JSON.parse(fs.readFileSync(path.join(DIR, "ranks-lite.json"), "utf8"));
const ci = (id) => lite.cols.indexOf(id);
const colOf = (id) => lite.rows.map((r) => r[ci(id)]);
const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
const adjsPool = colOf(ci("adjs0") >= 0 ? "adjs0" : "adjs").filter(fin).sort((a, b) => a - b); // fit on iVi BEFORE the 🪳 evening-out
const P = new Map();
for (const r of lite.rows) {
  const g = (id) => r[ci(id)];
  const z = zergScore(tp, g("inflation"), g("apk"), g("rvp"), g("crp"));
  P.set(g("slug"), { name: g("name"), slug: g("slug"), adjs: ci("adjs0") >= 0 ? g("adjs0") : g("adjs"), inf: g("inf"), infVeh: g("infVeh"), infMax: g("infMax"), zerg: z ? z.score : null, tier: tierOf(ci("adjs0") >= 0 ? g("adjs0") : g("adjs"), adjsPool) });
}
const cidNames = ROOM === "pc" && fs.existsSync(path.join(DIR, "cid-names.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "cid-names.json"), "utf8")) : {};
const resolve = (name, srv) => {
  let n = String(name || "");
  if (/^\d{10,}$/.test(n)) { const v = cidNames[n]; n = Array.isArray(v) ? v[0] : v || n; }
  const s = slugKey(n);
  if (srv && P.has(s + "-" + srv)) return s + "-" + srv;
  return P.has(s) ? s : null;
};

// ---------- pairs ----------
const dir = new Map();
for (const f of fs.readdirSync(path.join(DIR, "players")).filter((x) => x.endsWith(".json"))) {
  const srv = ROOM === "ps" ? f.slice(0, 2) : null;
  let j; try { j = JSON.parse(fs.readFileSync(path.join(DIR, "players", f), "utf8")); } catch { continue; }
  const pl = j.player || j, a = resolve(pl.display || j.query, srv);
  if (!a) continue;
  const m = new Map();
  for (const row of pl.rows || []) {
    const b = resolve(row.name, srv); if (!b || b === a) continue;
    const e = m.get(b) || { k: 0, d: 0 }; e.k += +row.kills || 0; e.d += +row.deaths || 0; m.set(b, e);
  }
  dir.set(a, m);
}
const allPairs = [], seen = new Set();
for (const [a, m] of dir) for (const [b, ab] of m) {
  const key = a < b ? a + "|" + b : b + "|" + a; if (seen.has(key)) continue; seen.add(key);
  const ba = dir.get(b) && dir.get(b).get(a);
  allPairs.push({ a, b, ka: ba ? (ab.k + ba.d) / 2 : ab.k, kb: ba ? (ab.d + ba.k) / 2 : ab.d });
}
/** Oriented rows (hi = higher adjs), infantry subset, both 🪳 known (unless anyZerg), kills in [min, max). */
function rowsIn(min, max = Infinity, anyZerg = false) {
  const out = [];
  for (const p of allPairs) {
    const n = p.ka + p.kb; if (n < min || n >= max) continue;
    const A = P.get(p.a), B = P.get(p.b);
    if (!fin(A.adjs) || !fin(B.adjs) || (!anyZerg && (A.zerg == null || B.zerg == null))) continue;
    const [hi, lo, khi, klo] = A.adjs >= B.adjs ? [A, B, p.ka, p.kb] : [B, A, p.kb, p.ka];
    if (!(hi.adjs > 0) || khi <= 0 || klo <= 0 || !(hi.inf >= 75 && lo.inf >= 75)) continue;
    out.push({ a: hi.slug, b: lo.slug, hi, lo, khi, klo, n,
      adjs_gap: (lo.adjs - hi.adjs) / hi.adjs * 100, kill_gap: (klo - khi) / khi * 100, zerg_gap: lo.zerg == null || hi.zerg == null ? null : lo.zerg - hi.zerg,
      lk: Math.log((klo + 0.5) / (khi + 0.5)), w: 1 / (1 / (klo + 0.5) + 1 / (khi + 0.5)) });
  }
  return out;
}
const charge = (p, r = R_PROTO) => (p.adjs > 0 ? p.adjs * (1 - r * p.zerg) : p.adjs - r * p.zerg * REF);
const report = { room: ROOM, at: new Date().toISOString(), pairsVisible: allPairs.length };
const log = (...a) => console.log(...a);

// 1 + 2. §3 set, §7 / §6
for (const [min, max, label] of [[300, Infinity, "§3 set (≥ 300 kills)"], [100, 300, "disjoint 100–299 kills"]]) {
  const rs = rowsIn(min, max);
  const o = ols(rs.map((r) => [1, r.adjs_gap, r.zerg_gap]), rs.map((r) => r.kill_gap));
  const cg = (r, rr) => { const h = charge(r.hi, rr), l = charge(r.lo, rr); return (l - h) / h * 100; };
  const c = ols(rs.map((r) => [1, cg(r), r.zerg_gap]), rs.map((r) => r.kill_gap));
  let best = null;
  for (let rr = 0; rr <= 0.012 + 1e-9; rr += 0.0001) { const f = ols(rs.map((r) => [1, cg(r, rr)]), rs.map((r) => r.kill_gap)); if (!best || f.r2 > best.r2) best = { r: +rr.toFixed(4), r2: f.r2 }; }
  const ciZ = playerBoot(rs, (s) => ols(s.map((r) => [1, r.adjs_gap, r.zerg_gap]), s.map((r) => r.kill_gap)).beta[2], 200);
  const pts = ols(rs.map((r) => [1, (r.lo.adjs - r.hi.adjs) / 100, r.zerg_gap]), rs.map((r) => r.kill_gap));
  log(`${label}: ${rs.length} infantry pairs, ${new Set(rs.flatMap((r) => [r.a, r.b])).size} players`);
  log(`  kill_gap = ${r1(o.beta[0])} + ${r3(o.beta[1])}·adjs_gap ${r3(o.beta[2])}·zerg_gap, R² ${r3(o.r2)}; zerg 95 % ${ciZ.map(r3).join("…")}; §7 bar ≤ −0.15: ${o.beta[2] <= -0.15 ? "pass" : "fail"}`);
  log(`  same with the adjs gap in points: zerg ${r3(pts.beta[2])}, R² ${r3(pts.r2)}`);
  log(`  §6 with r = ${R_PROTO}: zerg ${r3(c.beta[2])} (|·| ≤ 0.05 ${Math.abs(c.beta[2]) <= 0.05 ? "pass" : "fail"}), R² ${r3(c.r2)} (≥ 0.40 ${c.r2 >= 0.4 ? "pass" : "fail"}); refit r ${best.r} (R² ${r3(best.r2)})`);
  report[min === 300 ? "s3" : "disjoint"] = { pairs: rs.length, coef: o.beta.map(r3), r2: r3(o.r2), zergCi: ciZ.map(r3), pointsModel: { zerg: r3(pts.beta[2]), r2: r3(pts.r2) }, s6: { zerg: r3(c.beta[2]), r2: r3(c.r2) }, refitR: best.r };
}

// 3. curve model
function curve(rs, nk = 12) {
  const ps = [...new Set(rs.flatMap((r) => [r.hi, r.lo]))];
  const knots = [...new Set(Array.from({ length: nk }, (_, i) => quant(ps.map((p) => p.adjs), 0.01 + i * 0.985 / (nk - 1))))];
  const hat = (x) => { const w = new Array(knots.length).fill(0); if (x <= knots[0]) { w[0] = 1; return w; } if (x >= knots.at(-1)) { w[knots.length - 1] = 1; return w; } let i = 0; while (x > knots[i + 1]) i++; const t = (x - knots[i]) / (knots[i + 1] - knots[i]); w[i] = 1 - t; w[i + 1] = t; return w; };
  const fd = (r, v = (p) => p.adjs) => { const a = hat(v(r.lo)).slice(1), b = hat(v(r.hi)).slice(1); return a.map((x, i) => x - b[i]); };
  const slope = (beta, x) => { const f = [0, ...beta.slice(0, knots.length - 1)]; let i = 0; while (i < knots.length - 2 && x > knots[i + 1]) i++; return (f[i + 1] - f[i]) / (knots[i + 1] - knots[i]); };
  return { knots, fd, slope, nA: knots.length - 1 };
}
{
  const rs = rowsIn(30), C = curve(rs);
  const fit = (s, g) => ols(s.map((r) => [...C.fd(r), ...g(r)]), s.map((r) => r.lk), s.map((r) => r.w));
  const f0 = fit(rs, () => []), f1 = fit(rs, (r) => [r.zerg_gap]);
  const g = f1.beta.at(-1), gci = playerBoot(rs, (s) => fit(s, (r) => [r.zerg_gap]).beta.at(-1), 100);
  const ZK = [0, 10, 20, 40, 60, 80, 100], gz = (z) => ZK.slice(0, -1).map((k, i) => Math.max(0, Math.min(z, ZK[i + 1]) - k));
  const fs2 = fit(rs, (r) => gz(r.lo.zerg).map((v, i) => v - gz(r.hi.zerg)[i]));
  const shape = Object.fromEntries([10, 20, 40, 60, 80].map((z) => [z, r1(pctOf(gz(z).reduce((s, v, i) => s + v * fs2.beta[C.nA + i], 0)))]));
  log(`curve model, ${rs.length} infantry pairs ≥ 30 kills: R² ${r3(f0.r2)} without 🪳, ${r3(f1.r2)} with`);
  log(`  🪳 per step ${g.toFixed(5)} log (95 % ${gci.map((v) => v.toFixed(5)).join("…")}): 🪳 50 = ${r1(pctOf(50 * g))} % kill ratio at the same adjs`);
  log(`  in adjs points per 🪳 step: ${[500, 1000, 1500, 2000].map((x) => `@${x} ${r1(-g / C.slope(f1.beta, x))}`).join("  ")} (prototype: ${[500, 1000, 1500, 2000].map((x) => r1(R_PROTO * x)).join(" / ")})`);
  log(`  shape (kill ratio vs a 🪳 0 player): ${Object.entries(shape).map(([z, v]) => `${z}: ${v} %`).join("  ")}`);
  report.curve = { pairs: rs.length, r2: [r3(f0.r2), r3(f1.r2)], perStep: +g.toFixed(5), ci: gci.map((v) => +v.toFixed(5)), shape };

  // per-tier weight: one 🪳 slope per ⚔️ iVi tier, in adjs points per step at the tier's median adjs
  const TIERS = ["top1", "top5", "top10", "top25", "top50", "lower"];
  const gt = (p) => TIERS.map((t) => (p.tier === t ? p.zerg : 0));
  const ft = fit(rs, (r) => gt(r.lo).map((v, i) => v - gt(r.hi)[i]));
  const med = Object.fromEntries(TIERS.map((t) => [t, median(rs.flatMap((r) => [r.hi, r.lo]).filter((p) => p.tier === t).map((p) => p.adjs))]));
  const toPts = (b) => TIERS.map((t, i) => -b[C.nA + i] / C.slope(b, med[t]));
  const pt = toPts(ft.beta);
  const ptCi = (() => {
    const ps = [...new Set(rs.flatMap((r) => [r.a, r.b]))], R = rng(9), out = [];
    for (let b = 0; b < 100; b++) {
      const c = new Map(); for (let i = 0; i < ps.length; i++) { const p = ps[Math.floor(R() * ps.length)]; c.set(p, (c.get(p) || 0) + 1); }
      const s = []; for (const r of rs) { const m = (c.get(r.a) || 0) * (c.get(r.b) || 0); for (let q = 0; q < m; q++) s.push(r); }
      out.push(toPts(fit(s, (r) => gt(r.lo).map((v, i) => v - gt(r.hi)[i])).beta));
    }
    return TIERS.map((_, i) => [quant(out.map((v) => v[i]), 0.025), quant(out.map((v) => v[i]), 0.975)]);
  })();
  report.tierWeights = TIERS.map((t, i) => ({ tier: t, medAdjs: Math.round(med[t]), ptsPerStep: r1(pt[i]), ci: ptCi[i].map(r1), pctPerStep: +(100 * pt[i] / med[t]).toFixed(3), prototypePts: r1(R_PROTO * med[t]) }));
  log("  per-tier 🪳 weight (adjs points per step, + = drop): " + report.tierWeights.map((w) => `${w.tier} ${w.ptsPerStep} [${w.ci.join("…")}] (${w.pctPerStep} %; prototype ${w.prototypePts})`).join("  "));

  // 5. tier × band grid (curve without 🪳)
  const res = new Map();
  for (const r of rs) {
    const e = r.lk - C.fd(r).reduce((s, v, i) => s + v * f0.beta[i], 0);
    for (const [p, sg] of [[r.lo, 1], [r.hi, -1]]) { const a = res.get(p) || { p, sw: 0, s: 0, n: 0 }; a.sw += r.w; a.s += r.w * e * sg; a.n++; res.set(p, a); }
  }
  const players = [...res.values()].filter((a) => a.n >= 5);
  const TI = ["top1", "top5", "top10", "top25", "top50", "lower"], ZB = [[0, 10], [10, 25], [25, 50], [50, 75], [75, 100]];
  report.grid = [];
  log("  tier × 🪳 band: duel kill ratio vs adjs alone (players, adjs points that match / prototype charge)");
  for (const t of TI) {
    const cells = ZB.map(([lo, hi]) => {
      const c = players.filter((a) => a.p.tier === t && a.p.zerg >= lo && a.p.zerg < hi);
      if (c.length < 8) return { n: c.length };
      const m = c.reduce((s, a) => s + a.sw * (a.s / a.sw), 0) / c.reduce((s, a) => s + a.sw, 0);
      const ad = median(c.map((a) => a.p.adjs)), zm = median(c.map((a) => a.p.zerg));
      return { n: c.length, pct: r1(pctOf(m)), pts: Math.round(m / C.slope(f0.beta, ad)), proto: -Math.round(R_PROTO * zm * ad) };
    });
    report.grid.push({ tier: t, cells });
    log(`    ${t.padEnd(6)} ${cells.map((c, i) => `🪳${ZB[i][0]}–${ZB[i][1] - 1}: ${c.pct == null ? `n${c.n}` : `${c.pct > 0 ? "+" : ""}${c.pct} % (${c.pts}/${c.proto} pts, n${c.n})`}`).join("  ")}`);
  }
}

// 4. out of sample
{
  const train = rowsIn(100), test = rowsIn(30, 100), C = curve(train, 10);
  const pct = (h, l) => (l - h) / h * 100;
  const models = {
    "adjs % gap (today)": (r) => [1, pct(r.hi.adjs, r.lo.adjs)],
    "charged % gap (prototype)": (r) => [1, pct(charge(r.hi), charge(r.lo))],
    "adjs points gap": (r) => [1, (r.lo.adjs - r.hi.adjs) / 100],
    "adjs curve": (r) => [1, ...C.fd(r)],
    "adjs curve + 🪳": (r) => [1, ...C.fd(r), r.zerg_gap],
    "charged curve (prototype)": (r) => [1, ...C.fd(r, (p) => charge(p))],
  };
  log(`out of sample: train ${train.length} pairs ≥ 100 kills, test ${test.length} disjoint pairs 30–99 kills`);
  report.oos = {};
  let base = null;
  for (const [name, X] of Object.entries(models)) {
    const f = ols(train.map(X), train.map((r) => r.lk), train.map((r) => r.w));
    let ll = 0, k = 0, hit = 0, hn = 0;
    for (const r of test) {
      const s = X(r).reduce((t, v, i) => t + v * f.beta[i], 0), p = 1 / (1 + Math.exp(-s));
      ll -= r.klo * Math.log(p) + r.khi * Math.log(1 - p); k += r.n;
      if (r.klo !== r.khi) { hn++; if ((p > 0.5) === (r.klo > r.khi)) hit++; }
    }
    const L = ll / k; base ??= L;
    report.oos[name] = { logLoss: +L.toFixed(5), vsToday: +((L / base - 1) * 100).toFixed(2), winner: r1(100 * hit / hn) };
    log(`  ${name.padEnd(27)} log-loss/kill ${L.toFixed(5)} (${((L / base - 1) * 100).toFixed(2)} % vs today), winner ${r1(100 * hit / hn)} %`);
  }
}
// 6. shipped 🪳⚔️ iVi
{
  const ok = (p) => fin(p.infVeh) && fin(p.infMax);
  const rs = rowsIn(30).filter((r) => ok(r.hi) && ok(r.lo));
  const veh = (r) => [(r.lo.infVeh - r.hi.infVeh) / 10, (r.lo.infMax - r.hi.infMax) / 10];
  const lowest = rs.reduce((m, r) => Math.min(m, r.hi.adjs, r.lo.adjs), Infinity);
  const L = (v, K) => Math.log(v + K);
  const fitK = (s, K, val, extra) => ols(s.map((r) => [L(val(r.lo), K) - L(val(r.hi), K), ...veh(r), ...extra(r)]), s.map((r) => r.lk), s.map((r) => r.w));
  const dz = (r) => [r.lo.zerg - r.hi.zerg];
  const raw = (p) => p.adjs;
  const best = (s, val, extra, step = 100) => { let b = null; for (let K = 1200; K <= 5000; K += step) { if (K + lowest <= 5 || s.some((r) => val(r.lo) + K <= 5 || val(r.hi) + K <= 5)) continue; const f = fitK(s, K, val, extra); if (!b || f.r2 > b.f.r2) b = { K, f }; } return b; };
  const b0 = best(rs, raw, dz), lam = -b0.f.beta[3] / b0.f.beta[0];
  const ps = [...new Set(rs.flatMap((r) => [r.a, r.b]))], R = rng(5), boots = [];
  for (let it = 0; it < 60; it++) {
    const c = new Map(); for (let i = 0; i < ps.length; i++) { const p = ps[Math.floor(R() * ps.length)]; c.set(p, (c.get(p) || 0) + 1); }
    const s = []; for (const r of rs) { const m = (c.get(r.a) || 0) * (c.get(r.b) || 0); for (let q = 0; q < m; q++) s.push(r); }
    const bb = best(s, raw, dz, 200); boots.push({ K: bb.K, l: -bb.f.beta[3] / bb.f.beta[0] });
  }
  const lamCi = [quant(boots.map((x) => x.l), 0.025), quant(boots.map((x) => x.l), 0.975)];
  log(`shipped 🪳⚔️ iVi: K ${ZERG_CHARGE.K}, λ ${ZERG_CHARGE.LAMBDA}; refit on ${rs.length} pairs (vehicle & MAX held fixed): K ${b0.K}, λ ${lam.toFixed(6)} (95 % ${lamCi.map((v) => v.toFixed(6)).join("…")})`);
  const TIERS = ["top1", "top5", "top10", "top25", "top50", "lower"];
  const pl = [...new Set(rs.flatMap((r) => [r.hi, r.lo]))];
  const tiers = TIERS.map((t) => {
    const a = median(pl.filter((p) => p.tier === t).map((p) => p.adjs));
    const d = a - zergChargedAdjs(a, ZERG_CHARGE.CENTER + 50), bs = boots.map((x) => a - ((a + x.K) * Math.exp(-x.l * 50) - x.K));
    const lo = quant(bs, 0.025), hi = quant(bs, 0.975);
    return { tier: t, medAdjs: Math.round(a), drop50steps: Math.round(d), ci: [Math.round(lo), Math.round(hi)], margin: Math.round((100 * (hi - lo)) / 2 / d) };
  });
  log(`  drop for 50 🪳 steps (🪳 ${ZERG_CHARGE.CENTER} → ${ZERG_CHARGE.CENTER + 50}; shipped; 95 % from the refits): ` + tiers.map((t) => `${t.tier} @${t.medAdjs} −${t.drop50steps} (${t.ci.join("…")}, ±${t.margin} %)`).join("  "));
  // held-out: fit on one half of the players, test on pairs inside the other half
  const R2 = rng(42), half = new Map(); for (const p of ps) half.set(p, R2() < 0.5 ? 0 : 1);
  const H = [0, 1].map((h) => rs.filter((r) => half.get(r.a) === h && half.get(r.b) === h));
  const held = [];
  for (const [tr, te] of [[H[0], H[1]], [H[1], H[0]]]) {
    const f = best(tr, raw, dz), l = -f.f.beta[3] / f.f.beta[0];
    const ch = (p) => (p.adjs + f.K) * Math.exp(-l * p.zerg) - f.K;
    const before = best(te, raw, dz).f.beta[3], after = best(te, ch, dz).f.beta[3];
    const ll = (val) => { const bb = best(tr, val, () => []); let s = 0, k = 0; for (const r of te) { const x = [L(val(r.lo), bb.K) - L(val(r.hi), bb.K), ...veh(r)]; const z = x.reduce((t, v, i) => t + v * bb.f.beta[i], 0), p = 1 / (1 + Math.exp(-z)); s -= r.klo * Math.log(p) + r.khi * Math.log(1 - p); k += r.n; } return s / k; };
    held.push({ before: +pctOf(before).toFixed(3), after: +pctOf(after).toFixed(3), logLoss: +((ll(ch) / ll(raw) - 1) * 100).toFixed(3) });
  }
  log("  held-out 🪳 bias per step (raw → adjusted) and log-loss change: " + held.map((h) => `${h.before} % → ${h.after} %, ${h.logLoss} %`).join("  |  "));
  // center: which 🪳 do players WITHOUT a 🪳 score (plain iVi in the column) duel like?
  const ra = rowsIn(30, Infinity, true).filter((r) => ok(r.hi) && ok(r.lo));
  const zn = (p) => (p.zerg == null ? [0, 1] : [p.zerg, 0]);
  const lowA = ra.reduce((m, r) => Math.min(m, r.hi.adjs, r.lo.adjs), Infinity);
  const Kc = Math.max(ZERG_CHARGE.K, Math.ceil(10 - lowA));
  const fitC = (s) => ols(s.map((r) => { const a = zn(r.lo), c = zn(r.hi); return [L(r.lo.adjs, Kc) - L(r.hi.adjs, Kc), ...veh(r), a[0] - c[0], a[1] - c[1]]; }), s.map((r) => r.lk), s.map((r) => r.w));
  const fc = fitC(ra), eq = fc.beta[4] / fc.beta[3];
  const psA = [...new Set(ra.flatMap((r) => [r.a, r.b]))], R3 = rng(3), eqB = [];
  for (let it = 0; it < 60; it++) {
    const c = new Map(); for (let i = 0; i < psA.length; i++) { const p = psA[Math.floor(R3() * psA.length)]; c.set(p, (c.get(p) || 0) + 1); }
    const s = []; for (const r of ra) { const m = (c.get(r.a) || 0) * (c.get(r.b) || 0); for (let q = 0; q < m; q++) s.push(r); }
    const f = fitC(s); eqB.push(f.beta[4] / f.beta[3]);
  }
  const eqCi = [quant(eqB, 0.025), quant(eqB, 0.975)];
  const zKnown = [...P.values()].filter((p) => p.zerg != null).map((p) => p.zerg);
  log(`  center ${ZERG_CHARGE.CENTER}: players without 🪳 (${ra.length} pairs incl. them) duel like 🪳 ${r1(eq)} (95 % ${eqCi.map(r1).join("…")}); median 🪳 of the rest ${median(zKnown)}`);
  const pass = ZERG_CHARGE.LAMBDA >= lamCi[0] && ZERG_CHARGE.LAMBDA <= lamCi[1] && held.every((h) => Math.abs(h.after) <= Math.abs(h.before) / 2) && ZERG_CHARGE.CENTER >= eqCi[0] && ZERG_CHARGE.CENTER <= eqCi[1];
  log(`  re-run check: ${pass ? "PASS" : "FAIL"} (shipped λ inside the refit range, held-out bias at most half the raw one, center inside the no-🪳 range)`);
  report.shipped = { K: ZERG_CHARGE.K, lambda: ZERG_CHARGE.LAMBDA, center: ZERG_CHARGE.CENTER, refit: { K: b0.K, lambda: +lam.toFixed(6), ci: lamCi.map((v) => +v.toFixed(6)) }, noZergLike: { zerg: r1(eq), ci: eqCi.map(r1) }, tiers, held, pass };
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n");
