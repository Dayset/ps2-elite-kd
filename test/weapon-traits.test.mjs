// weapon-traits.mjs: how far each way of firing still hits the body, the class race over range,
// and the guide page that reads them (weapon-guide.html / .mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reachOf, fireWays, verdict, moveCost, rangeShares, classStanding, slugOf } from "../weapon-traits.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const cat = JSON.parse(read("assets/weapons/catalog.json")).items;
const rec = JSON.parse(read("assets/weapons/recoil.json"));
const idOf = (name) => Object.keys(cat).find((k) => cat[k][0] === name);
const traits = (name) => { const r = rec.weapons[idOf(name)]; return verdict(rec.groups[r[1]], rec.groups[r[4]] || [], rec.handling[idOf(name)]); };

test("reach: a cone reaches the 0.3 m body half-width at 0.3 / tan(cone / 2)", () => {
  assert.equal(Math.round(reachOf(0.3)), 115);
  assert.equal(Math.round(reachOf(1.5)), 23);
  assert.equal(reachOf(0), Infinity);
});

test("SMG-46 Armistice: aiming on the move is free, jumping is 10× wider than that", () => {
  const v = traits("SMG-46 Armistice");
  assert.equal(v.strafeFree, true);
  assert.equal(v.moveX, 1);
  assert.equal(Math.round(v.adsMoveM), 115);
  assert.equal(Math.round(v.hipM), 23);
  assert.equal(Math.round(v.airM), 11, "in the air: ADS cone 3° (Census player_state 4)");
  assert.equal(v.airX, 10);
  assert.equal(v.ways[0].ads, true, "an aimed way is the best");
});

test("the air cone falls back to the widest cone of the other stances (checked against Census 2026-11-22)", () => {
  const states = [{ player_state_id: 0, cof_min: 0.15, cof_max: 0.6 }, { player_state_id: 2, cof_min: 0.4, cof_max: 3 }];
  assert.equal(fireWays([], states).find((w) => w.way === "adsAir").cone, 3);
  states.push({ player_state_id: 4, cof_min: 2.5, cof_max: 2.5 });
  assert.equal(fireWays([], states).find((w) => w.way === "adsAir").cone, 2.5, "a real row 4 wins");
  assert.equal(traits("NSX Naginata").ways.find((w) => w.way === "adsAir").cone, 3);
});

test("moving costs accuracy on rifles, not on most SMGs; pellet spread widens every way", () => {
  assert.ok(moveCost(rec.groups[rec.weapons[idOf("NC1 Gauss Rifle")][4]]) > 5);
  const smg = Object.keys(rec.weapons).filter((id) => cat[id] && cat[id][1] === "SMG" && rec.weapons[id][4]);
  const free = smg.filter((id) => moveCost(rec.groups[rec.weapons[id][4]]) === 1).length;
  assert.ok(free / smg.length > 0.8, `${free} of ${smg.length} SMGs strafe free`);
  const plain = fireWays([{ player_state_id: 0, cof_min: 1, cof_max: 7 }], []), wide = fireWays([{ player_state_id: 0, cof_min: 1, cof_max: 7 }], [], { hip: 2 });
  assert.equal(wide[0].cone, plain[0].cone + 2);
});

test("range shares and the class race", () => {
  assert.deepEqual(rangeShares([0, 0, 1, -1], 2), [0.5, 0.25]);
  const curves = [[100, 100, 300, 300], [200, 105, 200, 200], [null, 300, 400, 250]];
  assert.deepEqual(classStanding(curves, 0), { best: 0.5, near: 0.5, band: { from: 0, to: 1 } });
  assert.deepEqual(classStanding(curves, 1), { best: 0.5, near: 0.75, band: { from: 1, to: 3 } });
  assert.equal(classStanding(curves, 2).best, 0);
});

test("old guide slugs resolve: name slugs plus three aliases in the guide", () => {
  assert.equal(slugOf("NC6S Gauss SAW S"), "nc6s-gauss-saw-s");
  assert.equal(slugOf("U-ARX Dirac"), "u-arx-dirac");
  const mjs = read("weapon-guide.mjs");
  for (const s of ["gd22s", "equinox-ve2-burst", "moonshot"]) assert.match(mjs, new RegExp(`"${s}": \\d+`));
});

test("guide page: one page for every weapon, translated, sortable class table, flat", () => {
  const html = read("weapon-guide.html"), mjs = read("weapon-guide.mjs"), css = read("weapon-guide.css");
  assert.match(html, /<table class="ranks-table sortable wg-table" id="wgClass">/);
  assert.match(html, /src="weapon-guide\.mjs\?v=/);
  assert.match(html, /page-settings\.mjs/);
  assert.doesNotMatch(css, /border-radius:\s*[1-9]/);
  const en = JSON.parse(read("i18n/en.json"));
  for (const m of mjs.matchAll(/\btr\("([^"]+)"/g)) if (!m[1].endsWith(".")) assert.ok(m[1] in en, m[1]);
  for (const w of ["adsStill", "adsCrouch", "adsMove", "adsAir", "hipStill", "hipMove", "hipAir"]) assert.ok("wg.way." + w in en, w);
  for (const m of mjs.matchAll(/th\("([^"]+)"/g)) assert.ok(m[1] in en, m[1]);
});
