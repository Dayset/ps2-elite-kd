// PlayStation room (#55): PS players never merge with PC players or with each
// other, and every PS pool (ranks, review lists, percentiles) reads data-ps/ only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  upsertPsEntry, psDueAt, psStale, normalizePsDiscovery, psGrowQueue, knownNames, skipNames,
  buildPsPayload, PS_CAP_STEPS,
} from "../scripts/refresh-ps.mjs";
import { buildRanks, buildNames, usePsReviewLists, addServerColumn, roomArg, readHidden } from "../scripts/build-ranks.mjs";
import { normalizePlayer } from "../player-metrics.mjs";
import { isFarmListed } from "../padding.mjs";
import { nextCap } from "../scripts/discovery.mjs";

const DAY = 86400e3;
const NOW = Date.UTC(2026, 9, 22);

/** A Census character row + fetchPlayerCensus-shaped result for a fake PS player. */
function fakePlayer({ cid, name, tag = "", kills = 3000, deaths = 2000, seconds = 300000, opp = 40 }) {
  const c = {
    character_id: cid,
    name: { first: name },
    ...(tag ? { outfit: { alias: tag } } : {}),
    times: { creation: String(Math.floor(NOW / 1000) - 400 * 86400), last_login: String(Math.floor(NOW / 1000) - 3600) },
    stats: { stat_history: [{ stat_name: "kills", all_time: String(kills) }, { stat_name: "deaths", all_time: String(deaths) }, { stat_name: "time", all_time: String(seconds) }] },
  };
  const rows = [];
  for (let i = 0; i < opp; i++) rows.push({ name: `Opp${cid.slice(-3)}x${i}`, kills: 3 + (i % 5), deaths: 2 + (i % 3), kpm: 0.3 + (i % 10) / 10 });
  const r = { own: { kpm: 0.9, acc: 28, hsr: 22, ivi: 28 * 22 }, rows, board: rows, lookups: opp, paceFails: 0, skipped: 0, ownFailed: false };
  return { c, r };
}

test("same name on Genudine and Ceres: two people, two files, two slugs, no overwrite", () => {
  const index = { players: [] };
  const a = upsertPsEntry(index, { key: "us-5428000000000000001", ns: "ps2ps4us", cid: "5428000000000000001", display: "[ABC] Shadow", savedAt: 1 });
  const b = upsertPsEntry(index, { key: "eu-5428000000000000001", ns: "ps2ps4eu", cid: "5428000000000000001", display: "Shadow", savedAt: 2 });
  assert.equal(index.players.length, 2);
  assert.equal(a.file, "players/us-5428000000000000001.json");
  assert.equal(b.file, "players/eu-5428000000000000001.json");
  assert.notEqual(a.slug, b.slug);
  assert.equal(a.slug, "shadow");
  assert.equal(b.slug, "shadow-eu"); // "-" never comes out of a real name's slug
  assert.equal(a.server, "Genudine");
  assert.equal(b.server, "Ceres");
  // Updating one never touches the other.
  upsertPsEntry(index, { key: "eu-5428000000000000001", ns: "ps2ps4eu", cid: "5428000000000000001", display: "Shadow", savedAt: 3 });
  assert.equal(index.players.length, 2);
  assert.equal(index.players.find((p) => p.key === "us-5428000000000000001").savedAt, 1);
  assert.equal(index.players.find((p) => p.key === "eu-5428000000000000001").savedAt, 3);
  // names.json for the PS room carries file + slug, so the page can't rebuild a wrong path from the name.
  const names = buildNames(index, { withFile: true });
  assert.equal(names.count, 2);
  assert.deepEqual(names.players.map((r) => [r[2], r[3]]).sort(), [["players/eu-5428000000000000001.json", "shadow-eu"], ["players/us-5428000000000000001.json", "shadow"]]);
  // The PC names.json shape is unchanged (2 fields per row, PS-style files never listed).
  assert.equal(buildNames(index).count, 0);
});

