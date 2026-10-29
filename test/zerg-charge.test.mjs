// #84: 🪳⚔️ Zerg-adjusted iVi (zerg-charge.mjs) and its debug-only, PC-only column.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zergChargedAdjs, ZERG_CHARGE, zergFresh, dayOf, ZERG_FRESH_DAYS } from "../zerg-charge.mjs";

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

test("⚔️ iVi is the evened-out value on PC: page, Rankings and build agree", async () => {
  const src = fs.readFileSync(path.join(root, "stats-table.mjs"), "utf8");
  const vis = src.slice(src.indexOf("const adjVisibleCols"), src.indexOf("const adjDebugCols"));
  assert.match(vis, /id: "adjs"[^\n]*fn: \(r\) => zAdjs\(r\)/, "⚔️ iVi column uses the evened-out value");
  assert.match(src, /const zAdjs = [\s\S]*?\$\.IS_PS[\s\S]*?zergChargedAdjs/, "PC only");
  const dbg = src.slice(src.indexOf("const adjDebugCols"), src.indexOf("const adjCols ="));
  assert.ok(dbg.includes('id: "adjs0"'), "the before value is a debug column");
  const rk = fs.readFileSync(path.join(root, "rankings.mjs"), "utf8");
  assert.match(rk, /ROOM !== "ps" && o\.adjs0 == null[\s\S]*?zergChargedAdjs/);
  const { applyZergChargeColumn, LITE_COLS } = await import("../scripts/build-ranks.mjs");
  assert.ok(LITE_COLS.includes("adjs0"));
  const today = Math.floor(Date.now() / 864e5);
  const mk = () => ({ cols: ["name", "adjs", "inflation", "apk", "zat", "rvp", "crp"], rows: [["a", 1000, 3.5, 0.6, today, null, null], ["b", 1000, 1.2, 0.05, today - 5, null, null], ["c", 1000, null, null, null, null, null], ["d", 900, 2, 0.3, today, null, null], ["e", 800, 1.8, 0.2, today, null, null], ["f", 1000, 3.5, 0.6, today - 61, null, null]] });
  const r = mk(); const info = applyZergChargeColumn(r);
  const i0 = r.cols.indexOf("adjs0"), ia = r.cols.indexOf("adjs");
  assert.ok(i0 > 0 && r.rows.every((row) => row[i0] != null));
  assert.equal(r.rows[2][ia], 1000, "no 🪳 → unchanged");
  assert.equal(r.rows[5][ia], 1000, "no 🤝 sessions for 60+ days → unchanged until fresh data");
  assert.ok(r.rows[0][ia] < 1000 && r.rows[1][ia] > 1000, "high 🪳 down, low 🪳 up");
  assert.equal(info.up + info.down, info.changed);
  const ps = mk(); applyZergChargeColumn(ps, { enabled: false });
  assert.deepEqual(ps.rows.map((row) => row[1]), mk().rows.map((row) => row[1]), "PlayStation unchanged");
});

test("documented with the research", () => {
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  for (const k of ["col.adjs0", "tip.adjs0", "adjs.zergTip", "rk.zergAdjTip", "cp.zaH", "cp.zaNote", "cp.iviL5", "cp.dbgAdjs0"]) assert.ok(en[k], k);
  assert.match(en["cp.zaNote"], /docs\/zerg-adjustment\.md/);
  assert.match(en["cp.zaNote"], /issues\/84/);
  const html = fs.readFileSync(path.join(root, "columns.html"), "utf8");
  assert.ok(html.includes('id="zerg-adj"') && html.includes('data-i18n-html="cp.zaNote"'));
  assert.ok(fs.existsSync(path.join(root, "docs/zerg-adjustment.md")));
});

test("freshness: only recent 🤝 sessions even out ⚔️ iVi", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(ZERG_FRESH_DAYS, 60);
  assert.equal(zergFresh(dayOf("2026-10-20T00:00:00Z"), now), true);
  assert.equal(zergFresh(dayOf("2026-08-01T00:00:00Z"), now), false);
  assert.equal(zergFresh(null, now), false);
  assert.equal(dayOf("nope"), null);
});
