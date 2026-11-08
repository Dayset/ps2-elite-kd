// Most average planetman (owner 2026-11-08): the player closest to the 50th
// percentile on every core stat at once. Eight columns, all required, never
// imputed — a missing value disqualifies the player. Weekly pinned on-device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gScores } from "../g-score.mjs";
import { AVG_METRICS, mostAveragePlayer, loadCachedAvg, saveCachedAvg, isCacheFresh, renderAvgPlanetman, AVG_TTL_MS } from "../average-planetman.mjs";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const poolsOf = (rows, metrics) => {
  const pools = {};
  for (const m of metrics) pools[m] = rows.map((r) => r[m]).filter(fin).sort((a, b) => a - b);
  return pools;
};

test("mostAveragePlayer: middle of the pack wins, thin and incomplete rows excluded", () => {
  // 3 players, 2 metrics. Pools span all rows (thin D counts in the population
  // percentiles, E's adjs counts but its null rkd doesn't): adjs [100,200,200,
  // 200,300], rkd [1,2,2,3]. B (p20/p25) and C (p80/p75) tie at 27.5; the name
  // tie-break picks B. D is thin with perfect-median values (excluded as a
  // candidate), E lacks rkd (excluded, never imputed).
  const rows = [
    { name: "A", slug: "a", thin: false, adjs: 100, rkd: 1 },
    { name: "B", slug: "b", thin: false, adjs: 200, rkd: 2 },
    { name: "C", slug: "c", thin: false, adjs: 300, rkd: 3 },
    { name: "D", slug: "d", thin: true, adjs: 200, rkd: 2 },
    { name: "E", slug: "e", thin: false, adjs: 200, rkd: null },
  ];
  const w = mostAveragePlayer(rows, poolsOf(rows, ["adjs", "rkd"]), ["adjs", "rkd"]);
  assert.equal(w.name, "B");
  assert.ok(Math.abs(w.score - 27.5) < 1e-9, `score ${w.score}`);
  assert.equal(w.count, 5);
  assert.equal(mostAveragePlayer([], {}, ["adjs"]), null);
  assert.equal(mostAveragePlayer(rows, poolsOf(rows, ["adjs", "rkd"]), []), null);
});

test("mostAveragePlayer on live ranks: a real middle player, all eight columns present", () => {
  const d = JSON.parse(readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
  const ci = Object.fromEntries(d.cols.map((c, i) => [c, i]));
  const objs = d.rows.map((r) => ({ name: r[ci.name], slug: r[ci.slug], thin: r[ci.thin] === 1, adjs: r[ci.adjs], act: r[ci.act], pvs: r[ci.pvs], rf: r[ci.rf], rkd: r[ci.rkd], cons: r[ci.cons], inf: r[ci.inf] }));
  const gMap = gScores(objs);
  for (const o of objs) o.g = gMap.get(o) ?? null;
  const pools = poolsOf(objs, AVG_METRICS);
  const t0 = Date.now();
  const w = mostAveragePlayer(objs, pools);
  assert.ok(Date.now() - t0 < 1000, "fast enough for a page load");
  assert.ok(w, "someone qualifies");
  assert.equal(w.thin, undefined);
  assert.ok(w.score < 5, `score ${w.score} (eight metrics, G pulls everyone off 50)`);
  for (const m of AVG_METRICS) {
    assert.ok(fin(w.values[m]), `${m} present on the winner`);
    assert.ok(w.pcts[m] >= 30 && w.pcts[m] <= 70, `${m} p${w.pcts[m].toFixed(0)} near the middle`);
  }
});

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); } };
};

test("weekly cache: fresh for 7 days, then stale; garbage never parses", () => {
  const s = fakeStorage();
  assert.equal(loadCachedAvg(s), null);
  const now = Date.now();
  const entry = { name: "Bommbel", slug: "bommbel", score: 1.41, maxDev: 2, values: { adjs: 295, rkd: 0.59, pvs: 0.59 }, pcts: {}, count: 18665, at: now };
  assert.equal(saveCachedAvg(s, entry), true);
  assert.equal(loadCachedAvg(s).name, "Bommbel");
  assert.equal(isCacheFresh(entry, now + 6 * 24 * 3600 * 1000), true);
  assert.equal(isCacheFresh(entry, now + 8 * 24 * 3600 * 1000), false);
  assert.equal(isCacheFresh(entry, now + AVG_TTL_MS), false);
  s.setItem("ps2elite_avg_planetman", "not json{");
  assert.equal(loadCachedAvg(s), null);
});

test("renderAvgPlanetman: cached winner fills the line, no data needed; empty hides it", () => {
  const s = fakeStorage();
  const entry = { name: "Bommbel", slug: "bommbel", score: 1.41, maxDev: 2, values: { adjs: 295, rkd: 0.59, pvs: 0.59 }, pcts: {}, count: 18665, at: Date.now() };
  saveCachedAvg(s, entry);
  const el = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el, [], {}, s).name, "Bommbel");
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /Most average planetman: <a href="index\.html\?names=Bommbel">Bommbel<\/a> — ⚔️ iVi 295, ☠️ K\/D 0\.59, 🦁 Brave 0\.59/);
  assert.match(el.title, /within 2 percentiles of the median of 18,665 players\. Recomputed weekly\./);
  const el2 = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el2, [], {}, fakeStorage()), null);
  assert.equal(el2.hidden, true);
});
