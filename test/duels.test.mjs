// 🤺 Duels tab (duels.mjs / duels-panel.mjs, owner 2026-10-28): one player vs the crowd, two head-to-head.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classOf, crowdRows, crowdSummary, expectedCount, pagerOf, readPairPages, readPairNewer, pairEvents, fightsOf, fightResult,
  weaponShotUrls, parseShotStats, perKill, pairSummary, ONE_V_ONE,
  duelCacheEntry, duelCacheRestore, duelCachePrune,
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
  assert.equal(calls.length, 2, "the short page is re-asked once, then corroborated");
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

test("\"Read further back\" pages to the end of the history in one load", async () => {
  // 2,500 events of the history player: three Census pages (1,000 / 1,000 / ~500, edge second re-asked).
  const events = [];
  for (let i = 0; i < 2500; i++) events.push([300000 - i, i % 2, ANCHOR, 1, 0, 2, 1, 8, 0]);
  const { get, calls } = fakeCensus(events, ROYAL);
  const st = { pid: ROYAL, qid: ANCHOR, all: [], cursor: 0, done: false, pages: 0 };
  await readPairPages(st, { base: "https://x/get/ps2ps4us:v2/", get, pages: Infinity });
  assert.equal(st.done, true, "the short last page ends the read");
  assert.equal(calls.length, 4, "three pages, plus the short last page re-asked once");
  assert.equal(st.pages, 3);
});

test("readPairPages reports each non-terminal page, so the table can grow while Census answers", async () => {
  const events = [];
  for (let i = 0; i < 2500; i++) events.push([300000 - i, i % 2, ANCHOR, 1, 0, 2, 1, 8, 0]);
  const { get, calls } = fakeCensus(events, ROYAL);
  const seen = [];
  const st = { pid: ROYAL, qid: ANCHOR, all: [], cursor: 0, done: false, pages: 0 };
  await readPairPages(st, { base: "https://x/get/ps2ps4us:v2/", get, pages: Infinity, onPage: (s) => seen.push(s.pages) });
  assert.equal(calls.length, 4, "three pages, plus the short last page re-asked once");
  assert.deepEqual(seen, [1, 2], "the short last page is covered by the final render, not a progress call");
  assert.equal(st.done, true);
  assert.equal(st.pages, 3);
});

test("cached duels refresh only newer kills: pages from the top until a page adds nothing", async () => {
  // Cached: 1,000 events (t 200000..199001). Since then: 1,000 newer events (t 201000..200001).
  const cached = [];
  for (let i = 0; i < 1000; i++) cached.push([200000 - i, i % 2, ANCHOR, 1, 0, 2, 1, 8, 0]);
  const newer = [];
  for (let i = 0; i < 1000; i++) newer.push([201000 - i, i % 2, ANCHOR, 1, 0, 2, 1, 8, 0]);
  const { get, calls } = fakeCensus([...newer, ...cached], ROYAL);
  const st = { pid: ROYAL, qid: ANCHOR, all: cached, cursor: 199002, done: false, pages: 1, oldest: 199001 };
  await readPairNewer(st, { base: "https://x/get/ps2ps4us:v2/", get });
  assert.equal(calls.length, 2, "one newer page, then the boundary page that adds nothing");
  assert.equal(st.all.length, 2000);
  assert.equal(st.pages, 3);
  assert.equal(st.cursor, 199002, "refresh never moves the backward cursor");
  assert.equal(st.done, false, "refresh never completes the backward history");
  assert.equal(st.oldest, 199001, "the oldest event is unchanged");
});

test("cached duels with nothing new stop after one short page", async () => {
  const cached = [];
  for (let i = 0; i < 100; i++) cached.push([200000 - i, i % 2, ANCHOR, 1, 0, 2, 1, 8, 0]);
  const { get, calls } = fakeCensus(cached, ROYAL);
  const st = { pid: ROYAL, qid: ANCHOR, all: cached, cursor: 199902, done: true, pages: 1, oldest: 199901 };
  await readPairNewer(st, { base: "https://x/get/ps2ps4us:v2/", get });
  assert.equal(calls.length, 2, "the short page is re-asked once, then the refresh stops");
  assert.equal(st.all.length, 100, "no duplicates merged");
  assert.equal(st.done, true);
});

