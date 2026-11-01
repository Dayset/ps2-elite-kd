import test from "node:test";
import assert from "node:assert/strict";
import { forensicsStatus, RANK_COLS } from "../scripts/build-ranks.mjs";

// Owner-dismissed players (reviewed.json outlier:dismissed) leave 🔎 session forensics entirely:
// no candidate slot, no players row — not even as a hide-list reference (owner 2026-11-01, anniversay).
function mkPlayer(slug, { hidden = false, confirmedCheater = false, adjs = 500 } = {}) {
  const row = new Array(RANK_COLS.length).fill(null);
  row[RANK_COLS.indexOf("adjs")] = adjs;
  row[RANK_COLS.indexOf("created")] = 1500000000;
  row[RANK_COLS.indexOf("ownKpm")] = 0.5;
  return {
    slug, name: slug, hidden, confirmedCheater, patterns: [], values: {},
    forensics: { flagged: 0, odd: 0, analyzed: 1, worst: { sessionId: 1, kills: 10, deaths: 5, kd: 2 } },
    row,
  };
}

const players = [
  mkPlayer("anniversay", { hidden: true, confirmedCheater: true }),
  mkPlayer("hiddenref", { hidden: true, confirmedCheater: true }),
  mkPlayer("normalguy"),
];
const store = { players: { anniversay: { checkedAt: null }, hiddenref: { checkedAt: null }, normalguy: { checkedAt: null } } };
const guard = { players: [] };

test("forensicsStatus: dismissed slug leaves candidates and players", () => {
  const s = forensicsStatus(players, guard, store, undefined, undefined, new Set(["anniversay"]));
  assert.ok(!s.candidates.includes("anniversay"));
  assert.ok(!s.players.some((r) => r.slug === "anniversay"));
  // Hide-list references still show when NOT dismissed; ordinary rows still show.
  assert.ok(s.candidates.includes("hiddenref"));
  assert.ok(s.players.some((r) => r.slug === "hiddenref"));
  assert.ok(s.players.some((r) => r.slug === "normalguy"));
});

test("forensicsStatus: without the dismissed set, a hidden cheater stays a reference", () => {
  const s = forensicsStatus(players, guard, store);
  assert.ok(s.candidates.includes("anniversay"));
  assert.ok(s.players.some((r) => r.slug === "anniversay"));
});
