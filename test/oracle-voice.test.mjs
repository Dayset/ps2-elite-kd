// AI Commander voice (#65): spoken text and when it speaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sayText, orderKey, voiceTick } from "../oracle/js/voice.js";

const hold = { focus: { kind: "hold", bases: ["Heyoka"], target: "NC", cuts: [], now: 32.1, then: 27.1 }, backups: [], quiet: false };

test("spoken order: battlefield short, no faction name, worth + standing", () => {
  const win = { VS: { pct: 30.3 }, NC: { pct: 37.6 }, TR: { pct: 32.1 } };
  assert.equal(sayText("TR", hold, win), "Hold Heyoka or 5% lost. 32% 2nd place.");
  assert.equal(sayText("NC", { quiet: true, focus: null }, win), "Hold your lanes. 38% 1st place.");
  assert.equal(sayText("NC", { focus: { kind: "take", bases: ["Roothouse Distillery"], target: "TR", cuts: ["Johari Cove"], now: 7.8, then: 100 } }),
    "Take Roothouse Distillery, cuts 1, plus 92%.");
  assert.equal(sayText("NC", { focus: { kind: "push", bases: ["Edgewater Overlook"], target: "VS", cuts: [], now: 100, then: 100, heat: 46 } }, win), "Push Edgewater Overlook, the fight is there. 38% 1st place.");
  assert.equal(sayText("VS", { focus: { kind: "spoil", bases: ["The Crown"], target: "TR", cuts: [] } }, win), "Spoil TR: take The Crown. 30% 3rd place.");
});

test("same order (odds wobbling) is one key; a new base is a new key", () => {
  const k = orderKey("TR", hold);
  assert.equal(orderKey("TR", { ...hold, focus: { ...hold.focus, then: 26 } }), k);
  assert.notEqual(orderKey("TR", { ...hold, focus: { ...hold.focus, bases: ["The Bastion"] } }), k);
  assert.equal(voiceTick({ TR: hold }, "TR"), null, "off by default: says nothing");
});
