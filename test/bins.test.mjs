import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBins, CHART_PATTERNS, RED_PATTERNS } from "../bins.mjs";
import { reviewFlags } from "../red-flags.mjs";
import { buildRanksWithGuard, readConfirmedPadders } from "../scripts/build-ranks.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

describe("bin classifier (user rules t280u + t288u: chart-only incl. 🌾 padding → 📉, any other anomaly → 🚩)", () => {
  it("chart-only patterns go to 📉 only", () => {
    assert.deepEqual(classifyBins({ patterns: ["adjusted"] }), { bin: "chart", red: [], chart: ["adjusted"], both: false });
    assert.equal(classifyBins({ outlier: true }).bin, "chart");
    assert.deepEqual(classifyBins({ patterns: ["adjusted"], outlier: true }).chart, ["adjusted", "outlier"]);
    // t288u: stat padding is a chart-integrity issue, not a 🚩 pattern.
    assert.deepEqual(classifyBins({ patterns: ["padding"] }), { bin: "chart", red: [], chart: ["padding"], both: false });
    assert.ok(!RED_PATTERNS.includes("padding"));
    const both = classifyBins({ patterns: ["aim", "padding"] });
    assert.equal(both.bin, "red"); assert.equal(both.both, true); assert.deepEqual(both.chart, ["padding"]);
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
  it("nothing → no bin; chart patterns are exactly 🌾 padding + † adjusted + 🧪 outlier; 🚩 = aim / vehicle / rampage", () => {
    assert.equal(classifyBins().bin, "");
    assert.deepEqual([...CHART_PATTERNS], ["padding", "adjusted", "outlier"]);
    assert.deepEqual([...RED_PATTERNS], ["aim", "vehicle", "rampage", "session"]);
  });
  it("reviewFlags routes through the classifier", () => {
    assert.equal(reviewFlags({ kd: 98, kpm: 4.7, ivi: 228 }).red, true);
    assert.equal(reviewFlags({ kd: 1, kpm: 1, ivi: 500 }).flagged, false);
  });
  it("real cache: 🌾 / † / outlier-only players are never in 🚩; 🚩 + chart players are cross-referenced", () => {
    const { guard, session } = buildRanksWithGuard(dataDir);
    const idx = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
    const red = new Set();
    const confirmed = readConfirmedPadders(dataDir); // reviewed.json "padding" → always 🌾
    let pads = 0;
    for (const e of idx.players || []) {
      let raw; try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
      const f = reviewFlags(playerMetrics(normalizePlayer(raw)), { confirmed: confirmed.has(e.slug) });
      if (f.patterns.every((p) => CHART_PATTERNS.includes(p))) assert.equal(f.red, false, e.slug);
      if (f.patterns.includes("padding")) { pads += 1; assert.equal(f.red, f.patterns.some((p) => RED_PATTERNS.includes(p)), e.slug); }
      if (f.red) assert.ok(f.patterns.some((p) => RED_PATTERNS.includes(p)), e.slug);
      if (f.red) red.add(e.slug);
    }
    // 🚩 "session" (🧪 session stats, needs data/xp: computed by build-ranks, merged on build-log).
    for (const f of session.flagged) red.add(f.slug);
    for (const g of guard.players) {
      assert.equal((g.red || []).length > 0, red.has(g.slug), g.slug);
      if (red.has(g.slug)) assert.match(g.reason, /🚩/);
      else assert.ok(!/🚩/.test(g.reason), g.slug);
    }
    assert.equal(guard.playersAlsoRed + guard.playersChartOnly, guard.players.length);
    assert.ok(pads >= 1, "the cache has known padders (Megatake)");
    const { bins } = buildRanksWithGuard(dataDir);
    assert.equal(bins.red, red.size);
    assert.equal(bins.padding, pads);
  });
});
