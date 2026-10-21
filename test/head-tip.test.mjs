import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { richParts } from "../head-tip.mjs";

describe("head-tip richParts (**bold** in tip strings)", () => {
  it("plain text passes through as one part", () => {
    assert.deepEqual(richParts("💀 Who wins fights: kills per death."), [
      { b: false, s: "💀 Who wins fights: kills per death." },
    ]);
  });
  it("a ** pair becomes a bold part (the 🎯 IN THEORY tip)", () => {
    assert.deepEqual(richParts("🎯 Who aims best **IN THEORY**: lines lifted."), [
      { b: false, s: "🎯 Who aims best " },
      { b: true, s: "IN THEORY" },
      { b: false, s: ": lines lifted." },
    ]);
  });
  it("multiple pairs and an unmatched ** stay safe", () => {
    assert.deepEqual(richParts("**a** and **b** and **oops"), [
      { b: true, s: "a" },
      { b: false, s: " and " },
      { b: true, s: "b" },
      { b: false, s: " and **oops" },
    ]);
  });
  it("empty input gives no parts", () => {
    assert.deepEqual(richParts(""), []);
    assert.deepEqual(richParts(null), []);
  });
});
