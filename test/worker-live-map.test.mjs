// 🗺️ Live map + 💸 meter + 🖥️ PC stream (Workers Paid plan, 2026-10-29): worker/src/live-map.js,
// meter.js, pc-stream.js and the KillMonitor routes. No network: the Durable Object's SQLite is
// node:sqlite and the sockets are switched off.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LiveMap, FRESH_MS, WINDOW_MS, KEEP_MS, SHOW_BASE_MS, zoneDef } from "../worker/src/live-map.js";
import { Meter, INCLUDED, WS_RATIO, DO_GB, MONTH_S } from "../worker/src/meter.js";
import { pcSubscribe, streamLevel, messageName, PC_WORLDS, PC_SOFT, PC_HARD, PcStream } from "../worker/src/pc-stream.js";
import { subscribeMessage, LOCATOR_EVENTS } from "../worker/src/ps-assists.js";
import { KillMonitor, liveRoute, LOCATE_MAX } from "../worker/src/monitor.js";

const T0 = Date.parse("2026-10-29T12:00:00Z");
const A = "5428000000000000001", B = "5428000000000000002", C = "5428000000000000003", D = "5428000000000000004";
const sec = (ms) => String(Math.floor(ms / 1000));
const death = (t, attacker, victim, { aTeam = "1", vTeam = "2", zone = "2", world = "1" } = {}) =>
  ({ event_name: "Death", timestamp: sec(t), attacker_character_id: attacker, character_id: victim, attacker_team_id: aTeam, team_id: vTeam, zone_id: zone, world_id: world });
const capture = (t, cid, fac, { zone = "2", world = "1", kind = "PlayerFacilityCapture" } = {}) =>
  ({ event_name: kind, timestamp: sec(t), character_id: cid, facility_id: fac, zone_id: zone, world_id: world, outfit_id: "0" });

test("exact place by capture, 'near' by a kill with that player, one hop only", () => {
  const m = new LiveMap();
  m.onEvent("ps2", capture(T0, A, "201"), T0);
  m.onEvent("ps2", death(T0 + 10e3, A, B), T0 + 10e3);   // B fights A → near 201
  m.onEvent("ps2", death(T0 + 20e3, C, B, { aTeam: "3" }), T0 + 20e3); // C fights near-placed B → not placed
  const a = m.locate("ps2", A, T0 + 30e3), b = m.locate("ps2", B, T0 + 30e3), c = m.locate("ps2", C, T0 + 30e3);
  assert.equal(a.f, 201);
  assert.equal(a.fn, "Indar Waste Treatment");
  assert.equal(a.how, "exact");
  assert.equal(a.zn, "Indar");
  assert.equal(a.fac, "VS");
  assert.equal(b.f, 201);
  assert.equal(b.how, "near");
  assert.equal(b.fac, "NC");
  assert.equal(c.f, undefined, "a guess never places a third player");
  assert.equal(c.zn, "Indar");
  assert.equal(c.on, true);
});

test("an exact position beats a guess; stale after FRESH_MS for crowds, named up to SHOW_BASE_MS", () => {
  const m = new LiveMap();
  m.onEvent("ps2", capture(T0, A, "201"), T0);
  m.onEvent("ps2", capture(T0, B, "203"), T0);
  m.onEvent("ps2", death(T0 + 5e3, A, B), T0 + 5e3);
  assert.equal(m.locate("ps2", B, T0 + 6e3).f, 203, "B keeps its own exact base");
  // Activity after FRESH_MS: crowd window is WINDOW_MS, crowd entries refresh only while the base is fresh.
  const act = m.activity("ps2", "1", T0 + 6e3);
  const b201 = act.bases.find((x) => x.f === 201), b203 = act.bases.find((x) => x.f === 203);
  assert.equal(b201.n.VS, 1);
  assert.equal(b203.n.NC, 1);
  assert.equal(b201.k.VS, 1, "the kill counts at the killer's base");
  const later = T0 + SHOW_BASE_MS - 1e3;
  m.onEvent("ps2", death(later, A, D, { vTeam: "3" }), later);
  assert.equal(m.locate("ps2", A, later).f, 201, "still named, with its age");
  assert.ok(m.locate("ps2", A, later).fago >= (SHOW_BASE_MS - 2e3) / 1000);
  assert.equal(m.locate("ps2", D, later).f, undefined, "A is stale: D is not placed");
  assert.equal(m.locate("ps2", A, T0 + SHOW_BASE_MS + 60e3).f, undefined);
});

