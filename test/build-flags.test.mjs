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
    assert.equal(keepRow({ patterns: [], sprout: true }), false);
    assert.equal(keepRow({ patterns: [], farmAcct: {} }), true);
    assert.equal(keepRow({ patterns: [], slug: "x" }, new Set(["x"])), true);
  });
  it("workflow runs build-flags", () => {
    assert.match(fs.readFileSync(new URL("../.github/workflows/refresh-cache.yml", import.meta.url), "utf8"), /node scripts\/build-flags\.mjs/);
  });
});

import { stalkerFlag } from "../red-flags.mjs";
import { classifyBins } from "../bins.mjs";
describe("🚗 vehicle stalker (t369u)", () => {
  it("slow, headshot-free huge K/D = stalker; fast or headshot-heavy aim is not", () => {
    assert.equal(stalkerFlag({ kd: 11, ownKpm: 0.48, hsr: 0.8 }).flagged, true);
    assert.equal(stalkerFlag({ kd: 156, ownKpm: 1.97, hsr: 1 }).flagged, false);
    assert.equal(stalkerFlag({ kd: 9, ownKpm: 0.4, hsr: 45 }).flagged, false);
  });
  it("stalker is its own bin, a red pattern still wins", () => {
    assert.equal(classifyBins({ patterns: ["stalker"] }).bin, "stalker");
    assert.equal(classifyBins({ patterns: ["stalker", "session"] }).bin, "red");
    assert.deepEqual(classifyBins({ patterns: ["stalker", "adjusted"] }).red, []);
  });
});
