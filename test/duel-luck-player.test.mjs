// 🎲 Luck per player (owner 2026-11-02, t849u debug → t850u public column after ⚡ Const), data from scripts/fit-duel-ivi.mjs.
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

describe("🎲 per player: data files and the public column", () => {
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
  it("🎲 Luck is a public column right after ⚡ Const, in ✨ and 🏆, loaded lazily", () => {
    const src = fs.readFileSync("stats-table.mjs", "utf8");
    const vis = src.slice(src.indexOf("const adjVisibleCols = ["), src.indexOf("const adjDebugCols = ["));
    assert.match(vis, /id: "cons"[^\n]*\n(\s*\/\/[^\n]*\n)?\s*\{ id: "luck"/);
    assert.doesNotMatch(src, /adjDebugCols\.push\(\{ id: "luck"/, "no debug duplicate");
    assert.doesNotMatch(src, /showDebugCols\) loadLuck/, "loads for everyone");
    const rk = fs.readFileSync("rankings.mjs", "utf8");
    assert.match(rk, /id: "cons"[^\n]*\n(\s*\/\/[^\n]*\n)?\s*\{ id: "luck"/);
    for (const f of ["luck-col.mjs", "stats-table.mjs", "rankings.mjs"])
      assert.doesNotMatch(fs.readFileSync(f, "utf8").split("\n").filter((l) => /luck/i.test(l)).join("\n"), /cheat/i);
  });
  it("cell text: signed whole percent, dash when too few", async () => {
    const { luckText, luckClass, luckCellHtml } = await import("../luck-col.mjs");
    assert.equal(luckText(playerLuck(D, "b")), "+6%");
    assert.equal(luckText(playerLuck(D, "e")), "−7%");
    assert.equal(luckText(playerLuck(D, "a")), "0%");
    assert.equal(luckText(null), "—");
    assert.equal(luckClass(playerLuck(D, "a")), "luck-as");
    assert.equal(luckClass(playerLuck(D, "c")), "luck-up2");
    const esc = (s) => String(s);
    assert.match(luckCellHtml(playerLuck(D, "b"), D, esc), /class="luck-cell luck-up1"[^>]*>\+6%</);
    assert.match(luckCellHtml(null, D, esc), />—</);
  });
  it("9 languages carry the column label and hint", () => {
    for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
      const d = JSON.parse(fs.readFileSync(`i18n/${l}.json`, "utf8"));
      assert.match(d["col.luck"], /^🎲 \S/);
      for (const k of ["tip.luck", "luck.p.tip", "luck.p.few", "rk.basisLuck"]) assert.ok(d[k], `${l} ${k}`);
      assert.match(d["luck.p.tip"], /\{gap\}.*\{n\}.*\{b\}/s);
    }
  });
  it("🎲 Luck cells are plain text: no colour code (owner t851u)", () => {
    const css = fs.readFileSync("styles.css", "utf8").split("\n").filter((l) => /(^|[^-])td\.luck-/.test(l));
    assert.ok(css.length, "nowrap rule kept");
    for (const l of css) assert.doesNotMatch(l, /color|font-weight/);
  });
});
