// 🌈 G column (owner 2026-11-08): the two-factor product score as a visible
// stats column in both tables — after 🧘‍♂️ Pure iVi, before 🪖 Infantry —
// one value per player, no extra tag. K/D × Brave only; Infantry no longer
// scores (it only lives in the gate). The top-100 debug table was removed
// 2026-11-08 (owner: miscommunication, not needed); only the score survives.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gScores } from "../g-score.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("i18n/en.json"));
const row = (name, rkd, pvs, inf) => ({ name, rkd, pvs, inf });

test("gScores: two-factor product — (1-rkdRank/N)(1-braveRank/N), Infantry not scored", () => {
  // N=4. rkd ranks a1 b2 c3 d4; brave ranks b1 a2 c3 d4. inf is ignored.
  const rows = [row("a", 9, 0.1, 5), row("b", 8, 0.05, 10), row("c", 7, 0.5, 20), row("d", 6, 1, 1)];
  const g = gScores(rows);
  assert.equal(g.get(rows[0]).toFixed(2), ((3 / 4) * (2 / 4) * 100).toFixed(2)); // a
  assert.equal(g.get(rows[3]).toFixed(2), ((0 / 4) * (0 / 4) * 100).toFixed(2)); // d: worst rkd and brave → 0
  assert.equal(g.get(rows[1]).toFixed(2), ((2 / 4) * (3 / 4) * 100).toFixed(2)); // b
  assert.equal(g.get(rows[2]).toFixed(2), ((1 / 4) * (1 / 4) * 100).toFixed(2)); // c: inf 20 (worst) costs nothing
});

test("gScores: missing Brave takes the shared worst rank N, never helps", () => {
  const rows = [row("a", 9, 0.1, 5), row("b", 8, null, 5), row("c", 7, 0.5, 5), row("d", 6, 1, 5)];
  const g = gScores(rows);
  // b: brave rank 4 → factor 0. a and c score (c's rkd factor is 1/4, not 0).
  assert.equal(g.get(rows[1]), 0);
  assert.ok(g.get(rows[0]) > 0);
  assert.ok(g.get(rows[2]) > 0);
});

test("gScores: Infantry does not score — changing or nulling inf changes nothing", () => {
  const base = [row("a", 9, 0.1, 5), row("b", 8, 0.05, 10), row("c", 7, 0.5, 20), row("d", 6, 1, 1)];
  const values = [...gScores(base).values()];
  const alt = base.map((r) => ({ ...r, inf: 99 }));
  assert.deepEqual([...gScores(alt).values()], values);
  const nulled = base.map((r) => ({ ...r, inf: null }));
  assert.deepEqual([...gScores(nulled).values()], values);
});

test("rankings: G is a visible column after Pure ×(1−G), before Infantry; one value, no pct tag", () => {
  const src = read("rankings.mjs");
  const vis = src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("];", src.indexOf("const VISIBLE = [")));
  assert.ok(vis.includes('id: "g"'), "G in VISIBLE");
  assert.ok(vis.indexOf('id: "g"') > vis.indexOf('id: "combinedivi"') && vis.indexOf('id: "g"') < vis.indexOf('id: "inf"'), "after combinedivi, before inf");
  const block = vis.slice(vis.indexOf('id: "g"'), vis.indexOf('{ id: "inf"'));
  assert.ok(block.includes('tr("col.g"') && block.includes('tr("tip.g"'), "same i18n keys as the stats column");
  assert.ok(block.includes("g: true"), "g flag for the cell branch");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("];", src.indexOf("const DEBUG = [")));
  assert.ok(!dbg.includes('id: "g"'), "not a debug column");
  assert.ok(src.includes('from "./g-score.mjs?v=20261108-g2f1"'), "rankings imports gScores at the new pin");
  assert.ok(src.includes("const gMap = gScores(rows);"), "G computed once per data load");
  assert.ok(src.includes("pools.g = rows.map((o) => o.g)"), "pools.g for the positions table");
  assert.ok(src.includes("if (c.g) return"), "cell branch renders the one value");
});

test("stats table: G is a visible column after Pure ×(1−G), before Infantry; lazy full-payload load", () => {
  const src = read("stats-table.mjs");
  const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("];", src.indexOf("const adjVisibleCols = [")));
  assert.ok(vis.includes('id: "g"'), "G in adjVisibleCols");
  assert.ok(vis.indexOf('id: "g"') > vis.indexOf('id: "combinedivi"') && vis.indexOf('id: "g"') < vis.indexOf('id: "inf"'), "after combinedivi, before inf");
  const block = vis.slice(vis.indexOf('id: "g"'), vis.indexOf('{ id: "inf"'));
  assert.ok(block.includes('tr("col.g"') && block.includes('tr("tip.g"'), "same i18n keys as the rankings column");
  assert.ok(block.includes("gCell: true"), "gCell flag for the cell branch");
  assert.ok(src.includes('from "./g-score.mjs?v=20261108-g2f1"'), "stats table imports gScores at the new pin");
  assert.ok(src.includes("function loadG()"), "lazy G loader exists");
  assert.ok(src.includes("$.loadRanksPayload()"), "G comes from the full ranks payload, not ranks-lite");
  assert.ok(src.includes("loadG(); // 🌈 G"), "render triggers the load");
  assert.ok(src.includes("if (c.gCell)"), "cell branch renders the one value");
});

