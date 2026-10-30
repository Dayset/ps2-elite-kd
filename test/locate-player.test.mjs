// owner t648u/t649u: "Remove ranks" → "Hide ranks"; 2026-10-30: the button reads
// "Ranks" (pressed = show) and "Locate player" became a one-shot "Find player" button.
// Phones: search row, then Ranks + Find + Age on one row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const LANGS = ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"];

test("Ranks button + Find player button labels", () => {
  const en = JSON.parse(read("i18n/en.json"));
  assert.equal(en["ranks.showRanks"], "Ranks");
  assert.equal(en["ranks.showRanksTitle"], "Show the tier separators in the Rankings table");
  assert.equal(en["ranks.findPlayer"], "Find player");
  // Old keys are kept, never deleted — just no longer used in the page.
  assert.equal(en["ranks.removeRanks"], "Hide ranks");
  assert.equal(en["ranks.locate"], "Locate player");
  for (const l of LANGS) {
    const d = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["ranks.removeRanks", "ranks.removeRanksTitle", "ranks.locate", "ranks.locateTitle"]) assert.ok(d[k] && d[k].length <= 80, `${l} ${k}`);
    if (l !== "en") assert.notEqual(d["ranks.locate"], en["ranks.locate"], `${l} translated`);
  }
  const html = read("index.html");
  assert.doesNotMatch(html, />Hide ranks</);
  assert.doesNotMatch(html, /id="locateToggle"/);
  assert.match(html, /<button type="button" class="rk-find-btn rk-remove-ranks" id="removeRanksToggle" aria-pressed="false"[^>]*data-i18n="ranks.showRanks">Ranks<\/button>/);
  assert.doesNotMatch(html, /<input type="checkbox" id="removeRanksToggle" \/>/);
  assert.match(html, /<span class="rk-locate" id="locateWrap" hidden>\s*<button type="button" class="rk-find-btn" id="findPlayerBtn"[^>]*data-i18n="ranks\.findPlayer">Find player<\/button>/);
  assert.ok(html.indexOf('id="removeRanksToggle"') < html.indexOf('id="findPlayerBtn"'), "next to Ranks");
});

test("Find player logic: one name only, one-shot, no focus, quiet when missing", () => {
  const rk = read("rankings.mjs");
  assert.match(rk, /function syncLocate\(\) \{\s*const w = \$\("locateWrap"\);\s*if \(w\) w\.hidden = host\.getNames\(\)\.length !== 1;/);
  assert.match(rk, /syncLocate\(\);\s*\}/); // called from syncFindMe (same moments as 👤)
  assert.match(rk, /findBtn\.addEventListener\("click", \(\) => \{\s*locatedFor = "";\s*locatePlayer\(true\);\s*\}\);/);
  assert.match(rk, /function locatePlayer\(manual = false\) \{\s*if \(\(!manual && !locateOn\(\)\) \|\| !renderState \|\| picked\.size !== 1\) return;/);
  const fn = rk.slice(rk.indexOf("function locatePlayer(manual"), rk.indexOf("window.__lastLocate"));
  assert.match(fn, /if \(k < 0\) return;/);
  assert.match(fn, /box\.scrollTop = /);
  assert.match(fn, /rk-flash/);
  assert.doesNotMatch(fn, /\.focus\(|scrollIntoView|window\.scroll/);
  const css = read("styles.css");
  assert.match(css, /\.rk-filter-row \.rk-locate\[hidden\] \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.rk-filter-row \{ gap: 0\.5rem; \}\s*\.rk-filter-row \.rk-remove-ranks, \.rk-filter-row \.rk-locate \{ flex: 0 1 auto; flex-direction: row; \}\s*\.rk-filter-row \.rk-max-age \{ flex: 0 1 auto; \}\s*\}/);
});

// owner 2026-10-30: the t655u sticky re-apply behavior left with the switch —
// the Find button locates once per tap; there is no auto-locate after sorts.
// (relocateSoon / locateOn stay in the code but no-op: no toggle to be on.)
