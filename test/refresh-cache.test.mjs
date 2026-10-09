/**
 * Shared-cache rotation: which names the hourly Action refreshes next.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickBatch,
  isOutageError,
  NotFoundError,
  backoffMs,
  newWatchlistNames,
  isPlausibleName,
  crawlCandidates,
  mergeTopKillers,
  opponentRow,
  honuHistoryToStatHistory,
  staleCandidates,
  nextStaleAt,
  computeSchedule,
  REFRESH_RUN_GAP_MS,
  isConnectFailure,
  retryable,
  retryCandidates,
  parseTopKillers,
  formatTopKillers,
  liveCandidates,
  countAssistEvents,
  assistStatsFromBlock,
  pickNewSessions,
  dayWindows,
  mergeAssists,
  updateHonuAssists,
  viaCensusProxy,
} from "../scripts/refresh-cache.mjs";

const index = {
  players: [
    { name: "[A] Old", slug: "old", savedAt: 1000 },
    { name: "Mid", slug: "mid", savedAt: 5000 },
    { name: "New", slug: "new", savedAt: 9000 },
  ],
};

describe("pickBatch (stalest first)", () => {
  it("never-fetched names come first, then oldest savedAt", () => {
    const names = ["New", "Mid", "[A] Old", "Fresh"];
    assert.deepEqual(pickBatch(names, index, { players: {} }, 3), ["Fresh", "[A] Old", "Mid"]);
  });

  it("a recent failed attempt pushes a name to the back", () => {
    const names = ["New", "Mid", "[A] Old", "Typo"];
    const state = { players: { typo: { lastAttemptAt: 10000, fails: 3 }, old: { lastAttemptAt: 9500 } } };
    assert.deepEqual(pickBatch(names, index, state, 2), ["Mid", "New"]);
  });

  it("keeps input order on ties and respects size", () => {
    assert.deepEqual(pickBatch(["b", "a", "c"], { players: [] }, { players: {} }, 2), ["b", "a"]);
    assert.deepEqual(pickBatch(["b"], { players: [] }, { players: {} }, 0), []);
  });

  it("rotates through everyone over successive runs", () => {
    const names = ["a", "b", "c", "d", "e"];
    const idx = { players: [] };
    const state = { players: {} };
    const seen = [];
    let t = 1;
    for (let run = 0; run < 3; run++) {
      for (const n of pickBatch(names, idx, state, 2)) {
        seen.push(n);
        state.players[n] = { lastAttemptAt: t++ };
      }
    }
    assert.deepEqual(seen.slice(0, 5).sort(), names);
  });
});

describe("failure classification", () => {
  it("not-found is not an outage; network/5xx errors are", () => {
    assert.equal(isOutageError(new NotFoundError("Census: no character Xqzz")), false);
    assert.equal(isOutageError(new Error("503 Service Unavailable")), true);
    assert.equal(isOutageError(new TypeError("fetch failed")), true);
  });

  it("backoff honours Retry-After and caps", () => {
    assert.equal(backoffMs(0, "3"), 3000);
    assert.ok(backoffMs(10) <= 15_250);
    assert.ok(backoffMs(0) >= 1000);
  });
});

describe("on-demand names join the watchlist", () => {
  it("dedupes by tag-less slug against the watchlist and itself", () => {
    const existing = ["[RITE] ShloDog", "[12P] BlinderJeck"];
    assert.deepEqual(
      newWatchlistNames(existing, ["[XYZ] shlodog", "[NEW] Fresh", "Fresh", "Other"]),
      ["[NEW] Fresh", "Other"]
    );
  });

  it("rejects implausible names before hitting Census", () => {
    assert.equal(isPlausibleName("[RITE] ShloDog"), true);
    assert.equal(isPlausibleName("ShloDog"), true);
    assert.equal(isPlausibleName("bad name!"), false);
    assert.equal(isPlausibleName("x".repeat(40)), false);
    assert.equal(isPlausibleName("5428010618015189713"), true);
  });
});

describe("crawlCandidates (discovery)", () => {
  const pl = (rows) => ({ player: { rows } });
  const idx = { players: [{ name: "[A] Known", slug: "known" }] };

  it("ranks opponents seen by more cached players first, then by volume", () => {
    const payloads = [
      pl([{ name: "[X] Alpha", kills: 1, deaths: 1 }, { name: "Beta", kills: 50, deaths: 50 }, { name: "[A] Known", kills: 9, deaths: 9 }]),
      pl([{ name: "[Y] Alpha", kills: 2, deaths: 0 }, { name: "Gamma", kills: 5, deaths: 5 }]),
    ];
    assert.deepEqual(crawlCandidates(payloads, idx, { players: {} }), ["[Y] Alpha", "Beta", "Gamma"]);
  });

  it("skips unresolved ids, junk, and names that failed recently", () => {
    const now = 1_000_000_000_000;
    const payloads = [pl([{ name: "5428011263335537297" }, { name: "0" }, { name: "bad name!" }, { name: "Typo" }, { name: "Old" }])];
    const state = { players: { typo: { lastAttemptAt: now - 1000, fails: 1 }, old: { lastAttemptAt: now - 30 * 864e5, fails: 1 } } };
    assert.deepEqual(crawlCandidates(payloads, idx, state, now), ["Old"]);
  });
});

describe("live top killers list", () => {
  const T0 = Date.parse("2026-10-07T22:00:00Z");
  it("merges snapshots: seen counts once per run, best KPM kept, 7-day pruning", () => {
    const m = new Map();
    mergeTopKillers(m, [
      { name: "[KlSS] UltramaxVS", world: "Connery", kills: 150, deaths: 36, secondsOnline: 7200 },
      { name: "[KlSS] UltramaxVS", world: "Connery", kills: 150, deaths: 36, secondsOnline: 7200 },
      { name: "Shorty", world: "Miller", kills: 9, deaths: 1, secondsOnline: 300 },
    ], T0);
    mergeTopKillers(m, [{ name: "[NEW] UltramaxVS", world: "Connery", kills: 60, deaths: 30, secondsOnline: 3600 }], T0 + 600e3);
    const u = m.get("ultramaxvs");
    assert.equal(u.seen, 2);
    assert.equal(u.name, "[NEW] UltramaxVS");
    assert.equal(u.kpm.toFixed(2), "1.25");
    assert.equal(m.get("shorty").kpm, 0); // <10 min online: no KPM
    mergeTopKillers(m, [], T0 + 8 * 864e5);
    assert.equal(m.size, 0);
  });

  it("drops Honu's empty outfit tag", () => {
    const m = mergeTopKillers(new Map(), [{ name: "[] DGOZZOvs4", world: "Connery", kills: 1, deaths: 1, secondsOnline: 60 }], T0);
    assert.equal(m.get("dgozzovs4").name, "DGOZZOvs4");
  });

  it("round-trips through the text file", () => {
    const m = mergeTopKillers(new Map(), [{ name: "A1", world: "Miller", kills: 30, deaths: 3, secondsOnline: 1200 }], T0);
    const back = parseTopKillers(formatTopKillers(m));
    assert.deepEqual([...back.values()], [...m.values()].map((r) => ({ ...r, kpm: +r.kpm.toFixed(2) })));
  });

  it("candidates: not cached, not recently failed, most-seen then best KPM", () => {
    const m = new Map();
    mergeTopKillers(m, [
      { name: "Cached", kills: 99, secondsOnline: 3600 },
      { name: "Twice", kills: 10, secondsOnline: 3600 },
      { name: "HighKpm", kills: 120, secondsOnline: 3600 },
      { name: "Typo", kills: 50, secondsOnline: 3600 },
    ], T0);
    mergeTopKillers(m, [{ name: "Twice", kills: 12, secondsOnline: 3700 }], T0 + 1);
    const idx = { players: [{ name: "Cached", slug: "cached" }] };
    const state = { players: { typo: { lastAttemptAt: T0, fails: 1 } } };
    assert.deepEqual(liveCandidates(m, idx, state, T0 + 2), ["Twice", "HighKpm"]);
  });
});

describe("opponent rows and retry policy", () => {
  it("opponentRow is null-safe (Honu null/204 character, no outfit)", () => {
    const pair = { otherCharacterID: "5428", kills: 3, deaths: 1 };
    assert.deepEqual(opponentRow(pair, null, null), { name: "5428", kills: 3, deaths: 1, kpm: 0 });
    assert.deepEqual(opponentRow(pair, { name: "Bob", outfitTag: null }, { kpm: 1.5 }), { name: "Bob", kills: 3, deaths: 1, kpm: 1.5 });
    assert.equal(opponentRow(pair, { name: "Bob", outfitTag: "XYZ" }, null).name, "[XYZ] Bob");
    assert.equal(opponentRow(null, undefined, undefined).kills, 0);
  });

  const T = Date.parse("2026-10-07T23:00:00Z");
  it("never retries real not-found, retries other errors at most 3 times, 15 min apart", () => {
    assert.equal(retryable(undefined, T), true);
    assert.equal(retryable({ lastAttemptAt: T - 864e5, fails: 1, lastError: "Census: no character xx" }, T), false);
    assert.equal(retryable({ lastAttemptAt: T - 864e5, fails: 1, lastError: "Honu: empty killboard for 1" }, T), false);
    assert.equal(retryable({ lastAttemptAt: T - 864e5, fails: 1, kind: "notfound", lastError: "?" }, T), false);
    const bug = { lastAttemptAt: T - 3600e3, fails: 1, lastError: "Cannot read properties of null (reading 'outfitTag')" };
    assert.equal(retryable(bug, T), true);
    assert.equal(retryable({ ...bug, lastAttemptAt: T - 60e3 }, T), false);
    assert.equal(retryable({ ...bug, fails: 3, lastError: "The operation was aborted due to timeout" }, T), false);
  });

  it("retryCandidates: transient failures (new or cached), oldest attempt first", () => {
    const state = { players: {
      xrok32: { lastAttemptAt: T - 7200e3, fails: 1, lastOkAt: null, lastError: "Cannot read properties of null (reading 'outfitTag')" },
      shika: { lastAttemptAt: T - 7200e3, fails: 1, lastOkAt: null, lastError: "Honu: empty killboard for 5" },
      tolyano: { lastAttemptAt: T - 9000e3, fails: 1, lastOkAt: null, lastError: "The operation was aborted due to timeout" },
      okafter: { lastAttemptAt: T - 9000e3, fails: 0, lastOkAt: T - 9000e3 },
      threetimes: { lastAttemptAt: T - 9000e3, fails: 3, lastOkAt: null, lastError: "timeout" },
    } };
    assert.deepEqual(retryCandidates({ players: [{ slug: "xrok32" }] }, state, T), ["tolyano", "xrok32"]);
  });
});

describe("Honu history_stats fallback (only when Census lacks stat_history)", () => {
  it("maps Honu history_stats to Census stat_history rows", () => {
    assert.deepEqual(
      honuHistoryToStatHistory([{ type: "kills", allTime: 38716 }, { type: "deaths", allTime: 13857 }, { type: "time", allTime: 954345 }, { type: "battle_rank", allTime: 101 }]),
      [{ stat_name: "kills", all_time: "38716" }, { stat_name: "deaths", all_time: "13857" }, { stat_name: "time", all_time: "954345" }]
    );
    assert.deepEqual(honuHistoryToStatHistory(null).map((r) => r.all_time), ["0", "0", "0"]);
  });
  it("classifies connect failures (runner can't reach Census)", () => {
    assert.equal(isConnectFailure(new Error("fetch failed (UND_ERR_CONNECT_TIMEOUT) for census.daybreakgames.com")), true);
    assert.equal(isConnectFailure(new Error("503 Service Unavailable for x")), true);
    assert.equal(isConnectFailure(new Error("Census: no character x")), false);
  });
});

describe("daily refresh + schedule.json", () => {
  const H = 3600e3;
  const NOW = Date.parse("2026-10-09T12:00:00Z");
  const idx = {
    players: [
      { name: "[A] Fresh", slug: "fresh", savedAt: NOW - 2 * H },
      { name: "Old", slug: "old", savedAt: NOW - 50 * H },
      { name: "Never", slug: "never", savedAt: null },
      { name: "Tried", slug: "tried", savedAt: NOW - 40 * H },
    ],
  };
  const st = { players: { tried: { lastAttemptAt: NOW - 1 * H, fails: 1 } } };
  it("stale = saved/tried > 24 h ago, oldest first (never-saved first)", () => {
    assert.deepEqual(staleCandidates(idx, st, NOW), ["Never", "Old"]);
  });
  it("nextStaleAt = earliest last-touch + 24 h", () => {
    const fresh = { players: [idx.players[0], idx.players[3]] };
    assert.equal(nextStaleAt(fresh, st), NOW - 2 * H + 24 * H);
    assert.equal(nextStaleAt({ players: [] }, st), null);
  });
  it("computeSchedule: growth now, stale in ~1 h, else next stale time (deterministic), else idle", () => {
    assert.deepEqual(computeSchedule({ growthLeft: true, now: NOW }), { nextDueAt: new Date(NOW).toISOString(), reason: "growth" });
    assert.equal(computeSchedule({ staleLeft: 5, now: NOW }).nextDueAt, new Date(NOW + REFRESH_RUN_GAP_MS).toISOString());
    const a = computeSchedule({ nextStaleAt: NOW + 5 * H, now: NOW });
    const b = computeSchedule({ nextStaleAt: NOW + 5 * H, now: NOW + 600e3 });
    assert.deepEqual(a, b); // idle runs produce the same file -> no commit
    assert.deepEqual(computeSchedule({ now: NOW }), { nextDueAt: null, reason: "idle" });
    assert.equal(computeSchedule({ growthLeft: true, outageStop: true, now: NOW }).nextDueAt, new Date(NOW + 30 * 60e3).toISOString());
  });
});

describe("assists from Honu exp events", () => {
  const CID = "5429845372577334929";
  const sess = (id, start, end, kills) => ({ id, start, end, kills });
  it("counts only IsAssist exp ids earned by the player", () => {
    const ev = (experienceID, sourceID = CID) => ({ experienceID, sourceID });
    assert.equal(countAssistEvents({ events: [ev(2), ev(3), ev(371), ev(372), ev(1), ev(4), ev(2, "999")] }, CID), 4);
    assert.equal(countAssistEvents(null, CID), 0);
  });
  it("damage share = amount / scoreMult / base, multiplier from kill XP (Honu's method)", () => {
    const ev = (experienceID, amount, sourceID = CID) => ({ experienceID, amount, sourceID });
    const plain = assistStatsFromBlock({ events: [ev(1, 100), ev(278, 150), ev(2, 50), ev(371, 75), ev(372, 300), ev(3, 40), ev(2, 90, "999")] }, CID);
    assert.equal(plain.mult, 1);
    assert.equal(plain.assists, 4); // spawn assist counted, other player's ignored
    assert.equal(plain.shareN, 3); // spawn assist has no damage share
    assert.equal(plain.shareSum, 0.5 + 0.5 + 1);
    // Double XP: kills give 200 -> mult 2, assist 100 XP = 50%.
    const dbl = assistStatsFromBlock({ events: [ev(1, 200), ev(1, 200), ev(2, 100)] }, CID);
    assert.equal(dbl.mult, 2);
    assert.equal(dbl.shareSum, 0.5);
    // No kill events: mult 1; an impossible >100% share is halved (Honu heuristic) and capped.
    const odd = assistStatsFromBlock({ events: [ev(2, 160), ev(2, 500)] }, CID);
    assert.equal(odd.shareSum, 0.8 + 1);
  });
  it("picks finished, kill-ful, uncounted sessions newest first, capped", () => {
    const list = [
      sess(1, "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", 5),
      sess(2, "2026-10-02T00:00:00Z", "2026-10-02T01:00:00Z", 0), // no kills
      sess(3, "2026-10-03T00:00:00Z", null, 9), // still online
      sess(4, "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", 7),
      sess(5, "2026-10-05T00:00:00Z", "2026-10-05T01:00:00Z", 3), // already counted
      sess(6, "2026-10-06T00:00:00Z", "2026-10-06T01:00:00Z", 1),
      sess(7, "2026-10-07T00:00:00Z", "2026-10-07T01:00:00Z", 2),
    ];
    assert.deepEqual(pickNewSessions(list, { 5: [1, 3, 3600, 0] }, 3).map((x) => x.id), [7, 6, 4]);
    assert.deepEqual(pickNewSessions(null, {}), []);
  });
  it("splits long sessions into <= 24 h windows", () => {
    assert.deepEqual(dayWindows("2026-10-01T00:00:00Z", "2026-10-02T06:00:00Z"), [
      ["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"],
      ["2026-10-02T00:00:00.000Z", "2026-10-02T06:00:00.000Z"],
    ]);
  });
  it("merges incrementally, recomputes totals and prunes oldest", () => {
    const t = Date.parse("2026-10-01T00:00:00Z");
    const a1 = mergeAssists(null, [{ id: 1, assists: 10, kills: 20, seconds: 3600, startMs: t }]);
    const a2 = mergeAssists(a1, [{ id: 2, assists: 5, kills: 5, seconds: 1800, startMs: t + 86400000 }]);
    assert.equal(a2.total, 15);
    assert.equal(a2.kills_counted, 25);
    assert.equal(a2.seconds_counted, 5400);
    assert.equal(a2.sessions_counted, 2);
    assert.equal(a2.first, "2026-10-01T00:00:00.000Z");
    assert.equal(a2.last, "2026-10-02T00:30:00.000Z");
    assert.equal(a2.source, "honu-exp");
    assert.equal(a2.assist_count, 15);
    const a3 = mergeAssists(null, [{ id: 9, assists: 4, kills: 2, seconds: 60, startMs: t, shareSum: 1.5, shareN: 3, mult: 1 }]);
    assert.equal(a3.assist_share_sum, 1.5);
    assert.equal(a3.assist_share_n, 3);
    assert.equal(a3.avg_share, 0.5);
    const pruned = mergeAssists(a2, [], { maxKept: 1 });
    assert.deepEqual(Object.keys(pruned.sessions), ["2"]);
    assert.equal(pruned.total, 5);
    assert.equal(mergeAssists(null, []), null);
  });
  it("updateHonuAssists: 1 list call + <= cap exp calls, only new sessions, never throws", async () => {
    const urls = [];
    const list = [
      sess(11, "2026-10-06T02:46:32Z", "2026-10-06T06:20:43Z", 199),
      sess(12, "2026-10-05T00:00:00Z", "2026-10-05T01:00:00Z", 3),
      sess(13, "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", 3),
    ];
    const getJson = async (u) => {
      urls.push(u);
      if (u.endsWith("/sessions")) return list;
      return { events: [{ experienceID: 2, amount: 50, sourceID: CID }, { experienceID: 372, amount: 150, sourceID: CID }] };
    };
    const a = await updateHonuAssists(CID, null, { getJson, cap: 2 });
    assert.equal(urls.length, 3);
    assert.match(urls[0], /^https:\/\/wt\.honu\.pw\/api\/character\/\d+\/sessions$/);
    assert.match(urls[1], /\/api\/exp\/\d+\/period2\?start=.*interestedEvents=2&interestedEvents=3&interestedEvents=371&interestedEvents=372/);
    assert.deepEqual(Object.keys(a.sessions).sort(), ["11", "12"]);
    assert.equal(a.total, 4);
    assert.equal(a.assist_share_sum, 2); // 2 sessions x (0.5 + 0.5)
    assert.equal(a.avg_share, 0.5);
    assert.match(urls[1], /interestedEvents=1&interestedEvents=278&interestedEvents=279/);
    urls.length = 0;
    const b = await updateHonuAssists(CID, a, { getJson, cap: 2 });
    assert.equal(urls.length, 2); // list + the one remaining session
    assert.equal(b.sessions_counted, 3);
    // Errors keep the previous record (or leave the field absent).
    const boom = async () => { throw new Error("429"); };
    assert.equal(await updateHonuAssists(CID, b, { getJson: boom }), b);
    assert.equal(await updateHonuAssists(CID, null, { getJson: boom }), null);
    assert.equal(await updateHonuAssists("bad", null, { getJson: boom }), null);
  });
});

describe("Census proxy routing", () => {
  it("rewrites only Census URLs when a proxy is set", () => {
    const u = "https://census.daybreakgames.com/s:daysetps2legends/get/ps2:v2/character?name.first_lower=a";
    assert.equal(viaCensusProxy(u, ""), u);
    assert.equal(viaCensusProxy(u, "https://w.example.dev"), "https://w.example.dev/census/s:daysetps2legends/get/ps2:v2/character?name.first_lower=a");
    assert.equal(viaCensusProxy("https://wt.honu.pw/api/x", "https://w.example.dev"), "https://wt.honu.pw/api/x");
    assert.equal(viaCensusProxy("https://census.daybreakgames.com.evil.example/x", "https://w.example.dev"), "https://census.daybreakgames.com.evil.example/x");
  });
});
