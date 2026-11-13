// 🪳 Zerg meter (zerg-meter.html): geometry, motion and the page's
// minimalism. The meter must read true against the printed scale: the
// laser sits at the value's level, the roach's eyes sit on the laser, and
// the roach never covers the numbers.
// test-select-reaches: zerg-meter.mjs zerg-meter.html
// test-select: imports only
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  METER, clampZerg, valueToY, roachHeight, roachTop, createMotion, meterValue,
} from "../zerg-meter-motion.mjs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("meter geometry (measured off assets/zerg-meter-bg.jpg)", () => {
  it("value maps linearly to the printed scale", () => {
    assert.equal(valueToY(0), METER.y0);
    assert.equal(valueToY(100), METER.y100);
    assert.ok(Math.abs(valueToY(50) - (METER.y0 + METER.y100) / 2) < 1e-12);
    assert.equal(valueToY(150), METER.y100, "clamps above 100");
    assert.equal(valueToY(-5), METER.y0, "clamps below 0");
    assert.equal(valueToY(NaN), null, "no reading without a value");
    assert.equal(clampZerg(94.32), 94.32);
  });

  it("the roach's eyes sit on the value's level", () => {
    for (const v of [0, 10, 41.5, 50, 88, 100]) {
      const eye = roachTop(v) + METER.eyeY * roachHeight();
      assert.ok(Math.abs(eye - valueToY(v)) < 1e-12, `v=${v}`);
    }
  });

  it("the roach never covers the scale numbers", () => {
    // Content spans 15.6–84.2% of the sprite (measured); digits start 62.7%.
    const right = METER.barX + (0.842 - 0.5) * METER.roachW;
    const left = METER.barX - (0.5 - 0.156) * METER.roachW;
    assert.ok(right < 0.627, `roach content right ${right} < digits 0.627`);
    assert.ok(left > 0, "roach stays inside the image on the left");
  });

  it("the roach's content fits inside the image at both ends", () => {
    // Content spans 9.4–90.3% of the sprite height (measured).
    assert.ok(roachTop(100) + 0.094 * roachHeight() >= 0, "top at v=100");
    assert.ok(roachTop(0) + 0.903 * roachHeight() <= 1, "bottom at v=0");
  });

  it("the laser sits between the roach and the digits", () => {
    assert.ok(METER.laser.x0 > METER.barX, "laser starts right of the bar centre");
    assert.ok(METER.laser.x1 < 0.627, "laser ends left of the digits");
    assert.ok(METER.laser.x1 - METER.laser.x0 > 0.1, "laser is visible, not a dot");
  });
});

describe("meter reading: last opponent's Zerg, own lifetime only as the rest", () => {
  it("shows the last opponent once known, never the followed player's own score", () => {
    assert.equal(meterValue(1, 42), 42, "last opponent wins over the resting value");
    assert.equal(meterValue(1, 0), 0, "an opponent Zerg of 0 is a reading, not a missing one");
    assert.equal(meterValue(1, null), 1, "rests at own lifetime before the first known opponent");
    assert.equal(meterValue(null, 30), 30, "no own lifetime needed once an opponent scores");
    assert.equal(meterValue(null, null), null, "nothing to show for an unranked player yet");
    assert.equal(meterValue(null, NaN), null);
  });
});

describe("DPS-meter motion: slowed jump up, slide down", () => {
  it("rise covers most of a jump in one rise τ; fall covers less in the same time", () => {
    const m = createMotion();
    m.update(20, 0);
    const risen = m.update(80, 250); // one rise τ
    assert.ok(risen - 20 > 0.6 * 60, `rose to ${risen}`);
    const f = createMotion();
    f.update(80, 0);
    const fallen = f.update(20, 250); // one rise τ, but falling uses the fall τ
    assert.ok(80 - fallen < 0.35 * 60, `fell only to ${fallen}`);
  });

  it("settles exactly on the target and ignores nulls", () => {
    const m = createMotion();
    m.update(40, 0);
    assert.equal(m.update(40, 10000), 40);
    assert.equal(m.update(null, 20000), 40);
    assert.equal(m.update(150, 21000), 100, "clamps to the top of the scale");
  });
});

describe("page: meter only, and shared pins match live.mjs", () => {
  it("no links, headers, footers, nav or site chrome", () => {
    const html = read("zerg-meter.html");
    assert.doesNotMatch(html, /<a[\s>]/, "no links");
    assert.doesNotMatch(html, /<(header|footer|nav)[\s>]/, "no header/footer/nav");
    assert.doesNotMatch(html, /styles\.css/, "no site stylesheet");
    assert.doesNotMatch(html, /background-image/, "no page background image");
    assert.match(html, /background: #000/, "solid black page");
    assert.match(html, /assets\/zerg-meter-bg\.jpg/, "clean meter background");
    assert.match(html, /assets\/zerg-roach\.png/, "outlined roach");
  });

  it("the meter module shares live.mjs's pinned imports (no silent drift)", () => {
    const meter = read("zerg-meter.mjs");
    const live = read("live.mjs");
    for (const mod of ["live-model.mjs", "config.mjs", "trait-scores.mjs"]) {
      const pin = (src) => {
        const m = src.match(new RegExp(`"\\./${mod}\\?v=([^"]+)"`));
        assert.ok(m, `${mod} pinned in source`);
        return m[1];
      };
      assert.equal(pin(meter), pin(live), `${mod} pin`);
    }
    assert.match(read("zerg-meter.html"), /zerg-meter\.mjs\?v=20261113-zm1/);
    assert.match(meter, /zerg-meter-motion\.mjs\?v=20261113-zm1/);
  });
});
