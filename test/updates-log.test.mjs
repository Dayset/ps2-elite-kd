// Update log (updates.html): [bot] commits are hidden by default and only
// non-bot commits are visible and counted (owner 2026-11-25). The log used
// to hide only chore(cache); the bot also commits ps-room, scrims, outfits,
// luck, duels and spawn-camp refreshes — 96 of the last 100 commits — so the
// log now filters every [bot] commit and pages until it holds real changes.
// test-select: imports only
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "updates.html"), "utf8");

const botFn = html.match(/const isBot = (\(c\) => [^\n]+)/);
assert.ok(botFn, "isBot defined in updates.html");
const isBot = eval(botFn[1]); // the shipped predicate, run against real shapes
const commit = (message, login = "github-actions[bot]") => ({
  commit: { message },
  author: login ? { login } : null,
});

describe("update log bot filter", () => {
  it("hides every bot refresh pattern from the real log", () => {
    for (const msg of [
      "chore(ps-room): refresh, 27 player file(s), 0 new [bot]",
      "chore(cache): discovery refresh, 55 player file(s), 0 new [bot]",
      "chore(cache): scheduled refresh, 60 player file(s), 0 new [bot]",
      "chore(ps-scrims): 51 scrims, 359 files [bot]",
      "chore(outfits): outfit iVi dataset [bot]",
      "chore(luck): daily 🎲 Luck rebuild [bot]",
      "chore(duels): ladder + eval report [bot]",
      "chore(spawn-camp): weekly PC sample + bar re-measure [bot]",
    ]) assert.ok(isBot(commit(msg)), `bot: ${msg}`);
  });

  it("hides a bot commit even without the message marker (author login)", () => {
    assert.ok(isBot(commit("refresh data", "github-actions[bot]")));
    assert.ok(isBot(commit("refresh data", "some-bot[bot]")));
  });

  it("keeps real commits, including ones that merely mention bots", () => {
    for (const [msg, login] of [
      ["Hide 🧼 Pure on PlayStation; debug columns no longer squeeze the name column (20261120-pspure1)", "Muse"],
      ["🗳️ All my votes: checkbox to hide the vote-check buttons", "Muse"],
      ["🪦 Suppress the inactive mark while a player is live-online", "Muse"],
      ["fix the bot handling in the refresh script", "Dayset"],
    ]) assert.ok(!isBot(commit(msg, login)), `real: ${msg}`);
  });

  it("pages until it holds real commits, then stops", () => {
    assert.match(html, /const VISIBLE_TARGET = 20;/);
    assert.match(html, /const MAX_PAGES = 4;/);
    assert.match(html, /fetch\(API \+ "&page=" \+ page/);
    assert.match(html, /if \(commits\.filter\(\(c\) => !isBot\(c\)\)\.length >= VISIBLE_TARGET\) break;/);
    assert.match(html, /if \(data\.length < 100\) break;/);
  });

  it("toggle and hidden count cover bot refreshes, not just cache", () => {
    assert.match(html, /id="showBot" \/>\s*show bot refreshes/);
    assert.match(html, /" bot refresh" \+ \(hidden === 1 \? "" : "es"\) \+ " hidden/);
    assert.doesNotMatch(html, /isCache|showCache|routine cache refresh/);
  });
});
