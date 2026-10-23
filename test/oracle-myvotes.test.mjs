// "My votes" card in oracle/js/vote.js — stub fetch, check the rendered rows and the disclaimer.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.localStorage = { getItem: (k) => (k === "ps2oracle_token" ? "tok123" : null) };
const settled = (i, status) => ({ id: i, key: i % 2 ? "1-4-49341" : "10-344-777", outcome: ["VS", "NC", "TR"][i % 3], amount: 50, potential: 92.5,
  reward: status === "won" ? 92.5 : status === "void" ? 50 : 0, pct: 51, status, placed_ts: 1000 - i });
const body = {
  balance: 1234.5, gain: -12.25, own_faction: "VS", bonus_available: false,
  votes: [{ ...settled(0, "open") }, ...Array.from({ length: 12 }, (_, i) => settled(i + 1, ["won", "lost", "void"][i % 3]))],
};
globalThis.fetch = async (url, opt) => { calls.push({ url, opt }); return { status: 200, json: async () => body }; };

const { fetchMyVotes, myVotesHtml, alertName, DISCLAIMER } = await import("../oracle/js/vote.js");

test("alert key maps to server · continent", () => {
  assert.equal(alertName("1-4-49341"), "Osprey · Hossin");
  assert.equal(alertName("10-344-777"), "Wainwright · Oshur");
  assert.equal(alertName("40-8-1"), "SolTech · Esamir");
});

test("My votes: GET /vote/me with the Bearer token, balance, net, last 10 finished rows", async () => {
  const w = await fetchMyVotes();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/vote\/me$/);
  assert.equal(calls[0].opt.headers.Authorization, "Bearer tok123");
  const html = myVotesHtml(w);
  assert.match(html, /My votes/);
  assert.match(html, /BonusCheques <b>1,?234\.5<\/b>/);
  assert.match(html, /Net <b class="lost">−12\.25<\/b>/);
  const rows = html.match(/<div class="mvrow (won|lost|void)">/g) || [];
  assert.equal(rows.length, 10, "10 finished rows, the open vote skipped");
  assert.deepEqual(rows.slice(0, 3).map((r) => r.match(/mvrow (\w+)/)[1]), ["won", "lost", "void"]);
  assert.match(html, /Osprey · Hossin<\/span>\s*<span class="NC">NC<\/span> <span class="mvnum">50 → 92\.5<\/span>\s*<span class="mvst">right<\/span>/);
  assert.doesNotMatch(html, /<table/, "no table (phones)");
  assert.ok(html.includes(DISCLAIMER), "disclaimer on the card");
});

test("My votes: empty state and signed-out", () => {
  assert.match(myVotesHtml({ balance: 1000, gain: 0, votes: [{ status: "open", key: "1-2-3", outcome: "VS", amount: 25 }] }), /No finished votes yet/);
  assert.equal(myVotesHtml(null), "");
});

test("disclaimer: meme currency, no cash value, nothing paid out, fair play, game login", () => {
  for (const re of [/meme currency/, /no cash value/, /nothing is ever paid out/, /can't be bought, sold, traded or cashed out/, /any faction/, /in-game logout/, /cheaters aren't welcome/])
    assert.match(DISCLAIMER, re);
  assert.doesNotMatch(DISCLAIMER, /\bbet|payout|wager|gambl/i);
});
