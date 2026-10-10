// t315u: main page names in full on wide screens (stats table, legend, cache chips);
// phones keep the 18ch cap. The 390px pixel check is done at release time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const block = (mq) => { const i = css.lastIndexOf(`@media (${mq}) {\n  .stats-table .nm`); assert.ok(i > 0, mq); return css.slice(i, css.indexOf("\n}", i)); };

test("phones keep the 18ch cap and 10rem legend columns", () => {
  assert.match(css, /\.nm \{\s*display: inline-block;\s*max-width: 18ch;/);
  assert.match(css, /\.chip \.nm \{ max-width: min\(18ch, 100%\); \}/);
  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 10rem\), 1fr\)\);/);
});
test(">600px: 28ch, >1100px: 42ch for stats + cache chips; wider legend columns", () => {
  const a = block("min-width: 601px"), b = block("min-width: 1100px");
  assert.match(a, /\.stats-table \.nm \{ max-width: 28ch; \}/);
  assert.match(a, /\.chip \.nm \{ max-width: min\(28ch, 100%\); \}/);
  assert.match(a, /minmax\(min\(100%, 16rem\), 1fr\)/);
  assert.match(b, /\.stats-table \.nm \{ max-width: 42ch; \}/);
  assert.match(b, /\.chip \.nm \{ max-width: min\(42ch, 100%\); \}/);
  assert.match(b, /minmax\(min\(100%, 21rem\), 1fr\)/);
});
