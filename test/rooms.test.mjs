// Rooms (#55): PC and PlayStation never share a data tree, a namespace or an identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROOMS, ALL_NAMESPACES, PS_SERVERS, parseRoom, pageRoom, dataPrefix, censusNsBase, nsOfBase,
  psKey, parsePsKey, psPlayerFile, psServer, withRoom, roomById,
} from "../rooms.mjs";
import { CENSUS_NAMESPACES } from "../worker/src/worker.js";

test("two rooms, disjoint namespaces and data trees", () => {
  assert.deepEqual(Object.keys(ROOMS), ["pc", "ps"]);
  assert.deepEqual(ROOMS.pc.namespaces, ["ps2"]);
  assert.deepEqual(ROOMS.ps.namespaces, ["ps2ps4us", "ps2ps4eu"]);
  assert.equal(ROOMS.pc.namespaces.filter((n) => ROOMS.ps.namespaces.includes(n)).length, 0);
  assert.equal(dataPrefix("pc"), "data/");
  assert.equal(dataPrefix("ps"), "data-ps/");
  assert.equal(dataPrefix("nonsense"), "data/");
  assert.equal(roomById(undefined).id, "pc");
});

test("the Worker's Census proxy allowlist equals the rooms' namespaces", () => {
  assert.deepEqual([...CENSUS_NAMESPACES].sort(), [...ALL_NAMESPACES].sort());
});

test("only an explicit room=ps opens the PlayStation room; default stays PC", () => {
  assert.equal(parseRoom(""), "pc");
  assert.equal(parseRoom("?names=ShloDog"), "pc");
  assert.equal(parseRoom("?room=ps&names=Shadow"), "ps");
  assert.equal(parseRoom("?room=PS"), "ps");
  assert.equal(parseRoom("?room=pc"), "pc");
  assert.equal(parseRoom("?room=xbox"), "pc");
  assert.equal(pageRoom({ pathname: "/ps2-elite-kd/", search: "?room=ps" }), "ps");
  // Live stays PC-only (owner 2026-10-21).
  assert.equal(pageRoom({ pathname: "/ps2-elite-kd/live.html", search: "?room=ps" }), "pc");
  assert.equal(pageRoom(null), "pc");
});

test("Census bases per namespace; unknown namespaces refused", () => {
  assert.equal(censusNsBase("ps2", "daysetps2legends"), "https://census.daybreakgames.com/s:daysetps2legends/get/ps2:v2/");
  assert.equal(censusNsBase("ps2ps4eu", "s:abc"), "https://census.daybreakgames.com/s:abc/get/ps2ps4eu:v2/");
  assert.throws(() => censusNsBase("ps2ps5", "x"));
  assert.equal(nsOfBase(censusNsBase("ps2ps4us", "x")), "ps2ps4us");
  assert.equal(nsOfBase("nope"), "");
});

test("PS identity is server + character id; the same id on two servers is two people", () => {
  assert.equal(psKey("ps2ps4us", "5428452358028858337"), "us-5428452358028858337");
  assert.equal(psKey("ps2ps4eu", "5428452358028858337"), "eu-5428452358028858337");
  assert.notEqual(psPlayerFile("ps2ps4us", "1234567890"), psPlayerFile("ps2ps4eu", "1234567890"));
  assert.deepEqual(parsePsKey("eu-5428739481407105201"), { ns: "ps2ps4eu", cid: "5428739481407105201", server: "Ceres" });
  assert.equal(parsePsKey("shadow"), null);
  assert.throws(() => psKey("ps2", "123456"));
  assert.throws(() => psKey("ps2ps4us", "Shadow"));
  assert.equal(psServer("us").name, "Genudine");
  assert.equal(psServer("ps2ps4eu").name, "Ceres");
  assert.equal(PS_SERVERS.ps2ps4us.worldId, 1000);
});

test("withRoom writes or removes the room param and keeps the rest", () => {
  assert.equal(withRoom("https://dayset.github.io/ps2-elite-kd/?names=A,B", "ps"), "https://dayset.github.io/ps2-elite-kd/?names=A%2CB&room=ps");
  assert.equal(withRoom("https://dayset.github.io/ps2-elite-kd/?room=ps&names=A", "pc"), "https://dayset.github.io/ps2-elite-kd/?names=A");
});
