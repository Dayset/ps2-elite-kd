// t289u: main page ⇄ Rankings selection sync.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { namesToCarry, ranksHref, picksFromSearch, matchPicks, analyzeHref, MAIN_PENDING_KEY } from "../pick-sync.mjs";

const rows = [
  { name: "[00] danisantini", query: "danisantini", slug: "danisantini" },
  { name: "YEEZY", query: "YEEZY", slug: "yeezy" },
  { name: "[LHEU] Megatake", query: "Megatake", slug: "megatake" },
];

describe("pick-sync", () => {
  it("lone default ShloDog carries nothing; with others it is carried", () => {
    assert.deepEqual(namesToCarry(["ShloDog"]), []);
    assert.deepEqual(namesToCarry(["shlodog "]), []);
    assert.deepEqual(namesToCarry(["ShloDog", "YEEZY"]), ["ShloDog", "YEEZY"]);
    assert.deepEqual(namesToCarry([]), []);
  });
  it("dedupes case-insensitively and caps at max", () => {
    assert.deepEqual(namesToCarry(["a", "A", " b "]), ["a", "b"]);
    assert.equal(namesToCarry(Array.from({ length: 14 }, (_, i) => "n" + i), { max: 10 }).length, 10);
  });
  it("ranksHref / analyzeHref keep commas readable", () => {
    assert.equal(ranksHref(["ShloDog"]), "ranks.html");
    assert.equal(ranksHref(["YEEZY", "Megatake"]), "ranks.html?pick=YEEZY,Megatake");
    assert.equal(analyzeHref([]), "index.html");
    assert.equal(analyzeHref(["YEEZY", "a b"]), "index.html?names=YEEZY,a%20b");
  });
  it("picksFromSearch parses ?pick=", () => {
    assert.deepEqual(picksFromSearch("?pick=YEEZY,%20Megatake,"), ["YEEZY", "Megatake"]);
    assert.equal(picksFromSearch("?pick="), null);
    assert.equal(picksFromSearch(""), null);
  });
  it("matchPicks: case-insensitive, outfit tag optional, unknown skipped, order kept", () => {
    assert.deepEqual(
      matchPicks(["megatake", "nobody", "yeezy", "[00] DANISANTINI", "YEEZY"], rows),
      [
        { query: "Megatake", name: "[LHEU] Megatake" },
        { query: "YEEZY", name: "YEEZY" },
        { query: "danisantini", name: "[00] danisantini" },
      ]
    );
    assert.equal(matchPicks(["YEEZY", "Megatake"], rows, 1).length, 1);
  });
  it("pending key matches app.js LS_PENDING; pages wire the helpers", () => {
    const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
    assert.ok(app.includes(`LS_PENDING = "${MAIN_PENDING_KEY}"`));
    assert.match(app, /ranksHref\(currentNamesInField\(\)/);
    const ranks = fs.readFileSync(new URL("../ranks.html", import.meta.url), "utf8");
    assert.match(ranks, /picksFromSearch\(location\.search\)/);
    assert.match(ranks, /handOffPicks\(\);\s*location\.href = analyzeHref/);
  });
});
