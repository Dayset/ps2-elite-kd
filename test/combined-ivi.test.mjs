// 🧼 Combined (owner 2026-11-10): 🧘 Pure iVi × (1 − G/100), public since
// 2026-11-10 — both discounts at once, in 🧘 Pure iVi's old visible slot.
// 🪳 and G are near-independent (r ≈ −0.06), so each sin is docked once.
// The Clean column (⚔️ iVi × (1 − G)) shipped alongside it in 79e9e150 and
// was REMOVED the same day by the owner's pick; this column keeps the 🧼
// emoji. Neither discount rate is a measurement of cheating — G is a rank
// share, not a cheating probability.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gScores } from "../g-score.mjs";
import { combinedIvI } from "../combined-ivi.mjs";
import { pureIvI } from "../pure-ivi.mjs";
import { traitPools, zergScore } from "../trait-scores.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("combined: Pure × (1 − G/100); Eyfia is the case it catches", () => {
  // Eyfia on the snapshot: Pure 921, combined 838.
  assert.ok(Math.abs(combinedIvI(921, 9.1) - 837.2) < 0.5);
  assert.ok(combinedIvI(921, 9.1) < 921, "below Pure");
  // Aekris: Pure barely touches him (2667), combined erases him (19).
  assert.ok(Math.abs(combinedIvI(2667, 99.3) - 18.7) < 0.5);
  // Zyr0sNCx passes both: 2571 × 0.999 ≈ 2568.
  assert.ok(Math.abs(combinedIvI(2571, 0.1) - 2568.4) < 0.5);
  // Same G-discount shape: G 100 → 0, missing input → null.
  assert.equal(combinedIvI(1000, 100), 0);
  assert.equal(combinedIvI(null, 50), null);
  assert.equal(combinedIvI(1000, null), null);
  assert.equal(combinedIvI(1000, undefined), null);
  assert.equal(combinedIvI(NaN, 50), null);
});

test("on the checked-in snapshot: combined top 10 clean on both axes, top 500 has no G>50 and no zerg>70", () => {
  const payload = JSON.parse(read("data/ranks.json"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const rows = payload.rows
    .map((r) => ({ name: r[idx.name], adjs: r[idx.adjs], adjs0: r[idx.adjs0], ivi: r[idx.ivi], inflation: r[idx.inflation], apk: r[idx.apk], rvp: r[idx.rvp], crp: r[idx.crp], rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }))
    .filter((r) => Number.isFinite(r.adjs) && r.adjs > 0);
  const g = gScores(rows);
  for (const r of rows) r.g = g.get(r) ?? null;
  const tp = traitPools({ adjs: rows.map((r) => r.adjs), ivi: rows.map((r) => r.ivi), inflation: rows.map((r) => r.inflation), apk: rows.map((r) => r.apk) });
  for (const r of rows) {
    const z = zergScore(tp, r.inflation, r.apk, r.rvp, r.crp);
    r.zerg = z ? z.score : null;
    r.pure = pureIvI(Number.isFinite(r.adjs0) ? r.adjs0 : r.adjs, r.zerg);
    r.combined = combinedIvI(r.pure, r.g);
  }
  const withBoth = rows.filter((r) => r.combined != null);
  const byC = withBoth.slice().sort((a, b) => b.combined - a.combined);
  for (const r of byC.slice(0, 10)) {
    assert.ok(r.g < 2, `${r.name} top-10 with G ${r.g}`);
    assert.ok(r.zerg < 20, `${r.name} top-10 with zerg ${r.zerg}`);
  }
  assert.ok(byC[0].combined > 2500, "#1 combined is a high-iVi, near-zero-G, low-zerg player");
  assert.equal(byC.slice(0, 500).filter((r) => r.g > 50).length, 0, "no G>50 in the top 500");
  assert.equal(byC.slice(0, 500).filter((r) => r.zerg > 70).length, 0, "no zerg>70 in the top 500");
  const eyfia = withBoth.find((r) => r.name === "Eyfia");
  // Below both parents: the second is the old Clean value, computed inline —
  // the column is gone, so no function computes it anymore.
  const cleanVal = eyfia.adjs * (1 - eyfia.g / 100);
  assert.ok(eyfia.combined < eyfia.pure && eyfia.combined < cleanVal, "Eyfia drops below both parents");
  const aekris = withBoth.find((r) => r.name === "Aekris");
  assert.ok(aekris.combined < 25, `Aekris combined ${aekris.combined}`);
});

test("clean is gone: no clean function, column id, label, or module file in the shipped tree", () => {
  for (const f of ["combined-ivi.mjs", "rankings.mjs", "stats-table.mjs", "columns.html"]) {
    const src = read(f);
    assert.ok(!src.includes("cleanIvIStrong"), `${f} has no clean function`);
    assert.ok(!src.includes("cleanIvIMedium"), `${f} has no medium function`);
    assert.ok(!src.includes('id: "cleanivis"'), `${f} has no clean column id`);
    assert.ok(!src.includes("🧼 iVi ×(1−G)"), `${f} has no clean label`);
    assert.ok(!src.includes("🧼 iVi −10G"), `${f} has no medium label`);
  }
  assert.ok(!read("columns.html").includes("2000 / 50% → 1000"), "clean example gone from the docs");
  assert.ok(!read("columns.html").includes("2000 / 50% → 1500"), "medium example gone from the docs");
  assert.ok(!fs.existsSync(new URL("../clean-ivi.mjs", import.meta.url)), "clean-ivi.mjs deleted");
  assert.ok(!fs.existsSync(new URL("../test/clean-ivi.test.mjs", import.meta.url)), "test/clean-ivi.test.mjs deleted");
});

test("rankings: combined is the visible column after zerg (took Pure's slot 2026-11-10), Pure first debug", () => {
  const src = read("rankings.mjs");
  const vis = src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("const DEBUG = ["));
  assert.ok(vis.indexOf('id: "combinedivi"') > vis.indexOf('id: "zerg"') && vis.indexOf('id: "combinedivi"') < vis.indexOf('id: "g"'), "combined visible after zerg, before G");
  assert.ok(!vis.includes('id: "pureivi"'), "Pure no longer visible");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("const PUBLIC = ["));
  assert.ok(dbg.indexOf('id: "pureivi"') > -1 && dbg.indexOf('id: "pureivi"') < dbg.indexOf('id: "mech"'), "Pure first debug column");
  const block = vis.slice(vis.indexOf('id: "combinedivi"'), vis.indexOf('{ id: "g"'));
  assert.ok(block.includes('tr("col.combinedivi"') && block.includes('tr("tip.combinedivi"'), "same i18n keys as the stats column");
  assert.ok(block.includes("chosen rate"), "tip keeps the chosen-rate honesty in public");
  assert.ok(!block.includes("debug-only"), "no debug-only text on the public column");
  assert.ok(src.includes('from "./combined-ivi.mjs?v=20261110-cmb1"'), "rankings imports the module at the unchanged pin");
  assert.ok(src.includes("o.combinedivi = combinedIvI(o.pureivi, o.g);"), "combined off the Pure value at load — never the evened-out ⚔️ iVi");
  assert.ok(src.includes("pools.combinedivi = rows.map((o) => o.combinedivi)"), "pool for positions/percentiles");
  assert.ok(src.includes("combinedivi: 16"), "fixed column width set");
  // assignRanks sorts by the row's own key, so any column id on the row is sortable.
  assert.ok(src.includes("const av = a[key], bv = b[key];"), "sort reads the row value by sort key");
});

