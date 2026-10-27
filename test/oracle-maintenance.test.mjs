// Game-server maintenance (owner t721u): Census "locked" worlds -> calm info notice on the
// page, last good data kept, no "data delayed", no alert ended/voided while a server is down
// or just back, clears on its own. Worker parts need node:sqlite (Node >= 22.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWorldStates, serverStatus, holdFinals, serversHint, BACK_GRACE_S, parseSchedule, pickSchedule, schedDue, schedHint, SCHED_EVERY_S, SCHED_EVERY_DOWN_S } from "../oracle-worker/src/maintenance.js";
import { maintNotice, schedState, lastOnline, STATUS_URL } from "../oracle/js/maint.js";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("world states and the per-world verdict", () => {
  // real Census answer on 2026-10-27 during Hotfix #4
  const st = parseWorldStates({ world_list: [{ world_id: "40", state: "locked" }, { world_id: "1", state: "locked" }, { world_id: "10", state: "online" }] });
  assert.deepEqual(st, { 1: "locked", 10: "online", 40: "locked" });
  const T = 1_793_110_000;
  let s = serverStatus([1, 10, 40], null, st, { 1: true, 10: true }, {}, T);
  assert.equal(s[1].down, true); assert.equal(s[40].down, true); assert.equal(s[10].down, false);
  assert.equal(s[1].since, T); assert.equal(s[10].last_ok, T); assert.equal(s[1].last_ok, null, "a frozen map from a locked world is not good data");
  // state call fails next minute: keep the verdict
  const s2 = serverStatus([1, 10, 40], s, null, {}, {}, T + 60);
  assert.equal(s2[1].down, true); assert.equal(s2[1].since, T);
  // a stale "locked" with fresh captures = up
  const s3 = serverStatus([1, 10, 40], s2, st, { 1: true }, { 1: T + 100 }, T + 120);
  assert.equal(s3[1].down, false); assert.equal(s3[1].back, T + 120); assert.equal(s3[1].down_from, T);
  assert.equal(holdFinals(s3, 1, T + 120), true, "just back: still held");
  const s4 = serverStatus([1], s3, { 1: "online" }, { 1: true }, {}, T + 120 + BACK_GRACE_S);
  assert.equal(holdFinals(s4, 1, T + 120 + BACK_GRACE_S), false, "grace over");
  assert.equal(holdFinals(s4, 10, T), false);
  assert.deepEqual(serversHint(s)[1], { down: true, since: T, last_ok: null, last_up: null });
});

test("page notice: all down, some down, none", () => {
  const names = { 1: "Osprey", 10: "Wainwright", 40: "SolTech" };
  assert.equal(maintNotice(null, names), null);
  assert.equal(maintNotice({ 1: { down: false }, 10: { down: false } }, names), null);
  assert.deepEqual(maintNotice({ 1: { down: false }, 10: { down: false }, 40: { down: true, last_ok: 50 } }, names), { all: false, names: ["SolTech"], down: [{ name: "SolTech", lastUp: null }], lastOk: 50 });
  assert.deepEqual(maintNotice({ 1: { down: true, last_ok: 40 }, 10: { down: true, last_ok: 60 }, 40: { down: true } }, names), { all: true, names: ["Osprey", "Wainwright", "SolTech"], down: [{ name: "Osprey", lastUp: null }, { name: "Wainwright", lastUp: null }, { name: "SolTech", lastUp: null }], lastOk: 60 });
});

