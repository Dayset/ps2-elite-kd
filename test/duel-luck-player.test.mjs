// 🎲 vs expected per player (owner 2026-11-02, t849u): debug column first, data from scripts/fit-duel-ivi.mjs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { playerLuck } from "../duels.mjs";

const D = { v: 1, model: 2, oppMin: 20, players: 100, cuts: { lo99: -70, lo90: -45, hi90: 60, hi99: 140 },
  p: { a: [0, 30, 50], b: [61, 40, 80], c: [141, 50, 90], d: [-46, 25, 30], e: [-71, 22, 10], f: [60, 20, 70] } };

describe("🎲 per player: playerLuck", () => {
  it("verdict from the player spread: middle 90% = as expected, outer 1% = much", () => {
    const v = (s) => { const l = playerLuck(D, s); return [l.lvl, l.up]; };
    assert.deepEqual(v("a"), [0, true]);
    assert.deepEqual(v("f"), [0, true], "on the edge = still as expected");
    assert.deepEqual(v("b"), [1, true]);
    assert.deepEqual(v("c"), [2, true]);
    assert.deepEqual(v("d"), [1, false]);
    assert.deepEqual(v("e"), [2, false]);
    const b = playerLuck(D, "b");
    assert.equal(b.gap, 0.061); assert.equal(b.opps, 40); assert.equal(b.beat, 80);
  });
  it("too few opponents, no file or an unknown version → null (cell shows —)", () => {
    assert.equal(playerLuck(D, "zz"), null);
    assert.equal(playerLuck(null, "a"), null);
    assert.equal(playerLuck(false, "a"), null);
    assert.equal(playerLuck({ ...D, v: 2 }, "a"), null);
  });
});

describe("🎲 per player: data files and the debug column", () => {
  for (const dir of ["data", "data-ps"]) {
    it(`${dir}/duel-ivi-player.json: versioned, small, ordered cuts, 20+ opponents`, () => {
      const f = `${dir}/duel-ivi-player.json`;
      assert.ok(fs.statSync(f).size < 250000, "kept small");
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      assert.equal(d.v, 1); assert.equal(d.oppMin, 20);
      const c = d.cuts;
      assert.ok(c.lo99 <= c.lo90 && c.lo90 < c.hi90 && c.hi90 <= c.hi99);
      const rows = Object.values(d.p);
      assert.equal(rows.length, d.players);
      assert.ok(rows.every((r) => r.length === 3 && Number.isInteger(r[0]) && r[1] >= 20 && r[2] >= 0 && r[2] <= 100));
    });
  }
  it("the column lives with the older debug columns, not the visible ones", () => {
    const src = fs.readFileSync("stats-table.mjs", "utf8");
    const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("const adjDebugCols = ["));
    assert.ok(!vis.includes('id: "luck"'));
    assert.match(src, /adjDebugCols\.push\(\{ id: "luck"/);
    assert.match(src, /if \(\$\.showDebugCols\) loadLuck\(\)/, "file loads only with the debug box on");
    assert.doesNotMatch(src.slice(src.indexOf("luckCell: true")), /^[^\n]*cheat/im);
  });
});
