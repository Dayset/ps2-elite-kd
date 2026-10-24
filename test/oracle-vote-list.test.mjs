// "All my votes" list (oracle/js/vote.js voteListHtml): when, alert, vote, odds then, result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { voteListHtml } from "../oracle/js/vote.js";

test("every vote is listed with its moment, odds and result", () => {
  const h = voteListHtml([
    { key: "10-4-46377", outcome: "TR", amount: 50, potential: 120, pct: 45.4, progress: 0.26, placed_ts: 1792794080, status: "open", reward: 0 },
    { key: "10-6-46374", outcome: "VS", amount: 25, potential: 80, pct: 30, progress: 0.5, placed_ts: 1792780000, status: "lost", reward: 0 },
    { key: "1-2-49351", outcome: "VS", amount: 100, potential: 210, pct: 48, progress: 0.1, placed_ts: 1792700000, status: "won", reward: 210 },
  ]);
  assert.equal((h.match(/<tr class=/g) || []).length, 3);
  assert.match(h, /Wainwright · Hossin/);
  assert.match(h, /26% into the alert/);
  assert.match(h, /45\.4%/);
  assert.match(h, /open · 120 if right/);
  assert.match(h, /wrong · −25/);
  assert.match(h, /right · \+110/);
  assert.match(voteListHtml([]), /No votes yet/);
});
