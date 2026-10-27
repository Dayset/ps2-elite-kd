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

test("🦁 Brave (owner t700): PS slope on enemy KPM × gap and Activity × gap; PC unchanged", async () => {
  const { curveSlope, scaledCurveSlope, pressureVolume } = await import("../math.mjs");
  const { kpmScaleFor } = await import("../ps-baseline.mjs");
  const { playerMetrics, normalizePlayer } = await import("../player-metrics.mjs");
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ name: "o" + i, kpm: 0.2 + i * 0.02, kills: 30 - i * 0.5, deaths: 10 + i * 0.3 });
  const base = { display: "T", global_kd: 1.5, global_kpm: 0.9, own_kpm: 0.9, acc: 0.2, hsr: 0.2, ivi: 900, rows };
  const prev = psKpmRatio();
  try {
    setPsKpmRatio(1.69);
    assert.equal(kpmScaleFor("pc"), 1);
    assert.equal(kpmScaleFor("ps"), 1.69);
    assert.equal(scaledCurveSlope({ rows }, 1), curveSlope({ rows }));
    const pc = playerMetrics(normalizePlayer({ ...base }));
    const ps = playerMetrics(normalizePlayer({ ...base, room: "ps" }));
    assert.ok(Math.abs(pc.pvs - pressureVolume(pc.act, pc.slope)) < 1e-9);
    assert.equal(ps.braveScale, 1.69);
    assert.equal(ps.slope, pc.slope); // 📉 Slope column stays raw
    assert.equal(ps.act, pc.act); // 🏃 Activity column stays raw
    const scaledRows = rows.map((r) => ({ ...r, kpm: r.kpm * 1.69 }));
    assert.ok(Math.abs(ps.braveSlope - curveSlope({ rows: scaledRows, curve: [] })) < 1e-9);
    assert.ok(Math.abs(ps.pvs - pressureVolume(ps.act * 1.69, ps.braveSlope)) < 1e-9);
    assert.ok(ps.pvs > pc.pvs);
  } finally {
    setPsKpmRatio(prev);
  }
});

test("🛡️ Resist / 📊 COI / ⚙️ Mech% (owner t717): PS shows Resist × gap (base 0.6 ÷ gap); PC unchanged; iVi untouched", async () => {
  const { rfIf, combatOutput, projectedMech, RF_SOFT: SOFT } = await import("../math.mjs");
  const { playerMetrics, normalizePlayer } = await import("../player-metrics.mjs");
  const { ghostFeatures } = await import("../ghost.mjs");
  const { exampleFacts, exampleCard } = await import("../columns-example.mjs");
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ name: "o" + i, kpm: 0.2 + i * 0.02, kills: 30 - i * 0.5, deaths: 10 + i * 0.3 });
  const base = { display: "T", global_kd: 1.5, global_kpm: 0.9, own_kpm: 0.9, acc: 0.2, hsr: 0.2, ivi: 900, rows };
  const prev = psKpmRatio();
  try {
    setPsKpmRatio(1.69);
    const pc = playerMetrics(normalizePlayer({ ...base }));
    const ps = playerMetrics(normalizePlayer({ ...base, room: "ps" }));
    const raw = rfIf(normalizePlayer({ ...base })).rf;
    // PC: exactly the old numbers
    assert.equal(pc.rfScale, 1);
    assert.equal(pc.rf, raw);
    assert.equal(pc.rfRaw, raw);
    assert.equal(pc.coi, combatOutput(raw));
    assert.equal(pc.mech, projectedMech(raw));
    // PS: measured against 0.6 ÷ gap
    assert.ok(Math.abs(ps.rfScale - 1.69) < 1e-12);
    assert.equal(ps.rfRaw, raw);
    assert.ok(Math.abs(ps.rf - raw * 1.69) < 1e-12);
    assert.ok(Math.abs(ps.coi - raw / rfBaseFor("ps")) < 1e-12);
    assert.ok(Math.abs(ps.coi - ps.rf / SOFT) < 1e-12);
    assert.ok(Math.abs(ps.mech - projectedMech(raw * 1.69)) < 1e-12);
    // not changed by this: adjusted iVi still uses the raw Resist with the PS base, ghost style features stay raw
    assert.ok(Math.abs(ps.adj - adjustedIvi(ps.ivi, raw, rfBaseFor("ps"))) < 1e-9);
    assert.deepEqual(ghostFeatures(ps)[4], ghostFeatures(pc)[4]);
    // worked example: PS line shows raw × gap, PC has none
    const xps = exampleFacts({ ...base, room: "ps" });
    const xpc = exampleFacts({ ...base });
    assert.equal(xps.rf, raw);
    assert.match(exampleCard(xps), /1\.69/);
    assert.doesNotMatch(exampleCard(xpc), /🎮 PlayStation: the 🛡️ Resist/);
    // follows the weekly gap, no hardcoded number
    setPsKpmRatio(2);
    assert.ok(Math.abs(playerMetrics(normalizePlayer({ ...base, room: "ps" })).rf - raw * 2) < 1e-12);
  } finally {
    setPsKpmRatio(prev);
  }
});
