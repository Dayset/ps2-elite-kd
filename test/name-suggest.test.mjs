/**
 * Name suggestions (name-suggest.mjs): pure helpers only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CHARS,
  suggestFragment,
  censusSuggestUrl,
  parseCensusSuggestions,
  namesFromRanks,
  localMatches,
  mergeSuggestions,
  replaceFragment,
} from "../name-suggest.mjs";

describe("suggestFragment", () => {
  it("needs at least 4 characters", () => {
    assert.equal(MIN_CHARS, 4);
    assert.equal(suggestFragment("sim"), null);
    assert.equal(suggestFragment("simp"), "simp");
  });

  it("uses only the name being typed after earlier names", () => {
    assert.equal(suggestFragment("Dayset, Simplen"), "Simplen");
    assert.equal(suggestFragment("Dayset Sim"), null);
  });

  it("stays quiet right after a separator (the name was just committed)", () => {
    assert.equal(suggestFragment("Simplenubb "), null);
    assert.equal(suggestFragment("Simplenubb,"), null);
  });

  it("ignores text that can't be a character name", () => {
    assert.equal(suggestFragment("[TAG]"), null);
    assert.equal(suggestFragment("abc-d"), null);
    assert.equal(suggestFragment(""), null);
  });
});

describe("censusSuggestUrl", () => {
  it("builds a lower-case starts-with query sorted by last login", () => {
    const url = censusSuggestUrl("https://census.daybreakgames.com/s:x/get/ps2:v2/", "SimpleN");
    assert.ok(url.startsWith("https://census.daybreakgames.com/s:x/get/ps2:v2/character?"));
    assert.ok(url.includes("name.first_lower=%5Esimplen"));
    assert.ok(url.includes("c:sort=times.last_login:-1"));
    assert.ok(url.includes("c:limit=10"));
  });
});

describe("parseCensusSuggestions", () => {
  it("reads name, faction, BR and last login", () => {
    const out = parseCensusSuggestions({
      character_list: [
        { character_id: "1", name: { first: "Simplenubb" }, times: { last_login: "1792169438" }, battle_rank: { value: "89" }, faction_id: "1" },
        { character_id: "2", name: { first: "SimplenubbNS" }, faction_id: "4" },
      ],
    });
    assert.deepEqual(out[0], { name: "Simplenubb", faction: "VS", br: 89, lastLogin: 1792169438, source: "census" });
    assert.equal(out[1].faction, "NSO");
    assert.equal(out[1].br, null);
  });

  it("returns [] for errors and skips malformed names", () => {
    assert.deepEqual(parseCensusSuggestions({ error: "throttled" }), []);
    assert.deepEqual(parseCensusSuggestions(null), []);
    assert.deepEqual(parseCensusSuggestions({ character_list: [{ name: { first: "bad name" } }, {}] }), []);
  });
});

describe("local matches and merging", () => {
  const ranks = {
    cols: ["name", "query"],
    rows: [
      ["[lKPM] Simplenubb", "Simplenubb"],
      ["[1KPM] SimplenubbTR", "SimplenubbTR"],
      ["Other", "Other"],
    ],
  };

  it("reads bare names from ranks.json", () => {
    const names = namesFromRanks(ranks);
    assert.equal(names.length, 3);
    assert.equal(names[0].display, "[lKPM] Simplenubb");
    assert.deepEqual(namesFromRanks(null), []);
  });

  it("matches cached names by prefix, case-insensitive, shortest first", () => {
    const m = localMatches(namesFromRanks(ranks), "simpLE");
    assert.deepEqual(m.map((x) => x.name), ["Simplenubb", "SimplenubbTR"]);
    assert.equal(m[0].source, "cached");
  });

  it("puts cached names first, adds Census faction/BR, removes duplicates", () => {
    const local = localMatches(namesFromRanks(ranks), "simp");
    const remote = [
      { name: "simplenubb", faction: "VS", br: 89, source: "census" },
      { name: "SimplenubbNC", faction: "NC", br: 22, source: "census" },
    ];
    const out = mergeSuggestions(local, remote);
    assert.deepEqual(out.map((x) => x.name), ["simplenubb", "SimplenubbTR", "SimplenubbNC"]);
    assert.equal(out[0].source, "cached");
    assert.equal(out[0].faction, "VS");
  });

  it("leaves out names already in the box and respects the limit", () => {
    const remote = [{ name: "SimplenubbNC", source: "census" }, { name: "SimplenubbNS", source: "census" }];
    assert.deepEqual(mergeSuggestions([], remote, ["simplenubbnc"]).map((x) => x.name), ["SimplenubbNS"]);
    assert.equal(mergeSuggestions([], remote, [], 1).length, 1);
  });

  describe("adjusted iVi (⚔️) in suggestions (owner 2026-10-22)", () => {
    const ranks2 = {
      cols: ["name", "query", "adjs"],
      rows: [
        ["GingerBaby", "GingerBaby", 812],
        ["GingerBabyNC", "GingerBabyNC", 1905],
        ["GingerBabyTR", "GingerBabyTR", null],
        ["GingerBabyX", "GingerBabyX", 1905],
      ],
    };

    it("reads adjs from ranks.json (null when absent)", () => {
      const names = namesFromRanks(ranks2);
      assert.equal(names[0].adjs, 812);
      assert.equal(names[2].adjs, null);
    });

    it("local matches lead with the strongest, unrated last", () => {
      const m = localMatches(namesFromRanks(ranks2), "ginger");
      assert.deepEqual(m.map((x) => x.name), ["GingerBabyX", "GingerBabyNC", "GingerBaby", "GingerBabyTR"]);
    });

    it("merged list sorts by ⚔️; a merged row keeps Census BR + cached ⚔️; Census-only goes last", () => {
      const local = localMatches(namesFromRanks(ranks2), "ginger");
      const remote = [
        { name: "GingerBaby", faction: "NC", br: 120, source: "census" },
        { name: "GingerBabyNew", faction: "VS", br: 5, source: "census" },
      ];
      const out = mergeSuggestions(local, remote);
      assert.deepEqual(out.map((x) => x.name), ["GingerBabyX", "GingerBabyNC", "GingerBaby", "GingerBabyTR", "GingerBabyNew"]);
      const g = out.find((x) => x.name === "GingerBaby");
      assert.equal(g.adjs, 812);
      assert.equal(g.br, 120);
      assert.equal(g.source, "cached");
    });
  });
});

describe("PlayStation namesakes (owner 2026-10-23: suggestions pick the exact character)", () => {
  const psRanks = {
    cols: ["name", "query", "adjs", "srv"],
    rows: [
      ["Furkancimen3NS0", "us-5429699760501712033", 1774, "us"],
      ["Furkancimen3NS0", "eu-5429699762425851601", 1575, "eu"],
      ["KingOfNSO", "KingOfNSO", 1805, "us"],
    ],
  };

  it("keeps keyed rows and carries the exact pick key + server", () => {
    const names = namesFromRanks(psRanks);
    assert.equal(names.length, 3);
    assert.deepEqual(names.map((n) => n.query), ["us-5429699760501712033", "eu-5429699762425851601", "KingOfNSO"]);
    assert.equal(names[0].name, "Furkancimen3NS0");
    assert.equal(names[1].srv, "eu");
  });

  it("local matches list both twins, strongest first, each with its own key", () => {
    const m = localMatches(namesFromRanks(psRanks), "furk");
    assert.deepEqual(m.map((x) => x.query), ["us-5429699760501712033", "eu-5429699762425851601"]);
  });

  it("a Census namesake never merges into a twin or displaces one", () => {
    const local = localMatches(namesFromRanks(psRanks), "furk");
    const remote = [{ name: "Furkancimen3NS0", faction: "TR", br: 100, source: "census" }];
    const out = mergeSuggestions(local, remote);
    assert.deepEqual(out.map((x) => x.query), ["us-5429699760501712033", "eu-5429699762425851601"]);
  });

  it("excluding one twin's key leaves the other twin offered", () => {
    const local = localMatches(namesFromRanks(psRanks), "furk");
    const out = mergeSuggestions(local, [], ["eu-5429699762425851601"]);
    assert.deepEqual(out.map((x) => x.query), ["us-5429699760501712033"]);
  });

  it("an unkeyed PS name still pairs with its Census row and keeps its key", () => {
    const local = localMatches(namesFromRanks(psRanks), "king");
    const remote = [{ name: "KingOfNSO", faction: "NSO", br: 112, source: "census" }];
    const out = mergeSuggestions(local, remote);
    assert.equal(out.length, 1);
    assert.equal(out[0].query, "KingOfNSO");
    assert.equal(out[0].br, 112);
    assert.equal(out[0].adjs, 1805);
  });
});

describe("replaceFragment", () => {
  it("swaps the typed fragment for the picked name and adds a space", () => {
    assert.equal(replaceFragment("simp", "Simplenubb"), "Simplenubb ");
    assert.equal(replaceFragment("Dayset, simp", "Simplenubb"), "Dayset, Simplenubb ");
    assert.equal(replaceFragment("Dayset simp", "Simplenubb"), "Dayset Simplenubb ");
  });
});
