/**
 * 📊 Distribution auto-cycle timing (dist-cycle.mjs) with a fake clock.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDistCycler, STEP_MS, HOLD_MS } from "../dist-cycle.mjs";

/** Fake clock: timers fire in order as time advances. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

function setup({ canRun = () => true } = {}) {
  const clock = fakeClock();
  let cur = "adjs";
  const shown = [];
  const c = createDistCycler({
    ids: () => ["adjs", "rf", "act"],
    current: () => cur,
    show: (id) => { cur = id; shown.push([clock.now(), id]); },
    canRun,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, c, shown, cur: () => cur };
}

describe("dist auto-cycle", () => {
  it("uses 5 s steps and a 15 s hold", () => {
    assert.equal(STEP_MS, 5000);
    assert.equal(HOLD_MS, 15000);
  });

  it("switches every 5 s in menu order and wraps around", () => {
    const { clock, c, shown } = setup();
    c.start();
    clock.advance(4999);
    assert.equal(shown.length, 0);
    clock.advance(1);
    clock.advance(10000);
    assert.deepEqual(shown, [[5000, "rf"], [10000, "act"], [15000, "adjs"]]);
  });

  it("an interaction holds for 15 s, then cycling resumes every 5 s", () => {
    const { clock, c, shown } = setup();
    c.start();
    clock.advance(3000);
    c.interact(); // at 3 s
    clock.advance(14999); // up to 17.999 s: nothing
    assert.equal(shown.length, 0);
    clock.advance(1); // 18 s
    assert.deepEqual(shown, [[18000, "rf"]]);
    clock.advance(5000);
    assert.deepEqual(shown.at(-1), [23000, "act"]);
  });

  it("repeated interactions keep extending the hold", () => {
    const { clock, c, shown } = setup();
    c.start();
    c.interact();
    clock.advance(10000);
    c.interact(); // at 10 s → hold to 25 s
    clock.advance(14999);
    assert.equal(shown.length, 0);
    clock.advance(1);
    assert.deepEqual(shown, [[25000, "rf"]]);
  });

  it("waits while it can't run (folded / hidden / tooltip) and resumes after", () => {
    let ok = false;
    const { clock, c, shown } = setup({ canRun: () => ok });
    c.start();
    clock.advance(20000);
    assert.equal(shown.length, 0);
    ok = true;
    clock.advance(1000);
    assert.equal(shown.length, 1);
  });

  it("does nothing with fewer than two metrics, and stop() halts it", () => {
    const clock = fakeClock();
    let n = 0;
    const c = createDistCycler({ ids: () => ["adjs"], current: () => "adjs", show: () => n++, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    c.start();
    clock.advance(30000);
    assert.equal(n, 0);
    const s = setup();
    s.c.start();
    s.clock.advance(5000);
    s.c.stop();
    s.clock.advance(30000);
    assert.equal(s.shown.length, 1);
  });

  it("reports the hold time left", () => {
    const { clock, c } = setup();
    c.start();
    c.interact();
    clock.advance(5000);
    assert.equal(c.holdLeft(), 10000);
  });
});

import { swipeStep, createWheelSwiper } from "../dist-cycle.mjs";

describe("swipe between metrics (t383u)", () => {
  it("carousel: finger left = next, finger right = previous", () => {
    assert.equal(swipeStep({ dx: -120, dy: 10, dt: 200 }), 1);
    assert.equal(swipeStep({ dx: 120, dy: -10, dt: 200 }), -1);
  });
  it("ignores taps, short moves, vertical scrolls and slow drags", () => {
    assert.equal(swipeStep({ dx: 3, dy: 2, dt: 80 }), 0);
    assert.equal(swipeStep({ dx: 40, dy: 0, dt: 100 }), 0);
    assert.equal(swipeStep({ dx: 80, dy: 70, dt: 200 }), 0);
    assert.equal(swipeStep({ dx: 10, dy: 300, dt: 200 }), 0);
    assert.equal(swipeStep({ dx: 200, dy: 0, dt: 2000 }), 0);
  });
  it("trackpad: one switch per sideways gesture, direction matches the fingers", () => {
    let t = 0;
    const w = createWheelSwiper({ now: () => t });
    // fingers moving left → positive deltaX → next
    const out = [];
    for (let i = 0; i < 10; i++) { t += 16; out.push(w.push(20, 2)); }
    assert.deepEqual(out.filter(Boolean), [1]);
    t += 400; // pause → new gesture
    const out2 = [];
    for (let i = 0; i < 10; i++) { t += 16; out2.push(w.push(-25, 1)); }
    assert.deepEqual(out2.filter(Boolean), [-1]);
  });
  it("trackpad: vertical scrolling never switches", () => {
    let t = 0;
    const w = createWheelSwiper({ now: () => t });
    for (let i = 0; i < 20; i++) { t += 16; assert.equal(w.push(5, 40), 0); }
  });
});

import { dragCommits, DRAG_COMMIT } from "../chart-slide.mjs";

describe("drag carousel release (t386u)", () => {
  it("finishes past a quarter of the width, either direction", () => {
    assert.equal(DRAG_COMMIT, 0.25);
    assert.equal(dragCommits({ dx: -100, width: 380 }), true);
    assert.equal(dragCommits({ dx: 100, width: 380 }), true);
  });
  it("springs back on a short slow drag", () => {
    assert.equal(dragCommits({ dx: -60, width: 380, vx: -0.1 }), false);
  });
  it("a quick flick finishes even when short", () => {
    assert.equal(dragCommits({ dx: -40, width: 380, vx: -0.8 }), true);
    assert.equal(dragCommits({ dx: -40, width: 380, vx: 0.8 }), false); // flick back the other way
  });
});
