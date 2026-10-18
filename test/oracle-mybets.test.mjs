// #20: "My bets" card in oracle/js/bet.js — stub fetch, check the rendered rows.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.localStorage = { getItem: (k) => (k === "ps2oracle_token" ? "tok123" : null) };
const settled = (i, status) => ({ id: i, key: i % 2 ? "1-4-49341" : "10-344-777", outcome: ["VS", "NC", "TR"][i % 3], stake: 50, shares: 92.5,
  payout: status === "won" ? 92.5 : status === "void" ? 47.5 : 0, pct: 51, status, placed_ts: 1000 - i });
const body = {
  balance: 1234.5, profit: -12.25, own_faction: "VS", bonus_available: false,
  bets: [{ ...settled(0, "open") }, ...Array.from({ length: 12 }, (_, i) => settled(i + 1, ["won", "lost", "void"][i % 3]))],
};
globalThis.fetch = async (url, opt) => { calls.push({ url, opt }); return { status: 200, json: async () => body }; };

const { fetchMyBets, myBetsHtml, alertName } = await import("../oracle/js/bet.js");

test("alert key maps to server · continent", () => {
  assert.equal(alertName("1-4-49341"), "Osprey · Hossin");
  assert.equal(alertName("10-344-777"), "Wainwright · Oshur");
  assert.equal(alertName("40-8-1"), "SolTech · Esamir");
});

test("My bets: GET /bet/me with the Bearer token, balance, profit, last 10 settled rows", async () => {
  const w = await fetchMyBets();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/bet\/me$/);
  assert.equal(calls[0].opt.headers.Authorization, "Bearer tok123");
  const html = myBetsHtml(w);
  assert.match(html, /My bets/);
  assert.match(html, /Balance <b>1,?234\.5<\/b>/);
  assert.match(html, /Total profit <b class="lost">−12\.25<\/b>/);
  const rows = html.match(/<div class="mbrow (won|lost|void)">/g) || [];
  assert.equal(rows.length, 10, "10 settled rows, the open bet skipped");
  assert.deepEqual(rows.slice(0, 3).map((r) => r.match(/mbrow (\w+)/)[1]), ["won", "lost", "void"]);
  assert.match(html, /Osprey · Hossin<\/span>\s*<span class="NC">NC<\/span> <span class="mbnum">50 → 92\.5<\/span>\s*<span class="mbst">won<\/span>/);
  assert.doesNotMatch(html, /<table/, "no table (phones)");
});

test("My bets: empty state and signed-out", () => {
  assert.match(myBetsHtml({ balance: 1000, profit: 0, bets: [{ status: "open", key: "1-2-3", outcome: "VS", stake: 25 }] }), /No settled bets yet/);
  assert.equal(myBetsHtml(null), "");
});
