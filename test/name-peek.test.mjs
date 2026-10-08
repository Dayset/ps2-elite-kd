import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAME_MAX_CH, isTruncated, peekPosition } from "../name-peek.mjs";

describe("name-peek helpers", () => {
  it("caps names at 18 characters (≈80% of cached names)", () => {
    assert.equal(NAME_MAX_CH, 18);
  });
  it("detects truncation from scroll vs client width", () => {
    assert.equal(isTruncated({ scrollWidth: 200, clientWidth: 140 }), true);
    assert.equal(isTruncated({ scrollWidth: 140, clientWidth: 140 }), false);
    assert.equal(isTruncated(null), false);
  });
  it("places the popup above the anchor, below when there is no room, inside the viewport", () => {
    const vp = { width: 380, height: 800 };
    const size = { width: 200, height: 40 };
    assert.deepEqual(peekPosition({ left: 100, top: 300, width: 80, bottom: 320 }, size, vp), { left: 40, top: 252 });
    assert.deepEqual(peekPosition({ left: 100, top: 20, width: 80, bottom: 40 }, size, vp), { left: 40, top: 48 });
    assert.deepEqual(peekPosition({ left: 340, top: 300, width: 40, bottom: 320 }, size, vp), { left: 172, top: 252 });
    assert.deepEqual(peekPosition({ left: -50, top: 300, width: 40, bottom: 320 }, size, vp), { left: 8, top: 252 });
  });
});
