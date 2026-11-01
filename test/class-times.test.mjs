import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compactClassTimes, mainClassOf, CLASS_IDS } from "../scripts/class-times.mjs";

test("compactClassTimes sums per class profile and gives hours + shares", () => {
  const m = compactClassTimes([
    { character_id: "1", profile_id: "6", value_forever: "5400" },
    { character_id: "1", profile_id: "4", value_forever: "1800" },
    { character_id: "1", profile_id: "2", value_forever: "99999" }, // not a class profile
  ]);
  assert.deepEqual(m.get("1"), [2, 0, 0, 25, 0, 75, 0]);
});

test("mainClassOf picks the biggest share", () => {
  assert.deepEqual(mainClassOf([10, 5, 5, 60, 10, 20, 0]), { k: 2, id: "med", share: 0.6, hours: 10 });
  assert.equal(mainClassOf([0, 0, 0, 0, 0, 0, 0]), null);
});

for (const f of ["data/class-times.json", "data-ps/class-times.json"]) {
  test(`${f} is compact and well formed`, () => {
    if (!fs.existsSync(f)) return;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.deepEqual(j.cols, ["hours", ...CLASS_IDS]);
    assert.ok(fs.statSync(f).size < 1.5e6);
    for (const e of Object.values(j.players).slice(0, 500)) assert.equal(e.length, 7);
  });
}
