// 🎲 Live luck (owner 2026-11-08): actual-vs-expected kill share over the
// last 100 fights, same model as the Duels panel, raw value, no rounding.
import test from "node:test";
import assert from "node:assert/strict";
import { DUEL_FIT_V1 } from "../duels.mjs";
import { LIVE_LUCK_MAX, LIVE_LUCK_MIN, LUCK_ANCHOR_W, luckPush, luckFill, liveLuck, liveLuckRaw, anchorGap, luckChipFor, luckChips, luckText } from "../live-luck.mjs";

const fit = DUEL_FIT_V1;
const ev = (cid, iv, won) => ({ cid, iv, won });

test("liveLuck: equal opponents, 6 of 10 won → +10 pp", () => {
  const events = Array.from({ length: 10 }, (_, i) => ev(`c${i}`, 1000, i < 6));
  const r = liveLuck(events, 1000, fit);
  assert.equal(r.n, 10);
  assert.ok(Math.abs(r.act - 0.6) < 1e-9);
  assert.ok(Math.abs(r.exp - 0.5) < 1e-9);
  assert.ok(Math.abs(r.gapPp - 10) < 1e-9, `gapPp ${r.gapPp}`);
  assert.equal(luckText(r.gapPp).slice(0, 1), "+");
});

test("liveLuck: much stronger opponents, 3 of 10 won → about +8.28 pp", () => {
  // v1: p = 1/(1+exp(-0.5567·ln(100/1000))) ≈ 0.21723; (0.3 − 0.21723)·100 ≈ 8.28.
  const events = Array.from({ length: 10 }, (_, i) => ev(`c${i}`, 1000, i < 3));
  const r = liveLuck(events, 100, fit);
  assert.equal(r.n, 10);
  assert.ok(Math.abs(r.exp - 0.21723) < 1e-4, `exp ${r.exp}`);
  assert.ok(Math.abs(r.gapPp - 8.277) < 0.01, `gapPp ${r.gapPp}`);
});

test("liveLuck: too few scorable fights → no number", () => {
  const few = Array.from({ length: LIVE_LUCK_MIN - 1 }, (_, i) => ev(`c${i}`, 1000, true));
  assert.equal(liveLuck(few, 1000, fit), null);
});

test("liveLuck: unknown opponents don't count in n; non-positive iVi never scores", () => {
  const unknown = Array.from({ length: 12 }, (_, i) => ev(`c${i}`, i < 2 ? null : 1000, true));
  const r = liveLuck(unknown, 1000, fit);
  assert.equal(r.n, 10); // the 2 unknown don't count
  assert.ok(Math.abs(r.gapPp - 50) < 1e-9); // won all 10 scored at p=0.5
  const neg = Array.from({ length: 10 }, (_, i) => ev(`c${i}`, i < 2 ? -50 : 1000, true));
  assert.equal(liveLuck(neg, 1000, fit), null); // only 8 scored, below the floor
  const ten = Array.from({ length: 10 }, (_, i) => ev(`c${i}`, 1000, true));
  assert.equal(liveLuck(ten, 0, fit), null);
  assert.equal(liveLuck(ten, null, fit), null);
  assert.equal(liveLuck(ten, 1000, null), null);
});

test("luckPush caps the window at 100, oldest first; luckFill lands late iVis", () => {
  let w = [];
  for (let i = 0; i < LIVE_LUCK_MAX + 5; i++) w = luckPush(w, ev(`c${i}`, 1000, i % 2 === 0));
  assert.equal(w.length, LIVE_LUCK_MAX);
  assert.equal(w[0].cid, "c5");
  assert.equal(w[LIVE_LUCK_MAX - 1].cid, `c${LIVE_LUCK_MAX + 4}`);
  const w2 = [ev("a", null, true), ev("b", 500, false)];
  assert.equal(luckFill(w2, "a", 800), true);
  assert.equal(w2[0].iv, 800);
  assert.equal(luckFill(w2, "a", 900), false); // already filled
  assert.equal(luckFill(w2, "zzz", 700), false);
});

