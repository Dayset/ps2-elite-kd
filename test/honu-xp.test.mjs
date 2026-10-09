import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateXp, pickXpSessions, mergeXp, updateHonuXp, xpWindows, compactExpTypes } from "../scripts/honu-xp.mjs";
import { mergeRequested, requestedXpQueue, XP_RECHECK_MS, REQUESTED_TTL_MS } from "../scripts/refresh-cache.mjs";

const CID = "5429845372577334929";
const ev = (experienceID, amount, sourceID, otherID = "0") => ({ experienceID, amount, sourceID, otherID });

describe("honu-xp aggregation", () => {
  it("counts + sums per experience ID; earned vs received (self events not double counted)", () => {
    const block = { events: [ev(1, 100, CID, "9"), ev(1, 100, CID, "8"), ev(336, 25, CID, "7"), ev(7, 75, "9", CID), ev(1, 100, "9", CID), ev(4, 10, CID, CID)] };
    assert.deepEqual(aggregateXp(block, CID, "g"), { 1: [2, 200], 336: [1, 25], 4: [1, 10] });
    assert.deepEqual(aggregateXp(block, CID, "r"), { 7: [1, 75], 1: [1, 100] });
    assert.deepEqual(aggregateXp(null, CID, "g"), {});
  });
  it("picks finished kill-ful uncounted sessions newest first, capped", () => {
    const s = (id, d, kills = 5, end = true) => ({ id, start: `2026-10-0${d}T00:00:00Z`, end: end ? `2026-10-0${d}T01:00:00Z` : null, kills });
    const list = [s(1, 1), s(2, 2), s(3, 3, 0), s(4, 4, 5, false), s(5, 5), s(6, 6)];
    assert.deepEqual(pickXpSessions(list, ["6"], 2).map((x) => x.id), [5, 2]);
  });
  it("windows are <= 24 h", () => {
    assert.equal(xpWindows("2026-10-01T00:00:00Z", "2026-10-03T01:00:00Z").length, 3);
  });
  it("merge keeps running totals while pruning per-session detail", () => {
    const t = Date.parse("2026-10-01T00:00:00Z");
    const mk = (id, i) => ({ id, s: t + i * 864e5, sec: 3600, k: 10, g: { 1: [10, 1000] }, r: { 7: [1, 75] } });
    let x = mergeXp(null, [mk(1, 0), mk(2, 1)], { keep: 1 });
    x = mergeXp(x, [mk(3, 2), mk(2, 1)], { keep: 1 }); // 2 already counted: ignored
    assert.equal(x.sessions_counted, 3);
    assert.deepEqual(x.totals.g, { 1: [30, 3000] });
    assert.deepEqual(x.totals.r, { 7: [3, 225] });
    assert.deepEqual(Object.keys(x.sessions), ["3"]);
    assert.deepEqual(x.counted, ["3", "2", "1"]);
    assert.equal(x.seconds_counted, 3 * 3600);
    assert.equal(x.first, "2026-10-01T00:00:00.000Z");
  });
  it("updateHonuXp: sessions list + 2 calls per window, respects the shared budget, never throws", async () => {
    const urls = [];
    const getJson = async (u) => {
      urls.push(u);
      if (u.endsWith("/sessions")) {
        return [
          { id: 11, start: "2026-10-06T02:00:00Z", end: "2026-10-06T03:00:00Z", kills: 3 },
          { id: 12, start: "2026-10-05T02:00:00Z", end: "2026-10-05T03:00:00Z", kills: 3 },
        ];
      }
      if (u.includes("/characters/other?")) return { events: [ev(336, 50, "9", CID)] };
      return { events: [ev(335, 50, CID, "9"), ev(2, 60, CID, "8")] };
    };
    const budget = { calls: 4 }; // list + one session (2) fits, second session doesn't
    const { xp, calls } = await updateHonuXp(CID, null, { getJson, budget });
    assert.equal(calls, 3);
    assert.equal(budget.calls, 1);
    assert.match(urls[1], /\/api\/exp\/\d+\/period2\?start=.*includeCharacters=false/);
    assert.doesNotMatch(urls[1], /interestedEvents/);
    assert.match(urls[2], /\/api\/exp\/characters\/other\?charIDs=\d+&start=/);
    assert.deepEqual(xp.totals.g, { 335: [1, 50], 2: [1, 60] });
    assert.deepEqual(xp.totals.r, { 336: [1, 50] });
    const again = await updateHonuXp(CID, xp, { getJson, budget: { calls: 10 } });
    assert.equal(again.xp.sessions_counted, 2);
    const boom = await updateHonuXp(CID, xp, { getJson: async () => { throw new Error("429"); } });
    assert.equal(boom.xp, xp);
    assert.equal((await updateHonuXp(CID, null, { getJson, budget: { calls: 2 } })).calls, 0);
  });
  it("compacts exp types", () => {
    assert.deepEqual(compactExpTypes([{ id: 336, name: "Saved", amount: 25, awardTypeID: 1 }]), { 336: ["Saved", 25] });
  });
});

describe("requested players", () => {
  const NOW = Date.parse("2026-10-09T00:00:00Z");
  const idx = new Set(["justv6me", "shlodog", "old"]);
  it("merges file, Worker list and on-demand names; drops unknown and stale", () => {
    const r = mergeRequested({ old: NOW - REQUESTED_TTL_MS - 1, shlodog: NOW - 1000 }, [{ slug: "justv6me", at: NOW - 5 }, { slug: "nobody", at: NOW }], ["shlodog"], idx, NOW);
    assert.deepEqual(r, { shlodog: NOW, justv6me: NOW - 5 });
  });
  it("queue: most recently requested first, skips recently checked", () => {
    const q = requestedXpQueue({ a: NOW - 10, b: NOW - 5, c: NOW - 1 }, { c: NOW - 1000 }, NOW);
    assert.deepEqual(q, ["b", "a"]);
    assert.deepEqual(requestedXpQueue({ c: NOW }, { c: NOW - XP_RECHECK_MS - 1 }, NOW), ["c"]);
  });
});
