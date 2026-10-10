import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmedPadders, farmAccountLabels, splitFarm } from "../padding.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("wall of shame (hidden misc.html, user t295u)", () => {
  it("confirmedPadders lists only 'padding' decisions", () => {
    const r = { players: { b: { decision: "padding", at: "2026-10-09" }, a: { decision: "padding" }, c: { decision: "bad-luck" }, d: { decision: "nope" } } };
    assert.deepEqual(confirmedPadders(r).map((x) => x.slug), ["a", "b"]);
    assert.deepEqual(confirmedPadders(null), []);
  });

  it("farm accounts are names / IDs only, never kill/death counts", () => {
    const f = splitFarm([{ name: "vulcan112", kills: 300, deaths: 0, kpm: 0 }, { name: "5429109374136598737", kills: 200, deaths: 0, kpm: 0 }, { name: "real", kills: 50, deaths: 40, kpm: 1 }]);
    const labels = farmAccountLabels(f);
    assert.deepEqual(labels, ["vulcan112", "5429109374136598737"]);
    assert.ok(labels.every((l) => !/\d+\/\d+/.test(l)));
  });

  it("all 7 confirmed padders are recorded and Megatake's farm accounts show by name", () => {
    const reviewed = JSON.parse(read("data/reviewed.json"));
    const slugs = confirmedPadders(reviewed).map((x) => x.slug);
    for (const s of ["megatake", "guidetooblivion", "unicorn0nketamin", "rxxpvs", "xzhuzhu", "chennuo1", "nirl"]) assert.ok(slugs.includes(s), s);
    const m = playerMetrics(normalizePlayer(JSON.parse(read("data/players/megatake.json"))));
    const labels = farmAccountLabels(m.farm);
    for (const n of ["vulcan112", "battletank112", "hammer111"]) assert.ok(labels.includes(n), n);
  });

  it("page is hidden: noindex, not linked from public pages / sitemap / robots / README", () => {
    const html = read("misc.html");
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.ok(!/\d+\s*\/\s*\d+.*kills|v\.kills|v\.deaths/.test(html), "no kill/death counts on the page");
    for (const f of ["index.html", "ranks.html", "app.js", "sitemap.xml", "robots.txt", "README.md"]) assert.ok(!read(f).includes("misc.html"), f);
  });
});
