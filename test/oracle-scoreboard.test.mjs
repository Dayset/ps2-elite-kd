// 👥 Live fights scoreboard (owner 2026-10-30, approved exception: named players can show live).
// Top 3 players per base by kills there in the last 5 min; full list stored per capture / defense.
import test from "node:test";
import assert from "node:assert/strict";
globalThis.location ??= { search: "", pathname: "/oracle/", href: "https://example.test/oracle/" };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { LiveMap } = await import("../worker/src/live-map.js");
const { Rosters } = await import("../worker/src/rosters.js");
const { liveRoute } = await import("../worker/src/monitor.js");
const { topOf, fightsOf } = await import("../oracle-worker/src/fights.js");
const { namePlayers, buildMaps, _reset } = await import("../oracle-worker/src/players.js");
const { fightsCard, scoreboard } = await import("../oracle/js/fights.js");

const T = 1_800_000_000;
const now = T * 1000 + 5000;
const ids = { a: "5428000000000000001", b: "5428000000000000002", c: "5428000000000000003", d: "5428000000000000004", e: "5428000000000000005" };
function feed(m) {
  // a and b hold the point (exact position at base 300); kills there place the others.
  for (const cid of [ids.a, ids.b]) m.onEvent("ps2", { event_name: "PlayerFacilityDefend", world_id: "1", zone_id: "2", facility_id: "300", character_id: cid, timestamp: String(T) }, now);
  const death = (att, fa, vic, fv) => m.onEvent("ps2", { event_name: "Death", world_id: "1", zone_id: "2", attacker_character_id: att, attacker_team_id: fa, character_id: vic, team_id: fv, timestamp: String(T + 1) }, now);
  death(ids.a, "1", ids.c, "2"); death(ids.a, "1", ids.d, "2"); death(ids.a, "1", ids.e, "2");
  death(ids.b, "1", ids.c, "2"); death(ids.c, "2", ids.b, "1");
  death(ids.a, "1", ids.b, "1"); // team kill: a death for b, no kill for a
}

test("live map: top 3 per base by kills, then fewer deaths; full roster internal", () => {
  const m = new LiveMap();
  feed(m);
  const b = m.activity("ps2", "1", now).bases.find((x) => x.f === 300);
  assert.deepEqual(b.top, [[ids.a, "VS", 3, 0], [ids.b, "VS", 1, 2], [ids.c, "NC", 1, 2]]);
  const all = m.roster("ps2", "1", "300", now);
  assert.equal(all.length, 5);
  assert.deepEqual(all.find((p) => p[0] === ids.e), [ids.e, "NC", 0, 1]);
  m.prune(now + 6 * 60e3);
  assert.equal(m.roster("ps2", "1", "300", now + 6 * 60e3).length, 0, "forgotten after the 5 min window");
});

test("rosters: one row per capture / defense with kills, deaths and who was on the point", async () => {
  const m = new LiveMap();
  feed(m);
  const r = new Rosters(null, { roster: (w, f) => m.roster("ps2", w, f, now), removed: async () => new Set([ids.e]) });
  r.onEvent("ps2", { event_name: "PlayerFacilityDefend", world_id: "1", zone_id: "2", facility_id: "300", character_id: ids.a, timestamp: String(T) }, now);
  r.onEvent("ps2", { event_name: "FacilityControl", world_id: "1", zone_id: "2", facility_id: "300", old_faction_id: "1", new_faction_id: "1", timestamp: String(T + 2) }, now);
  assert.equal((await r.settle(now + 1000)).length, 0, "waits for the point events");
  const [row] = await r.settle(now + 20e3);
  assert.equal(row.r, "def");
  assert.equal(row.fac, "VS");
  assert.deepEqual(row.pl[0], [ids.a, "VS", 3, 0, 1]);
  assert.ok(!row.pl.some((p) => p[0] === ids.e), "players on the removal list are left out");
  assert.equal(row.pl.length, 4);
  // A mass flip (continent lock) is skipped.
  for (let i = 0; i < 4; i++) r.onEvent("ps2", { event_name: "FacilityControl", world_id: "1", zone_id: "2", facility_id: String(400 + i), old_faction_id: "1", new_faction_id: "2", timestamp: String(T + 9) }, now);
  assert.equal((await r.settle(now + 40e3)).length, 0);
});

