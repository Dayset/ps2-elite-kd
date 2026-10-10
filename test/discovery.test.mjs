// t291u: Census login sweep + fight filter, queue order, cap steps, refresh tiers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  refreshIntervalMs, tierName, weekFights, prefilter, sweepRow, rankQueue, mergeQueue, nextCap,
  normalizeDiscovery, sweepDue, sweepSlice, MIN_WEEK_FIGHTS, CAP_STEPS, DAY_MS, QUEUE_KEEP_MS,
} from "../scripts/discovery.mjs";
import { sizeWarning, SIZE_WARN_BYTES, HONU_DAILY_CAP } from "../scripts/refresh-cache.mjs";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const NOW_S = NOW / 1000;

describe("refresh tiers", () => {
  it("weekly / 2 weeks / monthly / never (🪦 > 1 year); unknown = weekly", () => {
    assert.equal(refreshIntervalMs(NOW - 2 * DAY_MS, NOW), 7 * DAY_MS);
    assert.equal(refreshIntervalMs(NOW - 20 * DAY_MS, NOW), 14 * DAY_MS);
    assert.equal(refreshIntervalMs(NOW - 200 * DAY_MS, NOW), 30 * DAY_MS);
    assert.equal(refreshIntervalMs(NOW - 400 * DAY_MS, NOW), Infinity);
    assert.equal(refreshIntervalMs(0, NOW), 7 * DAY_MS);
    assert.equal(tierName(NOW - 400 * DAY_MS, NOW), "never");
  });
});

describe("fight filter + queue", () => {
  it("week fights = kills + deaths in d01..d07", () => {
    const day = (v) => Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`d${String(i + 1).padStart(2, "0")}`, String(v)]));
    const m = weekFights([
      { character_id: "1", stat_name: "kills", day: day(10) },
      { character_id: "1", stat_name: "deaths", day: day(5) },
      { character_id: "2", stat_name: "time", day: day(999) },
    ]);
    assert.equal(m.get("1"), 105);
    assert.equal(m.has("2"), false);
  });
  it("prefilter skips cached, failed, low-playtime and duplicate rows", () => {
    const r = (cid, name, minutes) => ({ cid, name, slug: name.toLowerCase(), minutes, created: 0, last: 0 });
    const out = prefilter([r("1", "Cached", 900), r("2", "Bad", 900), r("3", "Fresh", 5), r("4", "Ok", 60), r("4", "Ok", 60)],
      new Set(["cached"]), (s) => s === "bad");
    assert.deepEqual(out.map((x) => x.name), ["Ok"]);
  });
  it("sweepRow drops odd names / ids", () => {
    assert.equal(sweepRow({ character_id: "5428", name: { first: "x" } }), null);
    assert.equal(sweepRow({ character_id: "5428010618014152561", name: { first: "bad name" } }), null);
    assert.equal(sweepRow({ character_id: "5428010618014152561", name: { first: "Good" }, times: { creation: "5", last_login: "7", minutes_played: "60" } }).slug, "good");
  });
  it("new accounts that play first, then most fights; merge dedupes, drops cached and expired", () => {
    const newC = NOW_S - 10 * 86400, oldC = NOW_S - 3000 * 86400;
    const q = rankQueue([
      { cid: "a", name: "Vet", fights: 900, created: oldC },
      { cid: "b", name: "Newbie", fights: 120, created: newC },
      { cid: "c", name: "Mid", fights: 300, created: oldC },
    ], NOW);
    assert.deepEqual(q.map((x) => x.name), ["Newbie", "Vet", "Mid"]);
    const merged = mergeQueue(
      [{ cid: "a", name: "Vet", fights: 900, created: oldC, seen: NOW }, { cid: "x", name: "Stale", fights: 500, seen: NOW - QUEUE_KEEP_MS - 1 }, { cid: "k", name: "Known", seen: NOW }],
      [{ cid: "a", name: "Vet", slug: "vet", fights: 950, created: oldC }],
      new Set(["known"]), NOW);
    assert.deepEqual(merged.map((x) => [x.name, x.fights]), [["Vet", 950]]);
  });
});

describe("cap steps", () => {
  it("3000 until caught up (index at step, no sync backlog, due fits one run), then next step up to 12000; never above", () => {
    assert.deepEqual(CAP_STEPS, [3000, 6000, 9000, 12000]);
    assert.equal(nextCap({ cap: 3000, indexSize: 2000 }), 3000);
    assert.equal(nextCap({ cap: 3000, indexSize: 3000, backlogLeft: 5 }), 3000);
    assert.equal(nextCap({ cap: 3000, indexSize: 3000, dueLeft: 200 }), 3000);
    assert.equal(nextCap({ cap: 3000, indexSize: 3001, dueLeft: 10 }), 6000);
    assert.equal(nextCap({ cap: 6000, indexSize: 5999 }), 6000);
    assert.equal(nextCap({ cap: 6000, indexSize: 6000, backlogLeft: 1 }), 6000);
    assert.equal(nextCap({ cap: 6000, indexSize: 6000 }), 9000);
    assert.equal(nextCap({ cap: 9000, indexSize: 9000, dueLeft: 100 }), 9000);
    assert.equal(nextCap({ cap: 9000, indexSize: 9000 }), 12000);
    assert.equal(nextCap({ cap: 12000, indexSize: 13000 }), 12000);
    assert.equal(nextCap({ cap: 0 }), 3000);
  });
});