test("vehicle kills place both players exactly; point XP counts at the player's base", () => {
  const m = new LiveMap();
  m.onEvent("ps2", { event_name: "VehicleDestroy", timestamp: sec(T0), attacker_character_id: A, character_id: B, facility_id: "203", attacker_team_id: "3", team_id: "1", faction_id: "1", zone_id: "2", world_id: "1" }, T0);
  assert.equal(m.locate("ps2", A, T0).how, "exact");
  assert.equal(m.locate("ps2", B, T0).f, 203);
  for (let i = 0; i < 3; i++) m.onEvent("ps2", { event_name: "GainExperience", experience_id: "557", timestamp: sec(T0 + i * 3e3), character_id: A, team_id: "3", zone_id: "2", world_id: "1", amount: "10" }, T0 + i * 3e3);
  m.onEvent("ps2", { event_name: "GainExperience", experience_id: "272", timestamp: sec(T0 + 10e3), character_id: A, team_id: "3", zone_id: "2", world_id: "1", amount: "100" }, T0 + 10e3);
  const b = m.activity("ps2", "1", T0 + 20e3).bases.find((x) => x.f === 203);
  assert.deepEqual(b.tick, { TR: 3 });
  assert.deepEqual(b.conv, { TR: 1 });
  assert.equal(b.convAgo, 10);
  assert.deepEqual(b.vk, { TR: 1 });
});

test("team kills, logout, world filter, zone change, prune", () => {
  const m = new LiveMap();
  m.onEvent("ps2", capture(T0, A, "201"), T0);
  m.onEvent("ps2", death(T0 + 1e3, A, B, { vTeam: "1" }), T0 + 1e3);
  assert.deepEqual(m.activity("ps2", "1", T0 + 2e3).bases.find((x) => x.f === 201).k, { tk: 1 });
  assert.equal(m.onEvent("ps2", death(T0, C, D, { world: "1000" }), T0), false, "a PS world on the PC socket is ignored");
  assert.equal(m.locate("ps2", C, T0), null);
  m.onEvent("ps2", { event_name: "PlayerLogout", timestamp: sec(T0 + 3e3), character_id: A, world_id: "1" }, T0 + 3e3);
  const a = m.locate("ps2", A, T0 + 4e3);
  assert.equal(a.on, false);
  assert.equal(a.f, undefined, "no base once logged out");
  assert.equal(m.activity("ps2", "1", T0 + 4e3).bases.find((x) => x.f === 201).n.VS, 1, "A left the crowd; B (VS, team-killed) stays");
  // Zone change drops the base.
  m.onEvent("ps2", capture(T0, B, "201"), T0 + 5e3);
  m.onEvent("ps2", death(T0 + 6e3, B, C, { zone: "4" }), T0 + 6e3);
  assert.equal(m.locate("ps2", B, T0 + 7e3).zn, "Hossin");
  assert.equal(m.locate("ps2", B, T0 + 7e3).f, undefined);
  m.prune(T0 + KEEP_MS + 60e3);
  assert.deepEqual(m.stats().ps2, { players: 0, placed: 0, bases: 0, zones: 0 });
  assert.equal(zoneDef(0x10000 + 344), 344, "instanced zone ids map to their continent");
});

test("PlayStation environments only take their own world", () => {
  const m = new LiveMap();
  assert.equal(m.onEvent("ps2ps4us", capture(T0, A, "201", { world: "2000" }), T0), false);
  assert.equal(m.onEvent("ps2ps4us", capture(T0, A, "201", { world: "1000" }), T0), true);
  assert.equal(m.locate("ps2ps4us", A, T0).w, 1000);
  assert.equal(m.locate("ps2", A, T0), null, "rooms never mix");
  assert.ok(LOCATOR_EVENTS.every((e) => subscribeMessage("ps2ps4us").eventNames.includes(e)));
});

test("activity: crowd per faction in the window, no player ids anywhere", () => {
  const m = new LiveMap();
  const ids = Array.from({ length: 12 }, (_, i) => String(5428000000000001000n + BigInt(i)));
  ids.forEach((id, i) => m.onEvent("ps2", capture(T0, id, "201"), T0));
  ids.forEach((id, i) => m.onEvent("ps2", death(T0 + 1e3 + i, id, D, { aTeam: i < 8 ? "1" : "2", vTeam: "3" }), T0 + 1e3 + i));
  const act = m.activity("ps2", "1", T0 + 30e3);
  const b = act.bases[0];
  assert.equal(b.f, 201);
  assert.equal(b.n.VS, 8);
  assert.equal(b.n.NC, 4);
  assert.equal(b.n.TR, 1, "the victim is placed near the base too");
  assert.equal(act.zones[2].n.VS + act.zones[2].n.NC + act.zones[2].n.TR, 13);
  const txt = JSON.stringify(act);
  for (const id of [...ids, D]) assert.ok(!txt.includes(id), "no character id in activity");
  assert.equal(m.activity("ps2", "1", T0 + WINDOW_MS + 60e3).bases[0]?.n.VS ?? 0, 0, "outside the window");
});

