// #100 stage and camera (pure): phase ranges, camera framing, cover
// variety by seed, approach paths, and the hit-model range factor.
import test from "node:test";
import assert from "node:assert/strict";
import { rangeFor, rangeFactor, camScaleFor, cameraFor, coverKinds, hopKinds,
  approachPath, approachX, offScreenX, KINDS, W, GROUND } from "../replay/camera.mjs";
import { STRIP } from "../replay/lanes.mjs";

test("range comes from the phase: trade far, commit near", () => {
  assert.equal(rangeFor("trade"), 40);
  assert.equal(rangeFor("commit"), 12);
  assert.ok(rangeFor("approach") > rangeFor("trade"), "approach is the longest range");
  assert.equal(rangeFor("resolution"), 12);
});

test("rangeFactor is bounded and monotone: near hits harder", () => {
  assert.ok(rangeFactor(12) > rangeFactor(40));
  assert.ok(rangeFactor(40) > rangeFactor(60));
  assert.ok(rangeFactor(5) <= 1.2 && rangeFactor(200) >= 0.75, "clamped both ends");
});

test("camera frames the overheads too: name tag above the head stays on-screen", () => {
  // A duelist's head sits ~157 px above the ground; the name tag tops out
  // ~64 px above the head. At commit zoom both must map into [0, H].
  for (const phase of ["trade", "commit", "resolution", "gap"]) {
    const cam = cameraFor({ ax: 510, bx: 770, phase });
    const headRow = (GROUND - 157 - cam.top) * cam.scale;
    const tagRow = (GROUND - 157 - 64 - cam.top) * cam.scale;
    const groundRow = (GROUND - cam.top) * cam.scale;
    assert.ok(tagRow >= 0, `${phase}: tag row ${tagRow.toFixed(1)}`);
    assert.ok(headRow >= 0 && headRow < STRIP.H, `${phase}: head row ${headRow.toFixed(1)}`);
    assert.ok(groundRow > 0 && groundRow <= STRIP.H, `${phase}: ground row ${groundRow.toFixed(1)}`);
  }
});

test("camera zooms out at trade, in at commit, and never crops a duelist", () => {
  assert.equal(camScaleFor("trade"), 0.85);
  assert.equal(camScaleFor("commit"), 1.18);
  const trade = cameraFor({ ax: 510, bx: 770, phase: "trade" });
  assert.equal(trade.scale, 0.85);
  assert.equal(trade.left, 640 - W / (2 * 0.85));
  // Wide span: the clamp pulls the scale down so both framing points stay
  // inside the frame with margin.
  const wide = cameraFor({ ax: -300, bx: 770, phase: "commit" });
  assert.ok(wide.scale < 1.18, `wide span clamps the commit zoom (got ${wide.scale})`);
  for (const x of [-300 - 150, 770 + 150]) {
    const canvasX = (x - wide.left) * wide.scale;
    assert.ok(canvasX >= 0 && canvasX <= W, `framing point ${x} maps to ${canvasX.toFixed(0)}`);
  }
  // Narrow span keeps the phase target exactly.
  const narrow = cameraFor({ ax: 600, bx: 680, phase: "commit" });
  assert.equal(narrow.scale, 1.18);
});

test("cover kinds differ between the duelists, every engagement", () => {
  for (let idx = 0; idx < 12; idx++) {
    const k = coverKinds(idx);
    assert.notEqual(k.a, k.b, `idx ${idx}: ${k.a} vs ${k.b}`);
    assert.ok(KINDS.includes(k.a) && KINDS.includes(k.b));
  }
  const hops = hopKinds(3, 3);
  assert.equal(new Set(hops).size, 3, "hop covers all differ");
});

test("approach path runs off-screen to the slot in hops with pauses", () => {
  const eng = { idx: 5, segments: [{ phase: "approach", t0: 100, t1: 102 }] };
  const path = approachPath(eng, 510, "a");
  assert.equal(path.start, -300);
  assert.equal(path.end, 510);
  assert.equal(path.hops.length, 2, "2 s approach → 2 hops");
  assert.equal(approachX(path, 100), -300);
  assert.equal(approachX(path, 102), 510);
  // Each move pauses in its last 30%: x is constant across the pause.
  assert.equal(approachX(path, 101.2), approachX(path, 101.3), "paused at a hop");
  assert.ok(approachX(path, 101.5) > approachX(path, 101.3), "moving again in the next hop");
  assert.ok(approachX(path, 101.3) < 510, "still en route");
  // Long approach → 3 hops, and the right side starts past the right edge.
  const long = approachPath({ idx: 2, segments: [{ phase: "approach", t0: 0, t1: 8 }] }, 770, "b");
  assert.equal(long.start, W + 300);
  assert.equal(long.hops.length, 3);
  assert.equal(offScreenX("a"), -300);
  assert.equal(offScreenX("b"), W + 300);
});
