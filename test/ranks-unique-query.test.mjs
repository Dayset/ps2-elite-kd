// One tick in the players table = one player (owner 2026-10-22, PS namesake
// Furkancimen3NS0 on Genudine + Ceres ticked both). Rows are picked by query,
// so the query must be unique in every room.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { uniqueQueries } from "../scripts/build-ranks.mjs";

test("PS namesakes get their server key; nothing else changes", () => {
  const a = ["[A] Bob", "Bob", "bob-us", 1], b = ["[B] Bob", "Bob", "bob", 2], c = ["Ann", "Ann", "ann", 3];
  const rows = uniqueQueries([a, b, c], new Map([[a, "us-1"], [b, "eu-2"], [c, "eu-3"]]));
  assert.deepEqual(rows.map((r) => r[1]), ["us-1", "eu-2", "Ann"]);
});

test("shared query without a key (PC): newest save kept, one row per query", () => {
  const rows = uniqueQueries([["Bob", "Bob", "bob", 1], ["BOB", "bob", "bob-2", 5], ["Ann", "Ann", "ann", 3]]);
  assert.deepEqual(rows.map((r) => r[2]), ["bob-2", "ann"]);
});

for (const dir of ["data", "data-ps"]) {
  test(`${dir}/ranks.json: every query is unique (case-insensitive)`, () => {
    const f = `${dir}/ranks.json`;
    if (!fs.existsSync(f)) return;
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    const q = r.cols.indexOf("query");
    const seen = new Map();
    const dupes = [];
    for (const row of r.rows) {
      const k = String(row[q]).toLowerCase();
      if (seen.has(k)) dupes.push(`${row[0]} / ${seen.get(k)}`);
      else seen.set(k, row[0]);
    }
    assert.deepEqual(dupes, []);
  });
}
