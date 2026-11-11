// 👿 Sore debug column (owner 2026-11-11): revenge % per player, in the debug
// columns of both tables, fed by the ranks "revk" trailing column (build-ranks)
// via ranks-lite.json (stats table) and ranks.json pools (rankings table).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRanksLite } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("build: revk trailing column after apk, carried in lite at 1 decimal", () => {
  const src = read("scripts/build-ranks.mjs");
  assert.match(src, /ranks\.cols\.push\("apk"\);[^]*ranks\.cols\.push\("revk"\);/, "revk pushed right after apk");
  assert.match(src, /Math\.round\(sm\.values\.s_revk \* 1000\) \/ 10/, "stored as a percentage, 1 decimal");
  assert.ok(src.includes('"apk", "revk", "inf"'), "LITE_COLS carries revk after apk");
  assert.match(src, /revk: 1/, "LITE_DIGITS rounds revk to 1 decimal");
  const lite = buildRanksLite({
    cols: ["name", "slug", "adjs", "adjs0", "zat", "cons", "apk", "revk", "inf", "infMax", "infVeh", "ivi", "inflation", "hut", "hutMk", "vdf", "rvp", "crp", "nbd", "nbh", "trc"],
    rows: [["a", "a", 100, 100, 1, 1, 0.55, 7.14, 90, 1, 2, 300, 1, 1, 0, 1, 1, 1, 1, 1, 0], ["b", "b", 100, 100, 1, 1, null, null, 90, 1, 2, 300, 1, 1, 0, 1, 1, 1, 1, 1, 0]],
  });
  assert.deepEqual(lite.cols.slice(6, 8), ["apk", "revk"]);
  assert.equal(lite.rows[0][lite.cols.indexOf("revk")], 7.1, "7.14% rounds to 7.1 in lite");
  assert.equal(lite.rows[1][lite.cols.indexOf("revk")], null, "missing stays missing");
});

test("rankings: revk is the last debug column, after 🔀 Diff", () => {
  const src = read("rankings.mjs");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("const PUBLIC = ["));
  assert.ok(dbg.indexOf('id: "revk"') > dbg.indexOf('id: "diff"'), "revk after diff in DEBUG");
  assert.ok(!src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("const DEBUG = [")).includes('id: "revk"'), "not a visible column");
  const block = dbg.slice(dbg.indexOf('id: "revk"'));
  assert.ok(block.includes('tr("col.sore"') && block.includes('tr("tip.sore"'), "same i18n keys as the stats column");
  assert.ok(block.includes("sore: true"), "sore flag for the cell branch");
});

test("stats table: revk is the last debug column, fed by the lite map", () => {
  const src = read("stats-table.mjs");
  const dbg = src.slice(src.indexOf("const adjDebugCols = ["), src.indexOf("const adjCols ="));
  assert.ok(dbg.indexOf('id: "revk"') > dbg.indexOf('id: "adjs0"'), "revk after adjs0 in adjDebugCols");
  assert.ok(!src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("const adjDebugCols")).includes('id: "revk"'), "not a visible column");
  const block = dbg.slice(dbg.indexOf('id: "revk"'));
  assert.ok(block.includes('tr("col.sore"') && block.includes('tr("tip.sore"'), "same i18n keys as the rankings column");
  assert.ok(block.includes("revkBySlug.get(slugKey(r.p.display))"), "value from the lite map, like 🤝");
  assert.ok(src.includes('payload.cols.indexOf("revk")'), "loadConsPool reads the revk column");
  assert.ok(src.includes("let revkBySlug = null;"), "map declared next to apkBySlug");
});

test("documented: i18n keys exist and the debug box lists 👿 Sore %", () => {
  const en = JSON.parse(read("i18n/en.json"));
  assert.equal(en["col.sore"], "👿 Sore %");
  assert.match(en["tip.sore"], /Revenge Kill XP tick/);
  assert.match(en["cp.dbgSore"], /Revenge Kill XP tick/);
  const html = read("columns.html");
  const box = html.slice(html.indexOf('id="debug"'));
  assert.ok(box.includes("<dt>👿 Sore %</dt>"), "debug list names the column");
  assert.ok(box.indexOf("👿 Sore %") > box.indexOf("⚔️ iVi before 🪳"), "listed after the adjs0 row, like the table");
  assert.ok(box.includes('data-i18n="cp.dbgSore"'), "debug row uses the i18n key");
});
