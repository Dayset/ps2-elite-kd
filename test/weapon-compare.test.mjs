// weapon-compare.mjs pure helpers: link state round trip, axis ticks, page wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseState, stateToSearch, niceTicks, viewMax, rangeStep, MAX_WEAPONS, MAX_RANGE, attList, burstRowsShown, resPresetFor } from "../weapon-compare.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("link state: defaults leave the query empty", () => {
  const s = parseState("");
  assert.deepEqual([s.acc, s.hsr, s.range, s.hp, s.hasW], [100, 100, 20, 1000, false]);
  assert.equal(stateToSearch({ ids: [], acc: 100, hsr: 100, range: 20, hp: 1000 }), "");
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
  for (const id of ["wcSearch", "wcChips", "wcAcc", "wcHsr", "wcRange", "wcHp", "wcTtk", "wcCdf", "wcDiff", "wcSimLegend", "wcDeepBox", "langSelect", "wcFps", "wcFpsRange", "wcFpsNote"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<footer[^>]*wc-foot/);
  assert.match(html, /weapon-compare\.css\?v=/);
  assert.match(html, /weapon-compare\.mjs\?v=/);
  assert.match(html, /Izubrr\/planetside_weapon_compare/);
  assert.match(html, /B4rrCH\/Ps2TtkCalculator/);
  assert.match(read("index.html"), /href="weapon-compare\.html"/);
  // the Ideal ADAD calculator is a folded section of this page; the old page only forwards here
  assert.match(html, /<details class="[^"]*dist-section[^"]*" id="wcAdad">/);
  assert.doesNotMatch(html, /<details[^>]*id="wcAdad"[^>]* open/);
  for (const id of ["calcH", "gunName", "inStill", "wtable", "adadTbl"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(read("weapon-adad.html"), /weapon-compare\.html#adad/);
  assert.match(read("NOTICE"), /weapon-compare\.html/);
});

test("range view: 100 m, 200 m for weapons that still fall off past 100 m, 500 m with the option", () => {
  const AR = { rangeMinDmg: 90 }, SNIPER = { rangeMinDmg: 350 };
  assert.equal(viewMax([AR], false), 100);
  assert.equal(viewMax([AR, SNIPER], false), 200);
  assert.equal(viewMax([AR], true), 500);
  assert.deepEqual([rangeStep(100), rangeStep(200), rangeStep(500)], [2, 4, 5]);
});

test("the FPS limit survives the link, off by default", () => {
  const s = parseState("");
  assert.equal(s.fpsOn, false);
  assert.equal(s.fps, 60);
  assert.equal(stateToSearch({ ids: [], acc: 100, hsr: 100, range: 20, hp: 1000 }), "");
  const on = { ids: [4], acc: 100, hsr: 100, range: 20, hp: 1000, fps: 60, fpsOn: true };
  assert.equal(stateToSearch(on), "?w=4&fps=60");
  const back = parseState(stateToSearch(on));
  assert.equal(back.fpsOn, true);
  assert.equal(back.fps, 60);
  assert.equal(parseState("?fps=5000").fps, 1000);
  assert.equal(parseState("?fps=5").fps, 30);
});

test("the 500 m option survives the link", () => {
  const s = { ids: [4], acc: 100, hsr: 100, range: 300, hp: 1000, far: true };
  assert.equal(stateToSearch(s), "?w=4&r=300&max=500");
  assert.equal(parseState("?w=4&r=300&max=500").far, true);
  assert.equal(parseState("?w=4").far, false);
});

test("loadout in the link: a<id>=Name,Name, only for chosen weapons, at most three parts", () => {
  const s = parseState("?w=4,14&a4=Compensator,Forward%20Grip&a99=Suppressor&a14=A,B,C,D");
  assert.deepEqual(s.att, { 4: ["Compensator", "Forward Grip"], 14: ["A", "B", "C"] });
  const back = stateToSearch({ ids: [4, 14], acc: 100, hsr: 100, range: 20, hp: 1000, att: { 4: { barrel: "Compensator", rail: "", ammo: "Soft Point Ammunition" } } });
  assert.equal(back, "?w=4%2C14&a4=Compensator%2CSoft+Point+Ammunition");
  assert.deepEqual(parseState(back).att, { 4: ["Compensator", "Soft Point Ammunition"] });
  assert.deepEqual(attList({ barrel: "", rail: "Forward Grip" }), ["Forward Grip"]);
});

test("one aim rule on the page: no separate aim point, no DPS block repeating the table, the deep dive is folded", () => {
  const html = read("weapon-compare.html");
  for (const gone of ["wcSimAimX", "wcSimAimY", "wcSimTarget", "wcDps", "wcSimSum"]) assert.doesNotMatch(html, new RegExp(`id="${gone}"`), gone);
  assert.match(html, /<details class="[^"]*dist-section[^"]*" id="wcDeepBox">/);
  assert.doesNotMatch(html, /<details[^>]*id="wcDeepBox"[^>]* open/);
});

test("burst analysis keeps only the shots that still hit, plus two", () => {
  const rows = [1, 1, 0.5, 0.2, 0.05, 0, 0, 0, 0, 0, 0, 0].map((total) => ({ total }));
  assert.equal(burstRowsShown(rows), 7);
  assert.equal(burstRowsShown(rows.map(() => ({ total: 0 }))), 6);
  assert.equal(burstRowsShown(rows.map(() => ({ total: 1 }))), rows.length);
});

test("recoil compensation defaults to 100% (full pulldown), both directions", () => {
  const html = read("weapon-compare.html");
  assert.match(html, /id="wcSimComp"[^>]*value="100"/);
  assert.match(html, /id="wcSimCompX"[^>]*value="100"/);
  assert.match(html, /id="wcSimCompV">100%</);
  assert.match(html, /id="wcSimCompXV">100%</);
});

test("accuracy and headshot rate default to 100% (perfect-play baseline)", () => {
  const html = read("weapon-compare.html");
  assert.match(html, /id="wcAcc"[^>]*value="100"/);
  assert.match(html, /id="wcHsr"[^>]*value="100"/);
  assert.match(html, /id="wcAccV">100%</);
  assert.match(html, /id="wcHsrV">100%</);
});

test("screen-height presets: 1080p, 1440p, 2160p (4K); anything else is custom", () => {
  assert.deepEqual([1080, 1440, 2160].map(resPresetFor), ["1080", "1440", "2160"]);
  assert.equal(resPresetFor(900), "custom");
  assert.equal(resPresetFor(4320), "custom");
});

test("tier lists: a folded section after the ADAD calculator, wired to the page state", () => {
  const html = read("weapon-compare.html"), mjs = read("weapon-compare.mjs"), css = read("weapon-compare.css");
  const en = JSON.parse(read("i18n/en.json"));
  for (const id of ["wcTiers", "tiersAds", "tiersHip", "tiersMeta", "tiersBody"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<details class="[^"]*dist-section[^"]*" id="wcTiers">/);
  assert.doesNotMatch(html, /<details[^>]*id="wcTiers"[^>]* open/);
  assert.match(html, /id="tiersAds" aria-checked="true"/);
  assert.match(html, /data-i18n="wc\.tiers\.sum"/);
  assert.match(html, /data-i18n="wc\.how\.tiers"/);
  assert.match(mjs, /from "\.\/weapon-tiers\.mjs\?v=/);
  assert.match(mjs, /computeTiers\(\[\.\.\.weapons\.values\(\)\], recoil, tierOpts\(\)\)/);
  assert.match(mjs, /if \(range\) renderTiers\(\);/);
  assert.match(mjs, /tiersBody/);
  assert.match(css, /\.wc-tier-table/);
  assert.match(css, /\.wc-tier-S/);
  for (const k of ["wc.tiers.sum", "wc.tiers.sub", "wc.tiers.meta", "wc.tiers.fpsOn", "wc.tiers.fpsOff",
    "wc.tiers.col.tier", "wc.tiers.col.weapon", "wc.tiers.col.faction", "wc.tiers.col.eff", "wc.tiers.col.loss",
    "wc.tiers.col.free", "wc.tiers.count", "wc.tiers.group", "wc.tiers.few", "wc.tiers.caveat", "wc.how.tiers"]) {
    assert.ok(typeof en[k] === "string" && en[k].length, k);
  }
});

test("beginner guides: one switch, a finder, and a link slot on every weapon card (veteran view hides them)", () => {
  const html = read("weapon-compare.html"), mjs = read("weapon-compare.mjs"), css = read("weapon-compare.css");
  assert.match(html, /id="wcGuides" type="checkbox" checked/);
  assert.match(html, /<details class="wc-guidefind" id="wcGuideFind">/);
  assert.doesNotMatch(html, /<details[^>]*id="wcGuideFind"[^>]* open/);
  assert.match(mjs, /class="wc-guide" href=/);
  assert.match(mjs, /wc-guide-soon/);
  assert.match(mjs, /ps2-elite-kd-wc-guides/);
  assert.match(css, /body\.wc-noguides \.wc-guide, body\.wc-noguides \.wc-guidefind \{ display: none; \}/);
  // every guide the page links to exists as a file
  for (const m of mjs.matchAll(/"(weapon-sage-[a-z0-9-]+\.html)"/g)) assert.ok(existsSync(new URL("../" + m[1], import.meta.url)), m[1]);
});