describe("sweepSlice (fake Census)", () => {
  const BASE = "https://census/x/get/ps2:v2/";
  const chars = Array.from({ length: 1500 }, (_, i) => ({
    character_id: String(5428000000000000000n + BigInt(i)),
    name: { first: `P${i}` },
    times: { creation: String(NOW_S - (i % 2 ? 10 : 2000) * 86400), last_login: String(NOW_S - 86400 + i), minutes_played: "500" },
  }));
  const fights = (cid) => (Number(BigInt(cid) % 3n) === 0 ? 150 : 20); // every 3rd plays enough
  function fake() {
    const calls = [];
    const getJson = async (url) => {
      calls.push(url);
      if (url.includes("character?")) {
        const from = +/last_login=%5D(\d+)/.exec(url)[1];
        const lim = +/c:limit=(\d+)/.exec(url)[1];
        return { character_list: chars.filter((c) => +c.times.last_login >= from).slice(0, lim) };
      }
      const ids = /character_id=([\d,]+)/.exec(url)[1].split(",");
      return { characters_stat_history_list: ids.flatMap((id) => [
        { character_id: id, stat_name: "kills", day: { d01: String(fights(id)) } },
        { character_id: id, stat_name: "deaths", day: { d02: "0" } },
      ]) };
    };
    return { calls, getJson };
  }
  it("pages by last_login, checks fights in batches of 100, queues players with >= 100 fights, finishes", async () => {
    const d = normalizeDiscovery(null, NOW);
    assert.equal(sweepDue(d, NOW), true);
    const { calls, getJson } = fake();
    const seenCached = [];
    const out = await sweepSlice(d, { base: BASE, getJson, known: new Set(["p0"]), until: Date.now() + 60e3, now: NOW, onCached: (s) => seenCached.push(s) });
    assert.equal(out.done, true);
    assert.deepEqual(seenCached, ["p0"]);
    assert.equal(out.swept, 1500);
    assert.equal(out.checked, 1499);
    assert.equal(calls.filter((u) => u.includes("character?")).length, 2);
    assert.equal(calls.filter((u) => u.includes("stat_history")).length, 15);
    const want = chars.filter((c, i) => i !== 0 && fights(c.character_id) >= MIN_WEEK_FIGHTS).length;
    assert.equal(out.qualified, want);
    assert.equal(d.queue.length, want);
    // New accounts (odd i = created 10 days ago) come first.
    const firstOld = d.queue.findIndex((q) => +q.created < NOW_S - 1000 * 86400);
    assert.ok(d.queue.slice(0, firstOld).every((q) => +q.created > NOW_S - 100 * 86400));
    assert.equal(d.sweep.cursor, null);
    assert.ok(d.sweep.lastDoneAt);
    assert.equal(sweepDue(d, Date.now() + 1000), false);
  });
  it("resumes from its cursor when the time slice ends", async () => {
    const d = normalizeDiscovery(null, NOW);
    const { getJson } = fake();
    const a = await sweepSlice(d, { base: BASE, getJson, known: new Set(), until: 0, now: NOW });
    assert.equal(a.done, false);
    assert.equal(a.swept, 1000);
    assert.ok(d.sweep.cursor != null);
    const b = await sweepSlice(d, { base: BASE, getJson, known: new Set(), until: Date.now() + 60e3, now: NOW });
    assert.equal(b.done, true);
    assert.equal(a.swept + b.swept, 1500); // no row twice, none skipped
  });
});

describe("size warning + Honu cap", () => {
  it("warns at 700 MB (repo history or data), well before GitHub's 1 GB", () => {
    assert.equal(SIZE_WARN_BYTES, 700 * 1024 * 1024);
    assert.equal(sizeWarning({ repoBytes: 9e6, dataBytes: 14e6 }), false);
    assert.equal(sizeWarning({ repoBytes: SIZE_WARN_BYTES, dataBytes: 0 }), true);
    assert.equal(sizeWarning({ repoBytes: null, dataBytes: SIZE_WARN_BYTES + 1 }), true);
  });
  it("Honu daily cap default 1000", () => {
    assert.equal(HONU_DAILY_CAP, 1000);
  });
});
