import test from "node:test";
import assert from "node:assert/strict";
import { summarizeInfantry, infantryUrls, infantryTagCounts, VEHICLE_LIKE_ITEMS } from "../infantry.mjs";

const f = (stat, item, veh, n) => ({ stat_name: stat, item_id: item, vehicle_id: veh, value_vs: String(n), value_nc: "0", value_tr: "0" });

test("splits kills/deaths by vehicle_id and odd items", () => {
  const s = summarizeInfantry([
    f("weapon_kills", "44505", "0", 300), f("weapon_kills", "0", "12", 50), f("weapon_kills", "554", "0", 50),
    f("weapon_killed_by", "7528", "0", 200), f("weapon_killed_by", "0", "4", 100),
  ], [{ stat_name: "weapon_play_time", item_id: "44505", vehicle_id: "0", value: "36000" }, { stat_name: "weapon_play_time", item_id: "0", vehicle_id: "12", value: "9000" }]);
  assert.equal(s.footKills, 300);
  assert.equal(s.vehKills, 100);
  assert.equal(s.footDeaths, 200);
  assert.equal(s.infKd, 1.5);
  assert.equal(s.infKpm, 0.5);
  assert.equal(s.vehShare, 0.25);
  assert.equal(s.tag, "mixed");
  assert.ok(VEHICLE_LIKE_ITEMS.has("554"));
});

test("tags and thresholds", () => {
  assert.equal(summarizeInfantry([f("weapon_kills", "1", "0", 500)], []).tag, "infantry");
  assert.equal(summarizeInfantry([f("weapon_kills", "1", "5", 500)], []).tag, "vehicle");
  assert.equal(summarizeInfantry([f("weapon_kills", "1", "0", 20)], []).tag, null);
  assert.equal(summarizeInfantry([], []), null);
});

test("urls filter stats and counts", () => {
  const u = infantryUrls("B/", "123");
  assert.match(u.byFaction, /characters_weapon_stat_by_faction\?character_id=123&stat_name=weapon_kills,weapon_killed_by/);
  assert.match(u.plain, /characters_weapon_stat\?character_id=123&stat_name=weapon_play_time/);
  assert.deepEqual(infantryTagCounts([{ infantry: { tag: "mixed" } }, { infantry: { tag: null } }, {}]), { infantry: 0, mixed: 1, vehicle: 0, low: 1, none: 1 });
});
