#!/usr/bin/env node
/**
 * 🎯 Class vs class report (t827u / t828u). PRIVATE: prints class-level totals only.
 *
 * Input, one of:
 *   --live [--since <unix s>]   GET /live/killclasses from the cache Worker (needs CENSUS_PROXY_KEY in the env;
 *                               alert kills collected by worker/src/kill-classes.js)
 *   --file <path>               a saved /live/killclasses reply, or a JSON array of tuples
 * Tuple: [t, w, z, attackerId, victimId, attackerLoadout, victimLoadout, weapon, attackerVehicle, hs, attackerTeam, victimTeam]
 *
 * Infantry kills only (killer not in a vehicle), no suicides, no team kills.
 * Opponent strength = each player's ⚔️ iVi (adjs) from data/ranks.json, as a percentile (0–1) among rated PC players.
 * Output (JSON with --json, else a table): kills matrix, K/D per class pair, iVi-weighted K/D
 * (each kill counts by the victim's percentile) and the median iVi of killers / victims per class.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLASSES = ["inf", "la", "med", "eng", "ha", "max"];
export const CLASS_NAMES = ["Infiltrator", "Light Assault", "Medic", "Engineer", "Heavy Assault", "MAX"];
const LO = { 1: 0, 8: 0, 15: 0, 28: 0, 3: 1, 10: 1, 17: 1, 29: 1, 4: 2, 11: 2, 18: 2, 30: 2, 5: 3, 12: 3, 19: 3, 31: 3, 6: 4, 13: 4, 20: 4, 32: 4, 7: 5, 14: 5, 21: 5, 45: 5 };
export const classIdx = (l) => (LO[+l] ?? -1);
/** Faction from a loadout id (1 NC, 2 TR, 3 VS, 4 NSO), for data without team ids. */
export const loadoutFaction = (l) => { l = +l; return l >= 1 && l <= 7 ? 1 : l >= 8 && l <= 14 ? 2 : l >= 15 && l <= 21 ? 3 : l >= 28 ? 4 : 0; };

/** Tuples → class matrix. strength: Map cid → percentile 0–1 (optional). */
export function classMatrix(tuples, strength = new Map()) {
  const K = CLASSES.map(() => CLASSES.map(() => 0));
  const W = CLASSES.map(() => CLASSES.map(() => 0));
  const kIvi = CLASSES.map(() => []), vIvi = CLASSES.map(() => []);
  const seen = new Set();
  let used = 0, skipped = 0, t0 = Infinity, t1 = 0;
  const players = new Set();
  for (const x of tuples || []) {
    const [t, , , a, v, al, vl, , av, , at, vt] = x;
    const key = `${t}|${a}|${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ka = classIdx(al), kv = classIdx(vl);
    const ta = at || loadoutFaction(al), tv = vt || loadoutFaction(vl);
    if (ka < 0 || kv < 0 || !a || a === "0" || a === v || +av || (ta && ta === tv && ta !== 4)) { skipped++; continue; }
    used++; t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    players.add(a); players.add(v);
    K[ka][kv]++;
    const sv = strength.get(String(v)), sa = strength.get(String(a));
    if (sv != null) { W[ka][kv] += sv; vIvi[kv].push(sv); }
    if (sa != null) kIvi[ka].push(sa);
  }
  const med = (a) => { if (!a.length) return null; a = a.slice().sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const kd = K.map((r, i) => r.map((k, j) => (K[j][i] ? k / K[j][i] : null)));
  const wkd = W.map((r, i) => r.map((w, j) => (W[j][i] ? w / W[j][i] : null)));
  const kills = K.map((r) => r.reduce((p, q) => p + q, 0)), deaths = CLASSES.map((_, j) => K.reduce((p, r) => p + r[j], 0));
  return { used, skipped, players: players.size, t0: used ? t0 : null, t1: used ? t1 : null, kills: K, kd, weightedKd: wkd,
    total: CLASSES.map((_, i) => ({ kills: kills[i], deaths: deaths[i], kd: deaths[i] ? kills[i] / deaths[i] : null, killerPct: med(kIvi[i]), victimPct: med(vIvi[i]) })) };
}

/** data/ranks.json + data/players → Map cid → ⚔️ iVi percentile among rated rows (thin rows left out). */
export function strengthMap(root) {
  const d = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
  const ix = Object.fromEntries(d.cols.map((c, i) => [c, i]));
  const rows = d.rows.filter((r) => Number.isFinite(r[ix.adjs]) && !r[ix.thin]).sort((p, q) => p[ix.adjs] - q[ix.adjs]);
  const m = new Map();
  rows.forEach((r, i) => {
    try { const j = JSON.parse(fs.readFileSync(path.join(root, "data/players", r[ix.slug] + ".json"), "utf8")); const cid = (j.player || j).cid; if (cid) m.set(String(cid), (i + 0.5) / rows.length); } catch {}
  });
  return m;
}

function print(r) {
  const f = (x, d = 2) => (x == null ? "  —  " : x.toFixed(d).padStart(5));
  console.log(`Infantry kills used: ${r.used} (skipped ${r.skipped}), players ${r.players}, ${r.t0 ? new Date(r.t0 * 1000).toISOString() + " → " + new Date(r.t1 * 1000).toISOString() : "no data"}`);
  console.log("\nK/D of row class vs column class (kills row→col / kills col→row):");
  console.log("".padEnd(14) + CLASS_NAMES.map((n) => n.slice(0, 6).padStart(7)).join(""));
  r.kd.forEach((row, i) => console.log(CLASS_NAMES[i].padEnd(14) + row.map((x) => " " + f(x) + " ").join("")));
  console.log("\nSame, each kill counted by the victim's iVi percentile:");
  r.weightedKd.forEach((row, i) => console.log(CLASS_NAMES[i].padEnd(14) + row.map((x) => " " + f(x) + " ").join("")));
  console.log("\nPer class: kills, deaths, K/D, median iVi percentile of its killers / its victims");
  r.total.forEach((t, i) => console.log(CLASS_NAMES[i].padEnd(14), t.kills, t.deaths, f(t.kd), f(t.killerPct), f(t.victimPct)));
}

async function main(argv) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  let tuples = [];
  if (argv.includes("--live")) {
    const key = process.env.CENSUS_PROXY_KEY;
    if (!key) throw new Error("CENSUS_PROXY_KEY not set");
    let since = +arg("--since") || Math.floor(Date.now() / 1000) - 31 * 86400;
    for (let page = 0; page < 200; page++) {
      const r = await fetch(`https://ps2-elite-kd-cache.dayset.workers.dev/live/killclasses?since=${since}&limit=200`, { headers: { "X-Proxy-Key": key } });
      if (!r.ok) throw new Error(`killclasses ${r.status}`);
      const j = await r.json();
      for (const b of j.rows || []) tuples.push(...b.k);
      if (!j.rows || j.rows.length < 200) break;
      since = j.rows[j.rows.length - 1].t1 + 1;
    }
  } else if (arg("--file")) {
    const j = JSON.parse(fs.readFileSync(arg("--file"), "utf8"));
    tuples = Array.isArray(j) ? j : (j.rows || []).flatMap((b) => b.k);
  } else throw new Error("use --live or --file <path>");
  const r = classMatrix(tuples, strengthMap(root));
  if (argv.includes("--json")) console.log(JSON.stringify(r)); else print(r);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