test("PS payload: PC file shape + room / server, no Honu link (Honu is PC)", () => {
  const { c, r } = fakePlayer({ cid: "5429825812514923825", name: "BrenKill", tag: "PSN" });
  const p = buildPsPayload({ c, ns: "ps2ps4us", r, now: NOW });
  const pcShape = ["display", "cid", "global_kd", "global_kpm", "own_kpm", "acc", "hsr", "ivi", "n_scored", "source", "times", "rows", "curve"];
  for (const k of pcShape) assert.ok(k in p.player, `player.${k}`);
  assert.equal(p.key, "us-5429825812514923825");
  assert.equal(p.player.server, "Genudine");
  assert.equal(p.player.display, "[PSN] BrenKill");
  assert.equal("honu" in p.player, false);
  const np = normalizePlayer(p);
  assert.equal(np.honu, "");
  assert.equal(np.room, "ps");
  assert.equal(np.server, "Genudine");
  // PC players are unchanged: Honu link kept, no room/server keys.
  const pc = normalizePlayer({ player: { display: "X", cid: "5428010618035589553", rows: p.player.rows } });
  assert.ok(pc.honu.startsWith("https://wt.honu.pw/c/5428010618035589553"));
  assert.equal("room" in pc, false);
  assert.equal("server" in pc, false);
});

