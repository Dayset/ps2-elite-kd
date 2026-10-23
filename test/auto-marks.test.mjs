import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { autoMarks, autoMarksHtml, AUTO_MARK_MIN } from "../auto-marks.mjs";
import { HUT_MARK_MIN } from "../hut.mjs";

test("🪳 next to the name only when the revive check confirms a top-quarter Zerg", () => {
  assert.deepEqual(autoMarks(null, { score: 90, rvp: 99, confirmed: true }).map((m) => m.id), ["zerg"]);
  assert.equal(autoMarks(null, { score: 60, rvp: 99, confirmed: true }).length, 0); // low Zerg: confirmed but not a zerg
  assert.equal(autoMarks(null, { score: 90, rvp: 60, confirmed: false }).length, 0);
  assert.equal(autoMarks(null, { score: 90, rvp: null, confirmed: false }).length, 0); // no XP detail / cleared in reviewed.json
});

test("🐣 next to the name when a negative Diff is softened by ≥ the 🛖 mark minimum", () => {
  assert.equal(AUTO_MARK_MIN, HUT_MARK_MIN);
  assert.deepEqual(autoMarks({ by: "nbd", raw: -35, score: -12 }, null).map((m) => m.id), ["nbd"]);
  assert.equal(autoMarks({ by: "nbd", raw: -35, score: -30 }, null).length, 0); // small change: hover only
  assert.equal(autoMarks({ by: "veh", raw: 40, score: 10 }, null).length, 0);
  assert.equal(autoMarks(null, null).length, 0);
  assert.match(autoMarksHtml({ by: "nbd", raw: -35, score: 0 }, { score: 80, rvp: 90, confirmed: true }), /poop-mark auto-mark auto-mark-zerg.*🪳.*auto-mark-nbd.*🐣/);
});

test("stats table + Rankings name cells render the marks; one auto-marks.mjs version", () => {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const rk = fs.readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(app, /\$\{padMarkHtml\(row\.p\)\}\$\{autoMarkHtml\(row\)\}/);
  assert.match(rk, /hutHtml\(r\) \+ autoMarksHtml\(r\._gap, r\._zerg\)/);
  const v = (s) => (s.match(/auto-marks\.mjs\?v=([\w-]+)/) || [])[1];
  assert.ok(v(app));
  assert.equal(v(app), v(rk));
});
