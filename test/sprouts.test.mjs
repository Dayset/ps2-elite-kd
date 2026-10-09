import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sprout, sampleEvents, sproutRuleText, SPROUT_RULE } from "../sprouts.mjs";

describe("sprouts", () => {
  it("lists raw iVi ≤ 0 with a big enough sample", () => {
    assert.equal(sprout({ adjs: -166 }, 740).sprout, true);
    assert.equal(sprout({ adjs: 0 }, SPROUT_RULE.MIN_EVENTS).sprout, true, "boundaries inclusive");
  });
  it("skips small samples and positive iVi", () => {
    assert.equal(sprout({ adjs: -500 }, 82).sprout, false);
    assert.equal(sprout({ adjs: -500 }, SPROUT_RULE.MIN_EVENTS - 1).sprout, false);
    assert.equal(sprout({ adjs: 0.5 }, 5000).sprout, false);
  });
  it("never lists missing data", () => {
    assert.equal(sprout({ adjs: NaN }, 5000).sprout, false);
    assert.equal(sprout({}, 5000).sprout, false);
    assert.equal(sprout(null, 5000).sprout, false);
    assert.equal(sprout({ adjs: -10 }, undefined).sprout, false);
  });
  it("sums kills + deaths across rows", () => {
    assert.equal(sampleEvents([{ kills: 3, deaths: 2 }, { kills: "4", deaths: null }]), 9);
    assert.equal(sampleEvents(null), 0);
  });
  it("rule text states both thresholds", () => {
    const t = sproutRuleText();
    assert.match(t, /≤ 0/);
    assert.match(t, /300/);
  });
});
