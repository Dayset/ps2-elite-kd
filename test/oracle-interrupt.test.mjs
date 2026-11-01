// Server crash / shutdown mid-alert (owner t818s2880): an alert cut short by the server
// is "interrupted" (no winner, votes given back, left out of the accuracy stats and of
// training); an early end on a server that keeps running settles as normal; win chances
// stay frozen while a server is down. Worker parts need node:sqlite (Node >= 22.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isEarly, endedEarlyS, silenceVerdict, interruptedRecord, alertKey, KNOWN_INTERRUPTED, KNOWN_EARLY_OK, EARLY_END_S, SILENT_S, DECIDE_BY_S } from "../oracle-worker/src/interrupt.js";
import { prepare } from "../oracle-worker/history/grow.mjs";
import { fromRecord, fromBundle } from "../oracle-worker/history/capture-model.mjs";
import { samples } from "../oracle-worker/history/heat-model.mjs";
import { plannedDown } from "../oracle/js/maint.js";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const LANGS = ["en", "de", "fr", "es", "it", "ru", "uk", "ja", "zh"];

// ---------------------------------------------------------------- detection
test("early end: more than 3 min before the planned length", () => {
  const S = 1_000_000;
  assert.equal(endedEarlyS(S, 90, S + 90 * 60 - 20), 20);
  assert.equal(endedEarlyS(S, 90, S + 90 * 60 + 40), 0, "late is not early");
  assert.equal(isEarly(S, 90, S + 90 * 60 - EARLY_END_S), false, "exactly 3 min: normal");
  assert.equal(isEarly(S, 90, S + 90 * 60 - EARLY_END_S - 1), true);
  assert.equal(isEarly(S, 45, S + 30 * 60), true);
});

test("silence verdict on real patterns", () => {
  const E = 2_000_000;
  // 10-2-46360 (Oct 22): last capture 4 min before the end, nothing for 51 min after, other servers busy.
  const others = [E + 120, E + 400, E + 700, E + 1100];
  assert.equal(silenceVerdict([E - 240], others, E, E + 60), "wait", "too early to tell");
  assert.equal(silenceVerdict([E - 240], others, E, E + 20 * 60), "silent");
  // 1-6-49426 (Oct 27): ended 10 min early, next capture 2 min later -> server up.
  const up = [E - 300, E + 120, E + 500, E + 800, E + 1000, E + 1250];
  assert.equal(silenceVerdict(up.filter((x) => x <= E + 300), others, E, E + 5 * 60), "wait");
  assert.equal(silenceVerdict(up, others, E, E + DECIDE_BY_S), "up");
  // a capture 2 min after the end and then 12 quiet minutes is still a crash
  assert.equal(silenceVerdict([E - 300, E + 120], others, E, E + DECIDE_BY_S), "silent");
  // the longest normal quiet spell before an end was 9 min: never silent.
  assert.equal(silenceVerdict([E - 120, E + 9 * 60, E + 15 * 60], others, E, E + DECIDE_BY_S), "up");
  // quiet spell longer than 12 min that only starts 15 min after the end: unrelated
  assert.equal(silenceVerdict([E + 60, E + 300, E + 600, E + 900], others, E, E + 900 + SILENT_S + 60), "up");
  // nobody captured anything anywhere: our feed, not the server -> can't tell
  assert.equal(silenceVerdict([], [], E, E + DECIDE_BY_S), "unknown");
  assert.equal(silenceVerdict([], [], E, E + DECIDE_BY_S + 600), "unknown");
  // decided by end + 22 min at the latest
  assert.notEqual(silenceVerdict([E - 60, E + 700], others, E, E + DECIDE_BY_S), "wait");
});

// ---------------------------------------------------------------- training
test("training leaves interrupted alerts out, keeps checked early ends", () => {
  assert.equal(alertKey(10, 2, "10-46360"), "10-2-46360");
  assert.equal(alertKey(10, 2, 46360), "10-2-46360");
  const S = 1_790_000_000;
  const rec = (world, zone, id, ranMin, dur = 90) => ({ id: `${world}-${id}`, world, zone, event: 153, start: S, end: S + ranMin * 60, dur,
    init: { 1: 1 }, flips: [], result: { victor: 1, vs: 40, nc: 30, tr: 30 } });
  assert.equal(interruptedRecord(rec(10, 2, 46360, 27)), true, "listed crash");
  assert.equal(interruptedRecord(rec(1, 6, 49426, 80)), false, "ended early, server kept running");
  assert.equal(interruptedRecord(rec(1, 4, 99999, 60)), true, "unchecked early end: left out");
  assert.equal(interruptedRecord(rec(1, 4, 99999, 89.8)), false);
  assert.equal(interruptedRecord(rec(10, 6, 46374, 90)), false, "same instance id, other continent: not the crash");
  assert.equal(prepare(rec(10, 2, 46360, 27)).skip, "interrupted");
  assert.equal(fromRecord(rec(10, 2, 46360, 27)), null);
  assert.ok(fromRecord(rec(1, 6, 49426, 80)));
  const b = { world: 10, zone: 2, instance_id: 46360, event_id: 153, dur: 90, frames: [{ t: 0, set: { 1: "VS" } }] };
  assert.equal(fromBundle(b), null);
  assert.deepEqual(samples(b), []);
  assert.equal(fromBundle({ ...b, instance_id: 1, status: "interrupted" }), null);
  // the legacy Python builders read the same lists
  const py = JSON.parse(read("oracle/backend/interrupted_alerts.json"));
  assert.deepEqual(new Set(py.interrupted), KNOWN_INTERRUPTED);
  assert.deepEqual(new Set(py.early_ok), KNOWN_EARLY_OK);
  assert.equal(py.early_end_s, EARLY_END_S);
  for (const f of ["build_winbins.py", "build_winbins_growtree.py", "build_winbins_tree.py", "build_winbins_mom.py"])
    assert.match(read("oracle/backend/" + f), /interrupted\(inst\)/, f);
});

