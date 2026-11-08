// 🌈 G column (owner 2026-11-08): the population product score as a visible
// stats column in both tables — after 🧘‍♂️ Pure iVi, before 🪖 Infantry —
// one value per player, no extra tag. Same score as the 🌈 G debug table.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gScores } from "../cheese-table.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("i18n/en.json"));

test("rankings: G is a visible column after Pure iVi, before Infantry; one value, no pct tag", () => {
  const src = read("rankings.mjs");
  const vis = src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("];", src.indexOf("const VISIBLE = [")));
  assert.ok(vis.includes('id: "g"'), "G in VISIBLE");
  assert.ok(vis.indexOf('id: "g"') > vis.indexOf('id: "pureivi"') && vis.indexOf('id: "g"') < vis.indexOf('id: "inf"'), "after pureivi, before inf");
  const block = vis.slice(vis.indexOf('id: "g"'), vis.indexOf('{ id: "inf"'));
  assert.ok(block.includes('tr("col.g"') && block.includes('tr("tip.g"'), "same i18n keys as the stats column");
  assert.ok(block.includes("g: true"), "g flag for the cell branch");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("];", src.indexOf("const DEBUG = [")));
  assert.ok(!dbg.includes('id: "g"'), "not a debug column");
  assert.ok(src.includes('from "./cheese-table.mjs?v=20261108-gcol1"'), "rankings imports gScores at the new pin");
  assert.ok(src.includes("const gMap = gScores(rows);"), "G computed once per data load");
  assert.ok(src.includes("pools.g = rows.map((o) => o.g)"), "pools.g for the positions table");
  assert.ok(src.includes("if (c.g) return"), "cell branch renders the one value");
  assert.ok(src.includes("r.g.toFixed(2)"), "debug table shows two decimals");
});

test("stats table: G is a visible column after Pure iVi, before Infantry; lazy full-payload load", () => {
  const src = read("stats-table.mjs");
  const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("];", src.indexOf("const adjVisibleCols = [")));
  assert.ok(vis.includes('id: "g"'), "G in adjVisibleCols");
  assert.ok(vis.indexOf('id: "g"') > vis.indexOf('id: "pureivi"') && vis.indexOf('id: "g"') < vis.indexOf('id: "inf"'), "after pureivi, before inf");
  const block = vis.slice(vis.indexOf('id: "g"'), vis.indexOf('{ id: "inf"'));
  assert.ok(block.includes('tr("col.g"') && block.includes('tr("tip.g"'), "same i18n keys as the rankings column");
  assert.ok(block.includes("gCell: true"), "gCell flag for the cell branch");
  assert.ok(src.includes('from "./cheese-table.mjs?v=20261108-gcol1"'), "stats table imports gScores at the new pin");
  assert.ok(src.includes("function loadG()"), "lazy G loader exists");
  assert.ok(src.includes("$.loadRanksPayload()"), "G comes from the full ranks payload, not ranks-lite");
  assert.ok(src.includes("loadG(); // 🌈 G"), "render triggers the load");
  assert.ok(src.includes("if (c.gCell)"), "cell branch renders the one value");
});

test("i18n: col.g / tip.g exist in English only (other locales fall back)", () => {
  assert.equal(en["col.g"], "🌈 G");
  assert.match(en["tip.g"], /\(1 − K\/D rank\)/);
  assert.match(en["tip.g"], /5–20%/);
  assert.match(en["rk.cheeseNote"], /\{pop\}/);
  assert.doesNotMatch(en["rk.cheeseNote"], /99%/);
});

test("distribution on the checked-in snapshot: median 7.18%, p90 21.63%, top-100 cutoff 50.18%", () => {
  const payload = JSON.parse(read("data/ranks.json"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const objs = payload.rows.map((r) => ({ rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }));
  const vals = [...gScores(objs).values()].sort((a, b) => a - b);
  const n = vals.length;
  assert.equal(n, 18571);
  assert.equal(vals[Math.floor(n / 2)].toFixed(2), "7.18"); // median
  assert.equal(vals[Math.floor(0.9 * (n - 1))].toFixed(2), "21.63"); // p90
  assert.equal(vals[n - 100].toFixed(2), "50.18"); // top-100 cutoff
  assert.equal(vals.filter((v) => v >= 5 && v <= 20).length / n > 0.48, true); // bulk in 5–20%
});

test("pin chain: one tag (20261108-gcol1) from cheese-table to the HTML roots", () => {
  assert.match(read("rankings.mjs"), /cheese-table\.mjs\?v=20261108-gcol1/);
  assert.match(read("stats-table.mjs"), /cheese-table\.mjs\?v=20261108-gcol1/);
  assert.match(read("columns-example.mjs"), /cheese-table\.mjs\?v=20261108-gcol1/);
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261108-gcol1/);
  assert.match(read("app.js"), /shared-index\.mjs\?v=20261108-gcol1/);
  assert.match(read("app.js"), /stats-table\.mjs\?v=20261108-gcol1/);
  assert.match(read("index.html"), /app\.js\?v=20261108-gcol1/);
  assert.match(read("columns.html"), /columns-example\.mjs\?v=20261108-gcol1/);
  assert.match(read("live.html"), /app\.js\?v=20261108-gcol1/);
});
