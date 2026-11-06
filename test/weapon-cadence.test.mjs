// Firing rhythm (owner 2026-11-06): wind-up before the first shot, burst weapons, and a sanity check that no
// simulated kill is faster than the game allows. Before this, the NSX Kuwa "killed" with single taps that ignored
// its wind-up, and burst weapons (NSX Yumi, Pilot, Arbalest...) fired every shot at the slow between-burst rate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withCadence, timeOfShot, effectiveRpm, idealTtk, dps, HAND_WINDUP, ttkDistribution, quantileMs } from "../weapons-model.mjs";
import { simParams, simulate, compareBursts, sprayPattern, stylesFor, rng } from "../weapon-sim.mjs";
import { slimRecoil, cadenceOf } from "../scripts/weapon-slim.mjs";
import { toProfile } from "../replay/weapons.mjs";
import { styleParts } from "../weapon-compare.mjs";

const read = (f) => JSON.parse(readFileSync(new URL("../assets/weapons/" + f, import.meta.url), "utf8"));
const YUMI = withCadence(toProfile([240, 30, 1800, 167, 143, 10, 90, 2, 1, "burst"]), [5, 60, 250, 250], "NSX Yumi");
const KUWA = withCadence(toProfile([750, 30, 2000, 150, 125, 10, 65, 2, 1, "auto"]), undefined, "NSX Kuwa");
const AR = toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]);

test("a profile with no bursts and no wind-up is returned unchanged", () => {
  assert.equal(withCadence(AR, [1, 100, 100, 0], "NC1 Gauss Rifle"), AR);
  assert.equal(timeOfShot(AR, 3), 200);
});

test("NSX Yumi: 250 ms wind-up, 5 shots 60 ms apart, 250 ms before the next pull (405 shots a minute)", () => {
  assert.deepEqual([1, 2, 5, 6, 7].map((k) => timeOfShot(YUMI, k)), [250, 310, 490, 990, 1050]);
  assert.equal(YUMI.rpm, 1000);                      // in-burst rate, not the between-burst refire
  assert.equal(Math.round(effectiveRpm(YUMI)), 405);  // the wiki's averaged rate
  assert.ok(dps(YUMI).burst < 167 * 1000 / 60);       // the waits between bursts count
});

test("NSX Kuwa: the hand-typed 200 ms wind-up comes before the first shot of every trigger pull", () => {
  assert.equal(HAND_WINDUP["NSX Kuwa"], 200);
  assert.equal(KUWA.delayMs, 200);
  assert.equal(KUWA.delayHand, true);
  assert.equal(idealTtk(KUWA, { hp: 1000, range: 0 }), 200 + 6 * 80);   // 7 body shots
  // the next magazine winds up again
  assert.equal(timeOfShot(KUWA, 31), 200 + 29 * 80 + 80 + 2000 + 200);
});

test("cadence.json carries the Census bursts and wind-ups", () => {
  const { cadence } = read("cadence.json");
  const cat = read("catalog.json").items;
  const byName = (n) => Object.keys(cat).find((id) => cat[id][0] === n);
  assert.deepEqual(cadence[byName("NSX Yumi")], [5, 60, 250, 250]);
  assert.equal(cadence[byName("NS-45 Pilot")]?.[0], 3);
  assert.equal(cadence[byName("NSX Kuwa")], undefined);   // Census has no wind-up for it: HAND_WINDUP fills it
});

test("simulator: single taps with a wind-up pay it on every shot, so they are never the Kuwa's quickest style", () => {
  const FM = { cof_recoil: 0, fire_refire_ms: 80, recoil_magnitude_min: 0, recoil_magnitude_max: 0 };
  const ST = [{ player_state_id: 1, cof_min: 0, cof_max: 0 }];
  const P = simParams(KUWA, FM, ST, {});
  const tap = simulate(P, { burst: 1, distance: 10, hp: 1000 }, rng(1));
  const hold = simulate(P, { burst: 30, distance: 10, hp: 1000 }, rng(1));
  assert.equal(hold.ttk, 680);
  assert.ok(tap.ttk >= 7 * 200 + 6 * 80, `tap ${tap.ttk}`);
  assert.ok(tap.ttk > hold.ttk);
});

test("simulator: a burst weapon fires whole bursts, 60 ms apart inside, wind-up + refire between", () => {
  const FM = { cof_recoil: 0, fire_refire_ms: 250, recoil_magnitude_min: 0, recoil_magnitude_max: 0 };
  const P = simParams(YUMI, FM, [{ player_state_id: 1, cof_min: 0, cof_max: 0 }], {});
  assert.deepEqual(stylesFor(P), [5, 10, 15, 20, 30]);
  const r = simulate(P, { burst: 30, distance: 5, hp: 1e9 }, rng(1), true);
  const t = r.shots.slice(0, 7).map((s) => s.t);
  assert.deepEqual(t, [250, 310, 370, 430, 490, 990, 1050]);
});

