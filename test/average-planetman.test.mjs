// Most average planetman (owner 2026-11-08): the player closest to the 50th
// percentile on every core stat at once. Eight columns, all required, never
// imputed — a missing value disqualifies the player. Weekly pinned on-device.
// Footer display (owner 2026-11-09): name on its own line, then all twelve
// stats — the eight core stats plus 🎲 Luck, 🤝 Assists, 🪳 Zerg and
// 🧘‍♂️ Pure iVi (display-only, never part of the pick; unknown shows "—").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gScores } from "../g-score.mjs";
import { traitPools, zergScore } from "../trait-scores.mjs";
import { pureIvI } from "../pure-ivi.mjs";
import { playerLuck, luckPoints } from "../luck-col.mjs";
import { AVG_METRICS, AVG_EXTRA, mostAveragePlayer, loadCachedAvg, saveCachedAvg, isCacheFresh, renderAvgPlanetman, AVG_TTL_MS } from "../average-planetman.mjs";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const poolsOf = (rows, metrics) => {
  const pools = {};
  for (const m of metrics) pools[m] = rows.map((r) => r[m]).filter(fin).sort((a, b) => a - b);
  return pools;
};

test("mostAveragePlayer: middle of the pack wins, thin and incomplete rows excluded; extras ride along", () => {
  // 3 players, 2 metrics. Pools span all rows (thin D counts in the population
  // percentiles, E's adjs counts but its null rkd doesn't): adjs [100,200,200,
  // 200,300], rkd [1,2,2,3]. B (p20/p25) and C (p80/p75) tie at 27.5; the name
  // tie-break picks B. D is thin with perfect-median values (excluded as a
  // candidate), E lacks rkd (excluded, never imputed).
  const rows = [
    { name: "A", slug: "a", thin: false, adjs: 100, rkd: 1 },
    { name: "B", slug: "b", thin: false, adjs: 200, rkd: 2, luck: 0.8, apk: 0.5, zerg: 30, pureivi: 180 },
    { name: "C", slug: "c", thin: false, adjs: 300, rkd: 3 },
    { name: "D", slug: "d", thin: true, adjs: 200, rkd: 2 },
    { name: "E", slug: "e", thin: false, adjs: 200, rkd: null },
  ];
  const w = mostAveragePlayer(rows, poolsOf(rows, ["adjs", "rkd"]), ["adjs", "rkd"]);
  assert.equal(w.name, "B");
  assert.ok(Math.abs(w.score - 27.5) < 1e-9, `score ${w.score}`);
  assert.equal(w.count, 5);
  assert.deepEqual(w.extra, { luck: 0.8, apk: 0.5, zerg: 30, pureivi: 180 });
  // A row with no extras at all still picks, with nulls — never imputed.
  const w2 = mostAveragePlayer([rows[0]], poolsOf([rows[0]], ["adjs", "rkd"]), ["adjs", "rkd"]);
  assert.deepEqual(w2.extra, { luck: null, apk: null, zerg: null, pureivi: null });
  assert.equal(mostAveragePlayer([], {}, ["adjs"]), null);
  assert.equal(mostAveragePlayer(rows, poolsOf(rows, ["adjs", "rkd"]), []), null);
});

