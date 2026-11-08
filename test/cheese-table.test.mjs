// 🌈 G (cheese-table.mjs): top by ☠️ K/D, double-gated, ordered by the
// population product-G score.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cheeseList, inCheeseGate, gScores, CHEESE_TOP_N, CHEESE_BRAVE_OK, CHEESE_LOW_INF } from "../cheese-table.mjs";

const row = (name, rkd, pvs, inf) => ({ name, rkd, pvs, inf });
const g2 = (r) => r.g.toFixed(2);

test("gScores: population product — (1-rkdRank/N)(1-braveRank/N)(1-infRank/N)", () => {
  // N=4. rkd ranks a1 b2 c3 d4; brave ranks b1 a2 c3 d4; inf ranks d1 a2 b3 c4.
  const rows = [row("a", 9, 0.1, 5), row("b", 8, 0.05, 10), row("c", 7, 0.5, 20), row("d", 6, 1, 1)];
  const g = gScores(rows);
  assert.equal(g.get(rows[0]).toFixed(2), ((3 / 4) * (2 / 4) * (2 / 4) * 100).toFixed(2)); // a
  assert.equal(g.get(rows[3]).toFixed(2), ((0 / 4) * (0 / 4) * (3 / 4) * 100).toFixed(2)); // d: worst rkd and brave → 0
  assert.equal(g.get(rows[1]).toFixed(2), ((2 / 4) * (3 / 4) * (1 / 4) * 100).toFixed(2)); // b
});

test("gScores: missing Brave / Infantry takes the shared worst rank N, never helps", () => {
  const rows = [row("a", 9, 0.1, 5), row("b", 8, null, 5), row("c", 7, 0.1, null)];
  const g = gScores(rows);
  // b: brave rank 3 → factor 0. c: inf rank 3 → factor 0. Both score 0.
  assert.equal(g.get(rows[1]), 0);
  assert.equal(g.get(rows[2]), 0);
  assert.ok(g.get(rows[0]) > 0);
});

test("takes the top N by rkd, drops rows without one; G rewards the all-round profile over pure K/D", () => {
  const rows = [row("a", 9, 0.1, 10), row("b", null, 0.1, 10), row("c", 3, 5, 90), row("d", 12, 0.2, 10)];
  const { rows: out } = cheeseList(rows, { top: 2 });
  // a out-scores d on the product (Brave rank 1 + Inf rank 1 beat rkd rank 1).
  assert.deepEqual(out.map((r) => r.name), ["a", "d"]);
});

test("G orders by the product, not by Brave alone; the lowest Brave can still lose", () => {
  // N=5. rkd: a1 b2 c3 d4 e5. brave: c1 a2 b3 d4 e5(missing). inf: e1 a2 b3 d4 c5.
  // G: a 28.80, b 9.60, d 0.80, c 0 (worst inf), e 0 (worst rkd).
  const rows = [
    row("a", 9, 0.1, 5), // in
    row("b", 8, 1.5, 5), // in
    row("c", 7, 0.05, 95), // out: lowest Brave of all, but inf 95
    row("d", 6, 5, 10), // out
    row("e", 5, null, 1), // out: unknown Brave never passes, worst rank
  ];
  const { rows: out, edgeIndex } = cheeseList(rows);
  assert.deepEqual(out.map((r) => r.name), ["a", "b", "d", "c", "e"]);
  assert.equal(edgeIndex, 2);
  assert.deepEqual(out.map(g2), ["28.80", "9.60", "0.80", "0.00", "0.00"]);
});

test("tied G scores fall back to the crowd rank-sum, then Brave, then rkd", () => {
  // Every row scores G = 0 (each is worst on one dimension) and sums to 6:
  // a=1+3+2, b=2+1+3, c=3+2+1. Order inside the tie is Brave: b, c, a.
  const rows = [row("a", 9, 0.3, 20), row("b", 8, 0.1, 30), row("c", 7, 0.2, 10)];
  const { rows: out, edgeIndex } = cheeseList(rows);
  assert.deepEqual(out.map((r) => r.name), ["b", "c", "a"]);
  assert.deepEqual(out.map(g2), ["0.00", "0.00", "0.00"]);
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

test("stats: mean/median Brave, in-gate count, population size; G% on a 6-row population", () => {
  // N=6: rkd a1..f6; brave a1 e2 b3 c4 d5 f6; inf a1 c2 e3 b4 d5 f6.
  // G(a)=(5/6)^3=57.87, G(b)=G(c)=(4/6)(3/6)(2/6)=11.11; b before c on the crowd rank-sum.
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
  assert.equal(stats.popN, 6);
  assert.equal(stats.medianBrave, 0.3);
  assert.ok(Math.abs(stats.meanBrave - (0.1 + 0.3 + 2) / 3) < 1e-9);
  assert.equal(stats.popMedianBrave, 1.15); // median of [0.1, 0.2, 0.3, 2, 4, 10]
  assert.deepEqual(out.map((r) => [r.name, g2(r)]), [["a", "57.87"], ["b", "11.11"], ["c", "11.11"]]);
});

test("empty input: no rows, divider at the top, null averages", () => {
  const { rows, edgeIndex, stats } = cheeseList([]);
  assert.deepEqual(rows, []);
  assert.equal(edgeIndex, 0);
  assert.equal(stats.n, 0);
  assert.equal(stats.inCount, 0);
  assert.equal(stats.popN, 0);
  assert.equal(stats.meanBrave, null);
  assert.equal(stats.medianBrave, null);
});

test("real ranks.json: Sp00nyB4rd is #1 G at 97.71%; Bobeqh 29.85%; Sanctimony 0.38%", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const rows = payload.rows.map((r) => ({ name: r[idx.name], rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }));
  const { rows: out, edgeIndex, stats } = cheeseList(rows);
  assert.equal(stats.n, CHEESE_TOP_N);
  assert.equal(out.length, CHEESE_TOP_N);
  assert.equal(stats.popN, 18571);
  assert.equal(edgeIndex, stats.inCount);
  assert.ok(stats.inCount > 30 && stats.inCount < 45, `in-count ${stats.inCount}`);
  assert.ok(stats.medianBrave < 1, `median Brave ${stats.medianBrave}`);
  assert.deepEqual(out.slice(0, 3).map((r) => [r.name, g2(r)]), [
    ["Sp00nyB4rd", "97.71"],
    ["aftonom", "97.61"],
    ["MahdRider", "97.48"],
  ]);
  const byName = Object.fromEntries(out.map((r) => [r.name, r]));
  assert.equal(g2(byName.MalwareBits), "96.63");
  assert.equal(g2(byName.Bobeqh), "29.85");
  assert.equal(g2(byName.Sanctimony), "0.38");
  assert.equal(g2(byName.JasonBourne01), "91.64"); // top of the out-gate block
  assert.ok(out.indexOf(byName.Bobeqh) < edgeIndex, "Bobeqh in-gate");
  assert.ok(out.indexOf(byName.BadBotanist) >= edgeIndex, "BadBotanist (Brave 0.003, Inf 99) out-gate");
  // The population #1 (Tepe8756, rKD rank 129) is not in the top-100-by-K/D crowd:
  // the debug table is the top-100 view; the G column scores everyone.
  assert.equal(byName.Tepe8756, undefined);
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