test("page wiring + 9 languages", () => {
  const main = read("oracle/js/main.js"), css = read("oracle/oracle.css");
  assert.match(main, /maintNotice\(cy && cy\.servers, live\.worlds\)/);
  assert.match(main, /"info", links\)/, "info banner with links, not warn");
  assert.match(main, /schedState\(cy && cy\.sched, mt, now\)/);
  assert.equal(STATUS_URL, "https://www.daybreakgames.com/status");
  assert.match(css, /\.banner\.info/); assert.match(css, /prefers-reduced-motion: reduce\) \{ \.dot\.info/);
  for (const l of ["en", "de", "es", "fr", "it", "ja", "ru", "uk", "zh"]) {
    const j = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["or.mt.status", "or.mt.all", "or.mt.some", "or.mt.empty", "or.mt.lastUp", "or.mt.lastAll", "or.mt.lastList", "or.mt.keep", "or.mt.eta", "or.mt.late", "or.mt.soon", "or.mt.src", "or.mt.statusLink"]) assert.ok(j[k], `${l} ${k}`);
    const has = (k, ...v) => v.forEach((x) => assert.ok(j[k].includes(`{${x}}`), `${l} ${k} {${x}}`));
    has("or.mt.some", "names"); has("or.mt.lastUp", "name", "time"); has("or.mt.lastAll", "time"); has("or.mt.lastList", "list");
    has("or.mt.eta", "hours", "start", "end"); has("or.mt.late", "hours", "start"); has("or.mt.soon", "start", "hours", "end");
    assert.ok(!j["or.mt.allNoTime"] && !/cheat|track|locat/i.test(Object.entries(j).filter(([k]) => k.startsWith("or.mt.")).map(([, v]) => v).join(" ")), l);
  }
});

// Real Steam posts (2026-10-27 Hotfix #4, 2026-10-08 client-only) as the API returns them.
const HOTFIX4 = { gid: "1847286114047271", title: "October 27, 2026 Hotfix #4", date: 1793061309, contents: "A new client build will be updated 10/27/26. All servers will be down for the scheduled maintenance at 6am pdt. Please see the patch notes below. There will be a 3hr downtime window.Maintenance DurationClient and Server UpdateThis will be a combined client and server update, requiring approximately 3 hours of server downtime for maintenance." };
const CLIENT_ONLY = { gid: "1846018067927969", title: "October 8, 2026 Hotfix Notes", date: 1791421784, contents: "A new client build will be updated 10/8/26. Simply restart your game to receive the update after 6am pdt. This time, there will be no server downtime. No maintenance downtime will be required." };

test("announced schedule: parsed only when date, time and length are all there", () => {
  const s = parseSchedule(HOTFIX4);
  assert.equal(s.start, Date.UTC(2026, 9, 27, 13) / 1000, "6am PDT = 13:00 UTC");
  assert.equal(s.end, s.start + 3 * 3600); assert.equal(s.hours, 3);
  assert.equal(s.url, "https://store.steampowered.com/news/app/218230/view/1847286114047271");
  assert.equal(parseSchedule(CLIENT_ONLY), null, "client-only patch: no downtime");
  // "tomorrow" + post date (posted Oct 21 evening Pacific)
  const t = parseSchedule({ title: "October 22, 2026 - Patch Notes", date: 1792630000, contents: "Game servers will be down for a scheduled maintenance tomorrow @ 6AM PDT. This will be a combined client and server update, requiring approximately 3 hours of server downtime for maintenance." });
  assert.equal(t.start, Date.UTC(2026, 9, 22, 13) / 1000);
  // missing length / time -> nothing (never a guess)
  assert.equal(parseSchedule({ title: "x", date: 1792630000, contents: "Game servers will be down for a scheduled maintenance tomorrow @ 6AM PDT." }), null);
  assert.equal(parseSchedule({ title: "x", date: 1792630000, contents: "Servers will be down tomorrow for about 3 hours." }), null);
  // an unrelated "48 hours" is not the downtime
  assert.equal(parseSchedule({ title: "x", date: 1792630000, contents: "Double XP for 48 hours! Servers will be down tomorrow at 6am PDT for about 2 hours." }).hours, 2);
  assert.equal(parseSchedule({ title: "x", date: 1792630000, contents: "The event lasts 6 hours. Servers will be down tomorrow at 6am pdt." }), null);
  // PST in winter, "pt" resolved from the date
  assert.equal(parseSchedule({ title: "x", contents: "All servers will be down at 6am pt on 1/14/27 for 2 hours of maintenance." }).start, Date.UTC(2027, 0, 14, 14) / 1000);
  // pick: newest window near now only
  const now = s.start + 3600;
  assert.equal(pickSchedule({ appnews: { newsitems: [CLIENT_ONLY, HOTFIX4] } }, now).start, s.start);
  assert.equal(pickSchedule({ appnews: { newsitems: [HOTFIX4] } }, s.start + 3 * 86400), null, "old post is not today's schedule");
  // polite: 30 min normally, 10 min while a server is down
  assert.equal(schedDue({ checked: now - SCHED_EVERY_S + 60 }, { 1: { down: false } }, now), false);
  assert.equal(schedDue({ checked: now - SCHED_EVERY_DOWN_S }, { 1: { down: true } }, now), true);
  assert.equal(schedHint({ sched: s }, s.end + 13 * 3600), null, "hint expires");
});

