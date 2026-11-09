// weapon-stats.mjs: card rows, best of the chosen weapons (green) and of the class (gold).
import { test } from "node:test";
import assert from "node:assert/strict";
import { METRICS, GROUPS, statValues, bestOf, rank, classBests } from "../weapon-stats.mjs";
import { toProfile } from "../replay/weapons.mjs";

const AR = toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]);
const FAST = toProfile([900, 40, 2200, 125, 112, 10, 70, 2, 1, "auto"]);
const rec = {
  fm: { cof_recoil: 0.1, reload_chamber_ms: 500 }, states: [{ player_state_id: 0, cof_min: 3, cof_max: 6, cof_recovery_rate: 20 }, { player_state_id: 1, cof_min: 2.25, cof_max: 5 }],
  adsFm: { cof_recoil: 0.06, recoil_magnitude_min: 0.3, recoil_magnitude_max: 0.4, recoil_first_shot_modifier: 2, zoom_default: 1.35, move_modifier: 0.5 },
  adsStates: [{ player_state_id: 1, cof_min: 0.15, cof_max: 3 }], pool: 450, handling: { to_iron_sights_ms: 250, projectile_speed: 600 },
};

test("every metric has a group, a direction and a unique key", () => {
  const keys = new Set();
  for (const m of METRICS) {
    assert.ok(GROUPS.includes(m.group), m.key);
    assert.ok([-1, 0, 1].includes(m.dir), m.key);
    assert.ok(!keys.has(m.key), m.key);
    keys.add(m.key);
  }
});

test("values come from the profile, the hip mode and the ADS mode", () => {
  const v = statValues({ p: AR, rec, range: 0, hp: 500 });
  assert.equal(v.rpm, 600);
  assert.equal(v.reloadLong, 2450);
  assert.equal(v.pool, 450);
  assert.equal(v.adsCS, 0.15);
  assert.equal(v["adsCS:max"], 3);
  assert.equal(v.hipCS, 2.25);
  assert.equal(v.adsBloom, 0.06);
  assert.equal(v.hipBloom, 0.1);
  assert.ok(Math.abs(v.vRec - 0.35) < 1e-9, "average of min and max, from the ADS mode");
  assert.equal(v.speed, 600);
  assert.equal(v.adsSS, null, "a missing stance stays empty");
});

test("without recoil data the Census-profile rows still work", () => {
  const v = statValues({ p: AR, rec: null, range: 20, hp: 1000 });
  assert.equal(v.mag, 30);
  assert.equal(v.adsCS, null);
});

test("bestOf: direction, ties and single values give no winner", () => {
  assert.equal(bestOf([1, 2, 3], 1), 3);
  assert.equal(bestOf([1, 2, 3], -1), 1);
  assert.equal(bestOf([2, 2], 1), null);
  assert.equal(bestOf([2, null], 1), null);
  assert.equal(bestOf([1, 2], 0), null);
});

test("rank: gold beats green; equal values share the colour", () => {
  assert.equal(rank(3, 1, 3, 3), "gold");
  assert.equal(rank(3, 1, 3, 5), "good");
  assert.equal(rank(2, 1, 3, 5), "");
  assert.equal(rank(3, 0, 3, 3), "");
});

test("class bests over several weapons", () => {
  const cb = classBests([statValues({ p: AR, rec, range: 0, hp: 500 }), statValues({ p: FAST, rec, range: 0, hp: 500 })]);
  assert.equal(cb.rpm, 900);
  assert.equal(cb.reload, 1950);
  assert.equal(cb.adsCS, null, "same for both: no colour");
});

test("a best value most of the class shares is not gold", () => {
  const vals = Array.from({ length: 10 }, (_, i) => ({ rpm: i < 6 ? 600 : 500 }));
  assert.equal(classBests(vals).rpm, null);
  vals[9].rpm = 700;
  assert.equal(classBests(vals).rpm, 700);
});

test("rank: an attachment that beats the stock class best is still gold; equal rows are found", async () => {
  const { rank, rowAllSame } = await import("../weapon-stats.mjs");
  assert.equal(rank(6, 1, 6, 5), "gold");
  assert.equal(rank(4, -1, 4, 5), "gold");
  assert.equal(rank(6, -1, 6, 5), "good");
  assert.equal(rowAllSame([{ a: 2 }, { a: 2 }], "a"), true);
  assert.equal(rowAllSame([{ a: 2 }, { a: 3 }], "a"), false);
  assert.equal(rowAllSame([{ a: 2 }, { a: null }], "a"), false);
  assert.equal(rowAllSame([{ a: 2 }], "a"), false, "one weapon: nothing is hidden");
  assert.equal(rowAllSame([{ c: 1, "c:max": 2 }, { c: 1, "c:max": 3 }], "c"), false, "cones compare both ends");
});

test("free still shots (the ADAD count): same rule as weapon-adad nStill, in the stat table's strafing group", async () => {
  const { freeShots, NO_BLOOM, METRICS, GROUPS } = await import("../weapon-stats.mjs?free");
  const { nStill } = await import("../weapon-adad.mjs");
  assert.ok(GROUPS.includes("strafe"));
  for (const [a, b, c] of [[0.15, 0.4, 0.06], [0.3, 0.5, 0.05], [0.1, 0.25, 0.05], [0.5, 0.4, 0.1], [0.2, 0.2, 0.05]]) assert.equal(freeShots(a, b, c), nStill(a, b, c), `${a} ${b} ${c}`);
  assert.equal(freeShots(0.2, 0.5, 0), NO_BLOOM, "no bloom: every still shot is free");
  assert.equal(freeShots(null, 0.5, 0.1), null);
  // the Naginata worked example from the calculator page: ADS standing, still 0.15, moving 0.4, bloom 0.06 -> 4
  const rec = { adsFm: { cof_recoil: 0.06 }, adsStates: [{ player_state_id: 0, cof_min: 0.15 }, { player_state_id: 2, cof_min: 0.4 }], fm: null, states: [] };
  assert.equal(METRICS.find((m) => m.key === "freeAds").get({ rec }), 4);
  assert.equal(METRICS.find((m) => m.key === "freeHip").get({ rec }), null, "no hip fire mode: no value");
});
