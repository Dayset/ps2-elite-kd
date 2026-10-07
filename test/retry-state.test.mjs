/** Failed names stay retryable: repeat-Analyze gating + failed bookkeeping. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowGraphReady, forgetFailures } from "../analyze-run.mjs";

const slug = (n) => String(n).toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");

describe("shouldShowGraphReady", () => {
  const loaded = new Set(["ShloDog", "Wrel"]);
  const base = {
    sameSet: true,
    fresh: false,
    names: ["ShloDog", "Wrel"],
    isLoaded: (n) => loaded.has(n),
    isFailed: () => false,
  };
  it("shows the hint only when the same set is fully graphed", () => {
    assert.equal(shouldShowGraphReady(base), true);
  });
  it("never blocks a run when a name failed", () => {
    assert.equal(
      shouldShowGraphReady({ ...base, names: ["ShloDog", "Bogus"], isFailed: (n) => n === "Bogus" }),
      false
    );
  });
  it("never blocks a run when a name is not loaded yet (e.g. failure just cleared)", () => {
    assert.equal(shouldShowGraphReady({ ...base, names: ["ShloDog", "Bogus"] }), false);
  });
  it("runs when fresh is on, the set changed, or there are no names", () => {
    assert.equal(shouldShowGraphReady({ ...base, fresh: true }), false);
    assert.equal(shouldShowGraphReady({ ...base, sameSet: false }), false);
    assert.equal(shouldShowGraphReady({ ...base, names: [] }), false);
  });
});

describe("forgetFailures", () => {
  it("clears failed entries by slug (tag / case insensitive) and counts them", () => {
    const failed = new Map([
      [slug("Bogus"), { name: "Bogus" }],
      [slug("Typo99"), { name: "Typo99" }],
    ]);
    assert.equal(forgetFailures(failed, ["[XYZ] bogus", "Nobody"], slug), 1);
    assert.deepEqual([...failed.keys()], ["typo99"]);
    assert.equal(forgetFailures(failed, ["TYPO99"], slug), 1);
    assert.equal(failed.size, 0);
    assert.equal(forgetFailures(failed, [], slug), 0);
    assert.equal(forgetFailures(failed, undefined, slug), 0);
  });
});

import { honuProfileUrl } from "../analyze-run.mjs";

describe("honuProfileUrl", () => {
  it("builds the Honu profile URL from a character id", () => {
    assert.equal(honuProfileUrl("5428010618035323201"), "https://wt.honu.pw/c/5428010618035323201");
    assert.equal(honuProfileUrl(5428010618035323), "https://wt.honu.pw/c/5428010618035323");
  });
  it("returns empty for missing / invalid ids (legend falls back to plain text)", () => {
    for (const v of [undefined, null, "", "  ", "abc", "123", "1/../x"]) assert.equal(honuProfileUrl(v), "");
  });
});
