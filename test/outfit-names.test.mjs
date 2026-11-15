import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeName, normalizeTag, validName, validTag,
  nameLookupUrl, tagLookupUrl, parseLookup,
  localTaken, isNameTakenLocal, isTagTakenLocal,
  sortNames, filterNames, readNameRows, toNameArrays,
} from "../outfit-names.mjs";
import { readOutfitRows } from "../outfit-stats.mjs";

const root = new URL("../", import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

test("shipped list: 60 names, flat best-60 (no per-faction quota), no collision with the listed outfits", () => {
  const json = readJson("data/outfit-names.json");
  assert.equal(json.v, 1);
  assert.match(json.verifiedAt, /^\d{4}-\d{2}-\d{2}T/, "verifiedAt is an ISO date");
  const rows = readNameRows(json);
  assert.equal(rows.length, 60);
  for (const r of rows) {
    assert.ok(validName(r.name), r.name);
    assert.ok(validTag(r.tag) && r.tag !== "", r.name);
    assert.ok(["vs", "nc", "tr", "nso"].includes(r.fac), r.name);
    assert.ok(["osprey", "wainwright"].includes(r.srv), r.name);
  }
  assert.equal(new Set(rows.map((r) => normalizeName(r.name))).size, 60, "names unique");
  assert.equal(new Set(rows.map((r) => normalizeTag(r.tag))).size, 60, "tags unique");
  const taken = localTaken(readOutfitRows(readJson("data/outfits.json")));
  for (const r of rows) {
    assert.equal(isNameTakenLocal(r.name, taken), false, `${r.name}: name collides with a listed outfit`);
    assert.equal(isTagTakenLocal(r.tag, taken), false, `${r.name}: tag collides with a listed outfit`);
  }
});

const BASE = "https://census.daybreakgames.com/s:daysetps2legends/get/ps2:v2/";

test("normalizeName: trim + collapse + lowercase (trailing-space twins collide)", () => {
  assert.equal(normalizeName("  Recursion   "), "recursion");
  assert.equal(normalizeName("Recursion "), normalizeName("Recursion"));
  assert.equal(normalizeName(" Void Guardians"), "void guardians");
});

test("normalizeTag: brackets + case", () => {
  assert.equal(normalizeTag("[ARD]"), "ard");
  assert.equal(normalizeTag(" ard "), "ard");
});

test("validName / validTag: the shapes seen in the wild", () => {
  assert.equal(validName("Aurora Relay Division"), true);
  assert.equal(validName(""), false);
  assert.equal(validName("A".repeat(33)), false);
  assert.equal(validName("Name's"), false, "no apostrophes in the listed outfits");
  assert.equal(validTag("ARD"), true);
  assert.equal(validTag(""), true, "tag-less outfits exist");
  assert.equal(validTag("ABCDE"), false);
  assert.equal(validTag("[ARD]"), true);
});

test("lookup URLs: lower-cased exact name / tag, PC Census base", () => {
  const n = nameLookupUrl(BASE, "Recursion ");
  assert.ok(n.startsWith(BASE + "outfit?name_lower=recursion&"), n);
  assert.ok(n.includes("c:show=outfit_id,name,alias"), n);
  const t = tagLookupUrl(BASE, "[00]");
  assert.ok(t.includes("outfit?alias_lower=00&"), t);
});

test("parseLookup: empty list = free, rows = taken, error = unknown (never free)", () => {
  assert.deepEqual(parseLookup({ outfit_list: [], returned: 0 }), { taken: false, rows: [] });
  const got = parseLookup({ outfit_list: [{ outfit_id: "1", name: "Recursion", alias: "00", member_count: "303", leader: { world_id: "1" } }], returned: 1 });
  assert.equal(got.taken, true);
  assert.equal(got.rows[0].world, "1");
  assert.deepEqual(parseLookup({ errorCode: "SERVER_ERROR" }), { taken: null, rows: [] });
  assert.deepEqual(parseLookup(null), { taken: null, rows: [] });
});

test("localTaken: normalised collision with listed outfits", () => {
  const taken = localTaken([["1", "00", "Recursion ", "nc", "osprey", 21, 303, 1, 2]]);
  assert.equal(isNameTakenLocal("recursion", taken), true);
  assert.equal(isNameTakenLocal("Recursion", taken), true);
  assert.equal(isNameTakenLocal("Recursions", taken), false);
  assert.equal(isTagTakenLocal("00", taken), true);
  assert.equal(isTagTakenLocal("01", taken), false);
});

test("sortNames: name A–Z, faction, server — both sort", () => {
  const rows = [
    { name: "Zulu", tag: "Z", fac: "tr", srv: "wainwright" },
    { name: "Alpha", tag: "A", fac: "vs", srv: "osprey" },
    { name: "Mid", tag: "M", fac: "nc", srv: "osprey" },
  ];
  assert.deepEqual(sortNames(rows, "name", "asc").map((r) => r.name), ["Alpha", "Mid", "Zulu"]);
  assert.deepEqual(sortNames(rows, "fac", "asc").map((r) => r.fac), ["nc", "tr", "vs"]);
  assert.deepEqual(sortNames(rows, "fac", "desc").map((r) => r.fac), ["vs", "tr", "nc"]);
  assert.deepEqual(sortNames(rows, "srv", "asc").map((r) => r.srv), ["osprey", "osprey", "wainwright"]);
  assert.deepEqual(sortNames(rows, "srv", "desc").map((r) => r.name), ["Zulu", "Alpha", "Mid"]);
});

test("filterNames: text + faction + server filters combine", () => {
  const rows = [
    { name: "Aurora Relay", tag: "ARD", fac: "vs", srv: "osprey" },
    { name: "Aurora Ferry", tag: "AFU", fac: "vs", srv: "wainwright" },
    { name: "Iron Anvil", tag: "IAC", fac: "nc", srv: "osprey" },
  ];
  assert.equal(filterNames(rows, { q: "aurora" }).length, 2);
  assert.equal(filterNames(rows, { q: "aurora", srv: "osprey" }).length, 1);
  assert.equal(filterNames(rows, { fac: "nc" }).length, 1);
  assert.equal(filterNames(rows, { fac: "vs", srv: "wainwright" }).length, 1);
  assert.equal(filterNames(rows, {}).length, 3);
});

test("readNameRows / toNameArrays round-trip", () => {
  const json = { cols: ["name", "tag", "fac", "srv"], rows: [["Aurora Relay Division", "ARD", "vs", "osprey"]] };
  const rows = readNameRows(json);
  assert.equal(rows[0].name, "Aurora Relay Division");
  assert.deepEqual(toNameArrays(rows), json.rows);
  assert.deepEqual(readNameRows({ cols: ["name"], rows: [] }), []);
});
