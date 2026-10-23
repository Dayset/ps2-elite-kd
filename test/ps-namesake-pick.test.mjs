// PS namesakes (owner 2026-10-23, Furkancimen3NS0 on Genudine + Ceres): a
// ticked namesake could not be unticked. Each character (by id) must tick and
// untick on its own; the bare name in the names box picks the character this
// browser fetched, and that character's fresh copy never lands on the other row.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { matchPicks } from "../pick-sync.mjs";
import { mergeFreshRows, rankRow, RANK_COLS } from "../rank-row.mjs";
import { rankingsSource } from "./rankings-src.mjs";

const US = "5429699760501712033", EU = "5429699762425851601";
const rows = [
  { name: "[A] Twin", query: `us-${US}`, slug: "twin-us" },
  { name: "Twin", query: `eu-${EU}`, slug: "twin" },
  { name: "Solo", query: "Solo", slug: "solo" },
];

describe("PS namesake picks", () => {
  it("bare name → the character this browser resolved it to (cid beats slug)", () => {
    const us = matchPicks(["Twin"], rows, 10, { cidOf: () => US });
    assert.deepEqual(us.map((h) => [h.query, h.src]), [[`us-${US}`, "Twin"]]);
    const eu = matchPicks(["Twin"], rows, 10, { cidOf: () => EU });
    assert.deepEqual(eu.map((h) => h.query), [`eu-${EU}`]);
    // Unknown cid → old slug/name fallback.
    assert.equal(matchPicks(["Twin"], rows, 10, { cidOf: () => null }).length, 1);
  });
  it("server keys pick exactly one row each; single-server names unchanged", () => {
    const h = matchPicks([`us-${US}`, `eu-${EU}`, "solo"], rows, 10, { cidOf: () => US });
    assert.deepEqual(h.map((x) => x.query), [`us-${US}`, `eu-${EU}`, "Solo"]);
    assert.deepEqual(matchPicks(["Solo"], rows).map((x) => x.src), ["Solo"]);
  });
  it("untick removes the names-box entry that picked the row", () => {
    const src = rankingsSource();
    assert.match(src, /host\.toggleName\(want \? q : pickedSrc\.get\(q\) \|\| q, inp, want\)/);
    assert.match(src, /matchPicks\(host\.getNames\(\), data\.rows, maxNames\(\), \{ cidOf \}\)/);
  });
});

describe("PS namesake fresh copy", () => {
  it("a keyed row takes only its own character's browser copy and keeps its key", () => {
    const f = (k) => `data-ps/players/${k}.json`;
    if (!fs.existsSync(f(`us-${US}`)) || !fs.existsSync(f(`eu-${EU}`))) return;
    const rawUs = JSON.parse(fs.readFileSync(f(`us-${US}`), "utf8"));
    const rawEu = JSON.parse(fs.readFileSync(f(`eu-${EU}`), "utf8"));
    const q = RANK_COLS.indexOf("query");
    const rUs = rankRow(rawUs, { slug: "furkancimen3ns0-us", savedAt: 1000 }); rUs[q] = `us-${US}`;
    const rEu = rankRow(rawEu, { slug: "furkancimen3ns0", savedAt: 1000 }); rEu[q] = `eu-${EU}`;
    const now = Date.now();
    const pUs = rawUs.player || rawUs;
    // The browser fetched the bare name → the US character, stored under the bare slug.
    const store = { furkancimen3ns0: { name: "Furkancimen3NS0", savedAt: now, fetchedAt: now, player: { ...pUs, cid: US } } };
    const { rows: out } = mergeFreshRows({ cols: RANK_COLS.slice(), rows: [rUs, rEu] }, store, { now });
    assert.equal(out[1], rEu, "EU row never gets the US character's copy");
    assert.equal(out[0][q], `us-${US}`, "US row keeps its server key");
    assert.equal(out[0][3], now, "US row uses the fresher browser copy");
  });
});
