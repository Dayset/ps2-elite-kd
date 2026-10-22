// 🏆 Auraxium weapons block (weapons.mjs): Census rows → auraxium-only weapon rows.
import test from "node:test";
import assert from "node:assert/strict";
import { AURAXIUM_KILLS, summarizeWeapons, weaponStatUrls, itemInfoUrl, catalogEntry, itemsFromCensus } from "../weapons.mjs";

const fac = (item, stat, vs, nc = 0, tr = 0) => ({ stat_name: stat, item_id: String(item), value_vs: String(vs), value_nc: String(nc), value_tr: String(tr) });
const plain = (item, stat, v) => ({ stat_name: stat, item_id: String(item), value: String(v) });

test("auraxium is 10 + 50 + 100 + 1000 kills", () => {
  assert.equal(AURAXIUM_KILLS, 10 + 50 + 100 + 1000);
});

test("only weapons with 1160+ kills, summed over factions and vehicle rows, most kills first", () => {
  const rows = summarizeWeapons(
    [
      fac(100, "weapon_kills", 600, 400, 160), // 1160 → in
      fac(200, "weapon_kills", 1159), // one short → out
      fac(300, "weapon_kills", 2000), fac(300, "weapon_kills", 500), // two vehicle rows → 2500
      fac(300, "weapon_headshots", 1000),
      fac(300, "weapon_vehicle_kills", 40),
      fac(0, "weapon_kills", 99999), // item 0 is not a weapon
    ],
    [
      plain(300, "weapon_deaths", 1000), plain(300, "weapon_play_time", 150000),
      plain(300, "weapon_fire_count", 40000), plain(300, "weapon_hit_count", 10000),
      plain(300, "weapon_score", 500000),
    ],
  );
  assert.deepEqual(rows.map((r) => [r.id, r.kills]), [["300", 2500], ["100", 1160]]);
  const w = rows[0];
  assert.equal(w.kd, 2.5);
  assert.equal(w.kpm, 2500 / 2500);
  assert.equal(w.acc, 0.25);
  assert.equal(w.hsr, 0.4);
  assert.equal(w.vk, 40);
  assert.equal(rows[1].kd, null); // no deaths recorded
  assert.equal(rows[1].acc, null);
});

test("Census URLs ask only for the stats we show", () => {
  const u = weaponStatUrls("https://census.daybreakgames.com/s:x/get/ps2:v2/", "5428");
  assert.match(u.byFaction, /characters_weapon_stat_by_faction\?character_id=5428&stat_name=weapon_kills,weapon_headshots,weapon_vehicle_kills/);
  assert.match(u.plain, /characters_weapon_stat\?character_id=5428&stat_name=weapon_deaths,weapon_fire_count,weapon_hit_count,weapon_play_time,weapon_score/);
  assert.match(itemInfoUrl("B/", ["1", "2"]), /^B\/item\?item_id=1,2&/);
});

test("catalog entries and live item rows share one shape", () => {
  const cat = { items: { 7: ["Gauss SAW", "Heavy Weapon", 2, 1234] } };
  assert.deepEqual(catalogEntry(cat, "7"), { name: "Gauss SAW", category: "Heavy Weapon", faction: 2, image: "1234" });
  assert.equal(catalogEntry(cat, "8"), null);
  assert.deepEqual(itemsFromCensus([{ item_id: "7", faction_id: "2", image_id: "1234", name: { en: "Gauss SAW" }, category: { name: { en: "Heavy Weapon" } } }]),
    { 7: { name: "Gauss SAW", category: "Heavy Weapon", faction: 2, image: "1234" } });
});

test("IvI, SPK, DPH, SPM and killed-by come from the same two calls", () => {
  const [w] = summarizeWeapons(
    [fac(9, "weapon_kills", 2000), fac(9, "weapon_headshots", 600), fac(9, "weapon_killed_by", 0, 70, 30), fac(9, "weapon_damage_given", 1000000)],
    [plain(9, "weapon_fire_count", 50000), plain(9, "weapon_hit_count", 12500), plain(9, "weapon_play_time", 60000), plain(9, "weapon_score", 2000000)],
  );
  assert.equal(w.killedBy, 100);
  assert.equal(Math.round(w.ivi), 750); // 25 % × 30 %
  assert.equal(w.spk, 25);
  assert.equal(w.dph, 80);
  assert.equal(w.spm, 2000);
});
