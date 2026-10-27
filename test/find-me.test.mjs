// 👤 find-me in the all-players filter (owner t641u): one name in the names box +
// empty filter → 👤 where the ✕ goes; a click fills the filter with that name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

test("👤 find-me button: markup, logic, 9-language hover, static", () => {
  const html = read("index.html");
  assert.match(html, /<span class="rk-search-box">[\s\S]*?<input id="ranksSearch"[^>]*>\s*<button type="button" id="ranksFindMe" class="rk-find-me" hidden [^>]*data-i18n-title="ranks.findMe"[^>]*>👤<\/button>\s*<\/span>/);
  const rk = read("rankings.mjs");
  assert.match(rk, /if \(names\.length !== 1 \|\| bare\(\$\("ranksSearch"\)\.value \|\| ""\)\) return "";/); // 0 / 2+ names or filter text → hidden
  assert.match(rk, /b\.hidden = !n;/);
  assert.match(rk, /i\.value = n;\s*syncFindMe\(\);\s*applyFilter\(\);/); // click → filter, ✕ back
  assert.match(rk, /addEventListener\("input", \(e\) => \{\s*syncFindMe\(\);/); // ✕ / typing → re-check
  assert.match(rk, /function syncPicks\(\{ force = false \} = \{\}\) \{\s*syncFindMe\(\);/); // names box change
  const css = read("styles.css");
  const block = css.slice(css.indexOf(".rk-find-me {"), css.indexOf(".rk-find-me[hidden]"));
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /animation|transition/); // static
  assert.match(css, /\.rk-find-me\[hidden\] \{ display: none; \}/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const v = JSON.parse(read(`i18n/${l}.json`))["ranks.findMe"];
    assert.ok(v && v.startsWith("👤 ") && v.length <= 45 && !v.includes("\n"), `${l}: ${v}`);
  }
  assert.match(read("shared-index.mjs"), /rankings\.mjs\?v=20261027-rfps1/);
});

test("👤 fill does not focus the input (owner t645u: no phone keyboard)", () => {
  const rk = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  const h = rk.slice(rk.indexOf('$("ranksFindMe").addEventListener("click"'));
  const body = h.slice(0, h.indexOf("\n  });") + 6);
  assert.doesNotMatch(body, /\.focus\(/);
  assert.match(body, /\.blur\(\)/);
  assert.match(body, /applyFilter\(\)/);
});


test("filter ✕ is the browser's own search cancel, themed; room for 👤 only while it shows (owner t646u)", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /search-cancel-button/); // no custom ✕ styling
  assert.match(css, /html:not\(\[data-theme="light"\]\) \.rk-filter-row input#ranksSearch \{ color-scheme: dark; \}/);
  assert.match(css, /\.rk-search-box\.has-find-me input\[type="search"\] \{ padding-right: 2\.6rem; \}/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<input id="ranksSearch" type="search"/);
  const rk = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(rk, /classList\.toggle\("has-find-me", !!n\)/);
});
