import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBins, CHART_PATTERNS, RED_PATTERNS } from "../bins.mjs";
import { reviewFlags } from "../red-flags.mjs";
import { buildRanksWithGuard } from "../scripts/build-ranks.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

describe("bin classifier (user rule t280u: chart-only → 📉, any other anomaly → 🚩)", () => {
  it("chart-only patterns go to 📉 only", () => {
    assert.deepEqual(classifyBins({ patterns: ["adjusted"] }), { bin: "chart", red: [], chart: ["adjusted"], both: false });
    assert.equal(classifyBins({ outlier: true }).bin, "chart");
    assert.deepEqual(classifyBins({ patterns: ["adjusted"], outlier: true }).chart, ["adjusted", "outlier"]);
  });
  it("any non-chart pattern goes to 🚩, chart ones become a cross-reference", () => {
    for (const p of RED_PATTERNS) assert.equal(classifyBins({ patterns: [p] }).bin, "red", p);
    const b = classifyBins({ patterns: ["rampage"], outlier: true });
    assert.equal(b.bin, "red");
    assert.equal(b.both, true);
    assert.deepEqual(b.chart, ["outlier"]);
    // A future, not-yet-binned pattern defaults to 🚩.
    assert.equal(classifyBins({ patterns: ["newthing"] }).bin, "red");
  });
  it("nothing → no bin; chart patterns are exactly † adjusted + 🧪 outlier", () => {
    assert.equal(classifyBins().bin, "");
    assert.deepEqual([...CHART_PATTERNS], ["adjusted", "outlier"]);
  });
  it("reviewFlags routes through the classifier", () => {
    assert.equal(reviewFlags({ kd: 98, kpm: 4.7, ivi: 228 }).red, true);
    assert.equal(reviewFlags({ kd: 1, kpm: 1, ivi: 500 }).flagged, false);
  });
  it("real cache: † players and outlier-only players are never in 🚩; 🚩 + outlier players are cross-referenced", () => {
    const { guard } = buildRanksWithGuard(dataDir);
    const idx = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
    const red = new Set();
    for (const e of idx.players || []) {
      let raw; try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
      const f = reviewFlags(playerMetrics(normalizePlayer(raw)));
      if (f.patterns.every((p) => CHART_PATTERNS.includes(p))) assert.equal(f.red, false, e.slug);
      if (f.red) red.add(e.slug);
    }
    for (const g of guard.players) {
      assert.equal((g.red || []).length > 0, red.has(g.slug), g.slug);
      if (red.has(g.slug)) assert.match(g.reason, /🚩/);
      else assert.ok(!/🚩/.test(g.reason), g.slug);
    }
    assert.equal(guard.playersAlsoRed + guard.playersChartOnly, guard.players.length);
  });
});