test("duel cache entries round-trip the job and reject the wrong direction; prune keeps the newest 10", () => {
  const job = {
    base: "https://x/get/ps2ps4us:v2/", pid: ROYAL,
    st: { pid: ROYAL, qid: ANCHOR, all: [[300000, 1, ANCHOR, 1, 0, 2, 1, 8, 0]], cursor: 300001, done: true, pages: 2, oldest: 300000 },
    stats: new Map([["1|1", { shots: 100, hits: 50, kills: 10 }]]), asked: new Set(["1"]),
  };
  const entry = duelCacheEntry(job);
  assert.equal(entry.v, 1);
  assert.equal(entry.pid, ROYAL);
  const back = { base: job.base, pid: ROYAL, st: { qid: ANCHOR } };
  assert.equal(duelCacheRestore(entry, back), true);
  assert.deepEqual(back.st.all, job.st.all);
  assert.equal(back.st.done, true);
  assert.equal(back.stats.get("1|1").kills, 10);
  assert.ok(back.asked.has("1"), "asked weapons derive from the saved stats");
  assert.equal(duelCacheRestore(entry, { base: job.base, pid: ANCHOR, st: { qid: ROYAL } }), false, "a flipped direction must not restore");
  assert.equal(duelCacheRestore({ v: 1, pid: ROYAL }, back), false, "malformed entries must not restore");
  const map = {};
  for (let i = 0; i < 12; i++) map[`k${i}`] = { savedAt: i };
  const pruned = duelCachePrune(map);
  assert.equal(Object.keys(pruned).length, 10);
  assert.equal(pruned.k0, undefined, "the oldest entries go first");
  assert.ok(pruned.k11, "the newest entry survives");
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
  assert.match(panel, /pages: more \? Infinity : AUTO_PAGES/, "\"Read further back\" reads to the end of the history in one press");
  assert.doesNotMatch(panel, /MORE_PAGES/, "no per-click page chunk left");
  assert.match(panel, /className = "spinner"/, "small spinner while the history loads");
  assert.match(panel, /spin\.remove\(\)/, "spinner removed when the load settles");
  assert.match(panel, /loadPair\(more, \(j\) =>/, "each page re-renders the table as it arrives");
  assert.match(panel, /renderPair\(j, items\)/, "progress render uses the loaded pair and catalog");
  assert.match(panel, /waitSecs/, "ticking elapsed time while the history loads");
  assert.match(panel, /clearInterval\(waitTimer\)/, "timer stops when the load settles");
  assert.match(panel, /readPairNewer\(/, "cached pairs refresh only newer kills on open");
  assert.match(panel, /DUEL_CACHE_KEY/, "duels history cached in this browser");
  assert.match(panel, /duelCacheEntry\(job\)/, "completed loads save the pair to the cache");
  assert.match(panel, /onCached\(job\)/, "saved history renders before the refresh runs");
  assert.match(panel, /pairApi = null/, "no pair cache unless the page passes one");
  assert.match(st, /pairApi: \(\{ ns, p, q, want, seen \}\) => fetch\(`\$\{DUEL_API\}\/duels\/pair\?/, "#83: the page uses the cache Worker's pair cache");
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

test("crowd summary skips the unknown-opponent aggregate (\"0\") for nemesis and target", async () => {
  const { crowdSummary } = await import("../duels.mjs");
  const rows = [
    { name: "0", kills: 0, deaths: 196, kd: null, kpm: 0, share: 0.2 },
    { name: "[SLNM] HLotus", kills: 51, deaths: 120, kd: 51 / 120, kpm: 0.99, share: 0.1 },
    { name: "[SLNM] chsYGMRY", kills: 623, deaths: 322, kd: 623 / 322, kpm: 1.37, share: 0.3 },
  ];
  const s = crowdSummary(rows);
  assert.equal(s.nemesis.name, "[SLNM] HLotus", "second available nemesis, not the \"0\" aggregate");
  assert.equal(s.target.name, "[SLNM] chsYGMRY");
  assert.equal(s.deaths, 196 + 120 + 322, "totals still count the unknown row's deaths");
  const t = crowdSummary([
    { name: "0", kills: 500, deaths: 0, kd: null, kpm: 0, share: 0.5 },
    { name: "Real", kills: 10, deaths: 5, kd: 2, kpm: 1, share: 0.1 },
  ]);
  assert.equal(t.target.name, "Real", "an unknown row with kills is not a favourite target either");
  assert.equal(t.nemesis, null);
});

test("short Census pages are re-asked once before they count as the end (owner 2026-10-28)", async () => {
  const { readPairPages, readPairNewer } = await import("../duels.mjs");
  const raw = (ts, kill, other) => ({ timestamp: String(ts), table_type: kill ? "kills" : "deaths", character_id: kill ? other : "1", attacker_character_id: kill ? "1" : other });
  // Error payload with an empty list: throws, never done.
  {
    const st = { pid: "1", qid: "2", all: [], cursor: 0, done: false, pages: 0 };
    const get = async () => ({ error: "Census busy", characters_event_list: [] });
    await assert.rejects(readPairPages(st, { base: "https://x/", get }), /bad census reply/);
    assert.equal(st.done, false);
  }
  // Short page, then a full page: the read continues past the blip, both pages kept.
  {
    const full = Array.from({ length: 1000 }, (_, i) => raw(1_790_000_000 - i * 30, true, "9"));
    const short = [raw(1_790_100_000, true, "2"), raw(1_790_100_000 - 30, false, "2")];
    const seq = [{ characters_event_list: short }, { characters_event_list: full }, { characters_event_list: [] }, { characters_event_list: [] }];
    let i = 0;
    const get = async () => seq[Math.min(i++, seq.length - 1)];
    const st = { pid: "1", qid: "2", all: [], cursor: 0, done: false, pages: 0 };
    await readPairPages(st, { base: "https://x/", get, pages: 5 });
    assert.equal(st.done, true, "ends on the corroborated short page");
    assert.ok(st.all.some((x) => x[0] === 1_790_100_000), "the blip page's events are kept");
    assert.ok(st.all.length > 1000, "the full retry page is kept too");
  }
  // Short page, then a SHORTER one (flapping): breaks WITHOUT done, events kept.
  {
    const first = Array.from({ length: 5 }, (_, i) => raw(1_790_100_000 - i * 30, true, "2"));
    const second = Array.from({ length: 3 }, (_, i) => raw(1_790_100_000 - i * 30, true, "2"));
    const seq = [{ characters_event_list: first }, { characters_event_list: second }];
    let i = 0;
    const get = async () => seq[Math.min(i++, seq.length - 1)];
    const st = { pid: "1", qid: "2", all: [], cursor: 0, done: false, pages: 0 };
    await readPairPages(st, { base: "https://x/", get, pages: 5 });
    assert.equal(st.done, false, "flapping Census never claims completion");
    assert.equal(st.all.length, 5, "both pages' events are kept (deduped)");
  }
  // readPairNewer: an error payload throws too.
  {
    const st = { pid: "1", qid: "2", all: [], cursor: 0, done: false, pages: 0 };
    const get = async () => ({ error: "Census busy", characters_event_list: [] });
    await assert.rejects(readPairNewer(st, { base: "https://x/", get }), /bad census reply/);
  }
});

test("creation floor (owner note on #83): Census paging stops at the newer character's creation", async () => {
  const { pairFloor, readPairPages, DUEL_GAP } = await import("../duels.mjs");
  const old = { cid: "1", display: "Vet", times: { created: 1_300_000_000 } }, fresh = { cid: "2", display: "[N] Newbie", times: { created: 1_790_000_000 } };
  const f = pairFloor(old, fresh);
  assert.equal(f.floor, 1_790_000_000 - DUEL_GAP);
  assert.equal(f.newer, fresh);
  assert.deepEqual(pairFloor({ cid: "1" }, { cid: "2" }), { floor: 0, created: 0, newer: null });
  // 20 full pages of history reaching far below the floor: paging stops at the page that crosses it.
  const pageOf = (before) => {
    const top = Math.min(before || 1_790_100_000, 1_790_100_000);
    return { characters_event_list: Array.from({ length: 1000 }, (_, i) => ({ timestamp: String(top - 1 - i * 30), table_type: "kills", character_id: "9", attacker_character_id: "1" })) };
  };
  let calls = 0;
  const get = async (url) => { calls++; return pageOf(+((/before=(\d+)/.exec(url) || [])[1] || 0)); };
  const st = { pid: "1", qid: "2", all: [], cursor: 0, done: false, pages: 0 };
  await readPairPages(st, { base: "https://x/get/ps2:v2/", get, pages: 20, floor: f.floor });
  assert.equal(st.done, true);
  assert.ok(st.oldest <= f.floor);
  assert.ok(calls <= 4, `${calls} pages`);
});
