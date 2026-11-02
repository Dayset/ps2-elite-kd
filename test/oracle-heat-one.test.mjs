// 🔥 Heat belongs to the selected faction only (2026-11-02): the heat button
// used to render on all 3 faction cards with the same page-wide state, so all 3
// showed ON at once. Now it renders only on the followed faction's card.
// Structural checks — the button placement is verified through the real module
// in check-heat-one.mjs (CDP).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cmd = readFileSync(new URL("../oracle/js/commander.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../oracle/js/main.js", import.meta.url), "utf8");

test("heat button renders only on the selected faction's card", () => {
  assert.ok(cmd.includes('${f === on ? heatButton(heat) : ""}'), "heat button gated on f === on");
  assert.ok(!cmd.includes("${voiceButton(f)}${heatButton(heat)}"), "no unconditional heat button on every card");
  assert.ok(!cmd.includes("next to each faction's voice button"), "stale per-faction comment gone");
});

test("commander pin bumped through main.js", () => {
  assert.ok(main.includes('./commander.js?v=20261102-conduit1'), "main.js imports commander at conduit1");
});
