// #80: data/cid-names.json (character id → name) lets the 🎥 live page show a known victim's name with no Census call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cidNameEntry } from "../live-model.mjs";
import { buildCidNames } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("cidNameEntry (live page map reader)", () => {
  it("reads plain names and [name, faction] pairs", () => {
    const map = { 111: "Alpha", 222: ["Bravo", "nc"], 333: ["Charlie", "xx"], 444: "", 555: [42], 666: "  Spaced " };
    assert.deepEqual(cidNameEntry(map, "111"), { name: "Alpha", faction: "" });
    assert.deepEqual(cidNameEntry(map, 222), { name: "Bravo", faction: "nc" });
    assert.deepEqual(cidNameEntry(map, "333"), { name: "Charlie", faction: "" }, "an unknown faction tag is dropped, the name kept");
    assert.equal(cidNameEntry(map, "444"), null, "empty name = miss");
    assert.equal(cidNameEntry(map, "555"), null, "malformed = miss, never a wrong name");
    assert.deepEqual(cidNameEntry(map, "666"), { name: "Spaced", faction: "" });
    assert.equal(cidNameEntry(map, "999"), null);
    assert.equal(cidNameEntry(map, "toString"), null, "no prototype keys");
    assert.equal(cidNameEntry(null, "111"), null);
  });
});

describe("buildCidNames (refresh run)", () => {
  it("maps cached players and queued discoveries, tag stripped, faction when known, removed players left out, sorted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cid-names-"));
    try {
      fs.mkdirSync(path.join(dir, "players"));
      const players = [
        { slug: "zed", display: "[ABC] Zed", cid: "5428000000000000003", faction: "tr" },
        { slug: "amy", display: "Amy", cid: "5428000000000000001" },
        { slug: "gone", display: "Gone", cid: "5428000000000000002", faction: "vs" },
        { slug: "nocid", display: "NoCid" },
      ];
      for (const p of players) fs.writeFileSync(path.join(dir, "players", `${p.slug}.json`), JSON.stringify({ player: { display: p.display, cid: p.cid, faction: p.faction, rows: [] } }));
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ players: players.map((p) => ({ name: p.display, file: `players/${p.slug}.json`, slug: p.slug })).concat([{ name: "Missing", file: "players/missing.json" }]) }));
      fs.writeFileSync(path.join(dir, "discovery.json"), JSON.stringify({ queue: [{ cid: "5428000000000000004", name: "Newbie" }, { cid: "5428000000000000001", name: "AmyOld" }, { name: "NoId" }] }));
      fs.writeFileSync(path.join(dir, "opt-out.json"), JSON.stringify({ players: { "5428000000000000002": { name: "Gone", at: "2026-10-23", proof: "oracle sign-in" } } }));
      const map = buildCidNames(dir);
      assert.deepEqual(map, {
        "5428000000000000001": "Amy",
        "5428000000000000003": ["Zed", "tr"],
        "5428000000000000004": "Newbie",
      });
      assert.deepEqual(Object.keys(map), Object.keys(map).slice().sort(), "sorted by cid: unchanged cache, unchanged file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the committed map is small and well-formed (real data/)", () => {
    const f = path.join(root, "data", "cid-names.json");
    const size = fs.statSync(f).size;
    assert.ok(size < 1.5e6, `data/cid-names.json stays in the ~1 MB ballpark: ${size} bytes`);
    const map = JSON.parse(fs.readFileSync(f, "utf8"));
    const entries = Object.entries(map);
    assert.ok(entries.length > 1000, `has names: ${entries.length}`);
    for (const [cid, v] of entries.slice(0, 2000)) {
      assert.match(cid, /^\d{5,25}$/);
      assert.ok(cidNameEntry(map, cid), `readable entry for ${cid}`);
      assert.doesNotMatch(cidNameEntry(map, cid).name, /^\[/, "no outfit tag");
    }
  });
});

describe("wiring", () => {
  it("build-ranks writes the map on PC runs; the refresh stores the faction from the same Census row", () => {
    const br = read("scripts/build-ranks.mjs");
    assert.match(br, /if \(room === "pc"\) \{\s*try \{\s*const cidNames = buildCidNames\(dataDir\);\s*fs\.writeFileSync\(path\.join\(dataDir, "cid-names\.json"\)/);
    const rc = read("scripts/refresh-cache.mjs");
    assert.match(rc, /const faction = FACTION_TAG\[c\.faction_id\] \|\| "";/);
    assert.match(rc, /\.\.\.\(faction \? \{ faction \} : \{\}\),/);
  });

  it("live page: map fetched once at start, name shown before data, unknown = ?, never a raw #id", () => {
    const js = read("live.mjs");
    assert.match(js, /const cidNamesP = getJson\("data\/cid-names\.json"\)/);
    const person = js.slice(js.indexOf("async function person(cid)"), js.indexOf("const fmt = (v, d) =>"));
    assert.match(person, /hit = cidNameEntry\(await cidNamesP, cid\)/);
    assert.match(person, /if \(!hit \|\| !hit\.faction\)/, "no Census call at all when the map knows name + faction (and the player is cached)");
    assert.match(person, /: `\$\{CHAR\(cid\)\}&c:show=character_id,name\.first,faction_id`\);/, "a map miss asks name + faction first, without stat_history");
    assert.match(js, /if \(!p\.named\) return `<span class="lv-pn"><span class="lv-name lv-unk"><bdi>\?<\/bdi>/);
    const on = js.slice(js.indexOf("const onEvent = (ev) =>"), js.indexOf("async function commitEvent"));
    assert.match(on, /if \(pp && pp\.nameP\) pp\.nameP\.then\(render, render\);/);
  });
});
