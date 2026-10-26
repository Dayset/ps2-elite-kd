// AI Commander voice (#65): spoken text and when it speaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sayText, orderKey, voiceTick, gapEnding } from "../oracle/js/voice.js";

const hold = { focus: { kind: "hold", bases: ["Heyoka"], target: "NC", cuts: [], now: 32.1, then: 27.1 }, backups: [], quiet: false };

test("spoken order (owner t652u wording): Defend / Attack / Go / Prepare / Spoil, plus or minus with no % word, no pockets", () => {
  assert.equal(sayText("TR", hold), "Defend Heyoka or minus 5.");
  assert.equal(sayText("NC", { quiet: true, focus: null }), "Hold your lanes.");
  assert.equal(sayText("NC", { focus: { kind: "take", bases: ["Roothouse Distillery"], target: "TR", cuts: ["Johari Cove"], now: 7.8, then: 100 } }),
    "Attack Roothouse Distillery, cuts 1, plus 92.");
  assert.equal(sayText("NC", { focus: { kind: "plan", bases: ["A", "B"], target: "TR", cuts: [], now: 10, then: 30 } }), "Attack A and B, plus 20.");
  assert.equal(sayText("NC", { focus: { kind: "plan", bases: ["A", "B"], target: "TR", cuts: ["c"], now: 10, then: 30 } }), "Attack A and B, cuts 1, plus 20.");
  assert.equal(sayText("NC", { focus: { kind: "push", bases: ["Edgewater Overlook"], target: "VS", cuts: [], now: 100, then: 100, heat: 46 } }), "Go Edgewater Overlook, the fight is there.");
  assert.equal(sayText("NC", { focus: { kind: "guard", bases: ["Hurakan"], target: "VS", cuts: [] } }), "Prepare Hurakan, likely next target.");
  assert.equal(sayText("VS", { focus: { kind: "spoil", bases: ["The Crown"], target: "TR", cuts: [] } }), "Spoil TR: take The Crown.");
  // Pockets ditched for now: the chokepoint hold is a normal Defend line, no "Pocket:" ending.
  const pk = [{ chokepoint: "Cairn Station", n: 4 }];
  assert.equal(sayText("TR", { focus: { kind: "hold", bases: ["Cairn Station"], target: "NC", cuts: ["a"], now: 50, then: 28 } }, null, pk), "Defend Cairn Station or minus 22, cuts 1.");
  assert.equal(sayText("TR", hold, null, pk), "Defend Heyoka or minus 5.");
});

test("gap ending: always plain percent for 1st / 2nd / 3rd", () => {
  // Always plain percent (owner t680u/t681u): no minutes, no "Pay attention!", whatever the swing.
  const race = { territory: { VS: 45, NC: 35, TR: 20 }, momentum: { VS: -2, NC: 2, TR: 0 } };
  assert.equal(gapEnding("VS", race), " First, plus 10 percent difference.");
  assert.equal(gapEnding("NC", race), " Second, minus 10 percent difference.");
  assert.equal(gapEnding("TR", race), " Third, minus 15 percent difference.");
  assert.equal(sayText("VS", hold, race), "Defend Heyoka or minus 5. First, plus 10 percent difference.");
  assert.equal(gapEnding("VS", { territory: { VS: 45, NC: 39, TR: 16 }, momentum: { VS: -45, NC: 45, TR: 0 } }), " First, plus 6 percent difference.");
});

test("gap ending: tight and frozen races use the same plain percent form", () => {
  const tight = { territory: { VS: 50, NC: 49, TR: 1 }, momentum: { VS: 3, NC: -3, TR: 0 } };
  assert.equal(gapEnding("VS", tight), " First, plus 1 percent difference.");
  assert.equal(gapEnding("NC", tight), " Second, minus 1 percent difference.");
  assert.equal(gapEnding("TR", { territory: { VS: 36, NC: 33, TR: 31 }, momentum: {} }), " Third, minus 2 percent difference.");
  assert.equal(gapEnding("VS", { territory: { VS: 40.2, NC: 39.8, TR: 20 }, momentum: {} }), " First, plus 0.4 percent difference.");
  const frozen = { territory: { VS: 50, NC: 30, TR: 20 }, momentum: { VS: 0.4, NC: 0, TR: -0.4 } };
  assert.equal(gapEnding("VS", frozen), " First, plus 20 percent difference.");
  assert.equal(gapEnding("NC", frozen), " Second, minus 20 percent difference.");
  assert.equal(gapEnding("TR", frozen), " Third, minus 10 percent difference.");
  for (const r of [tight, frozen]) for (const f of ["VS", "NC", "TR"]) assert.doesNotMatch(gapEnding(f, r), /attention|minute|Lead/i);
  assert.equal(gapEnding("VS", null), "", "no territory: no ending");
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
