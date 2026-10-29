// 🧘‍♂️ Pure iVi (the uncentered 🪳 charge) and its visible-column wiring.
// Separate from Claude's #84 (zerg-charge.mjs): no centering, no freshness gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pureIvI, PURE_IVI_CHARGE } from "../pure-ivi.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("rate and negative base from the 2026-10-28 duel study", () => {
  assert.equal(PURE_IVI_CHARGE.RATE, 0.00436);
  assert.equal(PURE_IVI_CHARGE.NEG_BASE, 610.6);
});

test("adjs > 0: adjs × (1 − 0.00436 × 🪳)", () => {
  near(pureIvI(1000, 50), 782);
  near(pureIvI(1726, 12), 1726 * (1 - 0.00436 * 12));
  assert.equal(pureIvI(1000, 0), 1000, "🪳 0 → unchanged");
  near(pureIvI(1000, 100), 564);
  assert.ok(pureIvI(1000, 99) < pureIvI(1000, 50) && pureIvI(1000, 50) < pureIvI(1000, 0), "more 🪳, bigger drop");
});

test("adjs ≤ 0: fixed drop, never a percentage flip", () => {
  near(pureIvI(-100, 50), -100 - 0.00436 * 50 * 610.6);
  assert.ok(pureIvI(-100, 50) < -100);
  near(pureIvI(0, 50), -0.00436 * 50 * 610.6);
});

test("missing adjs or 🪳 → null", () => {
  assert.equal(pureIvI(1234.5, null), null);
  assert.equal(pureIvI(1234.5, undefined), null);
  assert.equal(pureIvI(1234.5, NaN), null);
  assert.equal(pureIvI(null, 30), null);
  assert.equal(pureIvI(NaN, 30), null);
});

test("rankings: visible column right after zerg, same keys, plain value only", () => {
  const src = fs.readFileSync(path.join(root, "rankings.mjs"), "utf8");
  const vis = src.slice(src.indexOf("const VISIBLE = ["), src.indexOf("const DEBUG = ["));
  assert.ok(vis.indexOf('id: "pureivi"') > -1, "pureivi is a visible rankings column");
  assert.ok(vis.indexOf('id: "pureivi"') > vis.indexOf('id: "zerg"') && vis.indexOf('id: "pureivi"') < vis.indexOf('id: "inf"'), "pureivi right after zerg, before infantry");
  const dbg = src.slice(src.indexOf("const DEBUG = ["), src.indexOf("const PUBLIC = ["));
  assert.ok(!dbg.includes('id: "pureivi"'), "no longer a debug column");
  const block = vis.slice(vis.indexOf('id: "pureivi"'), vis.indexOf('{ id: "inf"'));
  assert.ok(block.includes('tr("col.pureivi"') && block.includes('tr("tip.pureivi"'), "same i18n keys as the stats column");
  assert.ok(!block.includes("Muse's"), "no solo credit in the hint");
  const field = src.slice(src.indexOf("o.pureivi ="), src.indexOf("o.pureivi =") + 140);
  assert.ok(field.includes("pureIvI(") && field.includes("o.adjs0"), "charged from the plain adjs, not the evened-out one");
  assert.ok(!field.includes("zergChargedAdjs"), "no Claude #84 value in the Pure iVi field");
  assert.ok(field.includes('ROOM === "ps"'), "PC only");
  assert.ok(src.includes('["diff", "zerg", "pureivi"]'), "distribution pool covers pureivi (positions rank + pct)");
  // one module = one ?v= tag: pure-ivi.mjs must carry the same tag in both importers.
  const tag = (f) => [...fs.readFileSync(path.join(root, f), "utf8").matchAll(/pure-ivi\.mjs\?v=([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  assert.deepEqual(tag("rankings.mjs"), tag("stats-table.mjs"));
});
test("visible column right after zerg in the stats table, built on the plain value only", () => {
  const src = fs.readFileSync(path.join(root, "stats-table.mjs"), "utf8");
  const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("const adjDebugCols"));
  assert.ok(vis.indexOf('id: "pureivi"') > -1, "pureivi is a visible stats column");
  assert.ok(vis.indexOf('id: "pureivi"') > vis.indexOf('id: "zerg"') && vis.indexOf('id: "pureivi"') < vis.indexOf('id: "inf"'), "pureivi right after zerg, before infantry");
  const dbg = src.slice(src.indexOf("const adjDebugCols"), src.indexOf("const adjCols ="));
  assert.ok(!dbg.includes('id: "pureivi"'), "no longer a debug column");
  const block = vis.slice(vis.indexOf('id: "pureivi"'), vis.indexOf('{ id: "inf"'));
  assert.ok(!block.includes("zAdjs") && !block.includes("zergChargedAdjs"), "no Claude #84 value in the Pure iVi formula");
  assert.ok(block.includes('shownValue(r, "adjs")'), "charged from the plain adjs, not the evened-out one");
  assert.ok(block.includes("$.IS_PS"), "PC only");
  assert.ok(!block.includes("Muse's"), "no solo credit in the hint");
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  assert.equal(en["col.pureivi"], "🧘‍♂️ Pure iVi");
  assert.match(en["tip.pureivi"], /0\.00436/);
  assert.doesNotMatch(en["tip.pureivi"], /Muse's/);
});

test("documented: columns.html section + metrics.md formula", () => {
  const html = fs.readFileSync(path.join(root, "columns.html"), "utf8");
  assert.ok(html.includes('id="pureivi"'), "columns.html has the Pure iVi section");
  assert.ok(html.includes('href="#pureivi"'), "TOC links to it");
  assert.ok(html.includes('data-i18n="cp.pureiviH"'), "section heading is an i18n key");
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  for (const k of ["cp.tocPureivi", "cp.pureiviH", "cp.pureiviP", "cp.pureiviL1", "cp.pureiviL2", "cp.pureiviL3", "cp.pureiviNote"]) assert.ok(en[k], k);
  assert.match(en["cp.pureiviL1"], /0\.00436/);
  const md = fs.readFileSync(path.join(root, "docs/metrics.md"), "utf8");
  assert.ok(md.includes("### 🧘‍♂️ Pure iVi"), "metrics.md has the formula entry");
  assert.match(md, /0\.00436/);
  assert.match(md, /610\.6/);
});
