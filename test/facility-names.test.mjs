// worker/src/facility-names.js is generated from oracle/backend/*_regions.json (scripts/build-facility-names.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFacilityNames } from "../scripts/build-facility-names.mjs";

test("facility-names.js is in sync with the oracle's region files (run scripts/build-facility-names.mjs)", () => {
  assert.equal(fs.readFileSync(new URL("../worker/src/facility-names.js", import.meta.url), "utf8"), buildFacilityNames());
});
