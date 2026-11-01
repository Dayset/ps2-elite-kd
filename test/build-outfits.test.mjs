// 🛡️ Outfits dataset pipeline (#90, scripts/build-outfits.mjs): the pure parts — player join, Census batch
// answers, resume order and freshness. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankedPlayers, applyBatch, lookupOrder, freshMaps, MIN_RESOLVED, BATCH } from "../scripts/build-outfits.mjs";

const ranks = {
  updatedAt: "2026-11-01T00:00:00Z",
  cols: ["name", "query", "slug", "adjs", "srv"],
  rows: [
    ["Alpha", "Alpha", "alpha", 500, "osprey"],
    ["Bravo", "Bravo", "bravo", null, "osprey"], // no score
    ["Padder", "Padder", "padder", 900, "wainwright"], // confirmed padder
    ["Gone", "Gone", "gone", 300, "osprey"], // removed on request
    ["Nocid", "Nocid", "nocid", 200, "osprey"], // no character id known
    ["Delta", "Delta", "delta", 100, "wainwright"],
  ],
};
const cidNames = { 11: ["Alpha", "vs"], 12: ["Bravo", "nc"], 13: ["Padder", "tr"], 14: ["Gone", "tr"], 15: "Delta" };
const reviewed = { players: { padder: { decision: "padding", at: "2026-10-01" } } };
const optOut = { players: { 14: { name: "Gone", at: "2026-10-30", proof: "logout" } } };

test("rankedPlayers: scored, joined to a character id, no padders, no removed players", () => {
  const p = rankedPlayers({ ranks, cidNames, reviewed, optOut });
  assert.deepEqual(p.map((x) => x.slug), ["alpha", "delta"]);
  assert.deepEqual(p[0], { cid: "11", slug: "alpha", adjs: 500, fac: "vs", srv: "osprey" });
  assert.equal(p[1].fac, null, "old cid-names entries carry no faction");
});

test("applyBatch: members get their outfit, asked ids with no row are in no outfit", () => {
  const st = { chars: {}, outfits: {} };
  applyBatch(st, ["1", "2", "3"], [
    { character_id: "1", outfit_id: "37", alias: "ABC", name: "Alpha Co", member_count: "48" },
    { character_id: "2", outfit_id: "37", alias: "ABC", name: "Alpha Co", member_count: "48" },
    { character_id: "9", outfit_id: "" }, // malformed
  ], 1000);
  assert.deepEqual(st.chars, { 1: ["37", 1000], 2: ["37", 1000], 3: ["0", 1000] });
  assert.deepEqual(st.outfits, { 37: ["ABC", "Alpha Co", 48, 1000] });
});

test("lookupOrder: missing first, then oldest; fresh answers skipped (resumable)", () => {
  const now = 100 * 86400e3;
  const st = { chars: { a: ["0", now / 1000 - 3600], b: ["1", now / 1000 - 3 * 86400], c: ["1", now / 1000 - 2 * 86400] } };
  assert.deepEqual(lookupOrder(["a", "b", "c", "d"], st, now, 20 * 3600e3), ["d", "b", "c"]);
});

test("freshMaps: answers past the max age are not used", () => {
  const now = 100 * 86400e3;
  const st = { chars: { a: ["7", now / 1000 - 86400], b: ["7", now / 1000 - 20 * 86400] }, outfits: { 7: ["T", "Team", 9, 0] } };
  const { membership, outfits } = freshMaps(st, now, 14 * 86400e3);
  assert.deepEqual([...membership], [["a", "7"]]);
  assert.deepEqual(outfits.get("7"), { tag: "T", name: "Team", total: 9 });
});

test("limits: batches fit a Census URL, the write gate is 90%", () => {
  assert.ok(BATCH > 0 && BATCH <= 120, "CENSUS_BATCH in census-fetch.mjs is 120");
  assert.equal(MIN_RESOLVED, 0.9);
});
