// 🎬 #111 scrim plans (pure): the seed search lands the row's exact final
// score with no third-party engagements, and falls back to the nearest plan
// when the target is unreachable in the given tries.
import test from "node:test";
import assert from "node:assert/strict";
import { planScrim, scrimPlanEnd } from "../replay/scrim-plan.mjs";
import { shooter } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";
import { scoreAt } from "../replay/duel-scene.mjs";

const A = shooter(toProfile(FALLBACK["Assault Rifle"]), { kd: 1, spk: 39.5, hpk: 10.4, hsr: 0.18 });
const B = shooter(toProfile(FALLBACK["Assault Rifle"]), { kd: 1, spk: 39.5, hpk: 10.4, hsr: 0.18 });
const info = { kpm: 1, classShares: {}, revivedShare: 0.3, resupplyPm: 0 };

test("planScrim finds the exact row score, third-free", () => {
  const { plan, exact, tries } = planScrim(A, B, { seed: 12345, durationSec: 745, k: 3, d: 7, model: null, aInfo: info, bInfo: info });
  assert.equal(exact, true, `expected an exact 3–7 plan, found in ${tries} tries`);
  assert.deepEqual(scoreAt(plan, Infinity), { a: 3, b: 7 }, "the full played score is the row score");
  assert.equal(plan.engagements.some((e) => e.outcome === "third"), false, "a scrim has no third parties");
  assert.ok(plan.duration === 745);
  assert.ok(scrimPlanEnd(plan, 745) >= 745, "the scene ends at the plan's own end, never before the row window");
});

test("planScrim falls back to the nearest plan when no seed lands exact", () => {
  // One try per stage, fixed seed 999: stage A scores 6–7 (three kills over
  // on A's side), stage B re-plans at the corrected duration and scores
  // further away, so the fallback returns the 6–7 plan (rescaled to the row
  // window) and reports exact: false instead of pretending.
  const { plan, exact } = planScrim(A, B, { seed: 999, durationSec: 745, k: 3, d: 7, model: null, aInfo: info, bInfo: info, tries: 1 });
  assert.equal(exact, false);
  assert.deepEqual(scoreAt(plan, Infinity), { a: 6, b: 7 });
  assert.equal(plan.duration, 745, "even the fallback plan is rescaled to the row window");
});
