// 🎬 Pace selector (#110, pure): the director helpers in replay/director.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePace, rampTo, baseGate } from "../replay/director.mjs";

test("resolvePace: URL wins, else stored, else x1", () => {
  assert.equal(resolvePace("2", "1"), "2");
  assert.equal(resolvePace("cine", "2"), "cine");
  assert.equal(resolvePace("1", "2"), "1", "today's ?speed=1 keeps working");
  assert.equal(resolvePace(null, "2"), "2");
  assert.equal(resolvePace(null, null), "1");
  assert.equal(resolvePace("3", "cine"), "cine", "an unknown URL value falls through to storage");
  assert.equal(resolvePace("3", "bogus"), "1");
});

test("rampTo: a rate change takes the full ramp, linear, and never steps", () => {
  assert.equal(rampTo(2, 0.5, 0), 2);
  assert.equal(rampTo(2, 0.5, 0.2), 1.25);
  assert.equal(rampTo(2, 0.5, 0.4), 0.5);
  assert.equal(rampTo(2, 0.5, 1), 0.5, "past the ramp it sits at the target");
  assert.equal(rampTo(1, 2, 0.1), 1.25);
});

test("baseGate: the base rate changes at most once per 2 wall seconds", () => {
  let [base, at] = baseGate(null, 2, 0, -10);
  assert.deepEqual([base, at], [2, 0], "the first base is adopted immediately");
  [base, at] = baseGate(base, 1, 1.5, at);
  assert.deepEqual([base, at], [2, 0], "a change 1.5 s after the last one is refused");
  [base, at] = baseGate(base, 1, 2.0, at);
  assert.deepEqual([base, at], [1, 2.0], "a change at exactly 2 s is allowed");
  [base, at] = baseGate(base, 1, 5, at);
  assert.deepEqual([base, at], [1, 2.0], "asking for the same base does not move the timestamp");
  [base, at] = baseGate(base, 2, 3.9, at);
  assert.deepEqual([base, at], [1, 2.0], "the wait is measured from the last change that happened");
  [base, at] = baseGate(base, 2, 4.0, at);
  assert.deepEqual([base, at], [2, 4.0]);
});