test("page: last online + which schedule sentence", () => {
  const names = { 1: "Osprey", 10: "Wainwright", 40: "SolTech" };
  const mt = maintNotice({ 1: { down: true, last_up: 1000 }, 10: { down: true, last_up: 1100 }, 40: { down: true, last_up: 1200 } }, names);
  assert.deepEqual(lastOnline(mt), { one: 1200 });
  assert.equal(lastOnline(maintNotice({ 1: { down: true, last_up: 1000 }, 10: { down: true, last_up: 9000 } }, names)).each.length, 2);
  assert.equal(lastOnline(maintNotice({ 1: { down: true } }, names)), null);
  const sc = { start: 10_000, end: 20_800, hours: 3, url: "https://store.steampowered.com/news/app/218230/view/1" };
  assert.equal(schedState(sc, mt, 12_000).key, "eta");
  assert.equal(schedState(sc, mt, 30_000).key, "late");
  assert.equal(schedState(sc, null, 9_000).key, "soon");
  assert.equal(schedState(sc, null, 12_000), null, "servers up inside the window: nothing to say");
  assert.equal(schedState(sc, mt, 1_000), null, "down long before the announced start: not this window");
  assert.equal(schedState({ ...sc, url: "https://evil.example/" }, mt, 12_000).url, null, "only Daybreak's Steam post is linked");
  assert.equal(schedState(null, mt, 12_000), null);
});

