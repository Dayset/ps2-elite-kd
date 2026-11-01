import test from "node:test";
import assert from "node:assert/strict";
import { KillClasses, activeAlerts, killTuple, KC_MAX_ALERT_S } from "../worker/src/kill-classes.js";

const death = (o = {}) => ({ event_name: "Death", timestamp: "1000", world_id: "1", zone_id: "6", attacker_character_id: "5428000000000000001", character_id: "5428000000000000002",
  attacker_loadout_id: "6", character_loadout_id: "4", attacker_weapon_id: "80", attacker_vehicle_id: "0", is_headshot: "1", attacker_team_id: "2", team_id: "3", ...o });

test("activeAlerts: newest event per continent decides, old starts expire", () => {
  const on = activeAlerts([
    { world_id: "1", zone_id: "6", metagame_event_state_name: "started", timestamp: "1000", metagame_event_id: "188" },
    { world_id: "1", zone_id: "6", metagame_event_state_name: "ended", timestamp: "900" },
    { world_id: "10", zone_id: "4", metagame_event_state_name: "ended", timestamp: "990" },
    { world_id: "10", zone_id: "4", metagame_event_state_name: "started", timestamp: "100" },
    { world_id: "40", zone_id: "8", metagame_event_state_name: "started", timestamp: "1" },
  ], 1000 + 60);
  assert.deepEqual([...on.keys()], ["1|6", "40|8"]);
  assert.equal(activeAlerts([{ world_id: "40", zone_id: "8", metagame_event_state_name: "started", timestamp: "0" }], KC_MAX_ALERT_S + 1).size, 0);
});

test("killTuple keeps both classes and ids, zone without instance bits", () => {
  assert.deepEqual(killTuple(death({ zone_id: String((5 << 16) | 6) })), [1000, 1, 6, "5428000000000000001", "5428000000000000002", 6, 4, 80, 0, 1, 2, 3]);
  assert.equal(killTuple({ event_name: "VehicleDestroy" }), null);
});

test("KillClasses keeps only deaths on an alert continent and writes one row per settle", async () => {
  const rows = [];
  const sql = { exec: (q, ...a) => { if (q.startsWith("INSERT")) rows.push(a); return { toArray: () => [] }; } };
  const fetchFn = async () => ({ ok: true, json: async () => ({ world_event_list: [{ world_id: "1", zone_id: "6", metagame_event_state_name: "started", timestamp: "990" }] }) });
  const kc = new KillClasses(sql, { fetchFn, removed: async () => new Set(["5428000000000000009"]) });
  await kc.settle(1000e3);
  kc.onEvent("ps2", death());
  kc.onEvent("ps2", death({ zone_id: "2" }));                       // no alert there
  kc.onEvent("ps2ps4us", death());                                  // PS: not collected
  kc.onEvent("ps2", death({ character_id: "5428000000000000009" })); // removed player
  await kc.settle(1060e3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], 1);
  assert.equal(JSON.parse(rows[0][3])[0][5], 6);
  await kc.settle(1120e3);
  assert.equal(rows.length, 1, "nothing buffered → no row");
});

test("all mode keeps deaths outside alerts", async () => {
  const kc = new KillClasses(null, { all: true, fetchFn: async () => ({ ok: false }) });
  kc.onEvent("ps2", death({ zone_id: "2" }));
  assert.equal(kc.buf.length, 1);
});

test("class-kills-report: matrix skips vehicle kills, team kills and duplicates", async () => {
  const { classMatrix } = await import("../scripts/class-kills-report.mjs");
  const r = classMatrix([
    [1, 1, 6, "a1", "v1", 6, 18, 0, 0, 1, 2, 3],   // NC HA kills VS medic
    [1, 1, 6, "a1", "v1", 6, 18, 0, 0, 1, 2, 3],   // duplicate
    [2, 1, 6, "v1", "a1", 18, 6, 0, 0, 0, 3, 2],   // medic kills HA
    [3, 1, 6, "a1", "v2", 6, 11, 0, 0, 0, 2, 2],   // team kill
    [4, 1, 6, "a1", "v3", 6, 11, 0, 4, 0, 2, 3],   // from a vehicle
  ], new Map([["v1", 0.9], ["a1", 0.3]]));
  assert.equal(r.used, 2);
  assert.equal(r.kills[4][2], 1);
  assert.equal(r.kd[4][2], 1);
  assert.equal(r.weightedKd[4][2], 0.9 / 0.3);
});
