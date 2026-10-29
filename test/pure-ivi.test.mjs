// 🧘‍♂️ Pure iVi (Muse's uncentered 🪳 charge) and its first-debug-column wiring.
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

test("first debug column in the stats table, built on the plain value only", () => {
  const src = fs.readFileSync(path.join(root, "stats-table.mjs"), "utf8");
  const dbg = src.slice(src.indexOf("const adjDebugCols"), src.indexOf("const adjCols ="));
  assert.ok(dbg.indexOf('id: "pureivi"') > -1, "pureivi is a debug column");
  assert.ok(dbg.indexOf('id: "pureivi"') < dbg.indexOf('id: "mech"'), "pureivi is the first debug column");
  const block = dbg.slice(dbg.indexOf('id: "pureivi"'), dbg.indexOf('{ id: "mech"'));
  assert.ok(!block.includes("zAdjs") && !block.includes("zergChargedAdjs"), "no Claude #84 value in the Pure iVi formula");
  assert.ok(block.includes('shownValue(r, "adjs")'), "charged from the plain adjs, not the evened-out one");
  assert.ok(block.includes("$.IS_PS"), "PC only");
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  assert.equal(en["col.pureivi"], "🧘‍♂️ Pure iVi");
  assert.match(en["tip.pureivi"], /0\.00436/);
});
