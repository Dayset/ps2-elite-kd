// t765u: "[WARP]" in the name field → the outfit's members as chips (outfit-tags.mjs, names-field.mjs commitFragment).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outfitAlias, extractOutfitTags, outfitUrl, membersUrl, outfitServer, pickOutfit, sortMembers, freePlaces, createOutfitTags, INACTIVE_MS } from "../outfit-tags.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 30);
const mem = (name, daysAgo, cid = name) => ({ character_id: cid, c: { name: { first: name }, times: { last_login: String(Math.round((NOW - daysAgo * DAY) / 1000)) } } });

test("a tag on its own is an outfit; [TAG] Name stays a name", () => {
  assert.equal(outfitAlias("[WARP]"), "warp");
  assert.equal(outfitAlias("[hour]"), "hour");
  assert.equal(outfitAlias("[toolong]"), null);
  assert.equal(outfitAlias("[WARP] Sarleyy"), null);
  assert.equal(outfitAlias("Sarleyy"), null);
  assert.deepEqual(extractOutfitTags("[warp]"), { aliases: ["warp"], rest: "" });
  assert.deepEqual(extractOutfitTags("[WARP] [hour]"), { aliases: ["warp", "hour"], rest: "" });
  assert.deepEqual(extractOutfitTags("Bob, [warp], Ann"), { aliases: ["warp"], rest: "Bob, , Ann" });
  assert.deepEqual(extractOutfitTags("[WARP] Sarleyy"), { aliases: [], rest: "[WARP] Sarleyy" });
  assert.deepEqual(extractOutfitTags("[warp] [hour] Bob"), { aliases: ["warp"], rest: "[hour] Bob" });
  assert.deepEqual(extractOutfitTags("[Warp] [WARP]"), { aliases: ["warp"], rest: "" }, "deduped, case-insensitive");
});

test("Census URLs: alias_lower lookup, one member call with names + last login", () => {
  const b = "https://census.daybreakgames.com/s:x/get/ps2:v2/";
  assert.match(outfitUrl(b, "WARP"), /outfit\?alias_lower=warp&/);
  assert.match(outfitUrl(b, "warp"), /characters_world\^on:leader_character_id/);
  const m = membersUrl(b, "37560275229230231");
  assert.match(m, /outfit_member\?outfit_id=37560275229230231&c:limit=10000/);
  assert.match(m, /name\.first'times\.last_login/);
});

test("server: PC from the leader's world, PS from the namespace; several servers → most members", () => {
  assert.equal(outfitServer({ leader: { world_id: "1" } }), "Connery");
  assert.equal(outfitServer({ leader: { world_id: "17" } }), "Emerald");
  assert.equal(outfitServer({}, "https://x/s:y/get/ps2ps4eu:v2/"), "Ceres");
  const { pick, others } = pickOutfit([{ outfit_id: "1", member_count: "2" }, { outfit_id: "2", member_count: "6" }]);
  assert.equal(pick.outfit_id, "2");
  assert.equal(others.length, 1);
  assert.equal(pickOutfit([]).pick, null);
});

test("order: cached first, then most recently active, stop at 6 months inactive", () => {
  const ms = [mem("Old", 400), mem("Fresh", 1), mem("Mid", 30), mem("CachedOld", 900), mem("Edge", 183), mem("Mid", 2), mem("", 1), mem("InField", 1), mem("Gone", 1)];
  const r = sortMembers(ms, { have: ["infield"], isCached: (n) => n === "CachedOld", removed: ({ name }) => name === "Gone", now: NOW });
  assert.deepEqual(r.cached, ["CachedOld"]);
  assert.deepEqual(r.active, ["Fresh", "Mid"]);
  assert.deepEqual(r.inactive, ["Edge", "Old"], "6 months (183 days) or more waits for Fetch all");
  assert.equal(r.already, 1);
  assert.equal(r.total, 7, "unique names, removed one counted as a member");
  assert.equal(INACTIVE_MS, 183 * DAY);
});

test("free places: the 6-name limit, or no limit in the debug view", () => {
  assert.equal(freePlaces(6, 2), 4);
  assert.equal(freePlaces(6, 9), 0);
  assert.equal(freePlaces(Infinity, 50), Infinity);
});

function fakeField({ limit = 6, tokens = [], members, outfits, cached = [] }) {
  const calls = [];
  const $ = {
    nameTokens: tokens.slice(),
    CENSUS_BASES: ["https://census.daybreakgames.com/s:x/get/ps2:v2/"],
    els: {},
    nameLimit: () => limit,
    isCached: (n) => cached.includes(n),
    removedReady: async () => ({ size: 0 }),
    addNameToField: (n) => { if ($.nameTokens.length >= limit) return false; $.nameTokens.push(n); return true; },
    censusJson: async (url) => { calls.push(url); return url.includes("outfit_member") ? { outfit_member_list: members } : { outfit_list: outfits }; },
  };
  return { $, calls, part: createOutfitTags($) };
}

test("expand: unknown tag adds nothing; a known tag fills the free places (2 Census calls, no Honu)", async () => {
  const none = fakeField({ outfits: [], members: [] });
  const [u] = await none.part.expand(["zzzz"]);
  assert.equal(u.unknown, true);
  assert.deepEqual(none.$.nameTokens, []);
  const now = Date.now();
  const at = (d) => String(Math.round((now - d * DAY) / 1000));
  const members = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => ({ character_id: String(i), c: { name: { first: n }, times: { last_login: at(i) } } }));
  members.push({ character_id: "9", c: { name: { first: "Sleepy" }, times: { last_login: at(400) } } });
  const f = fakeField({ tokens: ["Me"], cached: ["G"], members, outfits: [{ outfit_id: "1", alias: "WARP", name: "Endless Warp", member_count: "8", leader: { world_id: "1" } }] });
  const [r] = await f.part.expand(["warp"]);
  assert.deepEqual(f.$.nameTokens, ["Me", "G", "A", "B", "C", "D"], "cached G first, then most recent");
  assert.equal(r.added, 5);
  assert.equal(r.cached, 1);
  assert.equal(r.fresh, 4);
  assert.equal(r.noRoom, 2);
  assert.equal(r.inactive, 1);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((u) => u.startsWith("https://census.daybreakgames.com/")), "Census only");
});

