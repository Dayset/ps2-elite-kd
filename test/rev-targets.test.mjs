// 🪦 Reverse favourite targets (rev-targets.mjs): who has a player as their
// favourite target, per crowdSummary's target rule (max-kills winning row).
import test from "node:test";
import assert from "node:assert/strict";
import { buildRevTargets } from "../rev-targets.mjs";

test("inverts favourite targets: one hunter per target, most kills wins", () => {
  const players = [
    { display: "Me", rows: [{ name: "Alpha", kills: 10, deaths: 2 }, { name: "Bravo", kills: 1, deaths: 9 }] },
    { display: "[T] Alpha", rows: [{ name: "Me", kills: 5, deaths: 3 }] },
    { display: "Bravo", rows: [{ name: "Me", kills: 8, deaths: 0 }] },
  ];
  const rev = buildRevTargets(players);
  // Me's target is Alpha (10 kills); Alpha's and Bravo's target is Me — Bravo
  // killed Me more (8 vs 5), so Bravo is Me's reverse target.
  assert.deepEqual(rev.alpha, ["Me", 10, 2]);
  assert.deepEqual(rev.me, ["Bravo", 8, 0]);
  assert.equal(rev.bravo, undefined);
});

test("ties: fewer deaths wins; unknown-opponent rows never count", () => {
  const players = [
    { display: "HunterA", rows: [{ name: "0", kills: 999, deaths: 0 }, { name: "Prey", kills: 10, deaths: 4 }] },
    { display: "HunterB", rows: [{ name: "Prey", kills: 10, deaths: 1 }] },
    { display: "Loser", rows: [{ name: "Prey", kills: 2, deaths: 9 }] },
  ];
  const rev = buildRevTargets(players);
  assert.deepEqual(rev.prey, ["HunterB", 10, 1], "equal kills: fewer deaths wins; the 999-kill \"0\" row is ignored; Loser has no winning row");
});

test("ladder: 7 is the usual bar; a lonely target falls back to 2, never 1", () => {
  const players = [
    { display: "Seven", rows: [{ name: "Prey", kills: 7, deaths: 6 }] },
    { display: "Six", rows: [{ name: "Solo", kills: 6, deaths: 0 }] },
    { display: "Four", rows: [{ name: "Mid", kills: 4, deaths: 1 }] },
    { display: "Two", rows: [{ name: "Pair", kills: 2, deaths: 0 }] },
    { display: "One", rows: [{ name: "Single", kills: 1, deaths: 0 }] },
  ];
  const rev = buildRevTargets(players);
  assert.deepEqual(rev.prey, ["Seven", 7, 6], "usual bar: a 7+ hunter shows");
  assert.deepEqual(rev.solo, ["Six", 6, 0], "no 7+ hunter: falls back to 6");
  assert.deepEqual(rev.mid, ["Four", 4, 1], "ladder middle: 4 counts");
  assert.deepEqual(rev.pair, ["Two", 2, 0], "ladder bottom: 2 counts");
  assert.equal(rev.single, undefined, "1 never counts, even when lonely");
});

test("ladder never replaces a 7+ hunter with a smaller one", () => {
  const players = [
    { display: "Seven", rows: [{ name: "Prey", kills: 7, deaths: 6 }] },
    { display: "Five", rows: [{ name: "Prey", kills: 5, deaths: 0 }] },
  ];
  assert.deepEqual(buildRevTargets(players).prey, ["Seven", 7, 6]);
});

test("tags and case are ignored on the target side; empty input gives {}", () => {
  const players = [{ display: "[5TAT] 5tuntmancamVS", rows: [{ name: "[TAG] Fantom220TR", kills: 73, deaths: 58 }] }];
  const rev = buildRevTargets(players);
  assert.deepEqual(rev.fantom220tr, ["[5TAT] 5tuntmancamVS", 73, 58]);
  assert.deepEqual(buildRevTargets([]), {});
  assert.deepEqual(buildRevTargets(null), {});
});