test("i18n: col.g / tip.g exist in English only (other locales fall back); the table's keys are gone", () => {
  assert.equal(en["col.g"], "🌈 G");
  assert.match(en["tip.g"], /\(1 − K\/D rank\)/);
  assert.match(en["tip.g"], /10–23%/);
  for (const k of ["rk.cheeseTitle", "rk.cheeseDesc", "rk.cheeseNote", "rk.cheeseScore", "rk.cheeseEdge", "rk.cheeseCount"]) {
    assert.equal(en[k], undefined, `${k} removed with the table`);
  }
});

test("removal: no trace of the top-100 table in the page, the code, or the imports", () => {
  const html = read("index.html");
  for (const id of ["cheeseSection", "cheeseHead", "cheeseBody", "cheeseNote", "cheeseCount"]) {
    assert.ok(!html.includes(`id="${id}"`), `index.html has no #${id}`);
  }
  assert.ok(!html.includes("rk.cheese"), "no cheese i18n references in the page");
  for (const f of ["rankings.mjs", "stats-table.mjs", "columns-example.mjs", "shared-index.mjs", "app.js"]) {
    const src = read(f);
    assert.ok(!src.includes("cheese-table.mjs"), `${f} no longer imports the old module`);
    assert.ok(!src.includes("cheeseList") && !src.includes("renderCheese") && !src.includes("CHEESE_"), `${f} has no table code`);
  }
  assert.ok(!read("live.html").includes('id="cheeseSection"'), "live.html carries no section (regen)");
});

test("distribution on the checked-in snapshot: median 17.21%, p90 28.95%, top-100 cutoff 70.09%", () => {
  const payload = JSON.parse(read("data/ranks.json"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const objs = payload.rows.map((r) => ({ rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }));
  const vals = [...gScores(objs).values()].sort((a, b) => a - b);
  const n = vals.length;
  assert.equal(n, 18575);
  assert.equal(vals[Math.floor(n / 2)].toFixed(2), "17.21"); // median
  assert.equal(vals[Math.floor(0.9 * (n - 1))].toFixed(2), "28.95"); // p90
  assert.equal(vals[n - 100].toFixed(2), "70.09"); // top-100 cutoff
  assert.equal(vals.filter((v) => v >= 5 && v <= 20).length / n > 0.48, true); // bulk in 5–20%
});

test("pin chain: g-score at 20261108-g2f1, neg2 chains, rankings/app chain at 20261110-swp1", () => {
  assert.match(read("rankings.mjs"), /g-score\.mjs\?v=20261108-g2f1/);
  assert.match(read("stats-table.mjs"), /g-score\.mjs\?v=20261108-g2f1/);
  assert.match(read("columns-example.mjs"), /g-score\.mjs\?v=20261108-g2f1/);
  assert.match(read("rankings.mjs"), /average-planetman\.mjs\?v=20261109-avg3/);
  assert.match(read("rankings.mjs"), /tiers\.mjs\?v=20261108-neg2/);
  assert.match(read("stats-table.mjs"), /tiers\.mjs\?v=20261108-neg2/);
  assert.match(read("stats-table.mjs"), /kill-feed\.mjs\?v=20261108-neg2/);
  assert.match(read("stats-table.mjs"), /duels-panel\.mjs\?v=20261108-neg2/);
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261110-swp1/);
  assert.match(read("app.js"), /shared-index\.mjs\?v=20261110-swp1/);
  assert.match(read("app.js"), /stats-table\.mjs\?v=20261110-swp1/);
  assert.match(read("index.html"), /app\.js\?v=20261110-swp1/);
  assert.match(read("columns.html"), /columns-example\.mjs\?v=20261110-swp1/);
  assert.match(read("live.html"), /app\.js\?v=20261110-swp1/);
  assert.match(read("live.mjs"), /live-model\.mjs\?v=20261108-neg2/);
  assert.match(read("live.html"), /live\.mjs\?v=20261108-chip1/);
  assert.match(read("scripts/build-live.mjs"), /live\.mjs\?v=20261108-chip1/);
});

test("rankings + positions tables: lone-value cells (Luck, Zerg, G, Infantry) sit on the value line", () => {
  const css = read("styles.css");
  // On phones the pct tag stacks to a second line; under the browser's middle
  // default a lone value would sit midway down the row instead of sharing the
  // value line (stats table got this fix 2026-11-01; rankings + positions 2026-11-08).
  for (const sel of [".ranks-table th, .ranks-table td", ".rk-pos-table th, .rk-pos-table td", ".stats-table td"]) {
    const block = css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    assert.ok(block.includes("vertical-align: top"), `${sel} top-aligns its cells`);
  }
});
