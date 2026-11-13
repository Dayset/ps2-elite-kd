/**
 * Online page (online.mjs): Honu online list parsing, ranks join
 * (⚔️ iVi / 🪳 Zerg / 🧘 Pure, same numbers as the Rankings table),
 * sorting, filtering and formatting. DOM-free.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_NAME, ZONE_NAME, FACTION_NAME,
  normName, honuProfileUrl, honuSessionUrl, playerSheetUrl,
  parseOnlinePlayers, buildStatsMap, joinOnline,
  fmtAgo, fmtInt, fmt2, sortRows, filterRows, countBy,
} from "../online.mjs";

const HONU_SAMPLE = [
  {
    characterID: "5429835220938712561",
    character: { id: "5429835220938712561", name: "SSPAC", worldID: 10, outfitID: "1", outfitTag: "RMBJ", outfitName: "RMBJ", factionID: 2, battleRank: 50, prestige: 0, dateLastLogin: "2026-11-13T12:49:03Z" },
    player: { id: "5429835220938712561", worldID: 10, zoneID: 6, sessionID: 78135891, lastLogin: "2026-11-13T12:49:03Z", latestEventTimestamp: 1794577996971, online: true },
  },
  {
    characterID: "5428011263288144865",
    character: { id: "5428011263288144865", name: "VALKYRIE", worldID: 2000, outfitID: null, outfitTag: null, outfitName: null, factionID: 1, battleRank: 40, prestige: 2, dateLastLogin: "2026-11-13T13:52:36Z" },
    player: { id: "5428011263288144865", worldID: 2000, zoneID: 4, sessionID: 78136420, online: true },
  },
  // Entry with no character name is skipped, never rendered as a blank row.
  { characterID: "1", character: { id: "1", name: "" }, player: {} },
];

// Tiny ranks.json-shaped fixture: 5 rows, full column set the page reads.
const RANKS_FIXTURE = {
  cols: ["name", "slug", "adjs", "adj", "kd", "kpm", "apk", "inf", "inflation", "rvp", "crp", "ivi"],
  rows: [
    ["SSPAC", "sspac", 1300, 1250, 2.5, 1.1, 0.2, 90, 1.5, 10, 5, 900],
    ["VALKYRIE", "valkyrie", 800, 780, 1.2, 0.6, 0.9, 60, 2.0, 40, 30, 500],
    ["botWaz", "botwaz", 1357.3, 1309.2, 2.77, 1.02, 0.231, 93, 1.98, 12, 11, 907],
    ["ShloDog", "shlodog", 500, 480, 1.0, 0.5, 0.4, 80, 1.1, 20, 15, 400],
    ["Nobody", "nobody", 100, 90, 0.5, 0.2, 1.5, 30, 3.0, 80, 70, 100],
  ],
};

test("world / zone / faction names match the site's own maps", () => {
  assert.equal(WORLD_NAME[1], "Osprey");
  assert.equal(WORLD_NAME[10], "Wainwright");
  assert.equal(WORLD_NAME[40], "SolTech");
  assert.equal(WORLD_NAME[1000], "Genudine");
  assert.equal(WORLD_NAME[2000], "Ceres");
  assert.equal(ZONE_NAME[2], "Indar");
  assert.equal(ZONE_NAME[4], "Hossin");
  assert.equal(ZONE_NAME[6], "Amerish");
  assert.equal(ZONE_NAME[8], "Esamir");
  assert.equal(ZONE_NAME[344], "Oshur");
  assert.equal(FACTION_NAME[1], "VS");
  assert.equal(FACTION_NAME[2], "NC");
  assert.equal(FACTION_NAME[3], "TR");
  assert.equal(FACTION_NAME[4], "NS");
  assert.equal(WORLD_NAME[9999], undefined);
});

test("normName strips tags and case, like rank-row slugKey", () => {
  assert.equal(normName("[00] botWaz"), "botwaz");
  assert.equal(normName("VALKYRIE"), "valkyrie");
  assert.equal(normName(""), "");
});

test("parseOnlinePlayers keeps live server/continent/session, skips nameless entries", () => {
  const rows = parseOnlinePlayers(HONU_SAMPLE);
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.equal(a.name, "SSPAC");
  assert.equal(a.tag, "RMBJ");
  assert.equal(a.faction, 2);
  assert.equal(a.world, 10);
  assert.equal(a.zone, 6);
  assert.equal(a.br, 50);
  assert.equal(a.prestige, 0);
  assert.equal(a.sessionId, "78135891");
  assert.equal(a.lastLoginMs, Date.parse("2026-11-13T12:49:03Z"));
  assert.equal(b.name, "VALKYRIE");
  assert.equal(b.tag, "");
  assert.equal(b.world, 2000); // Ceres (PS): still listed, stats stay null
  assert.equal(b.prestige, 2);
  assert.equal(b.stats, null);
});

test("links: ranked names open the Players sheet, unranked open Honu", () => {
  assert.equal(playerSheetUrl("botWaz"), "index.html?names=botWaz");
  assert.equal(honuProfileUrl("5429835220938712561"), "https://wt.honu.pw/c/5429835220938712561");
  assert.equal(honuSessionUrl(78135891), "https://wt.honu.pw/s/78135891");
});

test("buildStatsMap: ⚔️ iVi is the evened adj, 🪳 Zerg is 0..100, 🧘 Pure is charged adjs", () => {
  const map = buildStatsMap(RANKS_FIXTURE);
  assert.equal(map.size, 5);
  const s = map.get("sspac");
  assert.equal(s.adj, 1250); // evened ⚔️ iVi, not plain adjs 1300
  assert.equal(s.kd, 2.5);
  assert.equal(s.kpm, 1.1);
  assert.equal(s.apk, 0.2);
  assert.equal(s.inf, 90);
  assert.ok(Number.isFinite(s.zerg) && s.zerg >= 0 && s.zerg <= 100, `zerg ${s.zerg}`);
  // Pure = adjs × (1 − 0.00436 × zerg) for positive adjs.
  assert.ok(Math.abs(s.pure - 1300 * (1 - 0.00436 * s.zerg)) < 1e-9);
  // Low-assists player charges harder than the high-assists one.
  assert.ok(map.get("sspac").zerg < map.get("valkyrie").zerg, "0.20 apk zerg < 0.90 apk zerg");
  assert.equal(buildStatsMap(null).size, 0);
  assert.equal(buildStatsMap({}).size, 0);
});

test("joinOnline attaches stats by name; PS / unranked players stay null, never 0", () => {
  const players = joinOnline(parseOnlinePlayers(HONU_SAMPLE), buildStatsMap(RANKS_FIXTURE));
  assert.equal(players[0].stats.adj, 1250);
  assert.equal(players[1].stats.adj, 780); // VALKYRIE is in the fixture ranks
  const ps = joinOnline(parseOnlinePlayers([HONU_SAMPLE[1]]), buildStatsMap({ cols: [], rows: [] }));
  assert.equal(ps[0].stats, null);
});

test("sortRows: ⚔️ iVi high-first, unranked sink; name A–Z; low 🪳 first", () => {
  const players = joinOnline(parseOnlinePlayers(HONU_SAMPLE), buildStatsMap(RANKS_FIXTURE));
  players.push({ name: "UnrankedOne", cid: "9", faction: 3, world: 1, zone: 2, br: 10, prestige: 0, sessionId: "", lastLoginMs: NaN, stats: null });
  const byIvi = sortRows([...players], "ivi").map((r) => r.name);
  assert.deepEqual(byIvi, ["SSPAC", "VALKYRIE", "UnrankedOne"]);
  const byName = sortRows([...players], "name").map((r) => r.name);
  assert.deepEqual(byName, ["SSPAC", "UnrankedOne", "VALKYRIE"]);
  const byZerg = sortRows([...players], "zerg").map((r) => r.name);
  assert.equal(byZerg[0], "SSPAC"); // lower zerg first
  assert.equal(byZerg.at(-1), "UnrankedOne"); // no zerg sorts last
});

test("filterRows: server, faction, ranked-only and name search", () => {
  const players = joinOnline(parseOnlinePlayers(HONU_SAMPLE), buildStatsMap(RANKS_FIXTURE));
  assert.equal(filterRows(players, { server: "10" }).length, 1);
  assert.equal(filterRows(players, { server: "2000" }).length, 1);
  assert.equal(filterRows(players, { server: "1" }).length, 0);
  assert.equal(filterRows(players, { faction: "1" }).map((r) => r.name).join(), "VALKYRIE");
  assert.equal(filterRows(players, { rankedOnly: true }).length, 2);
  assert.equal(filterRows(players, { query: "ssp" }).map((r) => r.name).join(), "SSPAC");
  assert.equal(filterRows(players, { query: "VALK" }).length, 1); // case-insensitive
  assert.equal(filterRows(players, {}).length, 2);
});

test("fmt helpers: — for missing, never 0", () => {
  assert.equal(fmtInt(1250.4), "1,250");
  assert.equal(fmtInt(null), "—");
  assert.equal(fmtInt(undefined), "—");
  assert.equal(fmt2(2.5), "2.50");
  assert.equal(fmt2(null), "—");
  assert.equal(fmtAgo(Date.parse("2026-11-13T13:00:00Z"), Date.parse("2026-11-13T14:12:00Z")), "1h 12m");
  assert.equal(fmtAgo(Date.parse("2026-11-13T14:11:00Z"), Date.parse("2026-11-13T14:12:00Z")), "1m");
  assert.equal(fmtAgo(Date.parse("2026-11-13T14:11:50Z"), Date.parse("2026-11-13T14:12:00Z")), "10s");
  assert.equal(fmtAgo(NaN), "");
});

test("countBy groups players per server", () => {
  const players = parseOnlinePlayers(HONU_SAMPLE);
  const m = countBy(players, (r) => WORLD_NAME[r.world]);
  assert.equal(m.get("Wainwright"), 1);
  assert.equal(m.get("Ceres"), 1);
});
