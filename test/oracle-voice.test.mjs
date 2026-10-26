// AI Commander voice (#65): spoken text and when it speaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sayText, orderKey, voiceTick } from "../oracle/js/voice.js";

const hold = { focus: { kind: "hold", bases: ["Heyoka"], target: "NC", cuts: [], now: 32.1, then: 27.1 }, backups: [], quiet: false };

test("spoken order is just the order (owner t689u): no percent, cuts, place or difference", () => {
  assert.equal(sayText("TR", hold), "Defend Heyoka.");
  assert.equal(sayText("NC", { quiet: true, focus: null }), "Hold your lanes.");
  assert.equal(sayText("NC", { focus: { kind: "take", bases: ["Roothouse Distillery"], target: "TR", cuts: ["Johari Cove"], now: 7.8, then: 100 } }), "Attack Roothouse Distillery.");
  assert.equal(sayText("NC", { focus: { kind: "plan", bases: ["A", "B"], target: "TR", cuts: ["c"], now: 10, then: 30 } }), "Attack A and B.");
  assert.equal(sayText("NC", { focus: { kind: "push", bases: ["Edgewater Overlook"], target: "VS", cuts: [], now: 100, then: 100, heat: 46 } }), "Go Edgewater Overlook.");
  assert.equal(sayText("NC", { focus: { kind: "guard", bases: ["Hurakan"], target: "VS", cuts: [] } }), "Defend Hurakan.");
  assert.equal(sayText("VS", { focus: { kind: "spoil", bases: ["The Crown"], target: "TR", cuts: [] } }), "Attack The Crown.");
  // Race data and pockets no longer change the words.
  const race = { territory: { VS: 45, NC: 35, TR: 20 }, momentum: {} }, pk = [{ chokepoint: "Cairn Station", n: 4 }];
  assert.equal(sayText("VS", hold, race, pk), "Defend Heyoka.");
  assert.equal(sayText("NC", { quiet: true, focus: null }, race), "Hold your lanes.");
  for (const f of ["VS", "NC", "TR"]) assert.doesNotMatch(sayText(f, hold, race), /percent|plus|minus|cuts|First|Second|Third|attention|minute/i);
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
