// #84: 🪳⚔️ Zerg-adjusted iVi (zerg-charge.mjs) and its debug-only, PC-only column.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zergChargedAdjs, ZERG_CHARGE } from "../zerg-charge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { K, LAMBDA } = ZERG_CHARGE;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("measured constants", () => {
  assert.equal(K, 3100);
  assert.equal(LAMBDA, 0.00021);
});

test("adjs > 0: (iVi + K)·exp(−λ·🪳) − K, about the same points in every tier", () => {
  near(zergChargedAdjs(1000, 50), (1000 + K) * Math.exp(-LAMBDA * 50) - K);
  const drop = (a, z) => a - zergChargedAdjs(a, z);
  // 🪳 50 drops 30–60 points from iVi 170 to 2,050 (measured: −34 … −53)
  for (const a of [170, 535, 962, 1330, 1646, 2050]) {
    const d = drop(a, 50);
    assert.ok(d > 30 && d < 60, `iVi ${a}: −${d.toFixed(1)}`);
  }
  assert.ok(drop(2050, 50) > drop(170, 50), "a bit more at the top (points), much less as a %");
  assert.ok(drop(1000, 80) > drop(1000, 40) && drop(1000, 40) > 0, "more 🪳, bigger drop");
});

test("adjs ≤ 0: still only goes down, never flips", () => {
  const v = zergChargedAdjs(-300, 60);
  assert.ok(v < -300);
  near(v, (-300 + K) * Math.exp(-LAMBDA * 60) - K);
  assert.equal(zergChargedAdjs(0, 0), 0);
  assert.ok(zergChargedAdjs(0, 40) < 0);
  // far below anything measured: left alone
  assert.equal(zergChargedAdjs(-K - 5, 50), -K - 5);
});

test("🪳 0 = unchanged; missing 🪳 or iVi = null", () => {
  assert.equal(zergChargedAdjs(1234.5, 0), 1234.5);
  assert.equal(zergChargedAdjs(1234.5, null), null);
  assert.equal(zergChargedAdjs(1234.5, undefined), null);
  assert.equal(zergChargedAdjs(1234.5, NaN), null);
  assert.equal(zergChargedAdjs(null, 30), null);
  assert.equal(zergChargedAdjs(NaN, 30), null);
});

test("never raises a score", () => {
  for (const a of [-900, -10, 0, 50, 700, 1500, 2700]) for (const z of [0, 1, 10, 50, 99, 100]) assert.ok(zergChargedAdjs(a, z) <= a);
  assert.equal(zergChargedAdjs(800, -5), 800, "a negative 🪳 is treated as 0");
});

test("the column is debug-only, PC-only, translated, and documented", () => {
  const src = fs.readFileSync(path.join(root, "stats-table.mjs"), "utf8");
  const dbg = src.slice(src.indexOf("const adjDebugCols"), src.indexOf("const adjCols ="));
  assert.ok(dbg.includes('id: "zchg"'), "zchg sits in adjDebugCols");
  const vis = src.slice(src.indexOf("const adjVisibleCols"), src.indexOf("const adjDebugCols"));
  assert.ok(!vis.includes('"zchg"'), "not in the default view");
  assert.match(dbg, /id: "zchg"[\s\S]*?\$\.IS_PS[\s\S]*?zergChargedAdjs/);
  assert.match(dbg, /tr\("col\.zchg"/);
  assert.match(dbg, /tr\("tip\.zchg"/);
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  for (const k of ["col.zchg", "tip.zchg", "cp.dbgZchg"]) assert.ok(en[k], k);
  assert.ok(fs.readFileSync(path.join(root, "columns.html"), "utf8").includes('data-i18n="cp.dbgZchg"'));
});
