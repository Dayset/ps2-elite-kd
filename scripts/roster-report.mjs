#!/usr/bin/env node
/**
 * 👥 Base roster report (owner 2026-10-30): joins the stored rosters (cache Worker rosters.js,
 * GET /live/rosters, proxy key) with names (data/cid-names.json) and iVi (data/ranks-lite.json).
 *
 *   CENSUS_PROXY_KEY=… node scripts/roster-report.mjs [--days 1] [--csv out.csv] [--file rows.json]
 *
 * Prints: rows, players, how many players on the point the live map already had at that base
 * (collector accuracy), and the average iVi of the side that took / held the base vs the other.
 * --csv writes one line per player: time, world, base, result, winner, name, faction, kills,
 * deaths, onPoint, iVi. Internal only: never published.
 */
import { readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const days = +arg("--days", 1);
const API = process.env.CACHE_URL || "https://ps2-elite-kd-cache.dayset.workers.dev";

async function rows() {
  const f = arg("--file");
  if (f) return JSON.parse(readFileSync(f, "utf8")).rows || [];
  const out = [];
  let since = Math.floor(Date.now() / 1000 - days * 86400);
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${API}/live/rosters?since=${since}&limit=2000`, { headers: { "X-Proxy-Key": process.env.CENSUS_PROXY_KEY || "" } });
    if (!r.ok) throw new Error(`rosters ${r.status}`);
    const j = await r.json();
    out.push(...j.rows);
    if (j.rows.length < 2000) break;
    since = j.rows[j.rows.length - 1].t + 1;
  }
  return out;
}

const names = JSON.parse(readFileSync(new URL("../data/cid-names.json", import.meta.url)));
const lite = JSON.parse(readFileSync(new URL("../data/ranks-lite.json", import.meta.url)));
const ni = lite.cols.indexOf("name"), ii = lite.cols.indexOf("ivi");
const ivi = new Map(lite.rows.map((r) => [String(r[ni]).toLowerCase(), +r[ii]]));
const nameOf = (cid) => { const v = names[cid]; return Array.isArray(v) ? v[0] : v || null; };

const list = await rows();
let players = 0, point = 0, pointSeen = 0;
const side = { win: [], lose: [] };
const csv = ["time,world,base,result,winner,name,faction,kills,deaths,on_point,ivi"];
for (const r of list) {
  for (const [cid, fac, k, d, pt] of r.pl) {
    players++;
    if (pt) { point++; if (fac) pointSeen++; }
    const n = nameOf(cid), v = n ? ivi.get(n.toLowerCase()) : undefined;
    if (Number.isFinite(v) && fac) (fac === r.fac ? side.win : side.lose).push(v);
    csv.push([new Date(r.t * 1000).toISOString(), r.w, JSON.stringify(r.fn || String(r.f)), r.r, r.fac, JSON.stringify(n || cid), fac || "", k, d, pt, Number.isFinite(v) ? v : ""].join(","));
  }
}
const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
console.log(JSON.stringify({ rows: list.length, caps: list.filter((r) => r.r === "cap").length, defenses: list.filter((r) => r.r === "def").length, players,
  onPoint: point, onPointAlreadySeen: point ? Math.round((100 * pointSeen) / point) + "%" : null,
  iviWinningSide: avg(side.win), iviOtherSide: avg(side.lose), withIvi: side.win.length + side.lose.length }, null, 1));
const out = arg("--csv");
if (out) { writeFileSync(out, csv.join("\n") + "\n"); console.log(`wrote ${out} (${csv.length - 1} lines)`); }
