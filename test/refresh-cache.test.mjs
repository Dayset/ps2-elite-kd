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
  retryable,
  retryCandidates,
  parseTopKillers,
  formatTopKillers,
  liveCandidates,
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
