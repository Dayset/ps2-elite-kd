// build-log reads data/flags.json (scripts/build-flags.mjs) instead of scoring every player file in the browser (t367u).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { keepRow } from "../flags-summary.mjs";

describe("build-flags / build-log", () => {
  it("build-log no longer fetches player files, reads flags.json", () => {
    const html = fs.readFileSync(new URL("../build-log.html", import.meta.url), "utf8");
    assert.match(html, /data\/flags\.json/);
    assert.doesNotMatch(html, /fetchPlayer|"data\/" \+ entry\.file/);
    assert.match(html, /noindex/);
  });
  it("keepRow keeps flagged / sprout / farm / overlay rows only", () => {
    assert.equal(keepRow({ patterns: [] }), false);
    assert.equal(keepRow({ patterns: ["adjusted"] }), true);
    assert.equal(keepRow({ patterns: [], sprout: true }), true);
    assert.equal(keepRow({ patterns: [], slug: "x" }, new Set(["x"])), true);
  });
  it("workflow runs build-flags", () => {
    assert.match(fs.readFileSync(new URL("../.github/workflows/refresh-cache.yml", import.meta.url), "utf8"), /node scripts\/build-flags\.mjs/);
  });
});
