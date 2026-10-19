import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { nextBgFetch, liveRowFromPlayer, LIVE_COLS } from "../live.mjs";

test("nextBgFetch: newest first, still in the feed, never twice (#32)", () => {
  const rows = [{ opp: "b" }, { opp: "c" }];
  assert.equal(nextBgFetch(["a", "b", "c"], rows, new Set()), "b"); // a left the feed
  assert.equal(nextBgFetch(["b", "c"], rows, new Set(["b"])), "c");
  assert.equal(nextBgFetch(["b"], rows, new Set(["b"])), null);
  assert.equal(nextBgFetch([], rows, new Set()), null);
});

test("liveRowFromPlayer: same LIVE_COLS numbers as the cache, Assists null (#32)", () => {
  const raw = JSON.parse(fs.readFileSync(new URL("../data/players/000047.json", import.meta.url), "utf8"));
  const row = liveRowFromPlayer(raw.player || raw, "x");
  assert.equal(row.name, "x");
  for (const c of LIVE_COLS) assert.ok(c.id in row, c.id);
  assert.equal(row.apk, null);
  assert.equal(typeof row.rkd, "number");
});

import { shareDelay, SHARE_EVERY_MS } from "../live.mjs";
test("shareDelay: one /add a minute, full batch of 10 goes as soon as allowed (#33)", () => {
  assert.equal(shareDelay(1000, null, 1000, 0), null);
  assert.equal(shareDelay(1000, null, 1000, 1), SHARE_EVERY_MS); // partial batch waits a minute to collect
  assert.equal(shareDelay(5000, null, 1000, 10), 0); // full batch, nothing sent yet
  assert.equal(shareDelay(5000, 1000, 2000, 10), SHARE_EVERY_MS - 4000); // full, but sent 4 s ago
  assert.equal(shareDelay(100000, 1000, 2000, 2), 0); // window passed
});
