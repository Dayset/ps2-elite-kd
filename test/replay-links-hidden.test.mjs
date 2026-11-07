// 🎬 Replay entry links hidden for now (owner 2026-11-07, whole replay system
// to be redesigned): no anchor into replay/ may remain in the tables or
// panels — duels-panel.mjs (commit 8df507a1d) or the solo/scrim links
// (stats-table.mjs, rankings.mjs, scrims-panel.mjs). The replay/ page
// itself and the i18n keys stay, so this is a one-commit revert.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["duels-panel.mjs", "stats-table.mjs", "rankings.mjs", "scrims-panel.mjs"];
const src = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("replay entry links hidden", () => {
  for (const f of files) {
    it(`${f}: no anchor into replay/`, () => {
      assert.doesNotMatch(src(f), /href="replay\//, f);
      assert.doesNotMatch(src(f), /replay\/\?/, f);
    });
    it(`${f}: no replay-link helper call remains`, () => {
      assert.doesNotMatch(src(f), /replayLinkHtml\(/, f);
      assert.doesNotMatch(src(f), /replayHtml\(/, f);
      assert.doesNotMatch(src(f), /replayDuelHtml\(/, f);
      assert.doesNotMatch(src(f), /replayVsHtml\(/, f);
    });
  }

  it("i18n keys stay in en.json (one-commit revert)", () => {
    const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
    for (const k of ["replay.open", "scr.replay", "duel.replayDuel", "duel.replayVs"]) {
      assert.ok(k in en, k);
    }
  });
});
