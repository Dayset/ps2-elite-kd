// 🎬 #107 status lines (pure): wall-time lifetime, fade, merge, cap.
import test from "node:test";
import assert from "node:assert/strict";
import { pushLine, visibleLines, LINE_MIN, LINE_FADE, LINE_MAX } from "../replay/status.mjs";

test("a line is full for 2.5 s wall, fades over 0.5 s, then drops", () => {
  const lines = pushLine([], "reloading", 100);
  assert.deepEqual(visibleLines(lines, 102.4), [{ text: "reloading", alpha: 1 }], "still on screen at 2.4 s");
  assert.deepEqual(visibleLines(lines, 102.5), [{ text: "reloading", alpha: 1 }]);
  const mid = visibleLines(lines, 102.75);
  assert.equal(mid.length, 1);
  assert.ok(mid[0].alpha > 0.4 && mid[0].alpha < 0.6, "half-faded halfway through the fade");
  assert.deepEqual(visibleLines(lines, 103.0), [], "gone at 3.0 s");
  assert.equal(lines.length, 0, "expired lines are pruned");
});

test("repeats merge with a count and refresh the timer; the stack caps at 3", () => {
  const lines = [];
  pushLine(lines, "reloading", 100);
  pushLine(lines, "reloading", 101);
  assert.deepEqual(visibleLines(lines, 102), [{ text: "reloading ×2", alpha: 1 }]);
  pushLine(lines, "healing", 102);
  pushLine(lines, "revived", 102);
  pushLine(lines, "+assist", 102);
  assert.equal(lines.length, LINE_MAX, "a fourth line drops the oldest");
  assert.deepEqual(visibleLines(lines, 102).map((l) => l.text), ["healing", "revived", "+assist"]);
  assert.ok(LINE_MIN === 2.5 && LINE_FADE === 0.5 && LINE_MAX === 3);
});
