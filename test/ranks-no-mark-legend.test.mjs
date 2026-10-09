// t290u: Rankings has no collapsed "♿ What † * ◦ mean" legend; the marks keep
// their hover tooltips on names. The main page's note is untouched.
import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ranks = fs.readFileSync(new URL("../ranks.html", import.meta.url), "utf8");
it("ranks.html: no mark legend, marks keep tooltips", () => {
  assert.ok(!/marks-note/.test(ranks), "marks-note legend removed");
  assert.ok(!/♿ What \$\{/.test(ranks), "no '♿ What … mean' summary");
  assert.match(ranks, /class="pad-mark mark-\$\{r\.markKind\}" title="/);
  assert.match(ranks, /class="sample-legacy" title="\$\{esc\(LEGACY_SAMPLE_TIP\)\}"/);
});
