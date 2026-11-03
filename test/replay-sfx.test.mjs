// Replay SFX v0.1 (pure): the synth module schedules the right tones,
// never throws, stays silent when muted, and rate-limits shots.
import test from "node:test";
import assert from "node:assert/strict";
import { createSfx } from "../replay/sfx.mjs";

function fakeCtx() {
  const oscs = [], gains = [];
  const osc = () => {
    const o = { type: null, freq: [], connect() {}, start() {}, stop() {},
      frequency: { setValueAtTime(v) { o.freq.push(["set", v]); }, exponentialRampToValueAtTime(v) { o.freq.push(["ramp", v]); } } };
    oscs.push(o); return o;
  };
  const gain = () => {
    const g = { vals: [], connect() {},
      gain: { setValueAtTime(v) { g.vals.push(["set", v]); }, exponentialRampToValueAtTime(v) { g.vals.push(["ramp", v]); } } };
    gains.push(g); return g;
  };
  return { oscs, gains, currentTime: 0, state: "running", resume() {}, createOscillator: osc, createGain: gain };
}

test("shot schedules a falling square blip; unknown names are silent no-ops", () => {
  const c = fakeCtx(), s = createSfx(() => c, () => 1000);
  s.play("shot");
  assert.equal(c.oscs.length, 1);
  assert.equal(c.oscs[0].type, "square");
  assert.deepEqual(c.oscs[0].freq[0], ["set", 900]);
  assert.deepEqual(c.oscs[0].freq[1], ["ramp", 300]);
  assert.doesNotThrow(() => s.play("nope"));
  assert.equal(c.oscs.length, 1, "an unknown name schedules nothing");
});

test("muted plays nothing; kill and headshot differ in pitch", () => {
  const c = fakeCtx(), s = createSfx(() => c, () => 1000);
  s.setMuted(true); s.play("kill");
  assert.equal(c.oscs.length, 0);
  s.setMuted(false); s.play("kill"); s.play("headshot");
  assert.equal(c.oscs.length, 2);
  assert.ok(c.oscs[1].freq[0][1] > c.oscs[0].freq[0][1], "headshot starts higher than kill");
});

test("shots rate-limit to one per 60 ms; other sounds do not", () => {
  let t = 1000;
  const c = fakeCtx(), s = createSfx(() => c, () => t);
  s.play("shot"); t += 10; s.play("shot"); t += 60; s.play("shot");
  assert.equal(c.oscs.length, 2, "the 10 ms-apart second shot is dropped");
  s.play("hit"); s.play("hit");
  assert.equal(c.oscs.length, 4, "hits have no gap limit");
});

test("a context that throws keeps play() silent, never throwing into the game loop", () => {
  const s = createSfx(() => { throw new Error("no audio"); }, () => 1000);
  assert.doesNotThrow(() => { s.play("shot"); s.play("death"); s.unlock(); });
});
