// live bounty (owner 2026-10-25): 7 kills without dying earns the bounty,
// a death below 7 resets, a bounty survives 3 deaths, kills while bountied
// change nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { bountyNext, BOUNTY_KILLS, BOUNTY_LIVES } from "../live-model.mjs";

const K = (s) => bountyNext(s, true);
const D = (s) => bountyNext(s, false);

test("bounty constants match the in-game rule", () => {
  assert.equal(BOUNTY_KILLS, 7);
  assert.equal(BOUNTY_LIVES, 3);
});

test("streak builds one heart per kill, capped at the bounty", () => {
  let s = { streak: 0, lives: 0 };
  for (let i = 1; i <= 6; i++) { s = K(s); assert.deepEqual(s, { streak: i, lives: 0 }); }
  s = K(s);
  assert.deepEqual(s, { streak: 7, lives: 3 }); // the 7th kill earns the bounty
});

test("a death below 7 resets everything", () => {
  assert.deepEqual(D({ streak: 3, lives: 0 }), { streak: 0, lives: 0 });
  assert.deepEqual(D({ streak: 0, lives: 0 }), { streak: 0, lives: 0 });
});

test("a bounty survives 3 deaths, then clears", () => {
  let s = { streak: 7, lives: 3 };
  s = D(s); assert.deepEqual(s, { streak: 7, lives: 2 });
  s = D(s); assert.deepEqual(s, { streak: 7, lives: 1 });
  s = D(s); assert.deepEqual(s, { streak: 0, lives: 0 });
  s = K(s); assert.deepEqual(s, { streak: 1, lives: 0 }); // counting restarts from the beginning
});

test("kills while bountied change nothing", () => {
  assert.deepEqual(K({ streak: 7, lives: 2 }), { streak: 7, lives: 2 });
});
