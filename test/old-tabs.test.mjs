// 🗂️ Tracker data tabs (old-tabs.mjs, owner 2026-10-28): one row; kill feed · weapons · Census table.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OLD_TAB_PANELS } from "../old-tabs.mjs";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("one tab row ABOVE the ✨ skill table, in order: Census / Fisu / Honu, kill feed, weapons", () => {
  assert.deepEqual(OLD_TAB_PANELS.map((p) => p.id), ["pub", "kf", "wp"]);
  const at = (s) => index.indexOf(s);
  const order = [at('id="namesBox"'), at('<section id="oldTabs"'), at('class="old-tabs"'), at('id="statsPublic"'), at('<details id="killFeedSection"'), at('<details id="weaponsSection"'), at('<section id="statsCarousel"'), at('<details id="chartSection"')];
  order.forEach((v, i) => { assert.ok(v > 0, `missing #${i}`); if (i) assert.ok(order[i - 1] < v, `order #${i}`); });
  const block = index.slice(at('<section id="oldTabs"'), at('<section id="statsCarousel"'));
  assert.equal(index.split('id="statsPublic"').length, 2);
  assert.equal(index.split('id="killFeedSection"').length, 2);
  assert.equal(index.split('id="weaponsSection"').length, 2);
  assert.doesNotMatch(block, /<details[^>]*\sopen/);
});

test("all closed by default, one open at a time, no animation, labels from the translated summaries", () => {
  const js = readFileSync(new URL("../old-tabs.mjs", import.meta.url), "utf8");
  assert.match(js, /if \(o && j !== i && o\.open\) o\.open = false/);
  assert.match(js, /const opening = !d\.open;/);
  const st = readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(st, /let publicStatsOpen = false;/);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const blk = css.slice(css.indexOf("/* 🗂️ Tracker data tabs"));
  assert.match(blk, /\.old-tabs \{ display: flex; flex-wrap: wrap;/);
  assert.match(blk, /#oldTabs details:not\(\[open\]\) \{ display: none; \}/);
  assert.doesNotMatch(blk.replace(/\/\*[\s\S]*?\*\//g, ""), /transition|animation/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${l}.json`, import.meta.url), "utf8"));
    for (const k of ["otab.aria", "kf.title", "wp.title", "stats.publicHead", "kf.iviTip"]) assert.ok(j[k], `${l} ${k}`);
  }
});
