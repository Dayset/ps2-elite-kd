// owner t648u/t649u: "Remove ranks" → "Hide ranks"; new "Locate player" switch (one name only),
// every sort scrolls the table to that player's row; phones: label left, switch right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const LANGS = ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"];

test("Hide ranks + Locate player labels in all 9 languages", () => {
  const en = JSON.parse(read("i18n/en.json"));
  assert.equal(en["ranks.removeRanks"], "Hide ranks");
  assert.equal(en["ranks.locate"], "Locate player");
  for (const l of LANGS) {
    const d = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["ranks.removeRanks", "ranks.removeRanksTitle", "ranks.locate", "ranks.locateTitle"]) assert.ok(d[k] && d[k].length <= 80, `${l} ${k}`);
    if (l !== "en") assert.notEqual(d["ranks.locate"], en["ranks.locate"], `${l} translated`);
  }
  const html = read("index.html");
  assert.doesNotMatch(html, />Remove ranks</);
  assert.match(html, /<label class="tgl-switch rk-locate" id="locateWrap" hidden [^>]*data-i18n-title="ranks\.locateTitle">\s*<input type="checkbox" id="locateToggle" \/> <span data-i18n="ranks\.locate">Locate player<\/span>/);
  assert.ok(html.indexOf('id="removeRanksToggle"') < html.indexOf('id="locateToggle"'), "next to Hide ranks");
});

test("Locate player logic: one name only, after every sort, no focus, quiet when missing", () => {
  const rk = read("rankings.mjs");
  assert.match(rk, /function syncLocate\(\) \{\s*const w = \$\("locateWrap"\);\s*if \(w\) w\.hidden = host\.getNames\(\)\.length !== 1;/);
  assert.match(rk, /syncLocate\(\);\s*\}/); // called from syncFindMe (same moments as 👤)
  assert.match(rk, /keepSortedColumnVisible\([^;]*;\s*locatePlayer\(\);/); // after every header sort
  assert.match(rk, /if \(locateEl\.checked\) locatePlayer\(\);/); // when turned on
  const fn = rk.slice(rk.indexOf("function locatePlayer()"), rk.indexOf("window.__lastLocate"));
  assert.match(fn, /if \(k < 0\) return;/);
  assert.match(fn, /box\.scrollTop = /);
  assert.match(fn, /rk-flash/);
  assert.doesNotMatch(fn, /\.focus\(|scrollIntoView|window\.scroll/);
  const css = read("styles.css");
  assert.match(css, /\.rk-filter-row \.rk-locate\[hidden\] \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.rk-filter-row \.rk-remove-ranks, \.rk-filter-row \.rk-locate \{ flex: 1 1 100%; flex-direction: row-reverse; justify-content: space-between; \}/);
});
