import test from "node:test";
import assert from "node:assert/strict";
import {
  bandFor,
  tenureState,
  buildCard,
  buildCards,
  findStale,
  remainingCards,
  shardFileFor,
  CARD_METRICS,
} from "../scripts/build-legend-cards.mjs";

const NOW = Date.UTC(2026, 10, 15);
const DAY = 86400;
const s = (ms) => Math.floor(ms / 1000);

const COLS = ["name", "query", "slug", "savedAt", ...CARD_METRICS, "thin", "mark", "farm", "top", "created", "last"];

function mkRow(over) {
  const o = {
    name: "Testy", query: "Testy", slug: "testy", savedAt: 0,
    adjs: 500, act: 1, pvs: 1, rf: 1, cons: 0.5, rkd: 1,
    kd: 1, kpm: 0.5, ownKpm: 0.5, acc: 25, hsr: 25, ivi: 500,
    thin: 0, mark: null, farm: null, top: 200,
    created: s(NOW - 365 * DAY * 1000), last: s(NOW - 1000),
    ...over,
  };
  return COLS.map((c) => o[c]);
}

function ranksOf(rows) {
  return { cols: COLS, rows };
}

function poolsOf(rows) {
  const pools = {};
  for (const id of CARD_METRICS) {
    pools[id] = rows.map((r) => r[COLS.indexOf(id)]).filter((v) => typeof v === "number").sort((a, b) => a - b);
  }
  return pools;
}

test("bandFor follows the issue #3 band table", () => {
  assert.equal(bandFor(99), "best");
  assert.equal(bandFor(98), "top");
  assert.equal(bandFor(90), "top");
  assert.equal(bandFor(89), "above");
  assert.equal(bandFor(75), "above");
  assert.equal(bandFor(74), "mid");
  assert.equal(bandFor(40), "mid");
  assert.equal(bandFor(39), "below");
  assert.equal(bandFor(20), "below");
  assert.equal(bandFor(19), "low");
  assert.equal(bandFor(0), "low");
  assert.equal(bandFor(null), "unknown");
});

test("tenureState: new / grave / inactive / veteran / active / unknown + boundaries", () => {
  assert.equal(tenureState(s(NOW - 10 * DAY * 1000), s(NOW - 1000), NOW), "new");
  assert.equal(tenureState(s(NOW - 91 * DAY * 1000), s(NOW - 1000), NOW), "active");
  assert.equal(tenureState(s(NOW - 365 * DAY * 1000), s(NOW - 400 * DAY * 1000), NOW), "grave");
  assert.equal(tenureState(s(NOW - 365 * DAY * 1000), s(NOW - 365 * DAY * 1000), NOW), "inactive");
  assert.equal(tenureState(s(NOW - 365 * DAY * 1000), s(NOW - 200 * DAY * 1000), NOW), "inactive");
  assert.equal(tenureState(s(NOW - 365 * DAY * 1000), s(NOW - 180 * DAY * 1000), NOW), "active");
  assert.equal(tenureState(s(NOW - 9 * 365 * DAY * 1000), s(NOW - 10 * DAY * 1000), NOW), "veteran");
  assert.equal(tenureState(null, null, NOW), "unknown");
});

test("eligibility: thin, padding, both (padding wins), neither", () => {
  const rows = [mkRow({ slug: "a" }), mkRow({ slug: "b", thin: 1 }), mkRow({ slug: "c" }), mkRow({ slug: "d", thin: 1 })];
  const padders = new Set(["c", "d"]);
  const cards = buildCards({ ranks: ranksOf(rows), padders, notes: { players: {} }, nowMs: NOW });
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  assert.equal(bySlug.get("a").eligible, true);
  assert.equal(bySlug.get("a").ineligibleReason, null);
  assert.equal(bySlug.get("b").eligible, false);
  assert.equal(bySlug.get("b").ineligibleReason, "thin");
  assert.equal(bySlug.get("c").eligible, false);
  assert.equal(bySlug.get("c").ineligibleReason, "padding");
  assert.equal(bySlug.get("d").ineligibleReason, "padding");
});