test("meter: counts, today, projection against the plan, save/load", () => {
  const me = new Meter({ since: T0 - 24 * 3600e3, h: {} });
  for (let h = 0; h < 24; h++) {
    const t = T0 - h * 3600e3 + 60e3;
    for (let i = 0; i < 10; i++) me.msg("ps2", "Death", 400, t);
    me.op("alarm", t, 60);
    me.op("fetch", t, 5);
    me.op("rows", t, 12);
  }
  const u = me.usage(T0 + 120e3);
  assert.equal(u.last24h.envs.ps2.events.Death, 240);
  assert.equal(u.last24h.alarm, 1440);
  const perMonth = MONTH_S / 86400;
  assert.equal(u.month.doRequests, Math.round((240 / WS_RATIO + 1440 + 120) * perMonth));
  assert.equal(u.month.doGbS, Math.round(DO_GB * MONTH_S));
  assert.ok(u.month.doGbS < INCLUDED.doGbS, "one always-on object fits the included duration");
  assert.equal(u.month.extraUsd, 0);
  assert.ok(me.today("ps2", T0 + 60e3) > 0);
  const back = Meter.load(JSON.stringify(me));
  assert.deepEqual(back.usage(T0 + 120e3), u);
  me.prune(T0 + 72 * 3600e3);
  assert.deepEqual(me.h, {});
  assert.ok(Meter.load("{not json").h, "a broken save starts a fresh meter");
  assert.equal(u.freeDay.doGbS, Math.round(DO_GB * 86400));
  assert.equal(u.freeDay.doRequests, Math.round(240 / WS_RATIO + 1440 + 120));
  assert.equal(u.freeDay.fits, true);
});

test("meter: a busy month shows the cost above the plan", () => {
  const me = new Meter({ since: T0 - 24 * 3600e3, h: {} });
  me.h["2026-10-29T11"] = { ps2: { Death: [10_000_000, 0] }, _: { fetch: 0, alarm: 0, rows: 0 } };
  const u = me.usage(T0 + 60e3);
  assert.ok(u.month.doRequests > INCLUDED.doRequests);
  assert.ok(u.month.extraUsd > 0 && u.month.extraUsd < 5, `${u.month.extraUsd}`);
  assert.ok(u.month.extraUsdWorst > u.month.extraUsd * 10, "1 message = 1 request would cost far more");
});

test("PC stream: live worlds only, governor steps full → lean → off, owner switch", () => {
  const full = pcSubscribe("full"), lean = pcSubscribe("lean");
  assert.deepEqual(full.worlds, ["1", "10", "40"]);
  assert.deepEqual(PC_WORLDS, ["1", "10", "40"]);
  assert.equal(full.characters[0], "all");
  assert.ok(full.logicalAndCharactersWithWorlds);
  for (const e of ["Death", "VehicleDestroy", "PlayerFacilityCapture", "PlayerFacilityDefend", "PlayerLogin", "PlayerLogout", "GainExperience_experience_id_272"]) assert.ok(lean.eventNames.includes(e), e);
  assert.ok(full.eventNames.includes("GainExperience_experience_id_557") && !lean.eventNames.includes("GainExperience_experience_id_557"));
  assert.ok(!full.eventNames.includes("GainExperience"), "never the whole XP firehose");
  assert.equal(streamLevel({}, 0), "full");
  assert.equal(streamLevel({}, 0, "free"), "off", "free plan: no PC stream");
  assert.deepEqual(subscribeMessage("ps2ps4us", { locator: false }).eventNames.filter((e) => LOCATOR_EVENTS.includes(e)), [], "free plan: the PS subscription from before");
  assert.equal(streamLevel({}, PC_SOFT), "lean");
  assert.equal(streamLevel({}, PC_HARD), "off");
  assert.equal(streamLevel({ PC_STREAM: "off" }, 0), "off");
  assert.equal(streamLevel({ PC_STREAM_SOFT: "10", PC_STREAM_HARD: "20" }, 15), "lean");
  assert.equal(messageName({ type: "serviceMessage", payload: { event_name: "GainExperience", experience_id: "557" } }), "GainExperience_557");
  assert.equal(messageName({ type: "heartbeat" }), "heartbeat");
  // Messages are metered and only PC worlds reach the live map.
  const meter = new Meter(), got = [];
  const pc = new PcStream({}, {}, { meter, onPayload: (env, p) => got.push([env, p.world_id]) });
  pc.onMessage(JSON.stringify({ type: "serviceMessage", payload: death(T0, A, B) }));
  pc.onMessage(JSON.stringify({ type: "serviceMessage", payload: death(T0, A, B, { world: "19" }) }));
  pc.onMessage(JSON.stringify({ type: "heartbeat", online: {} }));
  assert.deepEqual(got, [["ps2", "1"]]);
  assert.equal(meter.today("ps2"), 3);
});