test("mostAveragePlayer on live ranks: a real middle player, all eight columns present, extras joined", () => {
  const d = JSON.parse(readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
  const ci = Object.fromEntries(d.cols.map((c, i) => [c, i]));
  const objs = d.rows.map((r) => ({ name: r[ci.name], slug: r[ci.slug], thin: r[ci.thin] === 1, adjs: r[ci.adjs], act: r[ci.act], pvs: r[ci.pvs], rf: r[ci.rf], rkd: r[ci.rkd], cons: r[ci.cons], inf: r[ci.inf], apk: r[ci.apk], adjs0: r[ci.adjs0], inflation: r[ci.inflation], ivi: r[ci.ivi], rvp: r[ci.rvp], crp: r[ci.crp] }));
  const gMap = gScores(objs);
  for (const o of objs) o.g = gMap.get(o) ?? null;
  // 🪳 / 🧘‍♂️ exactly as rankings.mjs rebuildIndex computes them; 🎲 from the luck file.
  const tp = traitPools({ adjs: objs.map((o) => o.adjs), ivi: objs.map((o) => o.ivi), inflation: objs.map((o) => o.inflation), apk: objs.map((o) => o.apk) });
  const luckData = JSON.parse(readFileSync(new URL("../data/duel-ivi-player.json", import.meta.url), "utf8"));
  for (const o of objs) {
    const z = zergScore(tp, o.inflation, o.apk, o.rvp, o.crp);
    o.zerg = z ? z.score : null;
    o.pureivi = pureIvI(fin(o.adjs0) ? o.adjs0 : o.adjs, z ? z.score : null);
    const l = playerLuck(luckData, o.slug);
    o.luck = l ? luckPoints(l) : null;
  }
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
  // Extras: the winner is a real middle player, so the measured ones exist.
  assert.deepEqual(Object.keys(w.extra).sort(), [...AVG_EXTRA].sort());
  assert.ok(fin(w.extra.apk), `apk ${w.extra.apk}`);
  assert.ok(fin(w.extra.zerg) && w.extra.zerg >= 0 && w.extra.zerg <= 99, `zerg ${w.extra.zerg}`);
  assert.ok(fin(w.extra.pureivi), `pureivi ${w.extra.pureivi}`);
  assert.ok(w.extra.luck == null || fin(w.extra.luck), `luck ${w.extra.luck}`);
});

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); } };
};

const fullEntry = (over = {}) => ({
  name: "Bommbel", slug: "bommbel", score: 1.41, maxDev: 2,
  values: { adjs: 295, act: 0.25, pvs: 0.59, rf: 0.46, rkd: 0.59, cons: 0.55, inf: 84.9, g: 18.83 },
  pcts: {}, extra: { luck: 0.8, apk: 0.57, zerg: 57, pureivi: 224 }, count: 18665, at: Date.now(), ...over,
});

test("weekly cache: fresh for 7 days, then stale; garbage never parses; pre-extras entries recompute", () => {
  const s = fakeStorage();
  assert.equal(loadCachedAvg(s), null);
  const now = Date.now();
  const entry = fullEntry({ at: now });
  assert.equal(saveCachedAvg(s, entry), true);
  assert.equal(loadCachedAvg(s).name, "Bommbel");
  assert.equal(isCacheFresh(entry, now + 6 * 24 * 3600 * 1000), true);
  assert.equal(isCacheFresh(entry, now + 8 * 24 * 3600 * 1000), false);
  assert.equal(isCacheFresh(entry, now + AVG_TTL_MS), false);
  s.setItem("ps2elite_avg_planetman", "not json{");
  assert.equal(loadCachedAvg(s), null);
  // A cache written before the extras existed (no `extra` key) is treated as
  // absent, so the footer recomputes once instead of showing "—" for a week.
  const old = { name: "Bommbel", slug: "bommbel", score: 1.41, maxDev: 2, values: { adjs: 295, rkd: 0.59, pvs: 0.59 }, pcts: {}, count: 18665, at: now };
  s.setItem("ps2elite_avg_planetman", JSON.stringify(old));
  assert.equal(loadCachedAvg(s), null);
});

test("renderAvgPlanetman: cached winner fills two lines, no data needed; empty hides it", () => {
  const s = fakeStorage();
  saveCachedAvg(s, fullEntry());
  const el = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el, [], {}, s).name, "Bommbel");
  assert.equal(el.hidden, false);
  assert.equal(el.innerHTML, "Most average planetman: <a href=\"index.html?names=Bommbel\">Bommbel</a><br>⚔️ iVi 295, 🏃 Activity 0.25, 🦁 Brave 0.59, ☠️ K/D 0.59, 🛡️ Resist 0.46, ⚡ Const 0.55, 🎲 Luck +1%, 🤝 Assists 0.57, 🪳 Zerg 57, 🧘‍♂️ Pure iVi 224, 🌈 G 18.83%, 🪖 Infantry 84.9%");
  assert.match(el.title, /All eight core stats within 2 percentiles of the median of 18,665 players\. Recomputed weekly\./);
  const el2 = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el2, [], {}, fakeStorage()), null);
  assert.equal(el2.hidden, true);
});

