// #84: 🪳⚔️ Zerg-adjusted iVi (zerg-charge.mjs) and its debug-only, PC-only column.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zergChargedAdjs, ZERG_CHARGE } from "../zerg-charge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { K, LAMBDA, CENTER } = ZERG_CHARGE;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("measured constants and the owner's center", () => {
  assert.equal(K, 3100);
  assert.equal(LAMBDA, 0.00021);
  assert.equal(CENTER, 26.8);
});

test("(iVi + K)·exp(−λ·(🪳 − 26.8)) − K: about the same points in every tier", () => {
  near(zergChargedAdjs(1000, 50), (1000 + K) * Math.exp(-LAMBDA * (50 - CENTER)) - K);
  const change = (a, z) => zergChargedAdjs(a, z) - a;
  // 🪳 75 (50 steps above the center): −30 … −60 points from iVi 170 to 2,050 (measured 🪳 50 drop: −34 … −53)
  for (const a of [170, 535, 962, 1330, 1646, 2050]) {
    const d = -change(a, 75);
    assert.ok(d > 30 && d < 60, `iVi ${a}: −${d.toFixed(1)}`);
  }
  assert.ok(change(2050, 75) < change(170, 75), "a bit more at the top (points), much less as a %");
  assert.ok(change(1000, 80) < change(1000, 40) && change(1000, 40) < 0, "more 🪳 above 26.8, bigger drop");
});

test("🪳 26.8 = unchanged; below it goes up a little, above it goes down", () => {
  assert.equal(zergChargedAdjs(1234.5, CENTER), 1234.5);
  const up = zergChargedAdjs(1000, 0) - 1000, down = zergChargedAdjs(1000, 99) - 1000;
  assert.ok(up > 21 && up < 25, `🪳 0 at iVi 1,000: +${up.toFixed(1)}`);
  assert.ok(down < -60 && down > -64, `🪳 99 at iVi 1,000: ${down.toFixed(1)}`);
  assert.ok(zergChargedAdjs(1000, 14) > 1000 && zergChargedAdjs(1000, 30) < 1000);
  assert.equal(zergChargedAdjs(800, -5), zergChargedAdjs(800, 0), "a negative 🪳 counts as 0");
  assert.equal(zergChargedAdjs(800, 140), zergChargedAdjs(800, 100), "and above 100 as 100");
});

test("adjs ≤ 0: moves the same way, never flips sign through a percentage", () => {
  const v = zergChargedAdjs(-300, 60);
  assert.ok(v < -300);
  near(v, (-300 + K) * Math.exp(-LAMBDA * (60 - CENTER)) - K);
  assert.ok(zergChargedAdjs(0, 40) < 0 && zergChargedAdjs(0, 10) > 0);
  // far below anything measured: left alone
  assert.equal(zergChargedAdjs(-K - 5, 50), -K - 5);
});

test("missing 🪳 or iVi = null", () => {
  assert.equal(zergChargedAdjs(1234.5, null), null);
  assert.equal(zergChargedAdjs(1234.5, undefined), null);
  assert.equal(zergChargedAdjs(1234.5, NaN), null);
  assert.equal(zergChargedAdjs(null, 30), null);
  assert.equal(zergChargedAdjs(NaN, 30), null);
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