function fakeCtx() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return { storage: { sql: { exec(q, ...b) { const rows = db.prepare(q).all(...b); return { toArray: () => rows, one: () => rows[0] }; } }, async setAlarm(t) { alarm = t; }, async getAlarm() { return alarm; } } };
}

function monitor() {
  const ctx = fakeCtx();
  const km = new KillMonitor(ctx, { PS_ASSISTS: "off", PC_STREAM: "off", PLAN: "free" }); // PLAN set: no plan.json fetch in tests
  km.meta("startedAt", 1); // the 10-id pilot is long finished: no pilot socket in tests
  return km;
}

test("KillMonitor: /live/locate and /live/activity from memory, /monitor/usage without sockets", async () => {
  const km = monitor();
  const now = Date.now();
  km.live.onEvent("ps2", capture(now - 5e3, A, "201"), now - 5e3);
  km.live.onEvent("ps2", death(now - 2e3, A, B), now - 2e3);
  const loc = await (await km.fetch(new Request(`https://monitor/live/locate?ns=ps2&ids=${A},${B},${C},nope`))).json();
  assert.equal(loc.players[A].fn, "Indar Waste Treatment");
  assert.equal(loc.players[B].how, "near");
  assert.equal(loc.players[C], undefined);
  assert.equal(loc.stream, false);
  const act = await (await km.fetch(new Request("https://monitor/live/activity?ns=ps2&world=1&zone=2"))).json();
  assert.equal(act.bases[0].fn, "Indar Waste Treatment");
  assert.equal((await km.fetch(new Request("https://monitor/live/activity?ns=ps2&world=1000"))).status, 400, "no PS world on the PC map");
  assert.equal((await km.fetch(new Request("https://monitor/live/locate?ns=xx&ids=" + A))).status, 400);
  const u = await (await km.fetch(new Request("https://monitor/monitor/usage"))).json();
  assert.equal(u.pc.want, "off");
  assert.deepEqual(u.plan, { plan: "free", from: "variable", tripped: null });
  assert.equal(km.meta("plan"), "free", "remembered for the next restart");
  assert.equal(u.freeDay.limits.doRequests, 100000);
  assert.ok(u.last24h.fetch >= 4);
  assert.ok(u.month.doGbS > 0);
  assert.equal(u.live.ps2.players, 2);
});

test("liveRoute: per-player positions need the key (not public), removed players never located, ids capped, rate limit", async () => {
  const km = monitor();
  const now = Date.now();
  km.live.onEvent("ps2", capture(now - 5e3, A, "201"), now - 5e3);
  km.live.onEvent("ps2", capture(now - 5e3, B, "203"), now - 5e3);
  const env = { CENSUS_PROXY_KEY: "k", KILL_MONITOR: { idFromName: (n) => n, get: () => ({ fetch: (r) => km.fetch(r) }) } };
  const removed = async () => new Set([B]);
  const cors = { "Access-Control-Allow-Origin": "https://dayset.github.io" };
  const call = async (q, ip = "x", key = "k") => liveRoute(new Request(`https://w/live/locate?${q}`, { headers: key ? { "X-Proxy-Key": key } : {} }), env, cors, { ip, removed });
  assert.equal((await call(`ns=ps2&ids=${A}`, "x", null)).status, 403, "no key: refused");
  assert.equal((await call(`ns=ps2&ids=${A}`, "x", "wrong")).status, 403);
  assert.equal((await liveRoute(new Request(`https://w/live/locate?ns=ps2&ids=${A}`, { headers: { "X-Proxy-Key": "" } }), { ...env, CENSUS_PROXY_KEY: "" }, cors, { removed })).status, 403, "no key set: refused");
  const r = await call(`ns=ps2&ids=${A},${B}`);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null, "no CORS: never read by a page");
  const j = await r.json();
  assert.ok(j.players[A]);
  assert.equal(j.players[B], undefined, "on the removal list");
  assert.equal((await call("ns=ps2&ids=")).status, 400);
  const many = Array.from({ length: LOCATE_MAX + 20 }, (_, i) => String(5428000000000002000n + BigInt(i))).join(",");
  assert.equal((await call(`ns=ps2&ids=${many}`)).status, 200);
  let last;
  for (let i = 0; i < 260; i++) last = await call(`ns=ps2&ids=${A}`, "busy");
  assert.equal(last.status, 429);
  const act = await liveRoute(new Request("https://w/live/activity?ns=ps2&world=1"), env, {}, { ip: "y", removed });
  assert.equal((await act.json()).bases.length, 2);
});
