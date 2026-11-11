// 🕸️ Web (radar) view for the skill graph (owner 2026-11-11): 10 axes, every
// axis a population percentile (floored share strictly below, 1 decimal).
// No ⚡ Const, no public Census stats, no 🧘 Pure axis — the public stat is
// 🧼 Clean. 🤝 Assists and 🪳 Solo are inverted (low = good = outward).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  WEB_AXES, CHART_VIEWS, chartViews, nextChartView,
  percentile1dp, buildWebPools, webValuesFor, radarPoint, radarPoints,
} from "../web-chart.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Five players, values staggered so every percentile is a multiple of 20
// (n = 5: k players strictly below → k × 20).
const COLS = ["slug", "name", "adjs", "act", "pvs", "rf", "rkd", "apk", "inf", "inflation", "ivi", "rvp", "crp"];
const ROWS = [
  ["a", "A", 1000, 1, 5, 1.0, 1.0, 0.1, 50, 1.0, 500, null, null],
  ["b", "B", 2000, 2, 4, 1.5, 2.0, 0.2, 60, 1.5, 1000, null, null],
  ["c", "C", 1500, 3, 3, 2.0, 1.5, 0.3, 70, 2.0, 750, null, null],
  ["d", "D", 500, 4, 2, 2.5, 0.5, 0.4, 80, 2.5, 250, null, null],
  ["e", "E", 2500, 5, 1, 3.0, 3.0, 0.5, 90, 3.0, 1250, null, null],
];
const payload = { cols: COLS, rows: ROWS };
const LUCK = { v: 1, cuts: { lo99: -70, lo90: -48, hi90: 64, hi99: 148 }, p: { a: [0, 10, 50], e: [100, 10, 50] } };

test("web axes: 10, emoji only, no Const, no Census stats, no Pure", () => {
  assert.equal(WEB_AXES.length, 10);
  assert.deepEqual(WEB_AXES.map((a) => a.id), ["adjs", "act", "pvs", "rf", "rkd", "luck", "apk", "solo", "clean", "inf"]);
  for (const a of WEB_AXES) assert.match(a.emoji, /^\p{Extended_Pictographic}/u);
  assert.ok(!WEB_AXES.some((a) => a.id === "cons" || a.id === "pureivi" || a.id === "acc" || a.id === "hsr"));
});

test("percentile1dp: floored share strictly below, 1 decimal", () => {
  const s = [1, 2, 3, 4, 5];
  assert.equal(percentile1dp(s, 3), 40);
  assert.equal(percentile1dp(s, 1), 0);
  assert.equal(percentile1dp(s, 6), 100);
  assert.equal(percentile1dp(s, 2.5), 40);
  assert.equal(percentile1dp(s, null), null);
  assert.equal(percentile1dp([], 3), null);
  // 1-decimal floor, not the integer percentileOf: 1 of 6 below → 16.6, not 16.
  assert.equal(percentile1dp([1, 2, 3, 4, 5, 6], 2), 16.6);
});

test("web values on the synthetic pool (hand-computed)", () => {
  const pools = buildWebPools(payload, LUCK);
  assert.ok(pools);
  // E: top iVi/Activity/Resist/K/D/Infantry, bottom Brave (pvs 1), top Zerg
  // (80) so Solo 0, Clean 586.08 → 20th percentile of [369.2, 586.08, 1000,
  // 1040.256, 1606.528]; Luck 10 pts → 50th of [0, 10].
  assert.deepEqual(webValuesFor(pools, "e"), [80, 80, 0, 80, 80, 50, 20, 0, 20, 80]);
  // A: bottom almost everywhere, but top Brave (pvs 5), no Zerg (0) so Solo
  // 80, Assists 0.1 → inverted 100, Clean 1000 → 40th, Luck 0 pts → 0.
  assert.deepEqual(webValuesFor(pools, "a"), [20, 0, 80, 0, 20, 0, 100, 80, 40, 0]);
  // C has no Luck entry: that vertex is null, never a guessed number.
  const c = webValuesFor(pools, "c");
  assert.equal(c[5], null);
  assert.equal(c[0], 40); // adjs 1500 → 2 of 5 below
  assert.equal(c[8], 60); // Clean 1040.256 → 3 of 5 below
  // Unknown slug: no web at all.
  assert.equal(webValuesFor(pools, "nobody"), null);
  assert.equal(webValuesFor(null, "e"), null);
});

test("web values without the Luck file: Luck is null for everyone", () => {
  const pools = buildWebPools(payload, null);
  assert.equal(webValuesFor(pools, "e")[5], null);
  assert.equal(webValuesFor(pools, "e")[0], 80);
});

