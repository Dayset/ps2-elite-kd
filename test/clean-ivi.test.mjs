// 🧼 Clean iVi (owner 2026-11-10): ⚔️ iVi discounted by 🌈 G, debug-only,
// strong only — adjs × (1 − G/100). The medium strength (adjs − 10 × G)
// shipped alongside it in 3eec31a7 and was REMOVED the same day by the
// owner's pick: in the top 500 the two lists were 485/500 identical, but
// medium still left 5 players over G 90% in the top 500 while strong
// leaves none over G 50%. Neither formula is a measurement — G is a rank
// share, not a cheating probability — just a chosen rate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gScores } from "../g-score.mjs";
import { cleanIvIStrong } from "../clean-ivi.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("strong: adjs × (1 − G/100); the owner's example, A wins", () => {
  assert.equal(cleanIvIStrong(2000, 50), 1000);
  assert.ok(Math.abs(cleanIvIStrong(2005, 51) - 982.45) < 0.01);
  assert.ok(cleanIvIStrong(2000, 50) > cleanIvIStrong(2005, 51), "2000/50% beats 2005/51%");
  assert.ok(Math.abs(cleanIvIStrong(2644, 0.15) - 2644 * 0.9985) < 0.01, "2644 × 0.9985");
  assert.ok(Math.abs(cleanIvIStrong(2772, 99.34) - 2772 * (1 - 0.9934)) < 0.01, "2772 × 0.0066");
});

test("missing adjs or G → null; floored at 0, never negative", () => {
  assert.equal(cleanIvIStrong(null, 50), null);
  assert.equal(cleanIvIStrong(2000, null), null);
  assert.equal(cleanIvIStrong(NaN, 50), null);
  assert.equal(cleanIvIStrong(2000, undefined), null);
  assert.equal(cleanIvIStrong(100, 50), 50);
  assert.equal(cleanIvIStrong(100, 100), 0);
  assert.equal(cleanIvIStrong(0, 0), 0);
});

test("on the checked-in snapshot: top 10 clean (G < 2), Aekris falls past #10000", () => {
  const payload = JSON.parse(read("data/ranks.json"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const rows = payload.rows
    .map((r) => ({ name: r[idx.name], adjs: r[idx.adjs], rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }))
    .filter((r) => Number.isFinite(r.adjs) && r.adjs > 0);
  const g = gScores(rows);
  for (const r of rows) r.g = g.get(r) ?? null;
  const withG = rows.filter((r) => r.g != null);
  const byS = withG.slice().sort((a, b) => cleanIvIStrong(b.adjs, b.g) - cleanIvIStrong(a.adjs, a.g));
  for (const r of byS.slice(0, 10)) assert.ok(r.g < 2, `${r.name} top-10 with G ${r.g}`);
  assert.ok(byS[0].adjs > 2500 && byS[0].g < 1, "#1 is a high-iVi, near-zero-G player");
  const aekS = byS.findIndex((r) => r.name === "Aekris") + 1;
  assert.ok(aekS > 10000, `Aekris falls past #10000, got #${aekS}`);
  assert.equal(byS.slice(0, 500).filter((r) => r.g > 50).length, 0, "no G>50 in the top 500");
});

test("medium is gone: no medium function or column id in the shipped files", () => {
  for (const f of ["clean-ivi.mjs", "rankings.mjs", "stats-table.mjs", "columns.html"]) {
    const src = read(f);
    assert.ok(!src.includes("cleanIvIMedium"), `${f} has no medium function`);
    assert.ok(!src.includes('id: "cleanivi"'), `${f} has no medium column id`);
    assert.ok(!src.includes("−10G"), `${f} has no medium label`);
  }
  assert.ok(!read("columns.html").includes("2000 / 50% → 1500"), "medium example gone from the docs");
});

test("rankings: strong is the first DEBUG column, computed at load, sortable by row value", () => {
  const src = read("rankings.mjs");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("];", src.indexOf("const DEBUG = [")));
  assert.ok(dbg.indexOf('id: "cleanivis"') < dbg.indexOf('id: "mech"'), "strong first debug column");
  assert.ok(!src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("];", src.indexOf("const VISIBLE = ["))).includes("cleanivis"), "not a visible column");
  assert.ok(src.includes('from "./clean-ivi.mjs?v=20261110-cln2"'), "rankings imports the module at the new pin");
  assert.ok(src.includes("o.cleanivis = cleanIvIStrong(o.adjs, o.g);"), "computed per row at load");
  assert.ok(src.includes("pools.cleanivis = rows.map((o) => o.cleanivis)"), "pool for positions/percentiles");
  assert.ok(src.includes("cleanivis: 14"), "fixed column width set");
  // assignRanks sorts by the row's own key, so any column id on the row is sortable.
  assert.ok(src.includes("const av = a[key], bv = b[key];"), "sort reads the row value by sort key");
});

test("stats table: strong is the first debug column, same formula off the displayed ⚔️ iVi", () => {
  const src = read("stats-table.mjs");
  const dbg = src.slice(src.indexOf("const adjDebugCols = ["), src.indexOf("];", src.indexOf("const adjDebugCols = [")));
  assert.ok(dbg.indexOf('id: "cleanivis"') < dbg.indexOf('id: "mech"'), "strong first debug column");
  assert.ok(!src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("];", src.indexOf("const adjVisibleCols = ["))).includes("cleanivis"), "not a visible column");
  assert.ok(src.includes('from "./clean-ivi.mjs?v=20261110-cln2"'), "stats table imports the module at the new pin");
  assert.ok(src.includes("cleanIvIStrong(zAdjs(r),"), "off the displayed (🪳-evened) ⚔️ iVi");
  assert.ok(src.includes("gBySlug.get(slugKey(r.p.display))"), "G from the lazy full-payload load");
});

test("pin chain: one tag 20261110-cln2 for the module and every touched link", () => {
  assert.match(read("rankings.mjs"), /clean-ivi\.mjs\?v=20261110-cln2/);
  assert.match(read("stats-table.mjs"), /clean-ivi\.mjs\?v=20261110-cln2/);
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261110-cln2/);
  assert.match(read("app.js"), /shared-index\.mjs\?v=20261110-cln2/);
  assert.match(read("app.js"), /stats-table\.mjs\?v=20261110-cln2/);
  assert.match(read("index.html"), /app\.js\?v=20261110-cln2/);
  assert.match(read("live.html"), /app\.js\?v=20261110-cln2/);
});

test("columns page: strong documented with its formula, medium gone", () => {
  const html = read("columns.html");
  assert.ok(html.includes("🧼 iVi ×(1−G)"), "strong documented");
  assert.ok(html.includes("2000 / 50% → 1000"), "worked example in the docs");
  assert.ok(!html.includes("🧼 iVi −10G"), "medium not documented");
});
