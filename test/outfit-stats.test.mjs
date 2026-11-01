// 🛡️ Outfits page (#90): the stats are pure helpers (outfit-stats.mjs). These pin the definitions from the issue:
// median (even count = mean of the two middle values), top 10% = mean of the best 10% of known members (≥ 1),
// coverage = known of total, floor = 5 known members.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTFIT_FLOOR, TOP_SHARE, OUTFIT_COLS, median, topCount, topShareMean, coverage, clearsFloor, majority,
  outfitStats, buildOutfitRows, sortOutfits, readOutfitRows, toOutfitArrays,
} from "../outfit-stats.mjs";

test("constants match the issue", () => {
  assert.equal(OUTFIT_FLOOR, 5);
  assert.equal(TOP_SHARE, 0.1);
  assert.deepEqual([...OUTFIT_COLS], ["id", "tag", "name", "fac", "srv", "known", "total", "med", "top"]);
});

test("median: odd count = middle value, even count = mean of the two middle values", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
  assert.equal(median([NaN, null, undefined, 2, 4]), 3, "non-numbers are left out");
  assert.equal(median([-10, 0, 10]), 0, "negative scores count");
});

test("topCount: ceil(10% of known), at least one", () => {
  assert.equal(topCount(0), 0);
  assert.equal(topCount(1), 1);
  assert.equal(topCount(5), 1);
  assert.equal(topCount(10), 1);
  assert.equal(topCount(11), 2);
  assert.equal(topCount(20), 2);
  assert.equal(topCount(21), 3);
  assert.equal(topCount(30), 3, "no float drift at exact multiples");
  assert.equal(topCount(100), 10);
});

test("topShareMean: mean of the best 10% of known members", () => {
  assert.equal(topShareMean([1, 2, 3, 4, 5]), 5, "5 members → the best one");
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1); // 1…20
  assert.equal(topShareMean(twenty), 19.5, "20 members → mean of the best two");
  const elevens = [100, 90, ...Array(9).fill(1)];
  assert.equal(topShareMean(elevens), 95, "11 members → best two");
  assert.equal(topShareMean([]), null);
  assert.equal(topShareMean([3, NaN, 9]), 9);
});

test("coverage: known of total; total never below known", () => {
  assert.deepEqual(coverage(12, 48), { known: 12, total: 48, share: 0.25 });
  assert.deepEqual(coverage(6, 4), { known: 6, total: 6, share: 1 }, "member_count lagging behind a join");
  assert.deepEqual(coverage(0, 0), { known: 0, total: 0, share: null });
  assert.deepEqual(coverage(3, "10"), { known: 3, total: 10, share: 0.3 }, "Census numbers arrive as strings");
});

test("floor: 5 known members", () => {
  assert.equal(clearsFloor(4), false);
  assert.equal(clearsFloor(5), true);
  assert.equal(clearsFloor(4, 4), true);
});

test("majority: most common non-empty value, first seen on a tie", () => {
  assert.equal(majority(["vs", "nc", "vs", null]), "vs");
  assert.equal(majority(["nc", "tr"]), "nc");
  assert.equal(majority([null, ""]), null);
});

const mk = (vals, extra = {}) => vals.map((v, i) => ({ cid: String(i), adjs: v, fac: "vs", srv: "osprey", ...extra }));

test("outfitStats: below the floor → null; at the floor → full row", () => {
  assert.equal(outfitStats({ id: "1", total: 50 }, mk([1, 2, 3, 4])), null);
  const s = outfitStats({ id: "7", tag: "ABC", name: "Alpha", total: 48 }, mk([100, 200, 300, 400, 500, 600]));
  assert.deepEqual(s, { id: "7", tag: "ABC", name: "Alpha", fac: "vs", srv: "osprey", known: 6, total: 48, med: 350, top: 600 });
});

