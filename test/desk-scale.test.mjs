// t299u: big desktop screens get bigger text and a capped graph; mobile unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deskUiScale, chartFontScale, DESK_MIN_VW } from "../desk-scale.mjs";

describe("desk-scale", () => {
  it("is a no-op below the desktop breakpoint", () => {
    for (const vw of [320, 390, 768, 1024, 1399]) {
      assert.equal(deskUiScale(vw, 16), 1);
      assert.equal(chartFontScale(vw, 16, 356), 1);
    }
    assert.equal(DESK_MIN_VW, 1400);
  });
  it("grows with the root font on desktop, bounded", () => {
    assert.ok(Math.abs(deskUiScale(2560, 21.36) - 1.335) < 0.01);
    assert.equal(deskUiScale(2560, 40), 1.5);
    assert.equal(deskUiScale(1920, 14), 1);
  });
  it("brings chart ticks up to ~0.8rem without ever shrinking them", () => {
    const s = chartFontScale(1920, 17.52, 1154);
    assert.ok(Math.abs((11 * s * 1154) / 1000 - 17.52 * 0.8) < 0.3, String(s));
    assert.equal(chartFontScale(2560, 16, 2500), 1);
    assert.equal(chartFontScale(1500, 22, 300), 1.45);
  });
  it("styles.css keeps the big-screen rules inside a min-width:1400px media query", () => {
    const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const i = css.indexOf("@media (min-width: 1400px)");
    assert.ok(i > 0);
    const block = css.slice(i);
    assert.match(block, /html \{ font-size: clamp\(16px/);
    assert.match(block, /62vh/);
    // root font-size is only ever set inside that block
    assert.equal((css.match(/html\s*\{\s*font-size/g) || []).length, 1);
  });
});
