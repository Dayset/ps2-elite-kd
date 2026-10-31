// Settled alert tabs (owner 2026-10-31): a settled alert's tab shows its
// final territory, not the latest map snapshot — post-end ticks can carry
// a post-lock map (e.g. TR-only) that is not the result. No final falls
// back to the latest snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("settled tabs show final territory, not latest snapshot (owner 2026-10-31)", () => {
  const main = read("../oracle/js/main.js");
  assert.match(main, /const terr = a\.status === "settled" && a\.final \? a\.final : \(a\.state && a\.state\.territory\) \|\| \{\};/);
});
