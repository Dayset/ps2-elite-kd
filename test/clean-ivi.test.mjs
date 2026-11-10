// 🧼 Clean iVi (owner 2026-11-10): ⚔️ iVi discounted by 🌈 G, debug-only,
// two strengths side by side so the owner can look at both and keep one:
// medium adjs − 10 × G, strong adjs × (1 − G/100). Neither is a measurement
// — G is a rank share, not a cheating probability — just a chosen rate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gScores } from "../g-score.mjs";
import { cleanIvIMedium, cleanIvIStrong } from "../clean-ivi.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("medium: adjs − 10 × G; the owner's example is a near-tie, A wins", () => {
  assert.equal(cleanIvIMedium(2000, 50), 1500);
  assert.equal(cleanIvIMedium(2005, 51), 1495);
  assert.ok(cleanIvIMedium(2000, 50) > cleanIvIMedium(2005, 51), "2000/50% beats 2005/51%");
  assert.equal(cleanIvIMedium(2644, 0.15), 2642.5);
  assert.equal(cleanIvIMedium(2772, 99.34), 2772 - 993.4);
});

test("strong: adjs × (1 − G/100); the owner's example, A wins by more", () => {
  assert.equal(cleanIvIStrong(2000, 50), 1000);
  assert.ok(Math.abs(cleanIvIStrong(2005, 51) - 982.45) < 0.01);
  assert.ok(cleanIvIStrong(2000, 50) > cleanIvIStrong(2005, 51), "2000/50% beats 2005/51%");
  assert.ok(Math.abs(cleanIvIStrong(2644, 0.15) - 2644 * 0.9985) < 0.01, "2644 × 0.9985");
  assert.ok(Math.abs(cleanIvIStrong(2772, 99.34) - 2772 * (1 - 0.9934)) < 0.01, "2772 × 0.0066");
});

test("missing adjs or G → null; floored at 0, never negative", () => {
  for (const fn of [cleanIvIMedium, cleanIvIStrong]) {
    assert.equal(fn(null, 50), null);
    assert.equal(fn(2000, null), null);
    assert.equal(fn(NaN, 50), null);
    assert.equal(fn(2000, undefined), null);
    assert.equal(fn(100, 50), fn === cleanIvIMedium ? 0 : 50); // medium: 100 − 500 → 0
    assert.ok(fn(0, 0) === 0);
  }
  assert.equal(cleanIvIMedium(100, 50), 0);
  assert.equal(cleanIvIStrong(100, 100), 0);
});

test("on the checked-in snapshot: both tops are clean (G < 2), Aekris falls far", () => {
  const payload = JSON.parse(read("data/ranks.json"));
  const idx = Object.fromEntries(payload.cols.map((c, i) => [c, i]));
  const rows = payload.rows
    .map((r) => ({ name: r[idx.name], adjs: r[idx.adjs], rkd: r[idx.rkd], pvs: r[idx.pvs], inf: r[idx.inf] }))
    .filter((r) => Number.isFinite(r.adjs) && r.adjs > 0);
  const g = gScores(rows);
  for (const r of rows) r.g = g.get(r) ?? null;
  const withG = rows.filter((r) => r.g != null);
  const byM = withG.slice().sort((a, b) => cleanIvIMedium(b.adjs, b.g) - cleanIvIMedium(a.adjs, a.g));
  const byS = withG.slice().sort((a, b) => cleanIvIStrong(b.adjs, b.g) - cleanIvIStrong(a.adjs, a.g));
  // Same ten names on top under both strengths (order may differ by a swap).
  assert.deepEqual(new Set(byM.slice(0, 10).map((r) => r.name)), new Set(byS.slice(0, 10).map((r) => r.name)));
  for (const r of byM.slice(0, 10)) assert.ok(r.g < 2, `${r.name} top-10 medium with G ${r.g}`);
  for (const r of byS.slice(0, 10)) assert.ok(r.g < 2, `${r.name} top-10 strong with G ${r.g}`);
  assert.ok(byM[0].adjs > 2500 && byM[0].g < 1, "medium #1 is a high-iVi, near-zero-G player");
  assert.equal(byM[0].name, byS[0].name, "same #1 under both strengths");
  const aekM = byM.findIndex((r) => r.name === "Aekris") + 1;
  const aekS = byS.findIndex((r) => r.name === "Aekris") + 1;
  assert.ok(aekM > 200, `Aekris (2772/99%) falls past #200 under medium, got #${aekM}`);
  assert.ok(aekS > 10000, `Aekris falls past #10000 under strong, got #${aekS}`);
});

