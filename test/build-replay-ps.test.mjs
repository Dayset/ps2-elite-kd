// 🎬 #111: `build-replay.mjs --room ps` on a fixture PS cache.
// Guards the PS-only rules: shards keyed by PS key (not slug, so namesakes
// stay apart), class times looked up by key, no faction and no XP fields
// (PS has neither source), and rows without an index key are skipped.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const COLS = ["name", "query", "slug", "savedAt", "adjs", "rf", "act", "pvs", "rkd", "mech", "cons", "inflation", "adj", "ekpm", "own", "coi", "slope", "kd", "kpm", "ownKpm", "acc", "hsr", "ivi", "thin", "mark", "farm", "top", "created", "last", "apk", "revk", "zat", "inf", "infMax", "infVeh", "vcut", "adjsPreVeh", "hut", "hutMk", "vdf", "nbd", "nbh", "rvp", "crp", "trc", "adjs0", "srv"];
const row = (name, slug, srv, adjs) => {
  const o = Object.fromEntries(COLS.map((c) => [c, null]));
  Object.assign(o, { name, query: name, slug, savedAt: 1, adjs, kd: 2, kpm: 1, acc: 20, hsr: 20, ivi: 800, inflation: 1, apk: 0.4, rvp: 50, crp: 50, vdf: 1, srv });
  return COLS.map((c) => o[c]);
};
const playerFile = (display, weaponId) => ({ player: { display, faction: null,
  weapons: { v: 1, rows: [[String(weaponId), 100, 20, 0, 0, 1000, 50, 1000, 500, 600, 100]] },
  rows: [{ name: "Someone", kills: 10, deaths: 10, kpm: 1 }],
  assists: { avg_share: 0.5 } } });

test("--room ps shards by key, keeps namesakes apart, skips unmapped rows", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "build-replay-ps-"));
  try {
    for (const f of ["replay/shard.mjs", "dist.mjs", "trait-scores.mjs", "duels.mjs", "zerg-revive.mjs"]) {
      fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
      fs.symlinkSync(path.join(ROOT, f), path.join(tmp, f));
    }
    const dps = path.join(tmp, "data-ps");
    fs.mkdirSync(path.join(dps, "players"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "assets/weapons"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "assets/weapons/catalog.json"), JSON.stringify({ items: { 7254: ["MSW-R", "LMG", null, null] } }));
    fs.writeFileSync(path.join(dps, "ranks.json"), JSON.stringify({ updatedAt: "2026-11-03T00:00:00.000Z", cols: COLS, rows: [
      row("Dupe", "dupe", "us", 1000), row("Dupe", "dupe", "eu", 1100),
      row("Solo", "solo", "us", 900), row("Ghost", "ghost", "us", 800),
    ] }));
    fs.writeFileSync(path.join(dps, "index.json"), JSON.stringify({ players: [
      { slug: "dupe", key: "us-111", ns: "ps2ps4us" }, { slug: "dupe", key: "eu-222", ns: "ps2ps4eu" },
      { slug: "solo", key: "us-333", ns: "ps2ps4us" },
    ] }));
    fs.writeFileSync(path.join(dps, "players/us-111.json"), JSON.stringify(playerFile("Dupe", 7254)));
    fs.writeFileSync(path.join(dps, "players/eu-222.json"), JSON.stringify(playerFile("Dupe", 7254)));
    fs.writeFileSync(path.join(dps, "players/us-333.json"), JSON.stringify(playerFile("Solo", 7254)));
    fs.writeFileSync(path.join(dps, "class-times.json"), JSON.stringify({ cols: ["hours", "inf", "la", "med", "eng", "ha", "max"],
      players: { "us-111": [100, 10, 10, 10, 10, 50, 10], "eu-222": [200, 20, 20, 20, 20, 10, 10], "us-333": [50, 50, 10, 10, 10, 10, 10] } }));
    fs.writeFileSync(path.join(dps, "duel-ivi-player.json"), JSON.stringify({ v: 1, cuts: { lo99: -100, lo90: -50, hi90: 50, hi99: 100 }, p: { "us-111": [10, 5, 50] } }));
    const out = execFileSync("node", [path.join(ROOT, "scripts/build-replay.mjs"), tmp, "--room", "ps"], { encoding: "utf8" });
    assert.match(out, /replay \[ps\]: 3 players/);
    const meta = JSON.parse(fs.readFileSync(path.join(dps, "replay/meta.json"), "utf8"));
    assert.equal(meta.room, "ps");
    assert.equal(meta.pool, 3, "the unmapped Ghost row is skipped, not emitted under its slug");
    const all = {};
    for (const f of fs.readdirSync(path.join(dps, "replay"))) {
      if (!/^[0-9a-f]{2}\.json$/.test(f)) continue;
      Object.assign(all, JSON.parse(fs.readFileSync(path.join(dps, "replay", f), "utf8")).p);
    }
    assert.deepEqual(Object.keys(all).sort(), ["eu-222", "us-111", "us-333"], "shard keys are PS keys, namesakes apart");
    assert.equal(all["us-111"].v.length, 19);
    assert.deepEqual(all["us-111"].c, [100, 10, 10, 10, 10, 50, 10], "class times looked up by key");
    assert.deepEqual(all["eu-222"].c, [200, 20, 20, 20, 20, 10, 10]);
    assert.equal(all["us-111"].m[0], 7254, "main weapon from the key's player file");
    assert.equal(all["us-111"].f, undefined, "PS has no faction source");
    assert.equal(all["us-111"].x, undefined, "PS has no Honu XP");
    assert.equal(all["us-111"].s, "us");
    assert.equal(all["eu-222"].s, "eu");
    assert.equal(all["us-111"].l, 1, "luck looked up (key, then slug)");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