test("stats table: combined is the visible column after zerg, off the 🧘 Pure iVi value", () => {
  const src = read("stats-table.mjs");
  const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("const adjDebugCols"));
  assert.ok(vis.indexOf('id: "combinedivi"') > vis.indexOf('id: "zerg"') && vis.indexOf('id: "combinedivi"') < vis.indexOf('id: "g"'), "combined visible after zerg, before G");
  assert.ok(!vis.includes('id: "pureivi"'), "Pure no longer visible");
  const dbg = src.slice(src.indexOf("const adjDebugCols"), src.indexOf("const adjCols ="));
  assert.ok(dbg.indexOf('id: "pureivi"') > -1 && dbg.indexOf('id: "pureivi"') < dbg.indexOf('id: "mech"'), "Pure first debug column");
  assert.ok(src.includes('from "./combined-ivi.mjs?v=20261110-cmb1"'), "stats table imports the module at the unchanged pin");
  const block = vis.slice(vis.indexOf('id: "combinedivi"'), vis.indexOf('{ id: "g"'));
  assert.ok(block.includes("pureIvI(a, z.score)"), "combined reuses the same Pure computation as the Pure column");
  assert.ok(block.includes("combinedIvI(v,"), "combined applies the G discount to that Pure value");
  assert.ok(!block.includes("zAdjs(r)"), "combined never starts from the evened-out ⚔️ iVi");
  assert.ok(block.includes('tr("col.combinedivi"') && block.includes('tr("tip.combinedivi"'), "same i18n keys as the rankings column");
  assert.ok(src.includes("gBySlug.get(slugKey(r.p.display))"), "G from the lazy full-payload load");
});

test("pin chain: module still 20261110-cmb1, every touched link now 20261111-sore4", () => {
  assert.match(read("rankings.mjs"), /combined-ivi\.mjs\?v=20261110-cmb1/);
  assert.match(read("stats-table.mjs"), /combined-ivi\.mjs\?v=20261110-cmb1/);
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261111-sore4/);
  assert.match(read("app.js"), /shared-index\.mjs\?v=20261111-sore4/);
  assert.match(read("app.js"), /stats-table\.mjs\?v=20261111-sore4/);
  assert.match(read("index.html"), /app\.js\?v=20261111-sore4/);
  assert.match(read("live.html"), /app\.js\?v=20261111-sore4/);
  assert.match(read("columns.html"), /columns-example\.mjs\?v=20261110-swp1/); // unchanged in the rename, keeps its swap pin
});

test("columns page: combined is a public card with a How-it's-measured section, Pure moved to debug", () => {
  const html = read("columns.html");
  assert.ok(html.includes("🧼 Pure"), "combined documented with the clean emoji, named just Pure");
  assert.ok(!html.includes("🧼 Pure ×(1−G)"), "old formula name gone from the docs");
  assert.ok(html.indexOf('id="combinedivi"') > -1 && html.indexOf('id="combinedivi"') < html.indexOf('id="debug"'), "combined card sits in the visible flow, before the debug box");
  assert.ok(html.includes('data-i18n="cp.combinediviH"'), "combined heading is an i18n key");
  const card = html.slice(html.indexOf('id="combinedivi"'));
  assert.ok(card.includes("How it’s measured"), "combined has a How it's measured section");
  for (const k of ["cp.combinediviL1", "cp.combinediviL2", "cp.combinediviL3", "cp.combinediviNote"]) assert.ok(card.includes(k), `combined card uses ${k}`);
  assert.ok(card.includes("921 × (1 − 0.091)"), "combined worked example in the docs");
  assert.ok(card.includes("Chosen, not measured"), "chosen-rate honesty on the public card");
  assert.ok(html.indexOf('id="debug"') < html.indexOf('id="pureivi"'), "Pure card moved into the debug box");
  assert.ok(!html.includes("🧼 iVi ×(1−G)"), "clean not documented");
  assert.ok(!html.includes("2000 / 50% → 1000"), "clean example not documented");
});
