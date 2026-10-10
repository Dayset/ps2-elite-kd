/**
 * Shared-cache chip ordering: sort by character name (outfit tag ignored),
 * grouped under letter separators with "#" first.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareByCharName, nameGroupLetter, groupByCharName } from "../analyze-run.mjs";

describe("compareByCharName", () => {
  it("ignores a leading [TAG] and case", () => {
    const names = ["[ZSD] RefusalToSubmit", "aHorn", "[ABC] Zed", "Atlas", "bHorn"];
    assert.deepEqual([...names].sort(compareByCharName), [
      "aHorn",
      "Atlas",
      "bHorn",
      "[ZSD] RefusalToSubmit",
      "[ABC] Zed",
    ]);
  });

  it("tie-breaks by full display string, deterministically", () => {
    const names = ["[ZZ] Same", "Same", "[AA] Same"];
    const a = [...names].sort(compareByCharName);
    const b = [...names].reverse().sort(compareByCharName);
    assert.deepEqual(a, b);
    assert.equal(a.length, 3);
  });
});

describe("nameGroupLetter", () => {
  it("uses the uppercased first letter of the tag-free name", () => {
    assert.equal(nameGroupLetter("[ZSD] RefusalToSubmit"), "R");
    assert.equal(nameGroupLetter("aHorn"), "A");
    assert.equal(nameGroupLetter("Élan"), "E");
  });
  it("puts digits / symbols into #", () => {
    assert.equal(nameGroupLetter("1337Sniper"), "#");
    assert.equal(nameGroupLetter("[TAG] 9Lives"), "#");
    assert.equal(nameGroupLetter("_under"), "#");
    assert.equal(nameGroupLetter(""), "#");
  });
});

describe("groupByCharName", () => {
  it("groups sorted items with # first then A–Z, keeping objects intact", () => {
    const items = [
      { name: "bHorn" },
      { name: "[ZSD] RefusalToSubmit" },
      { name: "Atlas" },
      { name: "2Fast" },
      { name: "aHorn" },
      { name: "[XYZ] Bravo" },
    ];
    const groups = groupByCharName(items);
    assert.deepEqual(
      groups.map((g) => [g.letter, g.items.map((i) => i.name)]),
      [
        ["#", ["2Fast"]],
        ["A", ["aHorn", "Atlas"]],
        ["B", ["bHorn", "[XYZ] Bravo"]],
        ["R", ["[ZSD] RefusalToSubmit"]],
      ]
    );
    assert.equal(groups[1].items[0], items[4]); // same object references
  });

  it("accepts plain strings and empty input", () => {
    assert.deepEqual(groupByCharName([]), []);
    assert.deepEqual(groupByCharName(["b", "A"]), [
      { letter: "A", items: ["A"] },
      { letter: "B", items: ["b"] },
    ]);
  });
});

describe("compareByCharName — marks, flairs, natural order (t302u)", () => {
  it("ignores [TAG], marks and flairs; case-insensitive; natural", () => {
    const names = ["[LHEU] Megatake*", "🪦 zed", "Alpha10", "👴🏽 [XYZ] beta†", "alpha2", "◦Gamma", "[AA] delta ◦"];
    assert.deepEqual([...names].sort(compareByCharName), [
      "alpha2",
      "Alpha10",
      "👴🏽 [XYZ] beta†",
      "[AA] delta ◦",
      "◦Gamma",
      "[LHEU] Megatake*",
      "🪦 zed",
    ]);
  });
  it("Megatake sorts under M, not L", () => {
    assert.equal(nameGroupLetter("[LHEU] Megatake"), "M");
    assert.ok(compareByCharName("[LHEU] Megatake", "Lima") > 0);
  });
});
