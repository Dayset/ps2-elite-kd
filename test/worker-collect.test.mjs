import test from "node:test";
import assert from "node:assert/strict";
import { Collect, vehicleTuple, worldTuple, mapState, kindOn, maxBytes } from "../worker/src/collect.js";
import { KillClasses, kcMode } from "../worker/src/kill-classes.js";
import { PC_EVENTS } from "../worker/src/pc-stream.js";

const vd = (o = {}) => ({ event_name: "VehicleDestroy", timestamp: "1000", world_id: "1", zone_id: String((3 << 16) | 2), attacker_character_id: "5428000000000000001", character_id: "5428000000000000002",
  attacker_vehicle_id: "4", vehicle_id: "2", attacker_weapon_id: "80", attacker_loadout_id: "6", attacker_team_id: "2", team_id: "3", facility_id: "222", ...o });
const fakeSql = () => {
  const rows = [];
  return { rows, exec: (q, ...a) => { if (q.startsWith("INSERT")) rows.push([q, ...a]); return { toArray: () => (q.startsWith("SELECT COUNT") ? [{ rows: 0, n: 0, bytes: 0, since: null }] : []) }; } };
};

test("vehicleTuple: PC worlds only, zone without instance bits", () => {
  assert.deepEqual(vehicleTuple(vd()), [1000, 1, 2, "5428000000000000001", "5428000000000000002", 4, 2, 80, 6, 2, 3, 222]);
  assert.equal(vehicleTuple(vd({ world_id: "1000" })), null);
  assert.equal(vehicleTuple({ event_name: "Death", world_id: "1" }), null);
});

test("worldTuple: control, alerts and locks; other events ignored", () => {
  assert.deepEqual(worldTuple({ event_name: "FacilityControl", timestamp: "5", world_id: "10", zone_id: "6", facility_id: "7", old_faction_id: "1", new_faction_id: "2", outfit_id: "37", duration_held: "300" }), [5, "F", 10, 6, 7, 1, 2, "37", 300]);
  assert.deepEqual(worldTuple({ event_name: "MetagameEvent", timestamp: "6", world_id: "40", zone_id: "8", instance_id: "9", metagame_event_id: "147", metagame_event_state_name: "started", faction_vs: "33.3", faction_nc: "33.3", faction_tr: "33.3", experience_bonus: "25" }), [6, "M", 40, 8, 9, 147, "started", 33.3, 33.3, 33.3, 25]);
  assert.equal(worldTuple({ event_name: "ContinentLock", timestamp: "7", world_id: "1", zone_id: "4", triggering_faction: "3" })[1], "L");
  assert.equal(worldTuple({ event_name: "Death", world_id: "1" }), null);
  assert.equal(worldTuple({ event_name: "FacilityControl", world_id: "2000" }), null);
});

test("mapState drops the scoreboard players (no ids stored)", () => {
  const s = mapState({ zones: { 2: { n: { VS: 3 }, zn: "Indar" } }, bases: [{ f: 1, fn: "X", z: 2, n: { VS: 3 }, k: {}, vk: {}, conv: {}, tick: {}, top: [["5428000000000000001", "VS", 3, 0]] }] });
  assert.deepEqual(s.zones, { 2: { VS: 3 } });
  assert.equal(s.bases[0].top, undefined);
  assert.ok(!JSON.stringify(s).includes("5428"));
});

test("kill switches and size caps come from worker variables", () => {
  assert.equal(kindOn({}, "vd"), true);
  assert.equal(kindOn({ VEHICLE_KILLS: "OFF" }, "vd"), false);
  assert.equal(kindOn({ MAP_STATES: "off" }, "ms"), false);
  assert.equal(maxBytes({ VD_MAX_MB: "300" }, "vd"), 300e6);
  assert.equal(maxBytes({}, "wev"), 100e6);
  assert.equal(kcMode("all"), "all"); assert.equal(kcMode("off"), "off"); assert.equal(kcMode(undefined), "alerts");
});

test("Collect writes one row per kind per settle, drops removed players, skips switched-off kinds", async () => {
  const sql = fakeSql();
  const live = { activity: (ns, w) => (w === "1" ? { zones: { 2: { n: { VS: 1 } } }, bases: [] } : { zones: {}, bases: [] }) };
  const c = new Collect(sql, { WORLD_EVENTS: "off" }, { live: () => live, removed: async () => new Set(["5428000000000000009"]) });
  c.onEvent("ps2", vd());
  c.onEvent("ps2", vd({ character_id: "5428000000000000009" }));
  c.onEvent("ps2ps4us", vd());
  c.onEvent("ps2", { event_name: "FacilityControl", world_id: "1", zone_id: "2" });
  await c.settle(1000e3);
  const by = (t) => sql.rows.filter((r) => r[0].includes(`INTO ${t} `));
  assert.equal(by("vd").length, 1);
  assert.equal(by("vd")[0][3], 1, "removed player dropped");
  assert.equal(by("wev").length, 0, "switched off");
  assert.equal(by("ms").length, 1);
  assert.deepEqual(JSON.parse(by("ms")[0][5])[0][1], { 1: { zones: { 2: { VS: 1 } }, bases: [] } });
  await c.settle(1060e3);
  assert.equal(by("ms").length, 1, "map state every 5 minutes");
  assert.equal(by("vd").length, 1, "nothing buffered → no row");
});

test("Collect stops writing a full table", async () => {
  const sql = { rows: [], exec: (q, ...a) => { if (q.startsWith("INSERT")) sql.rows.push(a); return { toArray: () => (q.startsWith("SELECT COUNT") ? [{ rows: 1, n: 1, bytes: 700e6, since: 1 }] : []) }; } };
  const c = new Collect(sql, { MAP_STATES: "off" });
  c.onEvent("ps2", vd());
  await c.settle(1000e3);
  assert.equal(sql.rows.length, 0);
  assert.equal(c.info(1000e3).vd.full, 1);
});

test("KillClasses: all mode tags alert kills, off mode keeps nothing", async () => {
  const death = (o = {}) => ({ event_name: "Death", timestamp: "1000", world_id: "1", zone_id: "6", attacker_character_id: "5428000000000000001", character_id: "5428000000000000002", ...o });
  const fetchFn = async () => ({ ok: true, json: async () => ({ world_event_list: [{ world_id: "1", zone_id: "6", metagame_event_state_name: "started", timestamp: "990" }] }) });
  const kc = new KillClasses(null, { mode: "all", fetchFn });
  await kc.poll(1000e3);
  kc.onEvent("ps2", death());
  kc.onEvent("ps2", death({ zone_id: "2" }));
  assert.deepEqual(kc.buf.map((k) => k[12]), [1, 0]);
  const off = new KillClasses(null, { mode: "off", fetchFn });
  off.onEvent("ps2", death());
  assert.equal(off.buf.length, 0);
  assert.equal(new KillClasses(null, {}).mode, "alerts", "unset stays alerts-only");
});

test("PC subscription carries the world events at every level", () => {
  for (const lvl of ["full", "points", "lean"]) for (const ev of ["MetagameEvent", "ContinentLock", "FacilityControl", "VehicleDestroy"]) assert.ok(PC_EVENTS[lvl].includes(ev), `${lvl} ${ev}`);
});
