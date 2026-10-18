/**
 * sfx: preloaded context + click sounds scheduled even while the context is
 * still suspended right after a gesture (the resume lands milliseconds
 * later). Fake AudioContext / window / localStorage, installed before the
 * module loads. Each test file runs in its own process, so the globals
 * below don't leak into other tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Minimal AudioContext stand-in: records created oscillators + resumes. */
class FakeGain {
  constructor() {
    this.gain = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }
  connect() { return this; }
  disconnect() {}
}
class FakeOsc {
  constructor() {
    this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    this.type = "";
    this.started = false;
  }
  connect() { return this; }
  start() { this.started = true; }
  stop() {}
}
class FakeAC {
  static instances = [];
  constructor() {
    FakeAC.instances.push(this);
    this.state = "suspended";
    this.currentTime = 0;
    this.oscs = [];
    this.resumeCalls = 0;
  }
  createOscillator() { const o = new FakeOsc(); this.oscs.push(o); return o; }
  createGain() { return new FakeGain(); }
  // Resume lands on a microtask — synchronously after the call the state is
  // still "suspended", which is exactly the window the fix covers.
  resume() { this.resumeCalls++; return Promise.resolve().then(() => { this.state = "running"; }); }
}

const listeners = {};
let stored = null; // localStorage value for "ps2_sfx" (null = default on)
globalThis.window = {
  AudioContext: FakeAC,
  addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
};
globalThis.localStorage = {
  getItem: () => stored,
  setItem: (_k, v) => { stored = v; },
};
const fire = (ev) => { for (const fn of listeners[ev] || []) fn(); };

const mod = await import("../sfx.mjs");

describe("sfx preload + sync", () => {
  it("creates the context at page load (preloaded, still suspended)", () => {
    assert.equal(FakeAC.instances.length, 1);
    assert.equal(FakeAC.instances[0].state, "suspended");
  });

  it("schedules the click sound while the context is still suspended", () => {
    const ctx = FakeAC.instances[0];
    assert.equal(ctx.oscs.length, 0);
    fire("pointerdown"); // gesture: kicks resume, state still "suspended"
    assert.equal(ctx.state, "suspended");
    mod.sfx("boop");
    assert.ok(ctx.oscs.length > 0, "tones scheduled despite suspension");
    assert.ok(ctx.oscs.every((o) => o.started), "oscillators started");
    assert.ok(ctx.resumeCalls >= 1, "sfx() kicked resume too");
  });

  it("stays silent with no recent gesture", async () => {
    const fresh = await import("../sfx.mjs?nogesture=1");
    const ctx = FakeAC.instances.at(-1);
    assert.equal(ctx.state, "suspended");
    fresh.sfx("boop");
    assert.equal(ctx.oscs.length, 0, "no gesture → no tones");
  });

  it("creates nothing when muted", async () => {
    const before = FakeAC.instances.length;
    stored = "off";
    await import("../sfx.mjs?muted=1");
    assert.equal(FakeAC.instances.length, before, "muted → no preloaded context");
    stored = null;
  });
});
