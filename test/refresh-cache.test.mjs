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