test("buildWebPools rejects a bad payload", () => {
  assert.equal(buildWebPools(null, null), null);
  assert.equal(buildWebPools({ cols: [], rows: [] }, null), null);
  assert.equal(buildWebPools({ cols: COLS, rows: [] }, null), null);
});

test("radar geometry: first axis at top, missing vertices jumped across", () => {
  const top = radarPoint(100, 0, 10, 500, 282, 200);
  assert.ok(Math.abs(top.x - 500) < 1e-9 && Math.abs(top.y - 82) < 1e-9);
  assert.deepEqual(radarPoint(50, 0, 10, 500, 282, 200), { x: 500, y: 182 });
  assert.deepEqual(radarPoint(0, 3, 10, 500, 282, 200), { x: 500, y: 282 });
  assert.deepEqual(radarPoint(150, 0, 10, 500, 282, 200), { x: 500, y: 82 }); // clamped
  const pts = radarPoints([100, null, 0, 50], 0, 0, 10);
  assert.equal(pts.length, 3); // the null vertex is skipped, not plotted at 0
  assert.deepEqual(radarPoints([null, null], 0, 0, 10), []);
  assert.deepEqual(radarPoints(null, 0, 0, 10), []);
});

test("carousel cycle: iVi → Pure → Web → iVi, and back; gated views skipped", () => {
  assert.deepEqual(CHART_VIEWS, ["kd", "pure", "web"]);
  assert.deepEqual(chartViews({ pure: true, web: true }), ["kd", "pure", "web"]);
  assert.deepEqual(chartViews({ pure: false, web: true }), ["kd", "web"]);
  assert.deepEqual(chartViews({}), ["kd"]);
  assert.equal(nextChartView("kd", 1, { pure: true, web: true }), "pure");
  assert.equal(nextChartView("pure", 1, { pure: true, web: true }), "web");
  assert.equal(nextChartView("web", 1, { pure: true, web: true }), "kd");
  assert.equal(nextChartView("kd", -1, { pure: true, web: true }), "web");
  assert.equal(nextChartView("web", -1, { pure: true, web: true }), "pure");
  assert.equal(nextChartView("kd", 1, { pure: false, web: true }), "web");
  assert.equal(nextChartView("web", -1, { pure: false, web: true }), "kd");
  assert.equal(nextChartView("kd", 1, {}), "kd");
  assert.equal(nextChartView("kd", -1, {}), "kd");
  assert.equal(nextChartView("ivi", 1, { pure: true, web: true }), "pure"); // retired mode counts as iVi
});

// Checked-in snapshot: the three reference players' webs, read from the
// live data (ranks.json + duel-ivi-player.json). Bands, not exact pins —
// the bot refreshes the snapshot, so pools drift a little run to run.
test("on the checked-in snapshot: the three reference webs", () => {
  const ranks = JSON.parse(read("data/ranks.json"));
  const luck = JSON.parse(read("data/duel-ivi-player.json"));
  const pools = buildWebPools(ranks, luck);
  assert.ok(pools);
  const bySlug = (slug) => {
    const v = webValuesFor(pools, slug);
    assert.ok(v, `${slug} has a web`);
    assert.equal(v.length, 10);
    assert.ok(v.every((x) => x === null || (x >= 0 && x <= 100)), `${slug} values in range`);
    return v;
  };
  const kano = bySlug("xclonekano");
  const zyr0s = bySlug("zyr0s");
  const fantom = bySlug("fantom220tr");
  // Order on the Clean axis (index 8): Kano ≈ Zyr0s > Fantom.
  assert.ok(kano[8] >= 99 && zyr0s[8] >= 99 && fantom[8] >= 95 && fantom[8] < 99);
  // Assists inverted (index 6): Zyr0s most solo, then Kano, then Fantom.
  assert.ok(zyr0s[6] > kano[6] && kano[6] > fantom[6]);
  assert.ok(zyr0s[6] >= 90 && fantom[6] >= 70 && fantom[6] <= 78);
  // Solo (index 7): same order.
  assert.ok(zyr0s[7] > kano[7] && kano[7] > fantom[7]);
  // Infantry (index 9): Fantom's 80.6% is far below the other two's ~98%.
  assert.ok(fantom[9] < 45 && kano[9] > 85 && zyr0s[9] > 85);
  // Luck (index 5): all three have a value, Zyr0s highest.
  assert.ok(kano[5] != null && zyr0s[5] != null && fantom[5] != null);
  assert.ok(zyr0s[5] > kano[5] && zyr0s[5] > fantom[5]);
  // Brave is pvs (index 2), not rf: all three sit near the rim.
  assert.ok(kano[2] >= 98 && zyr0s[2] >= 98 && fantom[2] >= 98);
});