test("outfitStats: members without a score are left out of every stat and of the known count", () => {
  const members = [...mk([10, 20, 30, 40, 50]), { cid: "x", adjs: null }, { cid: "y", adjs: NaN }];
  const s = outfitStats({ id: "1", total: 9 }, members);
  assert.equal(s.known, 5);
  assert.equal(s.total, 9);
  assert.equal(s.med, 30);
  assert.equal(outfitStats({ id: "1", total: 9 }, [...mk([1, 2, 3, 4]), { adjs: null }]), null, "unscored members don't lift an outfit over the floor");
});

test("outfitStats: rounds to one decimal", () => {
  const s = outfitStats({ id: "1", total: 5 }, mk([1.04, 2.06, 3.11, 4.2, 5.55]));
  assert.equal(s.med, 3.1);
  assert.equal(s.top, 5.6);
});

test("buildOutfitRows: groups by outfit, skips players in no outfit, applies the floor, sorts by median", () => {
  const players = [
    ...["a1", "a2", "a3", "a4", "a5"].map((cid, i) => ({ cid, adjs: 100 + i * 10, fac: "nc", srv: "wainwright" })),
    ...["b1", "b2", "b3", "b4", "b5", "b6"].map((cid, i) => ({ cid, adjs: 500 + i, fac: "tr", srv: "osprey" })),
    ...["c1", "c2", "c3"].map((cid) => ({ cid, adjs: 9999, fac: "vs", srv: "osprey" })), // under the floor
    { cid: "solo", adjs: 50000 }, // no outfit
    { cid: "z", adjs: null }, // no score
  ];
  const membership = new Map([
    ...["a1", "a2", "a3", "a4", "a5"].map((c) => [c, "A"]),
    ...["b1", "b2", "b3", "b4", "b5", "b6"].map((c) => [c, "B"]),
    ...["c1", "c2", "c3", "z"].map((c) => [c, "C"]),
    ["solo", "0"],
  ]);
  const outfits = { A: { tag: "AAA", name: "Alpha", total: 20 }, B: { tag: "BBB", name: "Bravo", total: "6" }, C: { tag: "CCC", name: "Charlie", total: 4 } };
  const rows = buildOutfitRows(players, membership, outfits);
  assert.deepEqual(rows.map((r) => r.tag), ["BBB", "AAA"]);
  assert.equal(rows[0].med, 502.5);
  assert.equal(rows[0].top, 505);
  assert.equal(rows[0].fac, "tr");
  assert.equal(rows[1].known, 5);
  assert.equal(rows[1].total, 20);
});

test("sortOutfits: by key and direction, nulls last, members = total then known", () => {
  const rows = [
    { id: "1", tag: "A", med: 10, top: 50, known: 5, total: 40 },
    { id: "2", tag: "B", med: 30, top: 40, known: 9, total: 40 },
    { id: "3", tag: "C", med: null, top: 60, known: 6, total: 10 },
    { id: "4", tag: "D", med: 20, top: null, known: 7, total: 100 },
  ];
  assert.deepEqual(sortOutfits(rows, "med", "desc").map((r) => r.tag), ["B", "D", "A", "C"]);
  assert.deepEqual(sortOutfits(rows, "med", "asc").map((r) => r.tag), ["A", "D", "B", "C"], "nulls stay last ascending too");
  assert.deepEqual(sortOutfits(rows, "top", "desc").map((r) => r.tag), ["C", "A", "B", "D"]);
  assert.deepEqual(sortOutfits(rows, "members", "desc").map((r) => r.tag), ["D", "B", "A", "C"]);
  assert.deepEqual(sortOutfits(rows, "tag", "asc").map((r) => r.tag), ["A", "B", "C", "D"]);
  assert.notEqual(sortOutfits(rows), rows, "returns a new array");
});

test("readOutfitRows / toOutfitArrays round-trip; a foreign layout reads as empty", () => {
  const objs = [{ id: "9", tag: "X", name: "Xray", fac: "vs", srv: "osprey", known: 5, total: 7, med: 1.5, top: 3 }];
  const json = { cols: [...OUTFIT_COLS], rows: toOutfitArrays(objs) };
  assert.deepEqual(readOutfitRows(json), objs);
  assert.deepEqual(readOutfitRows({ cols: ["id"], rows: [["1"]] }), []);
  assert.deepEqual(readOutfitRows(null), []);
});
