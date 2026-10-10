// t312u: desktop puts 🔍 Analyze left-aligned directly under the names field; phones unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("names box takes the full row on ≥601px so Analyze wraps under it", () => {
  assert.match(css, /@media \(min-width: 601px\) \{\s*\.controls \.names-box \{ flex: 1 1 100%; \}\s*\}/);
});
test("DOM order: names box → Analyze → 🔗, Rankings row unchanged (centred grid)", () => {
  const a = index.indexOf('id="namesBox"'), b = index.indexOf('id="analyzeBtn"'), c = index.indexOf('id="copyLinkBtn"');
  assert.ok(a > 0 && a < b && b < c);
  assert.match(css, /grid-template-columns: 1fr auto 1fr;/);
});
