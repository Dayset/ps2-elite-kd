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
  const pk = [{ chokepoint: "Cairn Station", n: 4 }];
  assert.equal(sayText("TR", { focus: { kind: "hold", bases: ["Cairn Station"], target: "NC", cuts: ["a"], now: 50, then: 28 } }, null, pk), "Hold Cairn Station, pocket of 4 behind it, or 22% lost.");
  assert.equal(sayText("TR", hold, null, pk), "Hold Heyoka or 5% lost. Pocket: hold Cairn Station.");
  assert.equal(sayText("VS", { focus: { kind: "spoil", bases: ["The Crown"], target: "TR", cuts: [] } }, win), "Spoil TR: take The Crown. 30% 3rd place.");
});

test("same order (odds wobbling) is one key; a new base is a new key", () => {
  const k = orderKey("TR", hold);
  assert.equal(orderKey("TR", { ...hold, focus: { ...hold.focus, then: 26 } }), k);
  assert.notEqual(orderKey("TR", { ...hold, focus: { ...hold.focus, bases: ["The Bastion"] } }), k);
  assert.equal(voiceTick({ TR: hold }, "TR"), null, "off by default: says nothing");
});

test("voices: natural (Edge) first, then Google (Chrome), then online, then the old local Windows voices", async () => {
  const { rankVoices } = await import("../oracle/js/voice.js");
  const v = (name, lang, localService) => ({ name, lang, localService });
  const out = rankVoices([v("Microsoft David - English (United States)", "en-US", true), v("Google US English", "en-US", false),
    v("Microsoft Aria Online (Natural) - English (United States)", "en-US", false), v("Google Deutsch", "de-DE", false), v("Google UK English Female", "en-GB", false)]);
  assert.deepEqual(out.map((x) => x.name), ["Microsoft Aria Online (Natural) - English (United States)", "Google US English", "Google UK English Female", "Microsoft David - English (United States)"]);
});