test("luckText: explicit sign, raw value, dash when no number", () => {
  assert.equal(luckText(0.73646).slice(0, 1), "+");
  assert.match(luckText(0.73646), /^\+0\.73646/);
  assert.equal(luckText(-1.47374738393).slice(0, 1), "-");
  assert.equal(luckText(null), "–");
  assert.equal(luckText(NaN), "–");
});

test("liveLuckRaw: the gap from the first scorable fight, no floor", () => {
  const events = [ev("a", 1000, true)];
  const r = liveLuckRaw(events, 1000, fit);
  assert.equal(r.n, 1);
  assert.ok(Math.abs(r.gapPp - 50) < 1e-9, `gapPp ${r.gapPp}`); // won 1 of 1, expected 0.5
  assert.equal(liveLuck(events, 1000, fit), null); // the floored version still waits for 10
});

test("luckChips: latest chip + session sum, in fractions, raw", () => {
  // One win vs an equal (iVi 1000 vs 1000, expected 0.5) at n=1, W=100:
  // chip = (1 − 0.5)/101 ≈ +0.00495; sum = the same (one fight).
  const one = luckChips([ev("a", 1000, true)], 1000, fit);
  assert.equal(one.n, 1);
  assert.ok(Math.abs(one.chip - 0.5 / 101) < 1e-12, `chip ${one.chip}`);
  assert.ok(Math.abs(one.sum - 0.5 / 101) < 1e-12, `sum ${one.sum}`);
  // Two fights: win vs equal (+0.5) then loss vs equal (−0.5) → chips cancel,
  // sum 0, latest chip −0.5/102 (n=2 now).
  const two = luckChips([ev("a", 1000, true), ev("b", 1000, false)], 1000, fit);
  assert.equal(two.n, 2);
  assert.ok(Math.abs(two.chip - -0.5 / 102) < 1e-12, `chip ${two.chip}`);
  assert.ok(Math.abs(two.sum) < 1e-12, `sum ${two.sum}`);
  // luckChipFor: the user's examples — a +0.953 win and a −0.267 loss.
  // (Built from the expected share: win vs iv where p ≈ 0.047, loss vs p ≈ 0.267.)
  assert.ok(Math.abs(luckChipFor(ev("a", 1000, true), 1000, fit, 1) - 0.5 / 101) < 1e-12);
  assert.equal(luckChipFor(ev("a", null, true), 1000, fit, 1), null); // unscorable
  assert.equal(luckChips([], 1000, fit), null);
  assert.equal(luckChips([ev("a", 1000, true)], 0, fit), null); // my iVi ≤ 0
});

test("anchorGap: lifetime gap counts as W fights, first fight moves it ~1/(W+1)", () => {
  assert.equal(LUCK_ANCHOR_W, 100);
  // Lifetime +2pp, session gap +50pp over 1 fight → (100×2 + 1×50)/101 ≈ 2.475.
  const a = anchorGap(50, 1, 2);
  assert.ok(Math.abs(a - (100 * 2 + 50) / 101) < 1e-12, `anchored ${a}`);
  // A bad death vs a weak opponent early: session gap −90pp over 1 fight, lifetime 0 → −90/101 ≈ −0.89, not −90.
  const b = anchorGap(-90, 1, 0);
  assert.ok(Math.abs(b - -90 / 101) < 1e-12, `anchored ${b}`);
  // At the anchor alone (no session fight yet) there is no number.
  assert.equal(anchorGap(50, 0, 2), null);
  assert.equal(anchorGap(50, 1, null), null);
  // As the session grows the anchor washes out: 100 session fights at +50pp → (100×2 + 100×50)/200 = 26.
  assert.ok(Math.abs(anchorGap(50, 100, 2) - 26) < 1e-12);
});
