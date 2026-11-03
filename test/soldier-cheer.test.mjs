// 🎬 #107 celebration (pure, soldier.js only): the cheer bob stays within
// 6 % of the soldier's height, runs ~1.2 s of wall time with 2–3 bobs, the
// glow fades out over the same window, and reduced motion keeps the glow
// while dropping the bob. Player.js wiring (setting cheerAt on a kill and
// passing wallT) lands with the #110 push, not here.
import test from "node:test";
import assert from "node:assert/strict";
import { cheerPose, CHEER_DUR, CHEER_AMP, Soldier } from "../replay/soldier.js";

test("cheerPose: silent outside the window, bounded bob and fading glow inside", () => {
  assert.deepEqual(cheerPose(-0.1), { bob: 0, glow: 0 });
  assert.deepEqual(cheerPose(1.2), { bob: 0, glow: 0 });
  assert.deepEqual(cheerPose(2), { bob: 0, glow: 0 });
  const at0 = cheerPose(0);
  assert.equal(at0.bob, 0, "the first hop starts on the ground");
  assert.equal(at0.glow, 1, "the glow starts full");
  // one hop is 1.2 / 2.5 = 0.48 s; halfway through the first hop is the peak
  assert.ok(Math.abs(cheerPose(0.24).bob + CHEER_AMP) < 1e-9, "peak hop is the 6 % cap");
  assert.ok(cheerPose(0.6).glow < 0.51 && cheerPose(0.6).glow > 0.49, "glow fades linearly");
  for (let e = 0; e < 1.2; e += 0.01) {
    const { bob } = cheerPose(e);
    assert.ok(bob <= 0 && bob >= -CHEER_AMP, `bob ${bob} out of range at ${e}`);
  }
});

test("cheerPose: 2–3 hops in the window, reduced motion keeps glow only", () => {
  let peaks = 0, prev = 0;
  for (let e = 0; e < 1.2; e += 0.005) {
    const b = -cheerPose(e).bob;
    if (prev < CHEER_AMP * 0.99 && b >= CHEER_AMP * 0.99) peaks++;
    prev = b;
  }
  assert.ok(peaks === 2 || peaks === 3, `expected 2–3 hops, got ${peaks}`);
  assert.deepEqual(cheerPose(0.24, true).bob, 0, "reduced motion: no bob");
  assert.ok(cheerPose(0.24, true).glow > 0.7, "reduced motion: glow still shows");
});

test("Soldier.pose: cheer adds on top of the current pose, never replaces it", () => {
  const s = new Soldier(null, "tr", { cheerAt: 10 });
  const idle = new Soldier(null, "tr", {}).pose(10.12);
  const cheering = s.pose(10.12, 10.12);
  assert.ok(cheering.bob < idle.bob, "the cheer bob lifts the pose (more negative bob)");
  assert.ok(cheering.cheer > 0.8, "glow is up just after the kill");
  assert.equal(new Soldier(null, "tr", {}).pose(10.12).cheer, 0, "no cheerAt, no glow");
  const done = s.pose(10.12, 11.5);
  assert.equal(done.cheer, 0, "the cheer is over after 1.2 wall seconds");
  assert.equal(done.bob, idle.bob, "the pose returns to exactly its uncheered shape");
});
