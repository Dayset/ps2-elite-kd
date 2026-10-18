/**
 * pickGraphForKeys (graph-keys.mjs): the graph whose rect holds the
 * viewport's vertical centre gets the ←/→ key; nothing when neither does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickGraphForKeys } from "../graph-keys.mjs";

const VH = 1000; // viewport centre = 500
const skill = { top: 100, bottom: 600 };
const dist = { top: 700, bottom: 1100 };

describe("pickGraphForKeys", () => {
  it("picks the skill graph when it holds the centre", () => {
    assert.equal(pickGraphForKeys(skill, dist, VH, { distOpen: true, hasPlayers: true }), "skill");
  });
  it("picks the Distribution chart when it holds the centre", () => {
    const low = { top: 100, bottom: 300 };
    const mid = { top: 400, bottom: 900 };
    assert.equal(pickGraphForKeys(low, mid, VH, { distOpen: true, hasPlayers: true }), "dist");
  });
  it("picks neither when both are off-centre (keys keep scrolling)", () => {
    const above = { top: -600, bottom: -100 };
    const below = { top: 1100, bottom: 1600 };
    assert.equal(pickGraphForKeys(above, below, VH, { distOpen: true, hasPlayers: true }), null);
  });
  it("skips a folded Distribution chart", () => {
    const low = { top: 100, bottom: 300 };
    assert.equal(pickGraphForKeys(low, dist, VH, { distOpen: false, hasPlayers: true }), null);
  });
  it("skips the skill graph with no players analysed", () => {
    assert.equal(pickGraphForKeys(skill, dist, VH, { distOpen: true, hasPlayers: false }), null);
  });
  it("overlapping rects: the one whose centre is nearer the middle wins", () => {
    const a = { top: 0, bottom: 1000 }; // centre 500 = dead on
    const b = { top: 400, bottom: 1400 }; // centre 900
    assert.equal(pickGraphForKeys(a, b, VH, { distOpen: true, hasPlayers: true }), "skill");
    assert.equal(pickGraphForKeys(b, a, VH, { distOpen: true, hasPlayers: true }), "dist");
  });
  it("tolerates missing rects", () => {
    const mid = { top: 400, bottom: 900 };
    assert.equal(pickGraphForKeys(null, mid, VH, { distOpen: true, hasPlayers: true }), "dist");
    assert.equal(pickGraphForKeys(skill, null, VH, { distOpen: true, hasPlayers: true }), "skill");
    assert.equal(pickGraphForKeys(null, null, VH, { distOpen: true, hasPlayers: true }), null);
  });
});