test("PS ranks read data-ps only: PC hide / farm / review lists never touch a PS player", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-room-"));
  try {
    // Empty PS review lists (the live data-ps/ ones hold real decisions).
    for (const f of ["hidden.json", "reviewed.json", "farm.json", "not-farm.json"]) {
      fs.writeFileSync(path.join(dir, f), JSON.stringify({ players: {} }));
    }
    fs.mkdirSync(path.join(dir, "players"));
    const index = { players: [] };
    // "cheetler" is on the PC hide list and "kklkk" on the PC farm list: same names in the PS room are other people.
    const people = [
      { cid: "5429000000000000011", name: "cheetler", ns: "ps2ps4us" },
      { cid: "5429000000000000012", name: "KKLKK", ns: "ps2ps4eu" },
      { cid: "5429000000000000013", name: "Shadow", ns: "ps2ps4eu" },
    ];
    for (const x of people) {
      const { c, r } = fakePlayer(x);
      const payload = buildPsPayload({ c, ns: x.ns, r, now: NOW });
      fs.writeFileSync(path.join(dir, `players/${payload.key}.json`), JSON.stringify(payload));
      upsertPsEntry(index, { key: payload.key, ns: x.ns, cid: x.cid, display: payload.player.display, savedAt: NOW, top: payload.top });
    }
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
    // Before switching lists the PC farm list is loaded (module import reads data/).
    assert.equal(isFarmListed({ name: "KKLKK" }), true);
    usePsReviewLists(dir);
    assert.equal(isFarmListed({ name: "KKLKK" }), false);
    assert.equal(readHidden(dir).size, 0);
    const ranks = buildRanks(dir);
    assert.equal(ranks.count, 3);
    assert.deepEqual(ranks.rows.map((r) => r[2]).sort(), ["cheetler", "kklkk", "shadow"]);
    addServerColumn(ranks, index);
    assert.equal(ranks.cols.at(-1), "srv");
    assert.deepEqual(Object.fromEntries(ranks.rows.map((r) => [r[2], r.at(-1)])), { cheetler: "us", kklkk: "eu", shadow: "eu" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("build-ranks room flag: only --room ps selects the PS tree", () => {
  assert.equal(roomArg(["node", "build-ranks.mjs"]), "pc");
  assert.equal(roomArg(["node", "build-ranks.mjs", "--room", "ps"]), "ps");
  assert.equal(roomArg(["node", "build-ranks.mjs", "--room", "xbox"]), "pc");
});

test("refresh tiers by activity, dormant never; due list is per key", () => {
  const st = { players: {} };
  const week = { key: "us-5429000000000000001", savedAt: NOW - 8 * DAY, last: Math.floor((NOW - DAY) / 1000) };
  const fresh = { key: "eu-5429000000000000002", savedAt: NOW - 2 * DAY, last: Math.floor((NOW - DAY) / 1000) };
  const dead = { key: "eu-5429000000000000003", savedAt: NOW - 400 * DAY, last: Math.floor((NOW - 400 * DAY) / 1000) };
  assert.equal(psDueAt(dead, st, NOW), Infinity);
  assert.deepEqual(psStale({ players: [week, fresh, dead] }, st, NOW), ["us-5429000000000000001"]);
});

test("discovery: one sweep per server, one ranked queue keyed by server + cid", () => {
  const disc = normalizePsDiscovery(null, NOW);
  assert.deepEqual(Object.keys(disc.servers), ["ps2ps4us", "ps2ps4eu"]);
  assert.equal(disc.cap, PS_CAP_STEPS[0]);
  disc.servers.ps2ps4us.queue = [{ cid: "5429000000000000100", name: "Twin", fights: 300, created: 1, seen: NOW }];
  disc.servers.ps2ps4eu.queue = [{ cid: "5429000000000000100", name: "Twin", fights: 500, created: 1, seen: NOW },
    { cid: "5429000000000000101", name: "Cached", fights: 900, created: 1, seen: NOW }];
  const index = { players: [{ key: "eu-5429000000000000101", ns: "ps2ps4eu", name: "Cached" }] };
  const q = psGrowQueue(disc, index, { players: {} }, NOW);
  assert.deepEqual(q.map((x) => x.key), ["eu-5429000000000000100", "us-5429000000000000100"]);
  assert.deepEqual([...knownNames(index, "ps2ps4eu")], ["cached"]);
  assert.equal(knownNames(index, "ps2ps4us").size, 0);
  const st = { players: { "us-5429000000000000200": { ns: "ps2ps4us", nameLower: "ghostname", kind: "notfound", fails: 1, lastAttemptAt: NOW } } };
  assert.deepEqual([...skipNames(st, "ps2ps4us", NOW)], ["ghostname"]);
  assert.equal(skipNames(st, "ps2ps4eu", NOW).size, 0);
  // Cap ladder: same rule as PC with PS steps.
  assert.equal(nextCap({ cap: 1000, indexSize: 1000, steps: PS_CAP_STEPS }), 2000);
  assert.equal(nextCap({ cap: 1000, indexSize: 10, steps: PS_CAP_STEPS }), 1000);
});

test("the PS refresh script never writes outside data-ps/ and refuses ROOM=pc", () => {
  const src = fs.readFileSync("scripts/refresh-ps.mjs", "utf8");
  assert.match(src, /const DATA_DIR = path\.join\(ROOT, ROOM\.dataDir\)/);
  assert.match(src, /export const ROOM = ROOMS\.ps;/);
  assert.doesNotMatch(src, /["'`]data\//); // no literal data/ path anywhere
  assert.match(src, /only refreshes the PlayStation room/);
});

test("the PS hide list keeps the Ceres farm-ring accounts out of PS Rankings (by character id, PS only)", async () => {
  const { hiddenList } = await import("../hidden.mjs");
  const h = hiddenList(JSON.parse(fs.readFileSync("data-ps/hidden.json", "utf8")));
  for (const cid of ["5429807370268020465", "5429807370267977649", "5429807370268025905", "5429807370268020081", "5429807370268025937", "5429807370268060497"]) {
    assert.ok(h.match({ cid }), `hidden ${cid}`);
  }
  // PC's hide list is a different file and holds none of them.
  const pc = hiddenList(JSON.parse(fs.readFileSync("data/hidden.json", "utf8")));
  assert.equal(pc.match({ cid: "5429807370268020465" }), null);
});
