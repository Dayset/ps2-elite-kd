// 💩 confirmed-padder penalty (2026-10-19): −10% adjusted iVi, fixed drop at or below 0, owner override.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { padderPenalty, isPenalizedPadder, setReviewed, PADDER_PENALTY_REF, POOP_TIP } from "../padding.mjs";

const real = JSON.parse(fs.readFileSync(new URL("../data/reviewed.json", import.meta.url), "utf8"));

describe("💩 padder penalty", () => {
  it("−10% for a positive score, fixed drop at or below zero (always goes down)", () => {
    assert.equal(padderPenalty(1000), 900);
    assert.ok(Math.abs(padderPenalty(-12) - (-12 - 0.1 * PADDER_PENALTY_REF)) < 1e-9);
    assert.ok(padderPenalty(0) < 0);
    for (const v of [-3000, -12, 0, 1, 450, 2500]) assert.ok(padderPenalty(v) < v);
    assert.equal(padderPenalty(null), null);
  });
  it("applies to every confirmed padder in reviewed.json, by slug or display name", () => {
    setReviewed(real);
    const pads = Object.entries(real.players).filter(([, e]) => e.decision === "padding").map(([s]) => s);
    assert.ok(pads.length >= 1);
    for (const s of pads) assert.ok(isPenalizedPadder(s), s);
    assert.ok(isPenalizedPadder("[LHEU] Megatake"));
    assert.ok(!isPenalizedPadder("zugie"));
  });
  it("owner override wins: penalty cleared or decision cleared → no 💩, no penalty", () => {
    setReviewed({ players: { a: { decision: "padding", penalty: "cleared" }, b: { decision: "cleared" }, c: { decision: "padding" } } });
    assert.ok(!isPenalizedPadder("a"));
    assert.ok(!isPenalizedPadder("b"));
    assert.ok(isPenalizedPadder("c"));
    setReviewed(real);
  });
  it("hover text explains it and says who to contact", () => {
    assert.match(POOP_TIP, /stat padding/i);
    assert.match(POOP_TIP, /−10%/);
    assert.match(POOP_TIP, /contact the site owner/i);
  });
  it("ranks.json carries the penalized numbers and status.json lists before / after", () => {
    const st = JSON.parse(fs.readFileSync(new URL("../data/status.json", import.meta.url), "utf8")).padderPenalty;
    assert.ok(st && st.players.length >= 1);
    const rk = JSON.parse(fs.readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
    const ia = rk.cols.indexOf("adjs0") >= 0 ? rk.cols.indexOf("adjs0") : rk.cols.indexOf("adjs"), is = rk.cols.indexOf("slug"); // before the 🪳 evening-out (#84)
    for (const p of st.players.filter((x) => x.status === "penalized")) {
      assert.ok(p.after < p.before, p.slug);
      assert.ok(p.rankAfter > p.rankBefore, p.slug);
      const row = rk.rows.find((r) => r[is] === p.slug);
      assert.ok(row && Math.abs(row[ia] - p.after) < 0.06, p.slug);
    }
  });
});