test("rankings: both are DEBUG columns (first), computed at load, sortable by row value", () => {
  const src = read("rankings.mjs");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("];", src.indexOf("const DEBUG = [")));
  assert.ok(dbg.indexOf('id: "cleanivi"') < dbg.indexOf('id: "mech"'), "medium first debug column");
  assert.ok(dbg.indexOf('id: "cleanivis"') < dbg.indexOf('id: "mech"'), "strong first debug column");
  assert.ok(dbg.indexOf('id: "cleanivi"') < dbg.indexOf('id: "cleanivis"'), "medium before strong");
  assert.ok(!src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("];", src.indexOf("const VISIBLE = ["))).includes("cleanivi"), "not visible columns");
  assert.ok(src.includes('from "./clean-ivi.mjs?v=20261110-cln1"'), "rankings imports the module at the new pin");
  assert.ok(src.includes("o.cleanivi = cleanIvIMedium(o.adjs, o.g);"), "medium computed per row at load");
  assert.ok(src.includes("o.cleanivis = cleanIvIStrong(o.adjs, o.g);"), "strong computed per row at load");
  assert.ok(src.includes('for (const id of ["cleanivi", "cleanivis"])'), "pools built for both, for positions/percentiles");
  assert.ok(src.includes("pools[id] = rows.map((o) => o[id])"), "pool per id");
  assert.ok(src.includes("cleanivi: 12") && src.includes("cleanivis: 14"), "fixed column widths set");
  // assignRanks sorts by the row's own key, so any column id on the row is sortable.
  assert.ok(src.includes("const av = a[key], bv = b[key];"), "sort reads the row value by sort key");
});

test("stats table: both are debug columns (first), same formulas off the displayed ⚔️ iVi", () => {
  const src = read("stats-table.mjs");
  const dbg = src.slice(src.indexOf("const adjDebugCols = ["), src.indexOf("];", src.indexOf("const adjDebugCols = [")));
  assert.ok(dbg.indexOf('id: "cleanivi"') < dbg.indexOf('id: "mech"'), "medium first debug column");
  assert.ok(dbg.indexOf('id: "cleanivis"') < dbg.indexOf('id: "mech"'), "strong first debug column");
  assert.ok(dbg.indexOf('id: "cleanivi"') < dbg.indexOf('id: "cleanivis"'), "medium before strong");
  assert.ok(!src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("];", src.indexOf("const adjVisibleCols = ["))).includes("cleanivi"), "not visible columns");
  assert.ok(src.includes('from "./clean-ivi.mjs?v=20261110-cln1"'), "stats table imports the module at the new pin");
  assert.ok(src.includes("cleanIvIMedium(zAdjs(r),"), "medium off the displayed (🪳-evened) ⚔️ iVi");
  assert.ok(src.includes("cleanIvIStrong(zAdjs(r),"), "strong off the displayed (🪳-evened) ⚔️ iVi");
  assert.ok(src.includes("gBySlug.get(slugKey(r.p.display))"), "G from the lazy full-payload load");
});

test("pin chain: one tag 20261110-cln1 for the new module and every touched link", () => {
  assert.match(read("rankings.mjs"), /clean-ivi\.mjs\?v=20261110-cln1/);
  assert.match(read("stats-table.mjs"), /clean-ivi\.mjs\?v=20261110-cln1/);
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261110-cln1/);
  assert.match(read("app.js"), /shared-index\.mjs\?v=20261110-cln1/);
  assert.match(read("app.js"), /stats-table\.mjs\?v=20261110-cln1/);
  assert.match(read("index.html"), /app\.js\?v=20261110-cln1/);
  assert.match(read("live.html"), /app\.js\?v=20261110-cln1/);
});

test("columns page: both debug columns documented with their formulas", () => {
  const html = read("columns.html");
  assert.ok(html.includes("🧼 iVi −10G"), "medium documented");
  assert.ok(html.includes("🧼 iVi ×(1−G)"), "strong documented");
  assert.ok(html.includes("2000 / 50%"), "worked example in the docs");
});
