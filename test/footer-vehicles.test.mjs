// t474u: "What about vehicles?" sits in the footer, on the line after "Thanks to HONU / Varunda".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
for (const page of ["index.html", "live.html"]) {
  test(`${page}: vehicles note is the line right after the HONU thanks, not in the data block`, () => {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /HONU<\/a> \/ Varunda<\/p>\n\s*<!--[^\n]*-->\n\s*<details id="vehiclesNote"/);
    const data = html.slice(html.indexOf('class="footer-data"'), html.indexOf('class="footer-block"'));
    assert.doesNotMatch(data, /vehiclesNote/);
    assert.equal(html.split('id="vehiclesNote"').length, 2, "exactly one copy");
  });
}
