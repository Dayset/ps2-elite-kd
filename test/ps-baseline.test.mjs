// PlayStation adjusted-iVi baseline (owner t698): 600 ÷ the weekly PC / PS kill-speed gap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { adjustedIvi, RF_SOFT } from "../math.mjs";
import { clampPsKpmRatio, setPsKpmRatio, psKpmRatio, psIviBaseline, rfBaseFor, PS_KPM_RATIO_DEFAULT } from "../ps-baseline.mjs";
import { measureGap, nextRatioFile, median } from "../scripts/ps-kpm-ratio.mjs";

const stored = JSON.parse(fs.readFileSync(new URL("../data-ps/kpm-ratio.json", import.meta.url), "utf8"));

test("the stored gap is loaded and gives baseline 600 ÷ gap", () => {
  assert.equal(psKpmRatio(), clampPsKpmRatio(stored.ratio));
  assert.equal(stored.baseline, Math.round(600 / stored.ratio));
  assert.ok(Math.abs(psIviBaseline() - 600 / stored.ratio) < 1e-9);
});

test("PC keeps 600; PS rates against 0.6 ÷ gap", () => {
  const prev = psKpmRatio();
  try {
    setPsKpmRatio(1.69);
    assert.equal(rfBaseFor("pc"), RF_SOFT);
    assert.equal(rfBaseFor(undefined), RF_SOFT);
    assert.ok(Math.abs(adjustedIvi(0, RF_SOFT, rfBaseFor("pc")) - 600) < 1e-9);
    // a PS player at the PS baseline RF scores 600; at the PC baseline RF: +600·log2(gap)
    assert.ok(Math.abs(adjustedIvi(0, 0.6 / 1.69, rfBaseFor("ps")) - 600) < 1e-9);
    assert.ok(Math.abs(adjustedIvi(0, 0.6, rfBaseFor("ps")) - (600 + 600 * Math.log2(1.69))) < 1e-9);
    assert.equal(Math.round(psIviBaseline()), 355);
  } finally {
    setPsKpmRatio(prev);
  }
});

test("gap is clamped to 1.0–3.0 and bad values keep the last one", () => {
  const prev = psKpmRatio();
  try {
    assert.equal(clampPsKpmRatio(0.5), 1);
    assert.equal(clampPsKpmRatio(9), 3);
    assert.ok(Number.isNaN(clampPsKpmRatio("x")));
    assert.ok(Number.isNaN(clampPsKpmRatio(null)));
    setPsKpmRatio(2.0);
    assert.equal(setPsKpmRatio(null), false);
    assert.equal(setPsKpmRatio({ ratio: -1 }), false);
    assert.equal(psKpmRatio(), 2.0);
    setPsKpmRatio({ ratio: 7 });
    assert.equal(psKpmRatio(), 3);
    assert.ok(PS_KPM_RATIO_DEFAULT >= 1 && PS_KPM_RATIO_DEFAULT <= 3);
  } finally {
    setPsKpmRatio(prev);
  }
});

const ranks = (rows) => ({ cols: ["thin", "adjs", "ekpm"], rows });
test("weekly measure: median opponent KPM over measured rows only", () => {
  const pc = ranks([...Array(1001)].map((_, i) => [0, 100, 0.8 + (i % 3) * 0.05]).concat([[1, 5, 9], [0, null, 9]]));
  const ps = ranks([...Array(301)].map(() => [0, 50, 0.5]));
  const m = measureGap(pc, ps);
  assert.equal(m.ratio, Math.round((median(ranksE(pc)) / 0.5) * 1000) / 1000);
  assert.equal(m.pc.n, 1001);
  assert.equal(m.baseline, Math.round(600 / m.ratio));
  assert.ok(measureGap(pc, ranks([[0, 1, 0.5]])).error, "too few PS rows → no measurement");
});
function ranksE(d) { return d.rows.filter((r) => !r[0] && Number.isFinite(r[1])).map((r) => r[2]); }

test("weekly file is rewritten only when the gap changes, with history", () => {
  const m = { ratio: 1.7, raw: 1.7, baseline: 353, pc: { n: 1, ekpm: 1 }, ps: { n: 1, ekpm: 1 } };
  assert.equal(nextRatioFile({ ratio: 1.7 }, m), null);
  const n = nextRatioFile({ ratio: 1.69, history: [{ at: "2026-10-26", ratio: 1.69, baseline: 355 }] }, m, new Date("2026-11-02T11:17:00Z"));
  assert.equal(n.ratio, 1.7);
  assert.equal(n.measuredAt, "2026-11-02");
  assert.deepEqual(n.history.map((h) => h.baseline), [353, 355]);
  assert.equal(nextRatioFile(null, { error: "x" }), null);
});

test("weekly workflow: cached data only, commits data-ps/ on change", () => {
  const y = fs.readFileSync(new URL("../.github/workflows/ps-kpm-ratio.yml", import.meta.url), "utf8");
  assert.match(y, /cron: "17 11 \* \* 1"/);
  assert.match(y, /group: refresh-ps-room/);
  assert.match(y, /changed == '1'/);
  assert.match(y, /COMMIT_DIR: data-ps\//);
  assert.doesNotMatch(y, /CENSUS_|secrets\.|honu\.pw/);
});
