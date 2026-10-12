// t290u: Rankings has no collapsed "♿ What † * ◦ mean" legend; the marks keep
// their hover tooltips on names. The main page's note is untouched.
import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rankingsSource } from "./rankings-src.mjs";

const ranks = rankingsSource();
it("ranks.html: no mark legend, marks keep tooltips", () => {
  assert.ok(!/marks-note/.test(ranks), "marks-note legend removed");
  assert.ok(!/♿ What \$\{/.test(ranks), "no '♿ What … mean' summary");
  assert.match(ranks, /class="pad-mark mark-\$\{\["padding","adjusted"\]\.includes\(r\.markKind\)/);
  assert.match(ranks, /class="sample-legacy" title="\$\{esc\(LEGACY_SAMPLE_TIP\)\}"/);
});
