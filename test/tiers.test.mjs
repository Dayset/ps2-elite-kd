/**
 * ⚔️ iVi tiers for the Rankings table (tiers.mjs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tierOf, groupByTier, openTierIds, pickedInGroup, groupIndexAt, IVI_TIERS } from "../tiers.mjs";

// 1..100 → share below = (v-1)/100.
const pool = Array.from({ length: 100 }, (_, i) => i + 1);

describe("tierOf", () => {
  it("places values by share of the population below them", () => {
    assert.equal(tierOf(100, pool), "top1"); // 99% below
    assert.equal(tierOf(99, pool), "top5"); // 98% below
    assert.equal(tierOf(96, pool), "top5"); // 95% below
    assert.equal(tierOf(95, pool), "top10");
    assert.equal(tierOf(91, pool), "top10");
    assert.equal(tierOf(90, pool), "top25");
    assert.equal(tierOf(76, pool), "top25");
    assert.equal(tierOf(51, pool), "top50");
    assert.equal(tierOf(50, pool), "lower");
    assert.equal(tierOf(1, pool), "lower");
  });

  it("puts iVi ≤ 0 below the scale and missing values in unrated", () => {
    assert.equal(tierOf(0, pool), "below");
    assert.equal(tierOf(-50, pool), "below");
    assert.equal(tierOf(null, pool), "unrated");
    assert.equal(tierOf(NaN, pool), "unrated");
  });

  it("has tiers ordered best to worst", () => {
    const mins = IVI_TIERS.map((t) => t.min);
    assert.deepEqual(mins, mins.slice().sort((a, b) => b - a));
  });
});

const rows = (vals) => vals.map((v, i) => ({ query: `p${i}`, adjs: v }));

describe("groupByTier", () => {
  it("splits a descending list into consecutive tiers with counts and ranges", () => {
    const list = rows([100, 99, 96, 60, 55, 10, -5, null]);
    const g = groupByTier(list, pool);
    assert.deepEqual(g.map((x) => [x.id, x.start, x.end, x.count]), [
      ["top1", 0, 1, 1],
      ["top5", 1, 3, 2],
      ["top50", 3, 5, 2],
      ["lower", 5, 6, 1],
      ["below", 6, 7, 1],
      ["unrated", 7, 8, 1],
    ]);
    assert.equal(g[1].lo, 96);
    assert.equal(g[1].hi, 99);
  });

  it("works for ascending order too", () => {
    const g = groupByTier(rows([10, 60, 100]), pool);
    assert.deepEqual(g.map((x) => x.id), ["lower", "top50", "top1"]);
  });

  it("returns [] for an empty list", () => {
    assert.deepEqual(groupByTier([], pool), []);
  });
});

describe("openTierIds", () => {
  const list = rows([100, 99, 60, 10]);
  const groups = groupByTier(list, pool);

  it("starts with every tier collapsed", () => {
    assert.equal(openTierIds(groups, { list, picked: new Set() }).size, 0);
  });

  it("opens the tiers holding selected players", () => {
    const open = openTierIds(groups, { list, picked: new Set(["p2"]) });
    assert.deepEqual([...open], ["top50"]);
  });

  it("opens every tier with matches while filtering", () => {
    assert.equal(openTierIds(groups, { list, picked: new Set(), filtering: true }).size, groups.length);
  });

  it("lets a manual choice win over the automatic rule", () => {
    const manual = new Map([["top50", false], ["lower", true]]);
    const open = openTierIds(groups, { list, picked: new Set(["p2"]), manual });
    assert.deepEqual([...open], ["lower"]);
  });
});

describe("helpers", () => {
  const list = rows([100, 99, 60, 10]);
  const groups = groupByTier(list, pool);

  it("lists selected players inside a group", () => {
    const g = groups.find((x) => x.id === "top5");
    assert.deepEqual(pickedInGroup(g, list, new Map([["p1", "x"]])).map((r) => r.query), ["p1"]);
  });

  it("finds the group for a list index", () => {
    assert.equal(groups[groupIndexAt(groups, 2)].id, "top50");
    assert.equal(groupIndexAt(groups, 99), -1);
  });
});
