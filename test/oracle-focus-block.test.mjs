// Oracle focus block (owner 2026-10-25): OBS block capture needs one exact
// rectangle — header, one facility per line, values + info — no matter the
// names or the base count. The renderer can't be imported in node (its
// modules read `location` at import), so this gates the template and the
// fixed-size CSS in source; test/oracle-focus-browser.test.mjs measures the
// real pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../oracle/js/commander.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../oracle/oracle.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../oracle/js/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../oracle/index.html", import.meta.url), "utf8");

test("focus block: header, one facility per line, values before prose", () => {
  assert.match(js, /<div class="fkindline">/);
  assert.match(js, /\(x\.bases \|\| \[\]\)\.map\(\(b\) => `<div class="fbase">\$\{bl\(b\)\}<\/div>`\)\.join\(""\)/);
  assert.match(js, /<div class="fodds">\$\{tail\}\$\{pocket\}<div class="ftext">\$\{linked\(x\.text, xNames\(x\)\)\}<\/div><\/div>/);
  // the header verb reuses the existing Attack/Defend keys — no new i18n text
  assert.match(js, /tr\("or\.c\.attack", "⚔️ Attack"\)/);
  assert.match(js, /tr\("or\.c\.defend", "🛡️ Defend"\)/);
  // front blocks keep their label; quiet blocks keep their shape
  assert.match(js, /tr\("or\.c\.busiest", "Busiest front:"\)/);
  assert.match(js, /class="focus quiet"/);
});

test("focus box: one fixed height, long names ellipsis, never grows", () => {
  assert.match(css, /\.cmd \.focus \{ height: 132px; overflow: hidden; line-height: 1\.35; \}/);
  assert.match(css, /\.cmd \.focus \.fhead \.fbase \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
});

test("focus pins: commander + main + css move together", () => {
  assert.match(main, /\.\/commander\.js\?v=20261025-foc1/);
  assert.match(html, /js\/main\.js\?v=20261025-foc1/);
  assert.match(html, /oracle\.css\?v=20261025-foc1/);
});
