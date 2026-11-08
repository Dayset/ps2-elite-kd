// 🌈 G (cheese-table.mjs): top by ☠️ K/D, double-gated, ordered by G score.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cheeseList, inCheeseGate, CHEESE_TOP_N, CHEESE_BRAVE_OK, CHEESE_LOW_INF } from "../cheese-table.mjs";

const row = (name, rkd, pvs, inf) => ({ name, rkd, pvs, inf });

test("takes the top N by rkd, drops rows without one", () => {
  const rows = [row("a", 9, 0.1, 10), row("b", null, 0.1, 10), row("c", 3, 5, 90), row("d", 12, 0.2, 10)];
  const { rows: out } = cheeseList(rows, { top: 2 });
  // d out-scores a on the rank-sum (rkd rank 1 beats Brave rank 1).
  assert.deepEqual(out.map((r) => r.name), ["d", "a"]);
});

test("G score orders by rank-sum, not by Brave alone; G% is the share out-cheesed", () => {
  // rkd ranks a1 b2 c3 d4 e5; brave ranks c1 a2 b3 d4 e5; inf ranks e1 a2 b3 d4 c5.
  // sums: a=5, b=8, c=9, e=11, d=12. G% = floor(100 * worse / 5).
  const rows = [
    row("a", 9, 0.1, 5), // in
    row("b", 8, 1.5, 5), // in
    row("c", 7, 0.05, 95), // out: lowest Brave of all, but inf 95
    row("d", 6, 5, 10), // out
    row("e", 5, null, 1), // out: unknown Brave never passes, worst rank
  ];
  const { rows: out, edgeIndex } = cheeseList(rows);
  assert.deepEqual(out.map((r) => r.name), ["a", "b", "c", "e", "d"]);
  assert.equal(edgeIndex, 2);
  assert.deepEqual(out.map((r) => r.g), [80, 60, 40, 20, 0]);
});

test("tied sums share the same G%; row order inside a tie is Brave, then rkd", () => {
  // Every row sums to 6: a=1+3+2, b=2+1+3, c=3+2+1.
  const rows = [row("a", 9, 0.3, 20), row("b", 8, 0.1, 30), row("c", 7, 0.2, 10)];
  const { rows: out, edgeIndex } = cheeseList(rows);
  assert.deepEqual(out.map((r) => r.name), ["b", "c", "a"]);
  assert.deepEqual(out.map((r) => r.g), [0, 0, 0]);
  assert.equal(edgeIndex, 3);
});

test("gate boundaries: Brave 1.7 and Infantry 50 are out (strictly under)", () => {
  assert.equal(CHEESE_BRAVE_OK, 1.7);
  assert.equal(CHEESE_LOW_INF, 50);
  assert.equal(inCheeseGate(row("a", 9, 1.69, 49)), true);
  assert.equal(inCheeseGate(row("b", 9, 1.7, 10)), false);
  assert.equal(inCheeseGate(row("c", 9, 0.5, 50)), false);
  assert.equal(inCheeseGate(row("d", 9, null, 10)), false);
  assert.equal(inCheeseGate(row("e", 9, 0.5, null)), false);
});

test("stats: mean/median Brave, in-gate count, population median; G% on a 3-row crowd", () => {
  const rows = [
    row("a", 9, 0.1, 10), // in
    row("b", 8, 0.3, 90),
    row("c", 7, 2, 10),
    row("d", 6, 4, 90),
    row("e", 5, 0.2, 40), // in, but outside the top 3
    row("f", 1, 10, 90), // outside the top 3
  ];
  const { rows: out, stats } = cheeseList(rows, { top: 3 });
  assert.equal(stats.n, 3);
  assert.equal(stats.inCount, 1);
  assert.equal(stats.medianBrave, 0.3);
  assert.ok(Math.abs(stats.meanBrave - (0.1 + 0.3 + 2) / 3) < 1e-9);
  assert.equal(stats.popMedianBrave, 1.15); // median of [0.1, 0.2, 0.3, 2, 4, 10]
  assert.deepEqual(out.map((r) => [r.name, r.g]), [["a", 66], ["b", 33], ["c", 0]]);
});

test("empty input: no rows, divider at the top, null averages", () => {
  const { rows, edgeIndex, stats } = cheeseList([]);
  assert.deepEqual(rows, []);
  assert.equal(edgeIndex, 0);
  assert.equal(stats.n, 0);
  assert.equal(stats.inCount, 0);
  assert.equal(stats.meanBrave, null);
  assert.equal(stats.medianBrave, null);
});

test("real ranks.json: MalwareBits is #1 G at 99%; Bobeqh 37%; Sanctimony 0%", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const rows = payload.rows.map((r) => ({ name: r[idx.name], rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }));
  const { rows: out, edgeIndex, stats } = cheeseList(rows);
  assert.equal(stats.n, CHEESE_TOP_N);
  assert.equal(out.length, CHEESE_TOP_N);
  assert.equal(edgeIndex, stats.inCount);
  assert.ok(stats.inCount > 30 && stats.inCount < 45, `in-count ${stats.inCount}`);
  assert.ok(stats.medianBrave < 1, `median Brave ${stats.medianBrave}`);
  assert.deepEqual(out.slice(0, 3).map((r) => [r.name, r.g]), [
    ["MalwareBits", 99],
    ["AirbornDestroyer", 98],
    ["aftonom", 97],
  ]);
  const byName = Object.fromEntries(out.map((r) => [r.name, r]));
  assert.equal(byName.Bobeqh.g, 37);
  assert.equal(byName.Sanctimony.g, 0);
  assert.equal(byName.JasonBourne01.g, 83); // top of the out-gate block
  assert.ok(out.indexOf(byName.Bobeqh) < edgeIndex, "Bobeqh in-gate");
  assert.ok(out.indexOf(byName.BadBotanist) >= edgeIndex, "BadBotanist (Brave 0.003, Inf 99) out-gate");
});

test("wiring: Rankings renders the table from render(), behind the debug toggle", () => {
  const rk = fs.readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(rk, /from "\.\/cheese-table\.mjs\?v=[A-Za-z0-9_.-]+"/);
  assert.match(rk, /renderCheese\(\);/);
  assert.match(rk, /sec\.hidden = !showDebug;/);
  assert.match(rk, /cheeseList\(data\.rows\)/);
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["cheeseSection", "cheeseHead", "cheeseBody", "cheeseNote", "cheeseCount"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html has #${id}`);
  }
  assert.ok(html.includes('data-i18n="rk.cheeseTitle"'));
  assert.ok(html.includes('data-i18n="rk.cheeseDesc"'));
  // Placement (owner 2026-11-08): right after the Distribution graph, before All players.
  assert.ok(html.indexOf('id="cheeseSection"') > html.indexOf('id="distSection"'), "after Distribution");
  assert.ok(html.indexOf('id="cheeseSection"') < html.indexOf('id="ranksTableSection"'), "before All players");
  const live = fs.readFileSync(new URL("../live.html", import.meta.url), "utf8");
  assert.ok(live.includes('id="cheeseSection"'), "live.html carries the section (regen)");
});
