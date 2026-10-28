// 🤺 Duels tab (duels.mjs / duels-panel.mjs, owner 2026-10-28): one player vs the crowd, two head-to-head.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classOf, crowdRows, crowdSummary, expectedCount, pagerOf, readPairPages, pairEvents, fightsOf, fightResult,
  weaponShotUrls, parseShotStats, perKill, pairSummary, ONE_V_ONE,
} from "../duels.mjs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/scrim-royaigreenberet.json", import.meta.url), "utf8"));
const ROYAL = fx.cid, ANCHOR = "5429365615044405249";

test("classes from Census loadout ids (all four factions)", () => {
  assert.equal(classOf(1), "inf"); assert.equal(classOf(17), "la"); assert.equal(classOf(30), "med");
  assert.equal(classOf(12), "eng"); assert.equal(classOf(6), "ha"); assert.equal(classOf(45), "max");
  assert.equal(classOf(0), ""); assert.equal(classOf(999), "");
});

test("vs the crowd: K/D, share, nemesis and favourite target from the loaded killboard", () => {
  const p = { display: "[X] Me", rows: [
    { name: "[A] Alpha", kills: 10, deaths: 2, kpm: 1.2 },
    { name: "Bravo", kills: 1, deaths: 9, kpm: 2.4 },
    { name: "[C] Charlie", kills: 4, deaths: 4 },
  ] };
  const rows = crowdRows(p);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kd, 5);
  assert.equal(rows[2].kpm, null);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
  const s = crowdSummary(rows);
  assert.equal(s.nemesis.name, "Bravo");
  assert.equal(s.target.name, "[A] Alpha");
  assert.equal(s.kd, 15 / 15);
  assert.equal(crowdSummary(rows, "[ZZ] bravo").kd, 14 / 6, "the head-to-head opponent is left out (tag and case ignored)");
  assert.equal(expectedCount(p, { display: "[NEW] alpha" }), 12);
  assert.equal(expectedCount(p, { display: "Nobody" }), null);
});

test("history is read from the less active player (reaches further back per page)", () => {
  const busy = { cid: "1", global_kpm: 3, global_kd: 3 }, calm = { cid: "2", global_kpm: 0.5, global_kd: 1 };
  assert.equal(pagerOf(busy, calm), calm);
  assert.equal(pagerOf(calm, busy), calm);
  assert.equal(pagerOf({ cid: "3" }, busy), busy);
});

// Census rows from the fixture's compact events (newest first, 1,000 per page).
function fakeCensus(events, cid) {
  const asRow = (x) => {
    const kill = x[1] === 1;
    return { timestamp: String(x[0]), table_type: kill ? "kills" : "deaths",
      character_id: kill ? x[2] : cid, attacker_character_id: kill ? cid : x[2], attacker_weapon_id: String(x[3]), is_headshot: String(x[4]),
      zone_id: String(x[5]), attacker_loadout_id: String(kill ? x[6] : x[7]), character_loadout_id: String(kill ? x[7] : x[6]), attacker_vehicle_id: String(x[8]) };
  };
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    const before = +((/before=(\d+)/.exec(url) || [])[1] || Infinity);
    const page = events.filter((x) => x[0] < before).sort((a, b) => b[0] - a[0]).slice(0, 1000);
    return { characters_event_list: page.map(asRow) };
  };
  return { get, calls };
}

test("head-to-head from the real RoyaIGreenBeret vs GimmeDatAnchor scrim (15–14 on Indar)", async () => {
  const { get, calls } = fakeCensus(fx.events, ROYAL);
  const st = { pid: ROYAL, qid: ANCHOR, all: [], cursor: 0, done: false, pages: 0 };
  await readPairPages(st, { base: "https://x/get/ps2ps4us:v2/", get, pages: 5 });
  assert.ok(st.done, "fixture history fits in one short page");
  assert.equal(calls.length, 1);
  const pe = pairEvents(st.all, ANCHOR, true);
  const aKills = pe.filter((e) => e.aKill).length;
  assert.equal(aKills, 15);
  assert.equal(pe.length - aKills, 14);
  assert.ok(pe.every((e, i) => !i || pe[i - 1].t <= e.t), "oldest first");
  // Seen from GimmeDatAnchor's side (history player is B): everything flips.
  const flip = pairEvents(st.all, ANCHOR, false);
  assert.equal(flip.filter((e) => e.aKill).length, 14);
  const fights = fightsOf(pe, st.all, ROYAL);
  const big = fights.reduce((m, f) => (f.ev.length > m.ev.length ? f : m), fights[0]);
  assert.equal(big.a + big.b >= 25, true);
  assert.equal(big.one, true, "the scrim is a 1v1 fight");
  assert.ok(big.focus >= ONE_V_ONE.focus);
  assert.equal(big.z, 2);
  assert.equal(fightResult({ a: 3, b: 1 }), "won");
  assert.equal(fightResult({ a: 1, b: 3 }), "lost");
  assert.equal(fightResult({ a: 2, b: 2 }), "draw");
  const s = pairSummary(pe, fights, new Map(), ROYAL, ANCHOR);
  assert.equal(s.a.kills, 15);
  assert.equal(s.b.kills, 14);
  assert.equal(s.n, 29);
  assert.ok(s.a.streak >= 1 && s.b.streak >= 1);
  assert.equal(s.a.shots, null, "no weapon stats → no ≈ shots");
});