test("public activity drops players on the removal list; rosters need the key", async () => {
  const body = { v: 1, bases: [{ f: 300, top: [[ids.a, "VS", 3, 0], [ids.e, "NC", 0, 1]] }, { f: 301, top: [[ids.e, "NC", 1, 0]] }] };
  const stub = { fetch: async () => new Response(JSON.stringify(body), { status: 200 }) };
  const env = { KILL_MONITOR: { get: () => stub, idFromName: () => "x" }, CENSUS_PROXY_KEY: "k" };
  const r = await liveRoute(new Request("https://c/live/activity?ns=ps2&world=1"), env, {}, { removed: async () => new Set([ids.e]) });
  const j = await r.json();
  assert.deepEqual(j.bases[0].top, [[ids.a, "VS", 3, 0]]);
  assert.equal(j.bases[1].top, undefined);
  const no = await liveRoute(new Request("https://c/live/rosters?since=1"), env, {}, {});
  assert.equal(no.status, 403);
  const yes = await liveRoute(new Request("https://c/live/rosters?since=1", { headers: { "X-Proxy-Key": "k" } }), env, {}, {});
  assert.equal(yes.status, 200);
});

test("oracle worker: ids cleaned, then named with iVi from the site data; unknown → one Census call", async () => {
  assert.deepEqual(topOf([[ids.a, "VS", 3.2, 0], ["x", "NC", 1, 1], [ids.b, "??", 1, 2], [ids.c, "NC", 1, 2], [ids.d, "NC", 0, 1]]), [[ids.a, "VS", 3, 0], [ids.b, null, 1, 2], [ids.c, "NC", 1, 2]]);
  const fx = fightsOf({ at: T, bases: [{ f: 300, fn: "Base", z: 2, n: { VS: 3, NC: 2 }, k: { VS: 4 }, top: [[ids.a, "VS", 3, 0], [ids.c, "NC", 1, 2]] }] }, 2);
  assert.equal(fx.bases[0].top.length, 2);
  _reset();
  const calls = [];
  const fetchFn = async (u) => {
    calls.push(u);
    if (u.endsWith("cid-names.json")) return Response.json({ [ids.a]: "Alpha", [ids.b]: ["Bravo", "vs"] });
    if (u.endsWith("ranks-lite.json")) return Response.json({ cols: ["name", "ivi"], rows: [["Alpha", 912.4]] });
    return Response.json({ character_list: [{ character_id: ids.c, name: { first: "Charlie" } }] });
  };
  await namePlayers({}, fx.bases, { fetchFn, now });
  assert.deepEqual(fx.bases[0].top, [{ n: "Alpha", f: "VS", k: 3, d: 0, i: 912 }, { n: "Charlie", f: "NC", k: 1, d: 2, i: null }]);
  assert.equal(calls.filter((u) => u.includes("census")).length, 1);
  assert.equal(buildMaps({ [ids.b]: ["Bravo", "vs"] }, null).names.get(ids.b), "Bravo");
});

test("page: folded scoreboard, short rows, the ranking in the hover, – for unknown iVi", () => {
  const f = { fid: "300", name: "Base", n: { VS: 3, NC: 2, TR: 0 }, k: { VS: 4, NC: 1, TR: 0 }, top: [{ n: "Alpha", f: "VS", k: 3, d: 0, i: 912 }, { n: "Charlie", f: "NC", k: 1, d: 2, i: null }] };
  const h = fightsCard({ fights: [f] });
  assert.match(h, /<details class="fsb" data-sb="Base"><summary title="[^"]*ranked by kills[^"]*">👥 Top 3<\/summary>/);
  assert.doesNotMatch(h, /<details class="fsb"[^>]* open/, "folded by default");
  const txt = h.replace(/<[^>]+>/g, "");
  assert.match(txt, /Alpha 3\/0 · 912/);
  assert.match(txt, /Charlie 1\/2 · –/);
  assert.doesNotMatch(h, /tracking|tracked|locat|cheater/i);
  assert.equal(scoreboard({ top: [] }, "x"), "");
});
