// columns.html interactive worked example (t445u): numbers come from the same
// playerMetrics() as the main table, the input is prefilled with the demo name,
// unknown names get a "use the main page" note.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exampleFacts, exampleCard, findRanksRow, ranksPool, notCachedHtml, DEMO_NAME, rowZerg, rowCells } from "../columns-example.mjs";

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
  const x = exampleFacts(raw, pools, { zerg: rowZerg(ranks, row) });
  assert.ok(Math.abs(x.adjs - row.adjs) < 0.06, `${x.adjs} vs ${row.adjs}`);
  const card = exampleCard(x);
  assert.match(card, new RegExp(`<b>Result:</b> ${Math.round(row.adjs)}, better than`));
  if (row.vcut > 0) assert.match(card, /🚜/);
});

test("not-cached note points to the main page and escapes the name", () => {
  const s = notCachedHtml("[TAG] Foo<b>");
  assert.match(s, /href="index\.html\?names=Foo%3Cb%3E"/);
  assert.ok(!s.includes("<b>"));
});

// 2026-11-02 columns page pass: the example row shows the main ✨ Stats table's columns, in its order,
// with the ranks.json values; every column card has a value slot and the headers link to the cards.
test("example row: main-table columns, ranks.json values, cards and links on the page", () => {
  const row = findRanksRow(ranks, DEMO_NAME);
  const cells = rowCells(ranks, row);
  assert.deepEqual(cells.map((c) => c.id), ["adjs", "act", "pvs", "rf", "rkd", "cons", "luck", "apk", "zerg", "combinedivi", "g", "inf"]);
  const by = Object.fromEntries(cells.map((c) => [c.id, c]));
  assert.equal(by.adjs.text, String(Math.round(row.adjs)));
  assert.equal(by.rkd.text, row.rkd.toFixed(3));
  assert.equal(by.g.text, "21.44%", "demo G is the two-factor product score");
  assert.equal(by.g.pct, null, "G is a share, no better/worse bar");
  for (const c of cells) if (c.pct != null) assert.ok(c.pct >= 0 && c.pct <= 99, c.id + " percentile");
  assert.equal(by.inf.pct, null, "infantry is a share, no better/worse bar");
  for (const c of cells) {
    assert.ok(html.includes(`<td data-ex="${c.id}">`), "row cell " + c.id);
    assert.ok(html.includes(`class="cx-val" data-ex="${c.id}"`), "card value " + c.id);
  }
  for (const id of ["ivi", "activity", "brave", "resist", "matchup-kd", "const", "luck", "assists", "zerg", "combinedivi", "g", "infantry"]) {
    assert.ok(html.includes(`href="#${id}"`) && html.includes(`id="${id}"`), id);
  }
});

// 2026-11-08: every public (non-debug) column has a full "How it's measured"
// section, not just a one-line tip — 🎲 Luck, 🤝 Assists and 🪖 Infantry were
// one-liners while 🪳 Zerg / 🧘‍♂️ Pure iVi / 🌈 G had formula + example + note.
test("docs: every public column has a 'How it's measured' section", () => {
  const en = JSON.parse(fs.readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8"));
  for (const [id, keys] of [
    ["luck", ["cp.luckSkill", "cp.luckL1", "cp.luckL2", "cp.luckNote"]],
    ["assists", ["cp.apkL1", "cp.apkL2", "cp.apkNote"]],
    ["infantry", ["cp.infL1", "cp.infL2"]],
    ["zerg", ["cp.zergNote"]],
    ["combinedivi", ["cp.combinediviL1", "cp.combinediviL2", "cp.combinediviL3"]],
    ["g", ["cp.gL1", "cp.gL2", "cp.gNote"]],
  ]) {
    const card = html.slice(html.indexOf(`id="${id}"`));
    assert.ok(card.includes("How it’s measured"), `${id} has a How it's measured section`);
    for (const k of keys) {
      assert.ok(card.includes(`data-i18n-html="${k}"`) || card.includes(`data-i18n="${k}"`), `${id} uses ${k}`);
      assert.ok(typeof en[k] === "string" && en[k].length > 0, `${k} exists in en.json`);
    }
  }
});
test("worked example: seven static items incl. the 🪳 Zerg line; emoji links not underlined", () => {
  const ex = html.slice(html.indexOf('id="worked-example"'), html.indexOf('<hr class="st-debug-sep"'));
  assert.equal((ex.match(/<li>/g) || []).length, 7, "static example has seven items");
  assert.ok(ex.includes('<a href="#zerg-adj">🪳</a> Zerg'), "static example has the Zerg item");
  assert.ok(ex.includes('<a href="#vehicle-cut">🚜</a> vehicle kills'), "static example has the vehicle item");
  assert.match(html, /#exCard a \{ text-decoration: none; \}/, "emoji links in the example carry no underline");
});