test("card carries visible metrics only, with percentile + band + owner note", () => {
  const rows = [mkRow({ slug: "a", adjs: 500 }), mkRow({ slug: "b", adjs: 900 })];
  const cards = buildCards({ ranks: ranksOf(rows), notes: { players: { a: { note: "Owner fact." } } }, nowMs: NOW });
  const a = cards.find((c) => c.slug === "a");
  assert.deepEqual(Object.keys(a.metrics), CARD_METRICS);
  assert.ok(!("mech" in a.metrics) && !("slope" in a.metrics) && !("adj" in a.metrics));
  assert.equal(a.ownerNote, "Owner fact.");
  assert.equal(cards.find((c) => c.slug === "b").ownerNote, null);
  // adjs pool [500, 900]: a at p0 (low), b at p50 (mid)
  assert.equal(a.metrics.adjs.percentile, 0);
  assert.equal(a.metrics.adjs.band, "low");
  assert.equal(cards.find((c) => c.slug === "b").metrics.adjs.band, "mid");
});

test("basis is stable inside a band, moves when a band changes", () => {
  const rows = [mkRow({ slug: "a", adjs: 50 }), mkRow({ slug: "b", adjs: 51 }), mkRow({ slug: "c", adjs: 95 })];
  // Pool per metric is the three row values; adjs pool [50, 51, 95].
  const cards = buildCards({ ranks: ranksOf(rows), nowMs: NOW });
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  // a: adjs p0 (low); b: adjs p33 (below) — same metric, different band → basis differs.
  assert.notEqual(bySlug.get("a").basis, bySlug.get("b").basis);
  assert.equal(bySlug.get("a").basis.split("|").length, CARD_METRICS.length + 1);
  assert.ok(bySlug.get("a").basis.endsWith("|active"));
  assert.equal(bySlug.get("c").metrics.adjs.band, "mid"); // pool [50, 51, 95]: 95 → p66
});

test("chunk order: active-30d first, then rest, then grave; iVi desc inside groups", () => {
  const rows = [
    mkRow({ slug: "grave-high", adjs: 999, last: s(NOW - 400 * DAY * 1000) }),
    mkRow({ slug: "rest-high", adjs: 900, last: s(NOW - 100 * DAY * 1000) }),
    mkRow({ slug: "recent-low", adjs: 100, last: s(NOW - 5 * DAY * 1000) }),
    mkRow({ slug: "recent-high", adjs: 800, last: s(NOW - 5 * DAY * 1000) }),
  ];
  const cards = buildCards({ ranks: ranksOf(rows), nowMs: NOW });
  assert.deepEqual(cards.map((c) => c.slug), ["recent-high", "recent-low", "rest-high", "grave-high"]);
});

test("findStale flags basis drift, ineligible and not-ranked legends", () => {
  const rows = [mkRow({ slug: "a" }), mkRow({ slug: "b", thin: 1 })];
  const cards = buildCards({ ranks: ranksOf(rows), nowMs: NOW });
  const a = cards.find((c) => c.slug === "a");
  const legends = new Map([
    ["a", { text: "x", basis: a.basis, at: "2026-10-15" }],
    ["a2", { text: "x", basis: "old|basis", at: "2026-10-15" }],
    ["b", { text: "x", basis: "whatever", at: "2026-10-15" }],
    ["ghost", { text: "x", basis: "whatever", at: "2026-10-15" }],
  ]);
  // a2 is not a real card: build a matching card for it via a second pass.
  const cards2 = [...cards, { ...a, slug: "a2", basis: "new|basis" }];
  const stale = findStale(cards2, legends);
  assert.deepEqual(stale.map((x) => [x.slug, x.status]), [
    ["a2", "stale"],
    ["b", "ineligible"],
    ["ghost", "not-ranked"],
  ]);
});

test("remainingCards drops slugs already stored in shards", () => {
  const cards = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  const legends = new Map([["a", { text: "x" }], ["c", { text: "y" }]]);
  assert.deepEqual(remainingCards(cards, legends).map((c) => c.slug), ["b"]);
  assert.deepEqual(remainingCards(cards, new Map()).map((c) => c.slug), ["a", "b", "c"]);
});

test("shardFileFor uses the slug's first char", () => {
  assert.equal(shardFileFor("bhorn"), "b.json");
  assert.equal(shardFileFor("4ua"), "4.json");
  assert.equal(shardFileFor("Zyr0sNCx"), "z.json");
});

test("buildCard exposes tenure + legacy sample for writers", () => {
  const rows = [mkRow({ slug: "a", top: 50, created: s(NOW - 10 * DAY * 1000) })];
  const card = buildCard(Object.fromEntries(COLS.map((c, i) => [c, rows[0][i]])), { pools: poolsOf(rows), padders: new Set(), notes: { players: {} }, nowMs: NOW });
  assert.equal(card.legacySample, true);
  assert.equal(card.top, 50);
  assert.equal(card.tenure.state, "new");
  assert.equal(card.tenure.flair, "👶");
});
