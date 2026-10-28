// ⚔️ Latest 100 kills & deaths (kill-feed.mjs): one Census call → rows + summary; one player only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEED_LIMIT, killFeedUrl, parseKillFeed, summarizeKillFeed, rowHtml } from "../kill-feed.mjs";

const ME = "111";
const ev = (o) => ({ is_headshot: "0", attacker_vehicle_id: "0", attacker_weapon_id: "7232", timestamp: "1793155624", team_id: "3", attacker_team_id: "2", ...o });

test("one Census call: 100 KILL + DEATH events with names, outfit, weapon and vehicle joined in", () => {
  const u = killFeedUrl("https://census.daybreakgames.com/s:x/get/ps2:v2/", ME);
  assert.equal(FEED_LIMIT, 100);
  assert.match(u, /characters_event\/\?character_id=111&type=KILL,DEATH&c:limit=100&c:join=/);
  for (const j of ["inject_at:vic", "inject_at:att", "outfit_member_extended", "item^on:attacker_weapon_id", "vehicle^on:attacker_vehicle_id"]) assert.ok(u.includes(j), j);
});

test("kills, deaths, suicides, teamkills and headshots are read the right way round", () => {
  const rows = parseKillFeed({ characters_event_list: [
    ev({ table_type: "kills", character_id: "222", attacker_character_id: ME, is_headshot: "1", vic: { name: { first: "Vic" }, faction_id: "3", of: { alias: "OO" } }, wpn: { name: { en: "EM1" } } }),
    ev({ table_type: "deaths", character_id: ME, attacker_character_id: "333", timestamp: "1793155000", team_id: "2", attacker_team_id: "1", attacker_vehicle_id: "4", att: { name: { first: "Mag" }, faction_id: "1" }, wpn: { name: { en: "Supernova FPC" } }, veh: { name: { en: "Magrider" } } }),
    ev({ table_type: "kills", character_id: "444", attacker_character_id: ME, timestamp: "1793154000", team_id: "2", attacker_team_id: "2", vic: { name: { first: "Mate" }, faction_id: "2" } }),
    ev({ table_type: "deaths", character_id: ME, attacker_character_id: ME, timestamp: "1793153000", attacker_weapon_id: "0" }),
  ] }, ME);
  assert.deepEqual(rows.map((r) => [r.kill, r.name, r.suicide, r.teamkill, r.headshot]), [
    [true, "Vic", false, false, true], [false, "Mag", false, false, false], [true, "Mate", false, true, false], [false, "", true, false, false],
  ]);
  assert.equal(rows[0].tag, "OO");
  assert.equal(rows[0].fac, "tr");
  assert.equal(rows[1].vehicle, "Magrider");
  assert.equal(rows[3].weapon, "");
  const s = summarizeKillFeed(rows);
  assert.deepEqual([s.kills, s.deaths, s.teamkills, s.suicides, s.hsr, s.kd], [1, 2, 1, 1, 1, 0.5]);
  const html = rowHtml(rows[2]);
  assert.match(html, /kf-tk/);
  assert.match(html, /data-name="Mate"/);
  assert.match(rowHtml(rows[3]), /kf-sui/);
  assert.deepEqual(parseKillFeed({}, ME), []);
});

test("the block sits right above the Auraxium weapons, collapsed and hidden until one player is shown", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const a = index.indexOf('<details id="killFeedSection"'), b = index.indexOf('<details id="weaponsSection"');
  assert.ok(a > 0 && a < b);
  assert.match(index, /<details id="killFeedSection"[^>]*\shidden>/);
  assert.doesNotMatch(index.slice(a, b), /<details[^>]*\sopen/);
  const st = readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(st, /killFeedPanel\.setPlayers\(\$\.LIVE_MODE \? \[\] : shownList\)/);
  assert.match(st, /const shownList = \$\.currentNamesInField\(\)\.length > 1 \? \[\] : list \|\| \[\];/);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const kf = css.slice(css.indexOf(".kf-section >"), css.indexOf("/* 🏆 Auraxium weapons"));
  assert.doesNotMatch(kf, /transition|animation/);
});
