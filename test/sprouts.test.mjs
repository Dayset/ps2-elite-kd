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

import { farmAccount, farmAccountRuleText, FARM_ACCOUNT_RULE } from "../sprouts.mjs";

describe("🤖 likely farm accounts", () => {
  // Shape of a real farm account: vulcan112 → Megatake (3271 deaths, 0 kills back, KPM 0).
  const bot = [
    { name: "[LHEU] Megatake", kills: 0, deaths: 3271, kpm: 2.1 },
    { name: "0", kills: 0, deaths: 40, kpm: 0 },
    { name: "Someone", kills: 1, deaths: 20, kpm: 1 },
  ];
  it("flags most deaths to a never-killed-back killer + near-zero KPM, names the player it feeds", () => {
    const r = farmAccount(bot, 0.0);
    assert.equal(r.farm, true);
    assert.equal(r.feeders[0].name, "[LHEU] Megatake");
    assert.ok(r.share > 0.99, "unknown killer '0' is left out of the share");
  });
  it("needs low own KPM (a real player who gets farmed still fights)", () => {
    assert.equal(farmAccount(bot, 0.3).farm, false);
    assert.equal(farmAccount(bot, undefined).farm, false, "missing KPM never flags");
  });
  it("needs the share and the no-kill-back line", () => {
    const spread = [{ name: "A", kills: 0, deaths: 120 }, { name: "B", kills: 3, deaths: 60 }, { name: "C", kills: 2, deaths: 70 }];
    assert.equal(farmAccount(spread, 0.01).farm, false, "48% < 50%");
    const fights = [{ name: "A", kills: 5, deaths: 200 }]; // 2.5% killed back
    assert.equal(farmAccount(fights, 0.01).farm, false);
    const small = [{ name: "A", kills: 0, deaths: FARM_ACCOUNT_RULE.MIN_DEATHS - 1 }];
    assert.equal(farmAccount(small, 0).farm, false);
  });
  it("can feed several players", () => {
    const r = farmAccount([{ name: "A", kills: 0, deaths: 300 }, { name: "B", kills: 1, deaths: 200 }, { name: "C", kills: 30, deaths: 100 }], 0.02);
    assert.equal(r.farm, true);
    assert.deepEqual(r.feeders.map((f) => f.name), ["A", "B"]);
  });
  it("handles empty input", () => {
    assert.equal(farmAccount(null, 0).farm, false);
    assert.equal(farmAccount([], 0).farm, false);
  });
  it("rule text states the thresholds", () => {
    const t = farmAccountRuleText();
    assert.match(t, /50%/);
    assert.match(t, /100\+/);
    assert.match(t, /0\.1/);
  });
});
