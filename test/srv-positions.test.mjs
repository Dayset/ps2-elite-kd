// 🌍 t812u: third carousel slide — each selected player's rank on their own server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { srvKeyOf } from "../srv-key.mjs";
import { addPcServerColumn } from "../scripts/build-ranks.mjs";

test("srvKeyOf: PC osprey / wainwright, PS us / eu, anything else null", () => {
  assert.equal(srvKeyOf("osprey"), "osprey");
  assert.equal(srvKeyOf("wainwright"), "wainwright");
  assert.equal(srvKeyOf("us", true), "genudine");
  assert.equal(srvKeyOf("eu", true), "ceres");
  assert.equal(srvKeyOf("us"), null, "PS keys mean nothing on PC");
  assert.equal(srvKeyOf("osprey", true), null);
  assert.equal(srvKeyOf(null), null);
  assert.equal(srvKeyOf("soltech"), null);
});

test("addPcServerColumn: merged worlds map to today's servers, SolTech / Jaeger / unknown → null", () => {
  const ranks = { cols: ["name", "query", "slug"], rows: [["a", "a", "a"], ["b", "b", "b"], ["c", "c", "c"], ["d", "d", "d"], ["e", "e", "e"]] };
  const worldBy = new Map([["a", 17], ["b", 13], ["c", 40], ["d", 19]]);
  addPcServerColumn(ranks, worldBy);
  assert.deepEqual(ranks.cols, ["name", "query", "slug", "srv"]);
  assert.deepEqual(ranks.rows.map((r) => r[3]), ["osprey", "wainwright", null, null, null]);
  addPcServerColumn(ranks, worldBy);
  assert.equal(ranks.cols.length, 4, "never added twice");
});

test("carousel has a third slide, rankings fill it, 9-language strings", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/class="sc-slide"/g) || []).length, 3);
  assert.match(html, /id="rkSrvPositions"/);
  const rk = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(rk, /\$\("rkSrvPositions"\)/);
  assert.match(rk, /tableRows\(true\)/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${l}.json`, import.meta.url), "utf8"));
    for (const k of ["sc.srvPositions", "rk.srvRank", "rk.srvTagTip", "rk.srvUnknown", "rk.srvAria"]) assert.ok(j[k], `${l} ${k}`);
    assert.match(j["rk.srvRank"], /\{k\}.*|\{server\}/);
  }
});

test("t813u: order ✨ Stats, 🌍 Server, 🏅 Global; Global tag; remembered slide kept by id", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/class="sc-slide" id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["scSlideStats", "scSlideSrv", "scSlidePos"]);
  const rk = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(rk, /srv-pos-global/);
  assert.match(rk, /rk\.globalTag"/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${l}.json`, import.meta.url), "utf8"));
    for (const k of ["rk.globalTag", "rk.globalTagTip"]) assert.ok(j[k], `${l} ${k}`);
    assert.match(j["rk.globalTagTip"], /\{n\}/);
  }
  const { savedSlideIndex } = await import("../stats-carousel.mjs");
  assert.equal(savedSlideIndex(ids, "scSlidePos", null), 2, "saved id wins");
  assert.equal(savedSlideIndex(ids, null, "1"), 2, "old index 1 (🏅 Global) still opens Global");
  assert.equal(savedSlideIndex(ids, null, "2"), 1, "old index 2 (🌍 Server) still opens Server");
  assert.equal(savedSlideIndex(ids, null, null), 0, "default ✨ Stats");
  assert.equal(savedSlideIndex(ids, "gone", "0"), 0);
});