test("Fetch all adds the inactive members (debug view: no limit)", async () => {
  const now = Date.now();
  const at = (d) => String(Math.round((now - d * DAY) / 1000));
  const members = [["A", 1], ["B", 200], ["C", 900]].map(([n, d], i) => ({ character_id: String(i), c: { name: { first: n }, times: { last_login: at(d) } } }));
  const f = fakeField({ limit: Infinity, members, outfits: [{ outfit_id: "1", alias: "HOUR", name: "ONLY PLAY 1HOUR", member_count: "3", leader: { world_id: "1" } }] });
  const [r] = await f.part.expand(["hour"]);
  assert.deepEqual(f.$.nameTokens, ["A"]);
  assert.equal(r.canMore, true);
  const more = f.part.fetchAll();
  assert.equal(more.fresh, 2);
  assert.deepEqual(f.$.nameTokens, ["A", "B", "C"]);
  assert.equal(f.part.fetchAll(), null, "once");
});

test("the field wires it: commitFragment pulls tags, Analyze / Enter wait for the members", () => {
  const nf = read("names-field.mjs");
  assert.match(nf, /extractOutfitTags\(\$\.els\.namesInput\.value\)/);
  assert.match(nf, /outfitPart\(\)\.expand\(aliases\)/);
  const an = read("analyze.mjs");
  assert.match(an, /const \{ rejected, outfits \} = \$\.commitFragment/);
  assert.match(an, /if \(outfits\) return outfits\.then/);
});

test("9 languages: every outfit.* key, same placeholders, no banned words", () => {
  const en = JSON.parse(read("i18n/en.json"));
  const keys = Object.keys(en).filter((k) => k.startsWith("outfit."));
  assert.ok(keys.length >= 14);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const code of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(read(`i18n/${code}.json`));
    for (const k of keys) {
      assert.ok(j[k], `${code}: ${k}`);
      assert.equal(ph(j[k]), ph(en[k]), `${code}: ${k} placeholders`);
      assert.doesNotMatch(j[k], /cheat|track|locat|читер|отслеж|トラッキング/i, `${code}: ${k}`);
    }
  }
  assert.doesNotMatch(read("outfit-tags.mjs"), /cheater/i);
});

test("no animation in the outfit note CSS", () => {
  const css = read("styles.css");
  const block = css.slice(css.indexOf("/* t765u: outfit tag note"));
  assert.doesNotMatch(block.slice(0, 1200).replace(/\/\*[\s\S]*?\*\//g, ""), /animation|transition/);
});
