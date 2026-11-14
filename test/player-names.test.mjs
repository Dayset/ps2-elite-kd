import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_CENSUS_BASE,
  MIN_PLAYER_NAME_LEN,
  MAX_PLAYER_NAME_LEN,
  normalizePlayerName,
  validPlayerName,
  playerLookupUrl,
  parsePlayerLookup,
  holderLabel,
  holdersLabel,
  variantNames,
  checkTargets,
  worldLabel,
} from "../player-names.mjs";

test("name shape: 3–32 letters/digits, digit-start ok, nothing else", () => {
  assert.equal(validPlayerName("Fantom220TR"), true);
  assert.equal(validPlayerName("4UA"), true); // 3 chars, starts with a digit — live in ranks.json
  assert.equal(validPlayerName("xCloneKano"), true);
  assert.equal(validPlayerName("a".repeat(32)), true);
  assert.equal(validPlayerName("ab"), false); // 2 chars: no such names on Census
  assert.equal(validPlayerName("a".repeat(33)), false);
  assert.equal(validPlayerName("A B"), false);
  assert.equal(validPlayerName("A-B"), false);
  assert.equal(validPlayerName("A_B"), false);
  assert.equal(validPlayerName(""), false);
  assert.equal(validPlayerName("  Ghost  "), true); // surrounding spaces are trimmed
  assert.equal(MIN_PLAYER_NAME_LEN, 3);
  assert.equal(MAX_PLAYER_NAME_LEN, 32);
});

test("normalize lower-cases and trims", () => {
  assert.equal(normalizePlayerName("  Fantom220TR "), "fantom220tr");
  assert.equal(normalizePlayerName(""), "");
});

test("lookup URL: exact lower-cased name, world resolved, limit 5", () => {
  const u = playerLookupUrl(PLAYER_CENSUS_BASE, "Fantom220TR");
  assert.ok(u.startsWith(PLAYER_CENSUS_BASE + "character?name.first_lower=fantom220tr"), u);
  assert.ok(u.includes("c:resolve=world"), u);
  assert.ok(u.includes("c:limit=5"), u);
  assert.ok(u.includes("battle_rank.value"), u);
});

test("parse: taken row carries name, faction, BR and world", () => {
  const p = parsePlayerLookup({
    character_list: [{
      character_id: "8261280742797131393",
      name: { first: "Fantom220TR" },
      faction_id: "3",
      battle_rank: { value: "100" },
      world_id: "10",
      times: { last_login: "1700000000" },
    }],
    returned: 1,
  });
  assert.equal(p.taken, true);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.rows[0], {
    id: "8261280742797131393",
    name: "Fantom220TR",
    faction: "TR",
    br: 100,
    world: "10",
    lastLogin: 1700000000,
  });
});

test("parse: empty list is free, error object is unknown (never free)", () => {
  assert.deepEqual(parsePlayerLookup({ character_list: [], returned: 0 }), { taken: false, rows: [] });
  assert.deepEqual(parsePlayerLookup({}), { taken: null, rows: [] });
  assert.deepEqual(parsePlayerLookup({ error: "service_unavailable" }), { taken: null, rows: [] });
  assert.deepEqual(parsePlayerLookup(null), { taken: null, rows: [] });
});

test("parse: PS can return the same name twice on one server", () => {
  const p = parsePlayerLookup({
    character_list: [
      { character_id: "1", name: { first: "Sniper" }, faction_id: "1", battle_rank: { value: "3" }, world_id: "2000" },
      { character_id: "2", name: { first: "Sniper" }, faction_id: "1", battle_rank: { value: "2" }, world_id: "2000" },
    ],
    returned: 2,
  });
  assert.equal(p.taken, true);
  assert.equal(p.rows.length, 2);
  assert.equal(holdersLabel(p.rows), "Sniper · VS · Ceres · BR 3 (+1 more)");
});

test("holder label omits unknown parts", () => {
  assert.equal(
    holderLabel({ name: "Fantom220TR", faction: "TR", br: 100, world: "10" }),
    "Fantom220TR · TR · Wainwright · BR 100"
  );
  assert.equal(holderLabel({ name: "Ghost", faction: "VS", br: null, world: "" }), "Ghost · VS");
  assert.equal(holderLabel(null), "");
  assert.equal(holdersLabel([]), "");
  assert.equal(worldLabel(17), "Osprey");
  assert.equal(worldLabel(10), "Wainwright");
  assert.equal(worldLabel(1000), "Genudine");
  assert.equal(worldLabel(2000), "Ceres");
  assert.equal(worldLabel(19), "Jaeger");
  assert.equal(worldLabel(999), "");
});

test("variants: digit suffixes and x-forms, all creatable", () => {
  assert.deepEqual(variantNames("Ghost"), ["Ghost7", "Ghost99", "xGhost", "GhostX"]);
  assert.deepEqual(variantNames("A7"), ["A77", "A799", "xA7", "A7X"]);
  assert.deepEqual(variantNames("a".repeat(32)), []); // nothing fits under 32
  assert.deepEqual(variantNames(""), []);
});

test("check targets: PC is one namespace, PS is Genudine + Ceres", () => {
  const pc = checkTargets("pc");
  assert.equal(pc.length, 1);
  assert.equal(pc[0].label, "PC");
  assert.ok(pc[0].base.includes("/get/ps2:v2/"), pc[0].base);
  const ps = checkTargets("ps");
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map((t) => t.label), ["Genudine", "Ceres"]);
  assert.ok(ps[0].base.includes("/get/ps2ps4us:v2/"), ps[0].base);
  assert.ok(ps[1].base.includes("/get/ps2ps4eu:v2/"), ps[1].base);
  assert.equal(checkTargets("bogus").length, 1); // unknown room → PC
  assert.equal(checkTargets("").length, 1);
});
