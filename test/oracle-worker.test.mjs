// ps2-oracle Worker: full alert lifecycle against a real SQLite D1 stand-in and
// a fake Census. Covers: map/metagame/flip storage, live state + ticks +
// benchmark slices, settlement from Census final scores at +10 min, sudden
// death deciding a draw, the snapshot cross-check flag, and the read API.
// Needs node:sqlite (Node >= 22.5); skipped otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";

const SCHEMA = readFileSync(new URL("../oracle-worker/schema.sql", import.meta.url), "utf8");

function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  let queries = 0;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { queries++; return db.prepare(sql).get(...args) ?? null; },
    async all() { queries++; return { results: db.prepare(sql).all(...args) }; },
    async run() { queries++; const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    _exec() { queries++; const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw: db,
    get queries() { return queries; },
    reset() { queries = 0; },
    prepare: (sql) => stmt(sql),
    async batch(list) { db.exec("BEGIN"); try { const r = list.map((s) => s._exec()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}

// Hossin regions from the real model so owners/territory are realistic.
const R2F = JSON.parse(readFileSync(new URL("../oracle/backend/hossin_region_to_facility.json", import.meta.url), "utf8"));
const REGIONS = Object.keys(R2F);

function mapJson(shares) {
  // shares: {1: n VS, 2: n NC, 3: n TR}, rest neutral
  const rows = [];
  let i = 0;
  for (const [fac, n] of Object.entries(shares)) for (let k = 0; k < n; k++) rows.push({ RowData: { RegionId: REGIONS[i++], FactionId: fac } });
  while (i < REGIONS.length) rows.push({ RowData: { RegionId: REGIONS[i++], FactionId: "0" } });
  return { map_list: [{ ZoneId: "4", Regions: { Row: rows } }], returned: 1 };
}

function installCensus(state) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.includes("/map/")) {
      const w = +new URL(u).searchParams.get("world_id");
      body = w === 1 ? mapJson(state.map) : { map_list: [], returned: 0 };
    } else if (u.includes("type=METAGAME")) {
      body = { world_event_list: state.metagame, returned: state.metagame.length };
    } else if (u.includes("type=FACILITY")) {
      body = { world_event_list: state.flips, returned: state.flips.length };
    } else if (u.includes("wt.honu.pw/api/population/")) {
      // Honu: camelCase list; zoneID may carry instance bits above 16.
      body = state.honu ? [{ worldID: 1, zoneID: (3 << 16) | 4, timestamp: "2026-10-18T06:00:00Z", total: 300, vs: 150, nc: 90, tr: 50, ns: 10 },
        { worldID: 1, zoneID: 2, total: 5, vs: 1, nc: 2, tr: 2, ns: 0 }] : [];
      if (state.honuDown) return new Response("down", { status: 503 });
    } else throw new Error("unexpected " + u);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

const mg = (instance, event, stateName, ts, vs = 30, nc = 30, tr = 30, world = 1, zone = 4) => ({
  event_type: "MetagameEvent", world_id: String(world), zone_id: String(zone), instance_id: String(instance),
  metagame_event_id: String(event), metagame_event_state_name: stateName, timestamp: String(ts),
  faction_vs: String(vs), faction_nc: String(nc), faction_tr: String(tr),
});

test("full alert lifecycle: live → settling → settled from Census final scores", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k" };
  const T0 = 1_792_300_000;
  const census = { map: { 1: 30, 2: 30, 3: 28 }, metagame: [], flips: [], honu: true };
  installCensus(census);

  // Pre-alert minute (for 15-min momentum), then the alert starts.
  await runCycle(env, (T0 - 1200) * 1000);
  census.metagame = [mg(500, 153, "started", T0)];
  census.flips = [{ event_type: "FacilityControl", world_id: "1", zone_id: "4", facility_id: "261000", faction_old: "2", faction_new: "1", duration_held: "300", timestamp: String(T0 + 30), outfit_id: "1" },
    { event_type: "FacilityControl", world_id: "1", zone_id: "4", facility_id: "262000", faction_old: "3", faction_new: "3", timestamp: String(T0 + 40) }];
  DB.reset();
  let rep = await runCycle(env, (T0 + 60) * 1000);
  assert.equal(rep.live, 1, JSON.stringify(rep));
  assert.ok(DB.queries <= 50, `D1 queries per run: ${DB.queries}`);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM flip").get().n, 1, "defense (old==new) is not a flip");

  // Mid-alert: VS surges.
  census.map = { 1: 50, 2: 20, 3: 18 };
  for (const m of [15, 30, 31, 60]) await runCycle(env, (T0 + m * 60) * 1000);
  const live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.equal(live.alerts.length, 1);
  const a = live.alerts[0];
  assert.equal(a.key, "1-4-500");
  assert.equal(a.world_name, "Osprey");
  assert.equal(a.status, "live");
  assert.equal(a.state.leader, "VS");
  assert.ok(a.state.win.VS.pct > 50, JSON.stringify(a.state.win));
  assert.equal(Object.keys(a.state.owners).length, 88);
  const bench = JSON.parse(DB.raw.prepare("SELECT slices FROM bench").get().slices);
  assert.deepEqual(Object.keys(bench).sort(), ["t0", "t0_pop", "t30", "t30_pop", "t60"], "pop blend logged until t60, where its weight hits 0");
  assert.deepEqual(a.state.pop, { VS: 150, NC: 90, TR: 50 }, "Honu zone id masked to 4");
  assert.equal(a.state.pop_source, "honu");
  assert.equal(a.kind, "territory");
  assert.ok(DB.raw.prepare("SELECT COUNT(*) n FROM pop").get().n >= 4);

  // Ends; Census final says TR (snapshot says VS → flagged, Census wins).
  const END = T0 + 90 * 60;
  census.metagame.push(mg(500, 153, "ended", END, 32.9, 31.8, 35.3));
  await runCycle(env, (END + 60) * 1000);
  let row = DB.raw.prepare("SELECT status, checks, winner FROM alert").get();
  assert.deepEqual({ ...row }, { status: "settling", checks: 1, winner: null });
  await runCycle(env, (END + 330) * 1000);
  assert.equal(DB.raw.prepare("SELECT checks FROM alert").get().checks, 2);
  await runCycle(env, (END + 630) * 1000);
  row = DB.raw.prepare("SELECT status, checks, winner, basis, flags FROM alert").get();
  assert.equal(row.status, "settled");
  assert.equal(row.checks, 3);
  assert.equal(row.winner, "TR");
  assert.equal(row.basis, "census_final");
  assert.ok(JSON.parse(row.flags).includes("snapshot_winner_VS"), row.flags);
  const b = DB.raw.prepare("SELECT winner, brier FROM bench").get();
  assert.equal(b.winner, "TR");
  assert.ok(JSON.parse(b.brier).t60 > 0.2, "VS-favoured prediction scores badly when TR wins");

  // Settled alerts are final: a later run does not touch them.
  await runCycle(env, (END + 900) * 1000);
  assert.equal(DB.raw.prepare("SELECT winner FROM alert").get().winner, "TR");

  const hist = await (await worker.fetch(new Request("https://x/history"), env)).json();
  assert.equal(hist.alerts[0].winner, "TR");
  assert.ok(hist.benchmark["90"].t60.n === 1);
  const one = await (await worker.fetch(new Request("https://x/alert?key=1-4-500"), env)).json();
  assert.ok(one.ticks.length >= 4);
});

test("a draw waits for sudden death and settles on its kills", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  const T0 = 1_792_400_000;
  const END = T0 + 45 * 60;
  const census = { map: { 1: 30, 2: 30, 3: 28 }, metagame: [mg(600, 177, "started", T0), mg(600, 177, "ended", END, 12, 12, 9)], flips: [] };
  installCensus(census);
  await runCycle(env, (END + 660) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "settling", "draw holds");
  census.metagame.push(mg(601, 237, "started", END + 5));
  await runCycle(env, (END + 720) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "sudden_death");
  census.metagame.push(mg(601, 237, "ended", END + 905, 234, 397, 419));
  await runCycle(env, (END + 960) * 1000);
  const row = DB.raw.prepare("SELECT status, winner, basis FROM alert").get();
  assert.deepEqual({ ...row }, { status: "settled", winner: "TR", basis: "sudden_death" });
});

test("Census outage: errors are reported, nothing throws, health turns unhealthy", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
  const rep = await runCycle(env, Date.now());
  assert.ok(rep.errors.length >= 6, JSON.stringify(rep.errors));
  const h = await (await worker.fetch(new Request("https://x/health"), env)).json();
  assert.equal(h.ok, true, "a cycle that ran is fresh");
  assert.equal(h.last_ok_age_s, null, "but it never succeeded");
});

