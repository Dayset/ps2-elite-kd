// #82 dashboard helpers (oracle/js/link.js, oracle/js/vote.js): the one-time link in the #fragment, the QR SVG,
// factions already backed on an alert, and what a refused vote or bonus says. The Worker side is test/oracle-devices.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

test("dashboard helpers: link code from the #fragment, stripped hash, voted factions, refusal texts", async () => {
  const { linkCodeFromHash, hashWithoutLink, qrSvg } = await import("../oracle/js/link.js");
  const code = "Ab-_".repeat(10) + "xyz";
  assert.equal(linkCodeFromHash("#link=" + code), code);
  assert.equal(linkCodeFromHash("#x=1&link=" + code), code);
  assert.equal(linkCodeFromHash("#link=short"), "", "malformed codes are ignored");
  assert.equal(linkCodeFromHash("#link=" + code + "<script>"), "");
  assert.equal(linkCodeFromHash(""), "");
  assert.equal(hashWithoutLink("#link=" + code), "");
  assert.equal(hashWithoutLink("#x=1&link=" + code + "&y=2"), "#x=1&y=2");
  const svg = qrSvg("https://dayset.github.io/ps2-elite-kd/oracle/#link=" + code, "One-time sign-in code");
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill="white"/, "white quiet zone in both themes");
  assert.doesNotMatch(svg, /width="\d+px"/, "scalable");

  const { votedFactions, voteErrorText } = await import("../oracle/js/vote.js");
  const w = { votes: [{ key: "1-4-9", outcome: "VS" }, { key: "1-4-9", outcome: "NC" }, { key: "1-6-2", outcome: "TR" }] };
  assert.deepEqual([...votedFactions(w, "1-4-9")].sort(), ["NC", "VS"]);
  assert.equal(votedFactions(null, "1-4-9").size, 0);
  assert.match(voteErrorText("already_voted", { vote: { outcome: "VS" } }), /already voted VS on this alert \(maybe from another device\)/);
  assert.match(voteErrorText("insufficient_balance", { balance: 12.5 }), /you have 12\.5 \(it may have changed on another device\)/);
  assert.equal(voteErrorText("insufficient_balance", {}), "Not enough BonusCheques.");
  assert.match(voteErrorText("already_claimed_today"), /already claimed \(maybe on another device\)/);
  assert.match(voteErrorText("odds_changed"), /odds moved/);
  assert.equal(voteErrorText("weird"), "Couldn't record the vote.");
});
