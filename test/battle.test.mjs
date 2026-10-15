/**
 * Regression suite for the debug battle simulator (Node built-in test runner).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_BASE,
  fighterFromRow,
  findFighter,
  pickOpponents,
  runBattle,
  duelOdds,
  normalCdf,
  seededRandom,
} from "../battle.mjs";

const COLS = ["name", "query", "adjs", "act", "cons"];
const row = (name, adjs, act, cons, query = name.toLowerCase()) => [name, query, adjs, act, cons];
const fighter = (name, adjs, act, cons) => fighterFromRow(row(name, adjs, act, cons), COLS);

describe("fighterFromRow", () => {
  it("mean strength is 2^(adjS/600) × √act, independent of consistency", () => {
    const f = fighter("A", 600, 4, 0.5);
    assert.ok(Math.abs(f.mu - 2 * 2) < 1e-9);
    assert.ok(Math.abs(fighter("A2", 600, 4, 1).mu - 4) < 1e-9);
  });

  it("spread is SPREAD_K × (1 − consistency)", () => {
    assert.ok(Math.abs(fighter("A", 0, 1, 0.6).sigma - 0.4) < 1e-9);
    assert.equal(fighter("A", 0, 1, 1).sigma, 0);
  });

  it("floors negative adjusted scores at 0", () => {
    assert.ok(Math.abs(fighter("B", -300, 1, 1).mu - 1) < 1e-9);
  });

  it("returns null when a required stat is missing", () => {
    assert.equal(fighterFromRow(["X", "x", null, 1, 1], COLS), null);
  });

  it("clamps activity to ≥ 0 and consistency to 0..1", () => {
    const f = fighterFromRow(row("C", 0, -2, 3), COLS);
    assert.equal(f.act, 0);
    assert.equal(f.cons, 1);
  });
});

describe("findFighter", () => {
  const rows = [row("[lKPM] Simplenubb", 2459, 12, 0.6, "simplenubb"), row("Other", 100, 1, 1)];

  it("matches the query column exactly, case-insensitively", () => {
    assert.equal(findFighter(rows, COLS, "SIMPLENUBB").fighter.name, "[lKPM] Simplenubb");
  });

  it("falls back to a single unambiguous substring match", () => {
    assert.equal(findFighter(rows, COLS, "nubb").fighter.name, "[lKPM] Simplenubb");
  });

  it("reports an error for an empty or unknown name", () => {
    assert.ok(findFighter(rows, COLS, "").error);
    assert.ok(findFighter(rows, COLS, "nobody").error);
  });

  it("reports ambiguous partial matches", () => {
    const many = [row("abc1", 1, 1, 1), row("abc2", 1, 1, 1)];
    assert.ok(findFighter(many, COLS, "abc").error);
  });
});

describe("pickOpponents", () => {
  const rows = [
    row("Champ", 1400, 1, 1),
    row("Near1", 1401, 1, 1),
    row("Near2", 1395, 1, 1),
    row("Far", 300, 1, 1),
    row("Near3", 1410, 1, 1),
  ];
  const champ = fighter("Champ", 1400, 1, 1);

  it("returns the n closest by adjusted score, excluding the champion", () => {
    assert.deepEqual(pickOpponents(rows, COLS, champ, 2).map((f) => f.name), ["Near1", "Near2"]);
  });

  it("returns fewer when not enough candidates exist", () => {
    assert.equal(pickOpponents(rows, COLS, champ, 99).length, 4);
  });
});

describe("normalCdf", () => {
  it("is 0.5 at zero and symmetric", () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normalCdf(1) + normalCdf(-1) - 1) < 1e-6);
  });

  it("matches a known value", () => {
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  });
});

describe("duelOdds", () => {
  it("two identical fighters are exactly 50/50, whatever their consistency", () => {
    const a = fighter("A", 1433, 2.6, 0.5);
    const b = fighter("B", 1433, 2.6, 0.5);
    assert.ok(Math.abs(duelOdds(a, b) - 0.5) < 1e-9);
    const c = fighter("C", 1433, 2.6, 0.9);
    const d = fighter("D", 1433, 2.6, 0.9);
    assert.ok(Math.abs(duelOdds(c, d) - 0.5) < 1e-9);
  });

  it("with a 2× mean gap, low consistency pulls the odds toward 50%", () => {
    const strong = fighter("S", 1200, 1, 0.6); // mean 4
    const weak = fighter("W", 600, 1, 0.6); // mean 2^1 = 2, strong mean 2^2 = 4
    const swingy = duelOdds(strong, weak);
    const steady = duelOdds(fighter("S2", 1200, 1, 0.9), fighter("W2", 600, 1, 0.9));
    assert.ok(swingy < steady);
    assert.ok(swingy > 0.5 && swingy < 1);
    assert.ok(steady > 0.99);
  });

  it("steady fighters with equal means are exactly 50/50 (no spread, tie)", () => {
    assert.equal(duelOdds(fighter("X", 600, 1, 1), fighter("Y", 600, 1, 1)), 0.5);
  });
});

describe("runBattle", () => {
  it("two identical fighters: Monte Carlo win rate is close to 50%", () => {
    const a = fighter("A", 1433, 2.6, 0.6);
    const b = fighter("B", 1433, 2.6, 0.6);
    const r = runBattle(a, [b], { trials: 8000, seed: 42 });
    // Single opponent uses the closed-form odds, so this must be exact.
    assert.ok(Math.abs(r.winRate - 0.5) < 1e-9);
  });

  it("two identical enemies beat an identical champion more often than not", () => {
    const a = fighter("A", 1433, 2.6, 0.6);
    const r = runBattle(a, [fighter("B", 1433, 2.6, 0.6), fighter("C", 1433, 2.6, 0.6)], { trials: 8000, seed: 42 });
    assert.ok(r.winRate < 0.5);
  });

  it("is reproducible: same seed, same result", () => {
    const a = fighter("A", 1433, 2.6, 0.6);
    const opps = [fighter("B", 1420, 2.4, 0.5), fighter("C", 1440, 2.8, 0.7)];
    const r1 = runBattle(a, opps, { trials: 2000, seed: 9 });
    const r2 = runBattle(a, opps, { trials: 2000, seed: 9 });
    assert.equal(r1.winRate, r2.winRate);
  });

  it("concentrated group of similar enemies beats an equal-strength champion", () => {
    const champ = fighter("Champ", 1000, 1, 1);
    const group = Array.from({ length: 6 }, (_, i) => fighter(`G${i}`, 1000, 1, 0.8));
    const r = runBattle(champ, group, { trials: 3000, seed: 5 });
    assert.equal(r.mode, "concentrated");
    assert.ok(r.winRate < 0.5);
  });

  it("sequential mode: a strong champion chokes many weak opponents", () => {
    const champ = fighter("Spartan", 2000, 12, 0.9);
    const weak = Array.from({ length: 10 }, (_, i) => fighter(`W${i}`, 0, 0.1 + i * 0.01, 0.9));
    const strong = fighter("Strong", 0, 12, 0.9);
    const r = runBattle(champ, [...weak, strong], { trials: 2000, seed: 3 });
    assert.equal(r.mode, "sequential");
    assert.ok(r.winRate > 0.9);
  });

  it("no opponents: the champion wins with full strength", () => {
    const r = runBattle(fighter("Solo", 600, 2, 1), []);
    assert.equal(r.win, true);
    assert.equal(r.remaining, 1);
  });

  it("exposes each opponent's closed-form 1v1 win chance", () => {
    const champ = fighter("Champ", 600, 4, 1);
    const r = runBattle(champ, [fighter("O", 600, 4, 1)]);
    assert.equal(r.duels.length, 1);
    assert.ok(Math.abs(r.duels[0].championWinChance - 0.5) < 1e-9);
  });
});

describe("seededRandom", () => {
  it("returns values in [0, 1) and is deterministic per seed", () => {
    const r1 = seededRandom(123);
    const r2 = seededRandom(123);
    for (let i = 0; i < 20; i++) {
      const x = r1();
      assert.ok(x >= 0 && x < 1);
      assert.equal(x, r2());
    }
  });
});

it("exports the score base used in the strength formula", () => {
  assert.equal(SCORE_BASE, 600);
});
