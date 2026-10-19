// columns.html interactive worked example (t445u): numbers come from the same
// playerMetrics() as the main table, the input is prefilled with the demo name,
// unknown names get a "use the main page" note.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exampleFacts, exampleCard, findRanksRow, ranksPool, notCachedHtml, DEMO_NAME } from "../columns-example.mjs";

const ranks = JSON.parse(fs.readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
const html = fs.readFileSync(new URL("../columns.html", import.meta.url), "utf8");

test("demo name is a real, editable input value and the module is loaded", () => {
  assert.match(html, /<input id="exName"[^>]*value="YuigahamaYui"/);
  assert.match(html, /<script type="module" src="columns-example\.mjs/);
  assert.ok(!/build-log/.test(html.replace(/<!--[\s\S]*?-->/g, "")), "never link build-log");
  assert.equal(DEMO_NAME, "YuigahamaYui");
});

test("lookup is case-insensitive and ignores the outfit tag", () => {
  assert.equal(findRanksRow(ranks, "[0EDF] yuigahamayui").slug, "yuigahamayui");
  assert.equal(findRanksRow(ranks, "  YUIGAHAMAYUI ").slug, "yuigahamayui");
  assert.equal(findRanksRow(ranks, "definitely-not-a-cached-name-zz9"), null);
});

test("example ⚔️ iVi equals the ranks.json value (main table) for the demo player", () => {
  const row = findRanksRow(ranks, DEMO_NAME);
  const raw = JSON.parse(fs.readFileSync(new URL(`../data/players/${row.slug}.json`, import.meta.url), "utf8"));
  const pools = { adjs: ranksPool(ranks, "adjs"), ivi: ranksPool(ranks, "ivi") };
  const x = exampleFacts(raw, pools);
  assert.ok(Math.abs(x.adjs - row.adjs) < 0.01);
  const card = exampleCard(x);
  assert.match(card, new RegExp(`<b>Result:</b> ${Math.round(Math.max(0, row.adjs))}, better than`));
  if (row.vcut > 0) assert.match(card, /🚜/);
});

test("not-cached note points to the main page and escapes the name", () => {
  const s = notCachedHtml("[TAG] Foo<b>");
  assert.match(s, /href="index\.html\?names=Foo%3Cb%3E"/);
  assert.ok(!s.includes("<b>"));
});
