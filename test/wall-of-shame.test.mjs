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

import { statMark, markNote, confirmedPadderSlugs, CONFIRMED_PADDING_TIP } from "../padding.mjs";
import { reviewFlags } from "../red-flags.mjs";
import { rankRow, RANK_COLS, buildRanks } from "../scripts/build-ranks.mjs";

describe("confirmed padders always get * (reviewed.json 'padding', t295u follow-up)", () => {
  const farm = splitFarm([{ name: "botA", kills: 120, deaths: 0, kpm: 0 }, { name: "real", kills: 900, deaths: 700, kpm: 1 }]);
  it("below the 20% line: † normally, * when confirmed; tooltip has names, no share or counts", () => {
    assert.ok(farm.share < 0.2);
    assert.equal(statMark(farm).kind, "adjusted");
    const mk = statMark(farm, undefined, { confirmed: true });
    assert.equal(mk.kind, "padding");
    assert.equal(mk.mark, "*");
    assert.ok(mk.tip.startsWith(CONFIRMED_PADDING_TIP));
    assert.match(mk.tip, /botA/);
    assert.ok(!/%|\d+\/\d+/.test(mk.tip), mk.tip);
    assert.ok(!/%|\d+\/\d+/.test(markNote(farm, { confirmed: true })));
    assert.equal(statMark({ victims: [] }, undefined, { confirmed: true }).kind, "padding", "even with no farm in the current sample");
  });
  it("reviewFlags: confirmed → 'padding' (📉 🌾 bin), not 'adjusted', not 🚩", () => {
    const m = { farm, raw: {} };
    const f = reviewFlags(m, { confirmed: true });
    assert.ok(f.patterns.includes("padding"));
    assert.ok(!f.patterns.includes("adjusted"));
    assert.equal(f.red, false);
  });
  it("all 7 confirmed padders get mark 'padding' in ranks rows (live data)", () => {
    const slugs = confirmedPadderSlugs(JSON.parse(read("data/reviewed.json")));
    assert.equal(slugs.size >= 7, true);
    const ranks = buildRanks(path.join(root, "data"));
    const mi = RANK_COLS.indexOf("mark");
    const fi = RANK_COLS.indexOf("farm");
    for (const s of ["megatake", "guidetooblivion", "unicorn0nketamin", "rxxpvs", "xzhuzhu", "chennuo1", "nirl"]) {
      const row = ranks.rows.find((r) => r[2] === s);
      assert.ok(row, s);
      assert.equal(row[mi], "padding", s);
      assert.ok(!/%/.test(row[fi] || ""), s + " farm note has no share");
    }
    const unconfirmed = rankRow(JSON.parse(read("data/players/guidetooblivion.json")), { slug: "guidetooblivion" });
    assert.notEqual(unconfirmed[mi], "padding", "without the review it's the 20% rule");
  });
});
