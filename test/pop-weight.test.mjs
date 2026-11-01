import test from "node:test";
import assert from "node:assert/strict";
import { popCells, alertPop, weightedSkill } from "../pop-weight.mjs";
import { readFileSync } from "node:fs";

test("popCells: per faction×server quantiles, skips bad rows", () => {
  const rows = [];
  for (let i = 1; i <= 100; i++) rows.push({ faction: "vs", server: "osprey", adjs: i });
  rows.push({ faction: "vs", server: "osprey", adjs: NaN }, { faction: "vs", server: null, adjs: 5 });
  const c = popCells(rows);
  assert.equal(c.cells["vs|osprey"].n, 100);
  assert.equal(c.cells["vs|osprey"].p.length, 101);
  assert.equal(Object.keys(c.cells).length, 1);
});

test("alertPop: NS is total minus the three empires", () => {
  const a = [{ world: 1, report: { players: 100, faction: { VS: { players: 30 }, NC: { players: 30 }, TR: { players: 30 } } } },
    { world: 40, report: { players: 50, faction: { VS: { players: 10 }, NC: { players: 10 }, TR: { players: 10 } } } }];
  const r = alertPop(a);
  assert.equal(r.alerts, 1);
  assert.equal(r.pop["vs|osprey"], 30);
  assert.equal(r.pop["nso|osprey"], 10);
});

test("weightedSkill: mixes servers by real population, null without data", () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ faction: "vs", server: "osprey", adjs: 100 }, { faction: "vs", server: "wainwright", adjs: 300 });
  const c = popCells(rows);
  const w = weightedSkill(c, { "vs|osprey": 900, "vs|wainwright": 100 });
  assert.equal(w.vs.med, 100);
  assert.ok(Math.abs(w.vs.mean - 120) <= 1);
  assert.equal(w.nc, null);
});

test("skill footer: wired into the existing history refresh, 9-language strings", () => {
  const res = readFileSync(new URL("../oracle/js/results.js", import.meta.url), "utf8");
  assert.match(res, /renderSkillFoot\(S\.histRows\)/);
  assert.match(readFileSync(new URL("../oracle/index.html", import.meta.url), "utf8"), /id="skillPop" hidden/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${l}.json`, import.meta.url), "utf8"));
    assert.ok(j["or.skillPop"] && j["or.skillPopTip"].includes("{n}"), l);
  }
});
