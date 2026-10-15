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
} from "../battle.mjs";

const COLS = ["name", "query", "adjs", "act", "cons"];
const row = (name, adjs, act, cons, query = name.toLowerCase()) => [name, query, adjs, act, cons];
const fighter = (name, adjs, act, cons) => fighterFromRow(row(name, adjs, act, cons), COLS);

describe("fighterFromRow", () => {
  it("computes strength as 2^(adjS/600) × √act × cons", () => {
    const f = fighter("A", 600, 4, 0.5);
    assert.ok(Math.abs(f.strength - 2 * 2 * 0.5) < 1e-9);
  });

  it("floors negative adjusted scores at 0 (strength 1 before activity/consistency)", () => {
    const f = fighter("B", -300, 1, 1);
    assert.equal(f.strength, 1);
  });

  it("returns null when a required stat is missing", () => {
    assert.equal(fighterFromRow(["X", "x", null, 1, 1], COLS), null);
  });

  it("clamps consistency to 0..1 and activity to ≥ 0", () => {
    const f = fighterFromRow(row("C", 0, -2, 3), COLS);
    assert.equal(f.act, 0);
    assert.equal(f.cons, 1);
  });
});

describe("findFighter", () => {
  const rows = [row("[lKPM] Simplenubb", 2459, 12, 0.6, "simplenubb"), row("Other", 100, 1, 1)];

  it("matches the query column exactly, case-insensitively", () => {
    const r = findFighter(rows, COLS, "SIMPLENUBB");
    assert.equal(r.fighter.name, "[lKPM] Simplenubb");
  });

  it("falls back to a single unambiguous substring match", () => {
    const r = findFighter(rows, COLS, "nubb");
    assert.equal(r.fighter.name, "[lKPM] Simplenubb");
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
    const picked = pickOpponents(rows, COLS, champ, 2).map((f) => f.name);
    assert.deepEqual(picked, ["Near1", "Near2"]);
  });

  it("returns fewer when not enough candidates exist", () => {
    assert.equal(pickOpponents(rows, COLS, champ, 99).length, 4);
  });
});

describe("runBattle: 1v1 and concentrated fights", () => {
  it("1v1: the stronger fighter wins", () => {
    const a = fighter("A", 1200, 2, 1);
    const b = fighter("B", 600, 2, 1);
    assert.equal(runBattle(a, [b]).win, true);
    assert.equal(runBattle(b, [a]).win, false);
  });

  it("concentrated enemy strength is (Σ√b)²", () => {
    const champ = fighter("Champ", 600, 4, 1);
    const opps = [fighter("O1", 0, 4, 1), fighter("O2", 0, 4, 1)];
    const r = runBattle(champ, opps);
    // Each opponent has b = 2, so E = (√2 + √2)² = 8.
    assert.ok(Math.abs(r.enemy - 8) < 1e-9);
    assert.equal(r.win, 4 > 8);
  });

  it("a concentrated group of similarly-active enemies beats a stronger single fighter", () => {
    const champ = fighter("Champ", 1000, 1, 1);
    const group = Array.from({ length: 6 }, (_, i) => fighter(`G${i}`, 1000, 1, 1));
    const r = runBattle(champ, group);
    assert.equal(r.mode, "concentrated");
    assert.equal(r.win, false);
  });
});

describe("runBattle: sequential (dissimilar activity)", () => {
  it("chokes many low-activity opponents one at a time", () => {
    const champ = fighter("Spartan", 2000, 12, 1);
    const weak = Array.from({ length: 10 }, (_, i) => fighter(`W${i}`, 0, 0.1 + i * 0.01, 1));
    const strong = fighter("Strong", 0, 12, 1);
    const r = runBattle(champ, [...weak, strong]);
    assert.equal(r.mode, "sequential");
    assert.equal(r.win, true);
    assert.ok(r.remaining > 0 && r.remaining <= 1);
  });

  it("uses concentration once activity levels are similar again", () => {
    const champ = fighter("Champ", 1000, 4, 1);
    const similar = [fighter("S1", 600, 3, 1), fighter("S2", 600, 4, 1)];
    assert.equal(runBattle(champ, similar).mode, "concentrated");
  });
});

describe("runBattle: edge cases", () => {
  it("no opponents: the champion wins with full strength", () => {
    const r = runBattle(fighter("Solo", 600, 2, 1), []);
    assert.equal(r.win, true);
    assert.equal(r.remaining, 1);
  });

  it("exposes each opponent's 1v1 win chance", () => {
    const champ = fighter("Champ", 600, 4, 1);
    const r = runBattle(champ, [fighter("O", 600, 4, 1)]);
    assert.equal(r.duels.length, 1);
    assert.ok(Math.abs(r.duels[0].championWinChance - 0.5) < 1e-9); // equal strengths
  });
});

it("exports the score base used in the strength formula", () => {
  assert.equal(SCORE_BASE, 600);
});
