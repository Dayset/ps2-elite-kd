// ⚔️ Alert skill medians (#89): worker/src/alert-skill.js — site skill maps (adjs, the ⚔️ iVi
// the pinned bar's global row uses, not the scoreboard's `ivi`) and per-faction medians over a
// zone crowd. Pure, no network (loadSkillMaps' fetch is not tested here).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillMaps, medianOf, zoneSkillMedians } from "../worker/src/alert-skill.js";

const ranks = { cols: ["name", "slug", "adjs", "ivi"], rows: [
  ["Alpha", "alpha", 1200, 1500],
  ["Bravo", "bravo", 800, 900],
  ["Charlie", "charlie", 1000, 1100],
  ["Delta", "delta", 0, 500],      // adjs 0 → no score (excluded)
  ["Echo", "echo", -5, 400],       // negative → excluded
]};
const cids = { "111": "Alpha", "222": ["Bravo", "x"], "333": "Charlie", "444": "Delta", "555": "Echo", "666": "Foxtrot" }; // Foxtrot: name, no ranks row

test("buildSkillMaps: cid→name, name→adjs (not ivi), finite positive only", () => {
  const m = buildSkillMaps(cids, ranks);
  assert.equal(m.names.get("111"), "Alpha");
  assert.equal(m.names.get("222"), "Bravo"); // array form takes the first
  assert.equal(m.adjs.get("alpha"), 1200);
  assert.equal(m.adjs.get("bravo"), 800);
  assert.equal(m.adjs.has("delta"), false);
  assert.equal(m.adjs.has("echo"), false);
  assert.equal(m.adjs.has("foxtrot"), false);
});

test("medianOf: odd, even (mean of middles, rounded), empty", () => {
  assert.equal(medianOf([300]), 300);
  assert.equal(medianOf([100, 300, 200]), 200);
  assert.equal(medianOf([100, 201]), 151); // (100+201)/2 = 150.5 → 151
  assert.equal(medianOf([]), null);
});

test("zoneSkillMedians: per-faction medians, unknown faction/score excluded", () => {
  const m = buildSkillMaps(cids, ranks);
  const crowd = [
    ["111", "VS"], ["222", "VS"],           // VS: 1200, 800 → med 1000, n 2
    ["333", "NC"],                          // NC: 1000 → med 1000, n 1
    ["444", "TR"], ["555", "TR"],           // TR: no known scores → left out
    ["666", "TR"],                          // Foxtrot: name but no ranks row → left out
    ["777", "NSO"],                         // unknown cid → left out
    ["111", null],                          // unknown faction → left out (the VS entry still counts)
    ["333", "XX"],                          // unknown faction → left out
  ];
  assert.deepEqual(zoneSkillMedians(crowd, m), { vs: { med: 1000, n: 2 }, nc: { med: 1000, n: 1 } });
});

test("zoneSkillMedians: NSO players form their own group", () => {
  const m = buildSkillMaps({ "111": "Alpha", "222": "Bravo" }, ranks);
  assert.deepEqual(zoneSkillMedians([["111", "NSO"], ["222", "NSO"]], m), { nso: { med: 1000, n: 2 } });
});

test("zoneSkillMedians: empty crowd / no maps → {}", () => {
  const m = buildSkillMaps(cids, ranks);
  assert.deepEqual(zoneSkillMedians([], m), {});
  assert.deepEqual(zoneSkillMedians([["111", "VS"]], null), {});
});
