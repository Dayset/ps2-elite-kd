#!/usr/bin/env node
/**
 * 🎲 Head-to-head "vs expected" fit (owner 2026-11-02, t845u). Offline, no network.
 *
 * How the ⚔️ iVi gap maps to the split of the kills between two players, fitted on every cached
 * killboard pair: player P's killboard row for opponent O gives P's kills on O and O's kills on P
 * (one row per pair, the bigger count when both sides are cached). Both need a ⚔️ iVi
 * (ranks-lite "adjs"). Pairs with MIN+ kills between them are kept.
 *
 * Model (Bradley–Terry): share of A = iVi_A^k ÷ (iVi_A^k + iVi_B^k), k by maximum likelihood.
 * Spread: real pairs vary far more than coin flips (not pure duels, squads, vehicles), so the
 * binomial z is shrunk by √(1 + (n − 1)·ρ), ρ fitted from the data. q90 / q99: the 90th / 99th
 * percentile of that |z| across the fitted pairs → "normal" / "unusual" / "very unusual".
 *
 * Usage: node scripts/fit-duel-ivi.mjs [dataDir=data/]  → <dataDir>duel-ivi-fit.json
 */
import fs from "node:fs";
import path from "node:path";
import { DUEL_FIT_MIN } from "../duels.mjs";

const dir = process.argv[2] || "data/";
const lite = JSON.parse(fs.readFileSync(path.join(dir, "ranks-lite.json"), "utf8"));
const c = lite.cols, ni = c.indexOf("name"), si = c.indexOf("slug"), ai = c.indexOf("adjs");
const ivi = new Map();
for (const r of lite.rows) {
  const v = r[ai];
  if (!Number.isFinite(v) || v <= 0) continue;
  ivi.set(String(r[ni]).toLowerCase(), v);
  ivi.set(String(r[si]).toLowerCase(), v);
}
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
    const key = me < o ? `${me}|${o}` : `${o}|${me}`;
    const x = me < o ? k : d;
    const old = pairs.get(key);
    if (!old || n > old.n) pairs.set(key, { x, n, L: Math.log(ivi.get(me < o ? me : o) / ivi.get(me < o ? o : me)) });
  }
}
const list = [...pairs.values()];
const sig = (t) => 1 / (1 + Math.exp(-t));
let k = 1;
for (let it = 0; it < 60; it++) {
  let g = 0, h = 0;
  for (const { x, n, L } of list) { const p = sig(k * L); g += L * (x - n * p); h -= L * L * n * p * (1 - p); }
  const step = g / h; k -= step;
  if (Math.abs(step) < 1e-9) break;
}
let num = 0, den = 0;
const zs = list.map(({ x, n, L }) => { const p = sig(k * L); const z = (x - n * p) / Math.sqrt(n * p * (1 - p)); num += (z * z - 1) * (n - 1); den += (n - 1) ** 2; return [z, n]; });
const rho = Math.max(0, num / den);
const az = zs.map(([z, n]) => Math.abs(z) / Math.sqrt(1 + (n - 1) * rho)).sort((a, b) => a - b);
const q = (p) => az[Math.min(az.length - 1, Math.floor(p * az.length))];
const out = { v: 1, at: new Date().toISOString(), pairs: list.length, min: DUEL_FIT_MIN, k: +k.toFixed(4), rho: +rho.toFixed(5), q90: +q(0.9).toFixed(3), q99: +q(0.99).toFixed(3),
  // |z| percentiles (every 1%) so the page can say "more lopsided than N% of pairs".
  pct: Array.from({ length: 99 }, (_, i) => +q((i + 1) / 100).toFixed(3)) };
fs.writeFileSync(path.join(dir, "duel-ivi-fit.json"), JSON.stringify(out) + "\n");
console.log(JSON.stringify({ ...out, pct: undefined }));
