import { test } from "node:test";
import assert from "node:assert/strict";
import { jumpButtonsVisible, sectionJumpState, hopTarget, scrollBehavior } from "../jump-btns.mjs";

test("jumpButtonsVisible: hidden near top, shown after ~1 screen, ⬇ hides at end", () => {
  assert.deepEqual(jumpButtonsVisible({ scrolled: 0, viewport: 800 }), { top: false, bottom: false });
  assert.deepEqual(jumpButtonsVisible({ scrolled: 700, viewport: 800 }), { top: false, bottom: false });
  assert.deepEqual(jumpButtonsVisible({ scrolled: 900, viewport: 800 }), { top: true, bottom: true });
  assert.deepEqual(jumpButtonsVisible({ scrolled: 900, viewport: 800, nearEnd: true }), { top: true, bottom: false });
  assert.deepEqual(jumpButtonsVisible({ active: false, scrolled: 5000, viewport: 800 }), { top: false, bottom: false });
});

test("sectionJumpState: only while inside the open, on-screen list", () => {
  const base = { open: true, viewport: 800, pageY: 2000 };
  // inside a long list, end far below
  assert.deepEqual(sectionJumpState({ ...base, listTop: -1500, listBottom: 6000 }), { top: true, bottom: true });
  // collapsed
  assert.deepEqual(sectionJumpState({ ...base, open: false, listTop: -1500, listBottom: 6000 }), { top: false, bottom: false });
  // list top still on screen (not inside yet)
  assert.deepEqual(sectionJumpState({ ...base, listTop: 120, listBottom: 6000 }), { top: false, bottom: false });
  // scrolled past the list (out of view above)
  assert.deepEqual(sectionJumpState({ ...base, listTop: -7000, listBottom: -100 }), { top: false, bottom: false });
  // end of list on screen → only ⬆
  assert.deepEqual(sectionJumpState({ ...base, listTop: -5000, listBottom: 700 }), { top: true, bottom: false });
  // not scrolled ~1 screen yet
  assert.deepEqual(sectionJumpState({ ...base, pageY: 500, listTop: -50, listBottom: 6000 }), { top: false, bottom: false });
});

test("hopTarget: hop only for long distances, landing ~near from target", () => {
  assert.equal(hopTarget(0, 2000, 800), null);
  assert.equal(hopTarget(0, 10000, 800), 9200);
  assert.equal(hopTarget(10000, 0, 800), 800);
  assert.equal(hopTarget(0, 10000, 0), null);
});

test("scrollBehavior: smooth without a window (node)", () => {
  assert.equal(scrollBehavior(), "smooth");
});
