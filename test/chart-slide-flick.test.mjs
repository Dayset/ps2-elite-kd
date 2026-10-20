// t471u: a human-fast flick on the 💀⇄🎯 skill graph / 📊 chart froze ~2.5 s
// (the watchdog) when the finger-up landed off the chart and missed `target`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../chart-slide.mjs", import.meta.url), "utf8");

test("drag moves and finger-up are heard on the window, wherever they land", () => {
  assert.match(src, /window\.addEventListener\("pointermove", onMove, \{ capture: true/);
  assert.match(src, /window\.addEventListener\("pointerup", \(e\) => end\(e, false\), \{ capture: true/);
  assert.match(src, /window\.addEventListener\("pointercancel", \(e\) => end\(e, true\), \{ capture: true/);
  assert.doesNotMatch(src, /target\.addEventListener\("pointerup"/);
});

test("the touched node's touchend ends a drag no pointer event ended", () => {
  assert.match(src, /finishAt\(x, y, cancel\)/);
});