test("renderAvgPlanetman: unknown extras show —, never a guess", () => {
  const s = fakeStorage();
  saveCachedAvg(s, fullEntry({ extra: { luck: null, apk: null, zerg: null, pureivi: null } }));
  const el = { innerHTML: "", title: "", hidden: true };
  renderAvgPlanetman(el, [], {}, s);
  assert.match(el.innerHTML, /🎲 Luck —, 🤝 Assists —, 🪳 Zerg —, 🧘‍♂️ Pure iVi —/);
});

test("renderAvgPlanetman: PS mirror omits 🧘‍♂️ Pure iVi entirely, never shows —", () => {
  const s = fakeStorage();
  saveCachedAvg(s, fullEntry({ name: "CaneloNC", slug: "canelonc", extra: { luck: -3.4, apk: 0.38, zerg: 41, pureivi: null } }), "ps");
  const el = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el, [], {}, s, "ps").name, "CaneloNC");
  assert.equal(el.hidden, false);
  assert.doesNotMatch(el.innerHTML, /Pure iVi/);
  assert.match(el.innerHTML, /Most average planetman: <a href="index\.html\?names=CaneloNC">CaneloNC<\/a><br>⚔️ iVi 295, 🏃 Activity 0\.25, 🦁 Brave 0\.59, ☠️ K\/D 0\.59, 🛡️ Resist 0\.46, ⚡ Const 0\.55, 🎲 Luck −3%, 🤝 Assists 0\.38, 🪳 Zerg 41, 🌈 G 18\.83%, 🪖 Infantry 84\.9%/);
  // And PC still shows it from the same entry shape.
  const s2 = fakeStorage();
  saveCachedAvg(s2, fullEntry());
  const el2 = { innerHTML: "", title: "", hidden: true };
  renderAvgPlanetman(el2, [], {}, s2, "pc");
  assert.match(el2.innerHTML, /🧘‍♂️ Pure iVi 224/);
});

test("weekly cache is room-scoped: the PS page never reads the PC winner", () => {
  const s = fakeStorage();
  saveCachedAvg(s, fullEntry({ name: "wcPiqer", slug: "wcpiger" }), "pc");
  saveCachedAvg(s, fullEntry({ name: "CaneloNC", slug: "canelonc" }), "ps");
  assert.equal(loadCachedAvg(s, "pc").name, "wcPiqer");
  assert.equal(loadCachedAvg(s, "ps").name, "CaneloNC");
  assert.equal(loadCachedAvg(s).name, "wcPiqer", "default room is PC, key unchanged");
  const s2 = fakeStorage();
  saveCachedAvg(s2, fullEntry({ name: "wcPiqer", slug: "wcpiger" }), "pc");
  assert.equal(loadCachedAvg(s2, "ps"), null, "a PC-only cache is invisible on PS");
});

test("renderAvgPlanetman: late 🎲 Luck patches a fresh cache instead of showing — for a week", () => {
  const s = fakeStorage();
  saveCachedAvg(s, fullEntry({ extra: { luck: null, apk: 0.57, zerg: 57, pureivi: 224 } }));
  // The luck file lands after the first render; today's rows carry it now.
  const rows = [{ name: "Bommbel", slug: "bommbel", luck: 0.8 }];
  const el = { innerHTML: "", title: "", hidden: true };
  assert.equal(renderAvgPlanetman(el, rows, {}, s).name, "Bommbel");
  assert.match(el.innerHTML, /🎲 Luck \+1%/);
  assert.equal(loadCachedAvg(s).extra.luck, 0.8, "patched value is re-saved");
  // No rows, no patch — the cached "—" stays until the data is there.
  const s2 = fakeStorage();
  saveCachedAvg(s2, fullEntry({ extra: { luck: null, apk: 0.57, zerg: 57, pureivi: 224 } }));
  const el2 = { innerHTML: "", title: "", hidden: true };
  renderAvgPlanetman(el2, [], {}, s2);
  assert.match(el2.innerHTML, /🎲 Luck —/);
});