// ---------------------------------------------------------------- page
test("page: short note in 9 languages, details in the hover hint", () => {
  const keys = ["or.st.int", "or.badge.interrupted", "or.int", "or.intHint", "or.early", "or.earlyHint", "or.frozen", "or.frozenHint", "or.off.status", "or.off.all", "or.off.some", "or.off.empty"];
  for (const l of LANGS) {
    const d = JSON.parse(read(`i18n/${l}.json`));
    for (const k of keys) assert.ok(d[k] && d[k].trim(), `${l}: ${k}`);
    assert.ok(d["or.int"].length <= 70, `${l}: note stays short`);
    assert.match(d["or.intHint"], /\{n\}/, `${l}: hint says how early`);
    assert.match(d["or.off.some"], /\{names\}/, l);
  }
  const en = JSON.parse(read("i18n/en.json"));
  assert.equal(en["or.int"], "Server went down mid-alert. No winner, votes refunded.");
  assert.doesNotMatch(Object.values(en).filter((v, i) => keys.includes(Object.keys(en)[i])).join(" "), /maintenance/i, "unannounced outages are not called maintenance");
  const main = read("oracle/js/main.js"), css = read("oracle/oracle.css"), res = read("oracle/js/results.js");
  assert.match(main, /or\.badge\.interrupted/); assert.match(main, /or\.intHint/); assert.match(main, /or\.frozenHint/);
  assert.match(main, /plannedDown\(/); assert.match(res, /interrupted/);
  assert.match(css, /\.badge\.interrupted/);
  // "maintenance" only when Daybreak announced it
  assert.equal(plannedDown({ key: "eta" }), true);
  assert.equal(plannedDown({ key: "late" }), true);
  assert.equal(plannedDown(null), false);
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
let R2F = null;
function mapJson() {
  R2F ||= JSON.parse(read("oracle/backend/hossin_region_to_facility.json"));
  const rows = Object.keys(R2F).map((r, i) => ({ RowData: { RegionId: r, FactionId: String(1 + (i % 3)) } }));
  return { map_list: [{ ZoneId: "4", Regions: { Row: rows } }], returned: 1 };
}
const mg = (instance, st, ts, vs = 30, nc = 30, tr = 30) => ({ event_type: "MetagameEvent", world_id: "1", zone_id: "4", instance_id: String(instance),
  metagame_event_id: "153", metagame_event_state_name: st, timestamp: String(ts), faction_vs: String(vs), faction_nc: String(nc), faction_tr: String(tr) });
function install(c) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.includes("api.steampowered.com")) body = { appnews: { newsitems: [] } };
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
const flip = (DB, world, zone, ts) => DB.raw.prepare("INSERT INTO flip (world, zone, facility, ts, old, new) VALUES (?,?,?,?,1,2)").run(world, zone, 1000 + ts % 997, ts);
function addVotes(DB, key, T) {
  DB.raw.prepare("INSERT INTO wallet (cid, balance, created, last_auto_at) VALUES ('c1', 100, ?, ?), ('c2', 50, ?, ?)").run(T, T, T, T);
  const v = DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'open')");
  v.run("v1", "c1", key, "VS", 10, 1, 9, 25, 40, 0.1, T + 120);
  v.run("v2", "c2", key, "NC", 5, 0.5, 4.5, 14, 30, 0.1, T + 120);
}

test("crash: early end + server silent -> interrupted, no winner, votes given back, not in the benchmark", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1(); const env = { DB };
  const T0 = 1_793_300_000, END = T0 + 27 * 60;
  const c = { metagame: [mg(900, "started", T0)] };
  install(c);
  for (const m of [1, 5, 10, 20, 25]) await runCycle(env, (T0 + m * 60) * 1000);
  const key = DB.raw.prepare("SELECT key FROM alert").get().key;
  addVotes(DB, key, T0);
  flip(DB, 1, 4, END - 240);                                  // last capture before the crash
  for (const s of [120, 400, 700, 1100, 1300]) flip(DB, 10, 2, END + s);   // other servers keep going
  c.metagame.push(mg(900, "ended", END, 45, 30, 25));         // Census closes it 63 min early, real-looking scores
  await runCycle(env, (END + 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "settling", "waits to see if the server comes back");
  assert.equal(DB.raw.prepare("SELECT status FROM vote WHERE id='v1'").get().status, "open");
  await runCycle(env, (END + DECIDE_BY_S + 60) * 1000);
  const a = DB.raw.prepare("SELECT status, winner, basis, flags FROM alert").get();
  assert.equal(a.status, "interrupted"); assert.equal(a.winner, null); assert.equal(a.basis, null);
  assert.match(a.flags, /interrupted:server_silent/); assert.match(a.flags, /ended_early:63/);
  const votes = DB.raw.prepare("SELECT id, status, reward FROM vote ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(votes, [{ id: "v1", status: "void", reward: 10 }, { id: "v2", status: "void", reward: 5 }], "full amount back, fee included");
  assert.deepEqual(DB.raw.prepare("SELECT balance FROM wallet ORDER BY cid").all().map((r) => r.balance), [110, 55]);
  const b = DB.raw.prepare("SELECT winner, brier, settled_ts FROM bench").get();
  assert.ok(!b || (b.winner == null && b.brier == null && b.settled_ts == null), "benchmark row never settled");
  const h = await (await worker.fetch(new Request("https://x/history?days=30"), env)).json();
  const ha = h.alerts.find((x) => x.key === key);
  assert.ok(ha, "listed in history"); assert.equal(ha.status, "interrupted");
  assert.ok(!JSON.stringify(h.benchmark).includes(key), "left out of the benchmark");
  // nothing changes on later minutes
  await runCycle(env, (END + 60 * 60) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "interrupted");
  assert.deepEqual(DB.raw.prepare("SELECT balance FROM wallet ORDER BY cid").all().map((r) => r.balance), [110, 55], "refunded once");
});

test("early end on a server that keeps running settles normally, tagged ended early", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1(); const env = { DB };
  const T0 = 1_793_400_000, END = T0 + 80 * 60;
  const c = { metagame: [mg(901, "started", T0)] };
  install(c);
  for (const m of [1, 30, 60, 79]) await runCycle(env, (T0 + m * 60) * 1000);
  const key = DB.raw.prepare("SELECT key FROM alert").get().key;
  addVotes(DB, key, T0);
  for (const s of [-300, 120, 500, 900]) flip(DB, 1, 4, END + s);
  for (const s of [100, 600]) flip(DB, 10, 2, END + s);
  c.metagame.push(mg(901, "ended", END, 45, 30, 25));
  for (const m of [1, 10, 25]) await runCycle(env, (END + m * 60) * 1000);
  const a = DB.raw.prepare("SELECT status, winner, flags FROM alert").get();
  assert.equal(a.status, "settled"); assert.equal(a.winner, "VS");
  assert.match(a.flags, /ended_early:10/); assert.doesNotMatch(a.flags, /interrupted/);
  assert.deepEqual(DB.raw.prepare("SELECT status FROM vote ORDER BY id").all().map((r) => r.status), ["won", "lost"]);
});

test("server down mid-alert: win chances frozen, nothing written, voting closed", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1(); const env = { DB };
  const T0 = 1_793_500_000;
  const c = { locked: false, metagame: [mg(902, "started", T0)] };
  install(c);
  for (const m of [1, 2, 3]) await runCycle(env, (T0 + m * 60) * 1000);
  const key = DB.raw.prepare("SELECT key FROM alert").get().key;
  const before = { ...DB.raw.prepare("SELECT state FROM alert").get() };
  const ticks = DB.raw.prepare("SELECT COUNT(*) n FROM tick").get().n;
  const bench = DB.raw.prepare("SELECT slices FROM bench").get();
  c.locked = true;
  for (const m of [10, 20, 30, 40]) await runCycle(env, (T0 + m * 60) * 1000);
  const a = DB.raw.prepare("SELECT status, state, flags FROM alert").get();
  assert.equal(a.status, "live"); assert.match(a.flags, /server_down/);
  assert.equal(a.state, before.state, "win chances don't drift");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM tick").get().n, ticks, "no win-chance minutes written while down");
  assert.deepEqual(DB.raw.prepare("SELECT slices FROM bench").get() ?? null, bench ?? null, "no benchmark slices while down");
  const q = await (await worker.fetch(new Request(`https://x/vote/quote?key=${encodeURIComponent(key)}`), env)).json();
  assert.equal(q.open, false, "no votes on frozen chances");
  // back up: chances move again
  c.locked = false;
  for (const m of [45, 46]) await runCycle(env, (T0 + m * 60) * 1000);
  assert.ok(DB.raw.prepare("SELECT COUNT(*) n FROM tick").get().n > ticks, "resumes after return");
  assert.doesNotMatch(DB.raw.prepare("SELECT flags FROM alert").get().flags || "", /server_down/);
});
