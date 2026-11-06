// weapon-compare.mjs pure helpers: link state round trip, axis ticks, page wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseState, stateToSearch, niceTicks, MAX_WEAPONS, MAX_RANGE } from "../weapon-compare.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("link state: defaults leave the query empty", () => {
  const s = parseState("");
  assert.deepEqual([s.acc, s.hsr, s.range, s.hp, s.hasW], [20, 20, 20, 1000, false]);
  assert.equal(stateToSearch({ ids: [], acc: 20, hsr: 20, range: 20, hp: 1000 }), "");
});

test("link state round trip", () => {
  const s = { ids: [4, 14, 20], acc: 55, hsr: 12, range: 35, hp: 500 };
  const back = parseState(stateToSearch(s));
  assert.deepEqual({ ids: back.ids, acc: back.acc, hsr: back.hsr, range: back.range, hp: back.hp }, s);
});

test("link state: junk is dropped or clamped, at most four weapons, unknown ids ignored", () => {
  const s = parseState("?w=1,2,2,x,3,4,5,6&acc=500&hsr=-9&r=9999&hp=abc", (id) => id !== 3);
  assert.deepEqual(s.ids, [1, 2, 4, 5]);
  assert.equal(s.ids.length <= MAX_WEAPONS, true);
  assert.equal(s.acc, 100);
  assert.equal(s.hsr, 0);
  assert.equal(s.range, MAX_RANGE);
  assert.equal(s.hp, 1000);
});

test("niceTicks starts at 0, ends at or above the max and is short", () => {
  for (const max of [37, 100, 640, 1234.5, 5]) {
    const t = niceTicks(max, 5);
    assert.equal(t[0], 0);
    assert.ok(t[t.length - 1] >= max * 0.999, `${max}: ${t}`);
    assert.ok(t.length >= 2 && t.length <= 9, `${max}: ${t}`);
  }
});

test("the page is wired: stylesheet, module, language menu, footer link, credits", () => {
  const html = read("weapon-compare.html");
  for (const id of ["wcSearch", "wcChips", "wcAcc", "wcHsr", "wcRange", "wcHp", "wcTtk", "wcCdf", "wcDps", "langSelect"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /weapon-compare\.css\?v=/);
  assert.match(html, /weapon-compare\.mjs\?v=/);
  assert.match(html, /Izubrr\/planetside_weapon_compare/);
  assert.match(html, /B4rrCH\/Ps2TtkCalculator/);
  assert.match(read("index.html"), /href="weapon-compare\.html"/);
  assert.match(read("NOTICE"), /weapon-compare\.html/);
});