test("key-protected endpoints refuse without the key", { skip }, async () => {
  const { default: worker } = await import("../oracle-worker/src/index.js");
  const env = { DB: fakeD1(), ORACLE_KEY: "secret" };
  assert.equal((await worker.fetch(new Request("https://x/export?world=1&zone=4"), env)).status, 403);
  const r = await worker.fetch(new Request("https://x/commander", { method: "POST", body: "{}", headers: { "X-Oracle-Key": "nope" } }), env);
  assert.equal(r.status, 403);
  assert.equal((await worker.fetch(new Request("https://x/export?world=1&zone=4", { headers: { "X-Oracle-Key": "secret" } }), env)).status, 200);
});

test("Outfit Wars is ignored; Meltdown alerts are labelled; Honu outage does not stop odds", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  const T0 = 1_792_500_000;
  const census = { map: { 1: 30, 2: 30, 3: 28 }, flips: [], honuDown: true,
    metagame: [mg(700, 227, "started", T0), mg(701, 177, "started", T0)] };
  installCensus(census);
  const rep = await runCycle(env, (T0 + 600) * 1000);
  assert.equal(rep.live, 1, "only the Meltdown alert is live");
  assert.ok(rep.errors.some((e) => e.startsWith("honu")), JSON.stringify(rep.errors));
  const live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.equal(live.alerts.length, 1);
  assert.equal(live.alerts[0].kind, "meltdown");
  assert.equal(live.alerts[0].state.alert.kind, "meltdown");
  assert.equal(live.alerts[0].state.win_popadj, null);
});

test("sudden death on another continent does not decide this draw", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  const T0 = 1_792_600_000, END = T0 + 45 * 60;
  const census = { map: { 1: 30, 2: 30, 3: 28 }, flips: [],
    metagame: [mg(800, 177, "started", T0), mg(800, 177, "ended", END, 12, 12, 9),
      mg(801, 238, "started", END + 5, 0, 0, 0, 1, 6), mg(801, 238, "ended", END + 905, 1, 2, 3, 1, 6)] };
  installCensus(census);
  await runCycle(env, (END + 1300) * 1000);
  const row = DB.raw.prepare("SELECT status, winner, basis FROM alert").get();
  assert.deepEqual({ ...row }, { status: "settled", winner: "draw", basis: "census_final" });
});