test("fights break after 10 minutes without a kill between them; newest first", () => {
  const ev = (t, aKill) => ({ t, aKill, w: 1, hs: false, z: 2, aL: 1, bL: 8, veh: 0 });
  const pe = [ev(1000, true), ev(1100, false), ev(1650, true), ev(5000, true)];
  const all = pe.map((e) => [e.t, e.aKill ? 1 : 0, "B", 1, 0, 2, 1, 8, 0]);
  const f = fightsOf(pe, all, "A");
  assert.equal(f.length, 2);
  assert.equal(f[0].t0, 5000);
  assert.deepEqual([f[1].a, f[1].b, f[1].ev.length], [2, 1, 3]);
  assert.equal(f[1].one, true);
  assert.equal(f[0].one, false, "one kill is not a 1v1 fight");
  // Someone else in the middle of it: focus drops below 75%.
  const crowded = all.concat([[1050, 1, "C", 1, 0, 2, 1, 8, 0], [1060, 0, "D", 1, 0, 2, 1, 8, 0]]);
  assert.equal(fightsOf(pe, crowded, "A")[1].one, false);
});

test("≈ shots / hits per kill: lifetime weapon stats of both players in 2 Census calls", () => {
  const u = weaponShotUrls("https://x/get/ps2:v2/", ["11", "22"], ["7236", "7236", "0", "804"]);
  assert.match(u.plain, /characters_weapon_stat\?character_id=11,22&item_id=7236,804&stat_name=weapon_fire_count,weapon_hit_count/);
  assert.match(u.kills, /characters_weapon_stat_by_faction\?character_id=11,22&item_id=7236,804&stat_name=weapon_kills/);
  const stats = parseShotStats(
    { characters_weapon_stat_list: [
      { character_id: "11", item_id: "7236", stat_name: "weapon_fire_count", value: "900" },
      { character_id: "11", item_id: "7236", stat_name: "weapon_hit_count", value: "300" },
      { character_id: "11", item_id: "7236", stat_name: "weapon_fire_count", value: "100" }, // vehicle row of the same weapon
    ] },
    { characters_weapon_stat_by_faction_list: [{ character_id: "11", item_id: "7236", stat_name: "weapon_kills", value_vs: "40", value_nc: "0", value_tr: "60" }] },
  );
  assert.deepEqual(perKill(stats, "11", 7236), { shots: 10, hits: 3, kills: 100 });
  assert.equal(perKill(stats, "22", 7236), null);
  const pe = [{ t: 1, aKill: true, w: 7236, hs: true, aL: 6, bL: 13 }, { t: 2, aKill: true, w: 7236, hs: false, aL: 6, bL: 13 }];
  const s = pairSummary(pe, [], stats, "11", "22");
  assert.equal(s.a.shots, 10);
  assert.equal(s.a.hits, 3);
  assert.equal(s.a.hsr, 0.5);
  assert.deepEqual(s.a.cls, ["ha", 2]);
  assert.equal(s.b.kills, 0);
});

test("tab wiring: both rooms, one or two players, translated, shared table look", () => {
  const st = readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(st, /duelsPanel\.setPlayers\(\$\.LIVE_MODE \? \[\] : list \|\| \[\]\)/);
  const panel = readFileSync(new URL("../duels-panel.mjs", import.meta.url), "utf8");
  assert.match(panel, /ok\.length === 1 \? "crowd" : ok\.length === 2 \? "pair" : null/);
  assert.match(panel, /pairApi = null/, "own kill store hook stays off until the Worker serves it");
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /<details id="duelsSection" class="dist-section duel-section" hidden>/);
  assert.match(index, /class="ranks-table duel-table"/);
});

test("warnings: same faction (teamkills only, NSO never counts) and different servers", async () => {
  const { charInfoUrl, parseCharInfo, pairWarnings } = await import("../duels.mjs");
  assert.match(charInfoUrl("https://x/get/ps2:v2/", ["1", "2"]), /character\/\?character_id=1,2&c:show=character_id,faction_id&c:join=characters_world/);
  const info = (fa, wa, fb, wb) => parseCharInfo({ character_list: [
    { character_id: "1", faction_id: String(fa), w: { world_id: String(wa) } },
    { character_id: "2", faction_id: String(fb), w: { world_id: String(wb) } }] });
  assert.deepEqual(pairWarnings(info(2, 1, 2, 1), "1", "2"), [{ kind: "faction", faction: "NC" }]);
  assert.deepEqual(pairWarnings(info(1, 1, 3, 10), "1", "2"), [{ kind: "world", wa: 1, wb: 10 }]);
  assert.deepEqual(pairWarnings(info(4, 1, 4, 1), "1", "2"), [], "NSO plays on any side");
  assert.deepEqual(pairWarnings(info(1, 1, 3, 1), "1", "2"), []);
  assert.deepEqual(pairWarnings(new Map(), "1", "2"), [], "no Census info → no warning");
});
