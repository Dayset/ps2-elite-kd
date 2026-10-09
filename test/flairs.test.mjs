import test from "node:test";
import assert from "node:assert/strict";
import { accountTimes, cleanTimes, flairsFor, flairsHtml, monthYear, YEAR_MS, FLAIR_RULES } from "../flairs.mjs";
import { normalizePlayer } from "../player-metrics.mjs";
import { withTimes } from "../scripts/backfill-times.mjs";

const NOW = Date.UTC(2026, 9, 9);
const s = (ms) => Math.floor(ms / 1000);

test("accountTimes reads Census times (last = max(last_save, last_login))", () => {
  const t = accountTimes({ times: { creation: "1398444038", last_save: "1398444230", last_login: "1398444043" } });
  assert.deepEqual(t, { created: 1398444038, last: 1398444230 });
  assert.equal(accountTimes({}), null);
  assert.equal(accountTimes({ times: { creation: "0" } }), null);
});

test("🪦 inactive: last activity over a year ago (xMasterBobx, Apr 2014)", () => {
  const f = flairsFor({ created: 1398444038, last: 1398444230 }, NOW);
  assert.deepEqual(f.map((x) => x.emoji), ["🪦"]);
  assert.match(f[0].tip, /Last played Apr 2014|last played Apr 2014/);
  assert.match(f[0].tip, /just for fun/);
});

test("👴🏽 veteran: 3+ years old and active within a year", () => {
  const f = flairsFor({ created: s(NOW - 5 * YEAR_MS), last: s(NOW - 10 * 86400000) }, NOW);
  assert.deepEqual(f.map((x) => x.id), ["veteran"]);
  assert.match(f[0].tip, /5\+ years/);
});

test("boundaries: young active account and 3y-minus-a-day get nothing", () => {
  assert.deepEqual(flairsFor({ created: s(NOW - YEAR_MS), last: s(NOW - 1000) }, NOW), []);
  assert.deepEqual(flairsFor({ created: s(NOW - 3 * YEAR_MS + 86400000), last: s(NOW) }, NOW), []);
  assert.equal(flairsFor({ created: s(NOW - 3 * YEAR_MS), last: s(NOW) }, NOW)[0].id, "veteran");
  assert.deepEqual(flairsFor({ created: s(NOW - 9 * YEAR_MS), last: s(NOW - YEAR_MS) }, NOW).map((x) => x.id), ["veteran"]);
  assert.deepEqual(flairsFor({ created: s(NOW - 9 * YEAR_MS), last: s(NOW - YEAR_MS - 1000) }, NOW).map((x) => x.id), ["inactive"]);
});

test("no date data → no flair; html escapes and is empty when none", () => {
  assert.deepEqual(flairsFor(null, NOW), []);
  assert.deepEqual(flairsFor({}, NOW), []);
  assert.equal(flairsHtml(null, NOW), "");
  assert.match(flairsHtml({ created: 1398444038, last: 1398444230 }, NOW), /class="flair flair-inactive" title="[^"]+"[^>]*>🪦<\/span>/);
});

test("rules list is extensible (each rule has id / emoji / test)", () => {
  for (const r of FLAIR_RULES) assert.ok(r.id && r.emoji && typeof r.test === "function");
  assert.equal(monthYear(1398444038), "Apr 2014");
  assert.equal(cleanTimes({ created: "5", last: null }).created, 5);
});

test("normalizePlayer keeps times; backfill only sets player.times", () => {
  const raw = { query: "x", top: 50, player: { display: "x", cid: "1", rows: [], curve: [] } };
  assert.equal(normalizePlayer(raw).times, null);
  const next = withTimes(raw, { created: 1, last: 2 });
  assert.deepEqual(normalizePlayer(next).times, { created: 1, last: 2 });
  assert.equal(next.query, "x");
  assert.equal(withTimes(raw, null), raw);
});