test("every weapon: no simulated kill beats the exact all-headshot time (so no impossible numbers)", () => {
  const rec = read("recoil.json"), cat = read("catalog.json").items, { profiles } = read("profiles.json"), { cadence } = read("cadence.json");
  const bad = [];
  for (const [id, w] of Object.entries(rec.weapons)) {
    const p = withCadence(toProfile(profiles[id]), cadence[id], cat[id] && cat[id][0]);
    if (!p || !rec.fm2[w[0]]) continue;
    const P = simParams(p, rec.fm2[w[0]], rec.groups[w[1]] || [], { aim: "ads", adsFm: rec.fm2[w[3]], adsStates: rec.groups[w[4]], acc: 1, hsr: 1 });
    const floor = idealTtk(p, { range: 10, hp: 1000, head: true });   // the sim uses Census refire ms, the model 60000 / rounded rpm: 1 % slack
    for (const row of compareBursts(P, { distance: 10, hp: 1000, runs: 8, seed: 3 }).rows) {
      if (row.p10 != null && row.p10 < floor * 0.99 - 1) bad.push(`${cat[id][0]} ${row.burst}: ${row.p10} < ${floor}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("spray pictures: a new seed gives a new spray, the same seed the same one", () => {
  const FM = { cof_recoil: 0.1, fire_refire_ms: 80, recoil_magnitude_min: 0.2, recoil_magnitude_max: 0.4, recoil_horizontal_min: 0.1, recoil_horizontal_max: 0.2, recoil_horizontal_tolerance: 0.5, recoil_angle_min: -10, recoil_angle_max: 10 };
  const P = simParams(AR, FM, [{ player_state_id: 1, cof_min: 0.1, cof_max: 1 }], {});
  const a = sprayPattern(P, { seed: 5, shots: 20 }), b = sprayPattern(P, { seed: 5, shots: 20 }), c = sprayPattern(P, { seed: 6, shots: 20 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map((s) => s.x), c.map((s) => s.x));
  assert.notDeepEqual(a.map((s) => s.y), c.map((s) => s.y));
});

test("slim recoil file: attachments kept once with their texts, idempotent; cadence from fire_mode_2", () => {
  const full = {
    savedAt: "x", weapons: { 1: [10, 20, 0, 11, 21] }, fm2: { 10: { fire_burst_count: 3, fire_auto_fire_ms: 70, fire_refire_ms: 140, fire_detect_range: 40 }, 11: {}, 99: {} },
    groups: { 20: [{ player_state_id: 0, cof_min: 1, cof_max: 2, cof_grow_rate: 50 }, { player_state_id: 7, cof_min: 9 }], 21: [] },
    attNames: { 5: "Compensator", 6: "Compensator", 7: "Red Laser Color" }, attDesc: { 5: "less recoil", 6: "less recoil" }, att: { 1: [5, 6, 7] },
  };
  const s = slimRecoil(full);
  assert.equal(s.v, 2);
  assert.deepEqual(Object.keys(s.fm2).sort(), ["10", "11"]);
  assert.equal(s.fm2[10].fire_detect_range, undefined);
  assert.deepEqual(s.groups[20], [{ player_state_id: 0, cof_min: 1, cof_max: 2 }]);
  assert.deepEqual(s.atts, [["Compensator", 0]]);
  assert.deepEqual(s.descs, ["less recoil"]);
  assert.deepEqual(s.att[1], [0]);
  assert.equal(slimRecoil(s), s);
  assert.deepEqual(cadenceOf(s), { 1: [3, 70, 140, 0] });
});

test("firing style words: bursts for burst weapons, shots for the rest", () => {
  assert.deepEqual(styleParts(10, 5), { pulls: 2, shots: 10 });
  assert.deepEqual(styleParts(4, 1), { shots: 4 });
});

test("the exact distribution is unchanged by the sparse rewrite (spot values)", () => {
  const d = ttkDistribution(AR, { range: 0, acc: 0.5, hsr: 0.2, hp: 500 });
  assert.ok(Math.abs(d.cdf.at(-1) - 1) < 1e-3);
  assert.equal(quantileMs(ttkDistribution(AR, { range: 0, acc: 1, hsr: 0, hp: 500 })), 200);
});
