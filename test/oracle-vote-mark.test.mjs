// Dashboard-only join: history rows mark the signed-in player's own votes
// (oracle/js/vote.js myVoteMark + "oracle:votes" event -> oracle/js/results.js).
// vote.js is imported the same way test/oracle-myvotes.test.mjs does it
// (localStorage stub; myVoteMark itself fetches nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.localStorage = { getItem: () => null };

const { myVoteMark } = await import("../oracle/js/vote.js");

const vote = (key, outcome, status) => ({ key, outcome, status });
const KEY = "10-4-49341", OTHER = "10-6-777";

test("no votes, null votes, or no vote on this alert -> no marker", () => {
  assert.equal(myVoteMark([], KEY), "");
  assert.equal(myVoteMark(null, KEY), "");
  assert.equal(myVoteMark([vote(OTHER, "VS", "won")], KEY), "");
});

test("one vote -> ballot + faction + translated result", () => {
  assert.equal(
    myVoteMark([vote(KEY, "NC", "won")], KEY),
    '\u{1F5F3}\uFE0F <span class="myvote"><span class="NC">NC</span> right</span>');
  assert.match(myVoteMark([vote(KEY, "VS", "lost")], KEY), /VS<\/span> wrong/);
  assert.match(myVoteMark([vote(KEY, "TR", "void")], KEY), /TR<\/span> given back/);
});

test("several votes on one alert (one per faction) all show", () => {
  const m = myVoteMark([vote(KEY, "VS", "won"), vote(KEY, "NC", "lost"), vote(OTHER, "TR", "won")], KEY);
  assert.match(m, /VS<\/span> right/);
  assert.match(m, /NC<\/span> wrong/);
  assert.doesNotMatch(m, /TR<\/span>/);
});

test("unknown status is shown raw, never silently dropped", () => {
  assert.match(myVoteMark([vote(KEY, "VS", "open")], KEY), /VS<\/span> open/);
});

test("outcome is escaped", () => {
  assert.doesNotMatch(myVoteMark([vote(KEY, "<script>", "won")], KEY), /<script>/);
});

const voteSrc = readFileSync(new URL("../oracle/js/vote.js", import.meta.url), "utf8");
const resultsSrc = readFileSync(new URL("../oracle/js/results.js", import.meta.url), "utf8");

test("wiring: vote.js dispatches oracle:votes on wallet change, results.js listens and marks rows", () => {
  assert.ok(voteSrc.includes('dispatchEvent(new CustomEvent("oracle:votes"'), "vote.js dispatches oracle:votes");
  assert.ok(voteSrc.includes("emitVotes()"), "vote.js calls emitVotes on wallet loads");
  assert.ok(resultsSrc.includes('addEventListener("oracle:votes"'), "results.js listens for oracle:votes");
  assert.ok(resultsSrc.includes("myVoteMark(myVotes, a.key)"), "renderHist marks each row with myVoteMark");
  assert.ok(resultsSrc.includes('from "./vote.js?v='), "results.js imports vote.js with a version tag");
});
