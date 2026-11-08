// Rankings table shows real negative ⚔️ iVi (owner 2026-11-08: less 0 in All players).
// The stats table, live page, kill feed and tiers keep their own floors/labels;
// the distribution graph keeps its floor: 0 + underflow bin (only the dot tooltip
// and the underflow label now use the real value).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");

test("rankings ⚔️ iVi has no floor: negative values render as-is", () => {
  assert.doesNotMatch(src, /floorZero/, "no floor flag left in rankings.mjs");
  assert.doesNotMatch(src, /below-scale/, "no below-scale cell left in rankings.mjs");
  assert.doesNotMatch(src, /Below the rating scale/, "no below-scale tooltip left in rankings.mjs");
  assert.doesNotMatch(src, /dist\.zeroBelow|dist\.below0/, "no floored distribution labels left in rankings.mjs");
  const def = src.slice(src.indexOf('{ id: "adjs"'), src.indexOf("},", src.indexOf('{ id: "adjs"')));
  assert.match(def, /digits: 0/);
  assert.doesNotMatch(def, /floorZero/);
});
