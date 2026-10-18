// ⏱ lock-probability card: bin data sums to the published total, the CDF
// matches the published median (t=85), and the SVG keeps its aspect ratio.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lockCdf, lockCard } from "../oracle/js/lock.js";

describe("lockCdf (38,104 past alerts)", () => {
  it("nothing locked before minute 50", () => {
    assert.equal(lockCdf(0), 0);
    assert.equal(lockCdf(49), 0);
  });
  it("matches hand-computed fractions", () => {
    assert.ok(Math.abs(lockCdf(50) - 385 / 38104) < 1e-9);
    assert.ok(Math.abs(lockCdf(65) - 674 / 38104) < 1e-9);
    assert.ok(Math.abs(lockCdf(85) - 14672 / 38104) < 1e-9);
    assert.equal(lockCdf(90), 1);
    assert.equal(lockCdf(120), 1);
  });
  it("median bin holds the 50% mark (published median t=85)", () => {
    assert.ok(lockCdf(85) < 0.5 && lockCdf(90) === 1);
  });
});

describe("lockCard SVG", () => {
  const a = { start_ts: 1000000, dur: 90 };
  const html = lockCard(a, 1000000 + 65 * 60); // t = 65 min
  it("has a viewBox and no NaN coordinates (never stretched/squished)", () => {
    assert.match(html, /viewBox="0 0 360 212"/);
    assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
    assert.ok(!html.includes("NaN"), "no NaN in coordinates");
  });
  it("draws one bar per non-empty bin", () => {
    const rects = html.match(/<rect /g) || [];
    assert.equal(rects.length, 8); // 8 non-zero bins
  });
  it("marks now and the median", () => {
    assert.match(html, /now t=65/);
    assert.match(html, /median t=85/);
  });
  it("shows the live countdown and the CDF readout", () => {
    assert.match(html, /id="lockTimer"/);
    assert.match(html, /25:00/); // 90 - 65 = 25 min left
    assert.match(html, /1\.8%/); // lockCdf(65) ≈ 1.77%
  });
});