// ---------------------------------------------------------------- Worker
const SCHEMA = read("oracle-worker/schema.sql");
function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:"); db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { db.prepare(sql).run(...args); return { meta: {} }; },
    _exec() { db.prepare(sql).run(...args); return { meta: {} }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(l) { db.exec("BEGIN"); try { l.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
const R2F = JSON.parse(read("oracle/backend/hossin_region_to_facility.json"));
const REGIONS = Object.keys(R2F);
function mapJson() {
  const rows = REGIONS.map((r, i) => ({ RowData: { RegionId: r, FactionId: String(1 + (i % 3)) } }));
  return { map_list: [{ ZoneId: "4", Regions: { Row: rows } }], returned: 1 };
}
const mg = (instance, event, st, ts, vs = 30, nc = 30, tr = 30) => ({ event_type: "MetagameEvent", world_id: "1", zone_id: "4", instance_id: String(instance),
  metagame_event_id: String(event), metagame_event_state_name: st, timestamp: String(ts), faction_vs: String(vs), faction_nc: String(nc), faction_tr: String(tr) });
function install(c) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.includes("api.steampowered.com")) { c.steamCalls = (c.steamCalls || 0) + 1; body = c.steam || { appnews: { newsitems: [] } }; }
    else if (u.includes("/world/?")) body = { world_list: [1, 10, 40].map((w) => ({ world_id: String(w), state: c.locked ? "locked" : "online" })) };
    else if (u.includes("/map/")) {
      if (c.locked) return new Response(JSON.stringify({ errorCode: "SERVER_ERROR" }), { status: 200 });
      body = +new URL(u).searchParams.get("world_id") === 1 ? mapJson() : { map_list: [] };
    } else if (u.includes("type=METAGAME")) body = { world_event_list: c.metagame };
    else if (u.includes("type=FACILITY")) body = { world_event_list: [] };
    else throw new Error("unexpected " + u);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

test("maintenance: no 'delayed', no snapshots from locked worlds, live alert never voided, settles after return", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1(); const env = { DB };
  const T0 = 1_793_100_000, DUR = 90 * 60;
  const c = { locked: false, metagame: [mg(700, 153, "started", T0)], steam: { appnews: { newsitems: [HOTFIX4] } } };
  install(c);
  await runCycle(env, (T0 + 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "live");
  const snaps0 = DB.raw.prepare("SELECT COUNT(*) n FROM snap").get().n;

  // Servers go down mid-alert; stay down past the alert's end + 30 min.
  c.locked = true;
  for (const m of [30, 60, 120, 125]) await runCycle(env, (T0 + m * 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM snap").get().n, snaps0, "no frozen snapshots stored");
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "settling", "held, not unresolved");
  const h = await (await worker.fetch(new Request("https://x/health"), env)).json();
  assert.equal(h.last_ok_age_s, h.last_cycle_age_s, "down worlds don't count as our delay: " + JSON.stringify(h));
  assert.equal(h.servers[1].down, true);
  const live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.deepEqual(Object.keys(live.cycle.servers).sort(), ["1", "10", "40"]);
  assert.equal(live.cycle.servers[1].last_ok, T0 + 60);
  assert.equal(maintNotice(live.cycle.servers, live.worlds).all, true);
  assert.equal(live.cycle.servers[1].last_up, T0 + 60, "last online = last minute seen up");
  assert.equal(c.steamCalls, 4, "Steam read at most every 10 min while down (5 cycles, the last one 5 min after the previous)");
  assert.equal(live.cycle.sched.start, Date.UTC(2026, 9, 27, 13) / 1000, "Daybreak's window reaches the page");
  assert.equal(schedState(live.cycle.sched, maintNotice(live.cycle.servers, live.worlds), T0 + 125 * 60).key, "eta");

  // Back: Census posts the late ended row with real scores -> settles on it, never voided.
  c.locked = false;
  c.metagame.push(mg(700, 153, "ended", T0 + DUR, 40, 30, 28));
  await runCycle(env, (T0 + 130 * 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "settling", "grace after return");
  const live2 = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.equal(maintNotice(live2.cycle.servers, live2.worlds), null, "notice clears on its own");
  await runCycle(env, (T0 + 130 * 60 + BACK_GRACE_S) * 1000);
  const row = DB.raw.prepare("SELECT status, winner FROM alert").get();
  assert.deepEqual({ ...row }, { status: "settled", winner: "VS" });
});

test("maintenance: an alert 'ended' by the shutdown is held until the server is back", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1(); const env = { DB };
  const T0 = 1_793_200_000;
  const c = { locked: false, metagame: [mg(800, 153, "started", T0)] };
  install(c);
  await runCycle(env, (T0 + 60) * 1000);
  c.locked = true;
  await runCycle(env, (T0 + 1800) * 1000);
  c.metagame.push(mg(800, 153, "ended", T0 + 1830, 20, 15, 10));   // shutdown row, sums 45 %
  for (const m of [40, 60, 90]) await runCycle(env, (T0 + m * 60) * 1000);
  const r = DB.raw.prepare("SELECT status, winner, flags FROM alert").get();
  assert.equal(r.status, "settling"); assert.equal(r.winner, null); assert.match(r.flags, /maintenance_hold/);
  c.locked = false;
  await runCycle(env, (T0 + 100 * 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "settling");
  await runCycle(env, (T0 + 100 * 60 + BACK_GRACE_S) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "unresolved", "#67 corrupt-sum hold applies after return");
});
