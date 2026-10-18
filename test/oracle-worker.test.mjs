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
    } else if (u.includes("wt.honu.pw/api/realtime-alert")) {
      body = state.realtime || [];
    } else if (u.includes("/participants")) {
      if (!state.participants) return new Response("not finished", { status: 400 });
      body = state.participants;
    } else if (u.includes("ps2radar.com/api/v1/players/")) {
      state.radarCalls = (state.radarCalls || 0) + 1;
      if (u.endsWith("/5428010618035300002")) return new Response("{}", { status: 404 });
      body = { player: { name: "Ace", character_id: "5428010618035300001", classification: { tier: "suspect", label: "Suspect" }, model: { tier: "blatant", blatant: true, sus_score: 91 } } };
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
  const { runCycle, honuIngest, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k" };
  const T0 = 1_792_300_000;
  // Population arrives from the oracle-honu Actions job via /honu/ingest.
  const feedPop = (ts) => honuIngest(DB, { pop: [{ world: 1, zone: 4, vs: 150, nc: 90, tr: 50, ns: 10 }] }, ts);
  const census = { map: { 1: 30, 2: 30, 3: 28 }, metagame: [], flips: [], honu: true };
  installCensus(census);

  // Pre-alert minute (for 15-min momentum), then the alert starts.
  await runCycle(env, (T0 - 1200) * 1000);
  census.metagame = [mg(500, 153, "started", T0)];
  census.flips = [{ event_type: "FacilityControl", world_id: "1", zone_id: "4", facility_id: "261000", faction_old: "2", faction_new: "1", duration_held: "300", timestamp: String(T0 + 30), outfit_id: "1" },
    { event_type: "FacilityControl", world_id: "1", zone_id: "4", facility_id: "262000", faction_old: "3", faction_new: "3", timestamp: String(T0 + 40) }];
  await feedPop(T0 + 30);
  DB.reset();
  let rep = await runCycle(env, (T0 + 60) * 1000);
  assert.equal(rep.live, 1, JSON.stringify(rep));
  assert.ok(DB.queries <= 50, `D1 queries per run: ${DB.queries}`);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM flip").get().n, 1, "defense (old==new) is not a flip");

  // Mid-alert: VS surges.
  census.map = { 1: 50, 2: 20, 3: 18 };
  for (const m of [15, 30, 31, 60]) { await feedPop(T0 + m * 60 - 120); await runCycle(env, (T0 + m * 60) * 1000); }
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

  // A bettor backed TR with 100 points for 250 shares (paid by the cycle when it settles).
  DB.raw.prepare("INSERT INTO wallet (cid, balance, created, last_auto_at) VALUES ('5428010618035300777', 900, 0, 0)").run();
  DB.raw.prepare(`INSERT INTO bet (id, cid, key, outcome, stake, fee, net, shares, pct, progress, placed_ts, status)
    VALUES ('b1', '5428010618035300777', '1-4-500', 'TR', 100, 0, 100, 250, 40, 0.3, ?, 'open')`).run(T0 + 1800);

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

  assert.deepEqual({ ...DB.raw.prepare("SELECT status, payout, credited FROM bet WHERE id='b1'").get() }, { status: "won", payout: 250, credited: 1 });
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet").get().balance, 1150, "paid once by the cycle");

  // Settled alerts are final: a later run does not touch them.
  await runCycle(env, (END + 900) * 1000);
  assert.equal(DB.raw.prepare("SELECT winner FROM alert").get().winner, "TR");
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet").get().balance, 1150, "no double payout");

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
  assert.ok(rep.errors.length >= 5, JSON.stringify(rep.errors));   // 3 worlds + metagame + facility
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

test("Outfit Wars is ignored; Meltdown alerts are labelled; no population means no pop blend", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  const T0 = 1_792_500_000;
  const census = { map: { 1: 30, 2: 30, 3: 28 }, flips: [],
    metagame: [mg(700, 227, "started", T0), mg(701, 177, "started", T0)] };
  installCensus(census);
  const rep = await runCycle(env, (T0 + 600) * 1000);
  assert.equal(rep.live, 1, "only the Meltdown alert is live");
  assert.deepEqual(rep.errors, []);
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

test("commander runs per live alert, inline and through the SELF binding", { skip }, async () => {
  const { runCycle, fanOutCommander, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k" };
  // Anchored to the real clock: the internal endpoint computes "now" itself.
  const T0 = Math.floor(Date.now() / 1000) - 21 * 60 - 5;
  const census = { map: { 1: 40, 2: 30, 3: 18 }, metagame: [mg(900, 153, "started", T0)], honu: true,
    flips: [{ event_type: "FacilityControl", world_id: "1", zone_id: "4", facility_id: "261000", faction_old: "2", faction_new: "1", timestamp: String(T0 + 20 * 60) }] };
  installCensus(census);
  await runCycle(env, (T0 + 300) * 1000);
  const rep = await runCycle(env, (T0 + 21 * 60) * 1000);
  assert.deepEqual(rep.live_keys, ["1-4-900"]);
  const [inline] = await fanOutCommander(env, rep.live_keys, (T0 + 21 * 60) * 1000);
  assert.equal(inline.ok, true, JSON.stringify(inline));
  let row = DB.raw.prepare("SELECT commander, commander_ts FROM alert").get();
  const cmd = JSON.parse(row.commander);
  assert.deepEqual(Object.keys(cmd.factions).sort(), ["NC", "TR", "VS"]);
  assert.equal(cmd.source, "worker");
  assert.ok(cmd.fight_up && typeof cmd.fight_up.text === "string");
  // Through a SELF binding: the internal endpoint requires the key.
  const self = { fetch: (req) => worker.fetch(req, env) };
  const viaSelf = await fanOutCommander({ ...env, SELF: self }, rep.live_keys);
  assert.equal(viaSelf[0].ok, true, JSON.stringify(viaSelf));
  const noKey = await fanOutCommander({ ...env, SELF: self, ORACLE_KEY: "" }, rep.live_keys);
  assert.match(noKey[0].error, /403/);
  const live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.ok(live.alerts[0].commander.factions.VS);
});

test("Honu bridge: queue -> oracle-honu job -> ingest (population, outlier report, PS2 Radar cache)", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const { runHonuJob } = await import("../oracle-worker/honu-job.mjs");
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k" };
  const NOW = Math.floor(Date.now() / 1000);       // ingest stamps real time; keep the cycle near it
  const T0 = NOW - 20 * 60, END = T0 + 90 * 60;
  const census = { map: { 1: 40, 2: 30, 3: 18 }, flips: [], metagame: [mg(950, 153, "started", T0)] };
  installCensus(census);
  // Fake Honu / Radar for the job; the oracle API is the real Worker.
  const calls = { honu: [], radar: 0 };
  const job = async (participants) => runHonuJob({
    api: "https://oracle", key: "k", log: () => {}, gapMs: { honu: 0, radar: 0 },
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      if (u.startsWith("https://oracle/")) return worker.fetch(new Request(u, init), env);
      if (u.includes("wt.honu.pw/api/population/1/zones")) { calls.honu.push("pop");
        return new Response(JSON.stringify([{ worldID: 1, zoneID: (3 << 16) | 4, vs: 150, nc: 90, tr: 50, ns: 10 }, { worldID: 1, zoneID: 2, vs: 1, nc: 1, tr: 1 }])); }
      if (u.includes("/participants")) { calls.honu.push("participants");
        return participants ? new Response(JSON.stringify(participants)) : new Response("not finished", { status: 400 }); }
      if (u.includes("ps2radar.com")) { calls.radar++;
        if (u.endsWith("/5428010618035300002")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ player: { name: "Ace", character_id: "5428010618035300001", classification: { tier: "suspect" }, model: { tier: "blatant", blatant: true, sus_score: 91 } } })); }
      throw new Error("unexpected " + u);
    },
  });
  await runCycle(env, NOW * 1000);
  let pend = await (await worker.fetch(new Request("https://x/honu/pending"), env)).json();
  assert.deepEqual(pend, { pending: true, pop: 1, reports: 0 });
  assert.equal((await worker.fetch(new Request("https://x/honu/queue"), env)).status, 403, "queue needs the key");
  await job(null);
  await runCycle(env, (NOW + 60) * 1000);
  let live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  assert.deepEqual(live.alerts[0].state.pop, { VS: 150, NC: 90, TR: 50 }, "zone id masked, population used");
  assert.ok(live.alerts[0].state.win_popadj);

  // Alert ends and settles; the job is asked for its report.
  census.metagame.push(mg(950, 153, "ended", END, 40, 35, 25));
  await runCycle(env, (END + 660) * 1000);
  pend = await (await worker.fetch(new Request("https://x/honu/pending"), env)).json();
  assert.equal(pend.reports, 1);
  await job(null);                                          // Honu not ready yet
  let row = DB.raw.prepare("SELECT status, attempts, err FROM report").get();
  assert.deepEqual({ ...row }, { status: "pending", attempts: 1, err: "honu 400" });
  pend = await (await worker.fetch(new Request("https://x/honu/pending"), env)).json();
  assert.equal(pend.reports, 0, "not retried within 4 minutes");
  DB.raw.prepare("UPDATE report SET ts = ts - 300").run();   // 5 minutes later
  const participants = {
    entries: [{ characterID: "5428010618035300001", kills: 300, deaths: 20, secondsOnline: 5400 }, { characterID: "5428010618035300002", kills: 120, deaths: 20, secondsOnline: 3000 },
      { characterID: "5428010618035300003", kills: 40, deaths: 40, secondsOnline: 3000 }],
    characters: [{ id: "5428010618035300001", name: "Ace", factionID: 1 }, { id: "5428010618035300002", name: "Bee", factionID: 2 }, { id: "5428010618035300003", name: "Cee", factionID: 3 }],
  };
  await job(participants);
  row = DB.raw.prepare("SELECT status, flagged, confirmed FROM report").get();
  assert.deepEqual({ ...row }, { status: "ok", flagged: 2, confirmed: 1 });
  assert.equal(calls.radar, 2);
  const one = await (await worker.fetch(new Request("https://x/alert?key=1-4-950"), env)).json();
  assert.equal(one.alert.report.faction.VS.kd, 15);
  assert.equal(one.outliers[0].radar.modelTier, "blatant");
  assert.equal(one.outliers[1].radar.stored, false);
  const hist = await (await worker.fetch(new Request("https://x/history"), env)).json();
  assert.equal(hist.alerts[0].report.confirmed, 1);
  // Done: nothing left in the queue; Radar answers are cached for the next alert.
  pend = await (await worker.fetch(new Request("https://x/honu/pending"), env)).json();
  assert.deepEqual(pend, { pending: false, pop: 0, reports: 0 });
  const radarRows = DB.raw.prepare("SELECT COUNT(*) n FROM radar").get().n;
  assert.equal(radarRows, 2);
});

// ---- Review 2026-10-18: settlement fallbacks and corrupt-input guards ----

const noScores = (m) => ({ ...m, faction_vs: "", faction_nc: "", faction_tr: "" });
const betRow = (DB, id, key, outcome, stake, fee, ts) => {
  DB.raw.prepare("INSERT OR IGNORE INTO wallet (cid, balance, created, last_auto_at) VALUES ('5428010618035300888', 500, 0, 0)").run();
  DB.raw.prepare(`INSERT INTO bet (id, cid, key, outcome, stake, fee, net, shares, pct, progress, placed_ts, status)
    VALUES (?, '5428010618035300888', ?, ?, ?, ?, ?, 300, 30, 0.6, ?, 'open')`).run(id, key, outcome, stake, fee, stake - fee, ts);
};

test("Census ended row without scores: settle from the clean pre-end snapshot", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const T0 = 1_792_500_000, END = T0 + 90 * 60;
  const census = { map: { 1: 40, 2: 28, 3: 20 }, metagame: [mg(700, 153, "started", T0)], flips: [] };
  installCensus(census);
  await runCycle({ DB }, (END - 60) * 1000);
  census.metagame.push(noScores(mg(700, 153, "ended", END)));
  await runCycle({ DB }, (END + 660) * 1000);
  const row = DB.raw.prepare("SELECT status, winner, basis, final, flags FROM alert").get();
  assert.equal(row.status, "settled");
  assert.equal(row.winner, "VS");
  assert.equal(row.basis, "snapshot");
  assert.equal(row.final, null);
  assert.ok(JSON.parse(row.flags).includes("final_missing"));
});

test("#26: Census corrects the ended row before +10 min: settle on the corrected scores; settled alerts never change", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const T0 = 1_792_600_000, END = T0 + 90 * 60;
  const census = { map: { 1: 40, 2: 28, 3: 20 }, metagame: [mg(710, 153, "started", T0)], flips: [] };
  installCensus(census);
  await runCycle({ DB }, (END - 60) * 1000);
  // The ended row first arrives with empty scores…
  census.metagame.push(noScores(mg(710, 153, "ended", END)));
  await runCycle({ DB }, (END + 60) * 1000);
  assert.notEqual(DB.raw.prepare("SELECT status FROM alert").get().status, "settled");
  // …then Census fills them in (TR wins, unlike the VS-leaning map).
  census.metagame[1] = mg(710, 153, "ended", END, 30, 25, 45);
  DB.reset();
  await runCycle({ DB }, (END + 300) * 1000);
  assert.ok(DB.queries <= 50, `D1 queries per run: ${DB.queries}`);
  assert.deepEqual({ ...DB.raw.prepare("SELECT vs, nc, tr FROM metagame WHERE state='ended'").get() }, { vs: 30, nc: 25, tr: 45 });
  await runCycle({ DB }, (END + 660) * 1000);
  let row = DB.raw.prepare("SELECT status, winner, basis, final FROM alert").get();
  assert.equal(row.status, "settled");
  assert.equal(row.winner, "TR");
  assert.equal(row.basis, "census_final");
  assert.deepEqual(JSON.parse(row.final), { VS: 30, NC: 25, TR: 45 });
  // A later "correction" after settlement updates the raw row but not the settled alert.
  census.metagame[1] = mg(710, 153, "ended", END, 50, 25, 25);
  await runCycle({ DB }, (END + 900) * 1000);
  row = DB.raw.prepare("SELECT status, winner, basis, final FROM alert").get();
  assert.equal(row.winner, "TR");
  assert.deepEqual(JSON.parse(row.final), { VS: 30, NC: 25, TR: 45 });
  // Empty scores never overwrite real ones.
  census.metagame[1] = noScores(mg(710, 153, "ended", END));
  await runCycle({ DB }, (END + 960) * 1000);
  assert.equal(DB.raw.prepare("SELECT vs FROM metagame WHERE state='ended'").get().vs, 50);
});

test("no scores and a neutral-heavy snapshot: unresolved, bets refunded in full", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const T0 = 1_792_510_000, END = T0 + 90 * 60;
  const census = { map: { 1: 30, 2: 20, 3: 10 }, metagame: [mg(710, 153, "started", T0)], flips: [] };
  installCensus(census);
  await runCycle({ DB }, (END - 60) * 1000);
  betRow(DB, "v1", "1-4-710", "VS", 100, 5, END - 1800);
  census.metagame.push(noScores(mg(710, 153, "ended", END)));
  await runCycle({ DB }, (END + 660) * 1000);
  assert.equal(DB.raw.prepare("SELECT status FROM alert").get().status, "unresolved");
  const b = DB.raw.prepare("SELECT status, payout, credited FROM bet").get();
  assert.deepEqual({ ...b }, { status: "void", payout: 100, credited: 1 }, "stake back, fee included");
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet").get().balance, 600);
});

test("corrupt map that disagrees with Census: Census winner recorded, bets voided", { skip }, async () => {
  const { runCycle } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const T0 = 1_792_520_000, END = T0 + 90 * 60;
  const census = { map: { 1: 35, 2: 15, 3: 10 }, metagame: [mg(720, 153, "started", T0)], flips: [] };   // 68 % owned, VS ahead
  installCensus(census);
  await runCycle({ DB }, (END - 60) * 1000);
  betRow(DB, "w1", "1-4-720", "TR", 100, 0, END - 1800);
  census.metagame.push(mg(720, 153, "ended", END, 30, 31, 39));                                       // Census: TR
  await runCycle({ DB }, (END + 660) * 1000);
  const row = DB.raw.prepare("SELECT status, winner, flags FROM alert").get();
  assert.equal(row.status, "settled");
  assert.equal(row.winner, "TR");
  const flags = JSON.parse(row.flags);
  assert.ok(flags.includes("bets_void") && flags.some((f) => f.startsWith("neutral_heavy")) && flags.includes("snapshot_winner_VS"), row.flags);
  assert.equal(DB.raw.prepare("SELECT status FROM bet").get().status, "void", "even the TR backer is refunded, not paid");
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet").get().balance, 600);
});

test("live guard: neutral-heavy map marks the state suspect, closes betting, holds the commander", { skip }, async () => {
  const { runCycle, commanderFor, default: worker } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const T0 = 1_792_530_000;
  const census = { map: { 1: 30, 2: 20, 3: 10 }, metagame: [mg(730, 153, "started", T0)], flips: [] };
  installCensus(census);
  const now = T0 + 20 * 60;
  await runCycle({ DB }, now * 1000);
  const st = JSON.parse(DB.raw.prepare("SELECT state FROM alert").get().state);
  assert.deepEqual(st.suspect, ["neutral_heavy:68.2"]);
  const q = await (await worker.fetch(new Request("https://x/bet/quote?key=1-4-730"), { DB })).json();
  assert.equal(q.open, false);
  assert.equal(q.reason, "data_suspect", JSON.stringify(q));
  assert.equal((await commanderFor({ DB }, "1-4-730", now * 1000)).skipped, "data suspect");
});

test("dataSuspect: frozen map while captures keep arriving; stale map", async () => {
  const { dataSuspect } = await import("../oracle-worker/src/index.js");
  const z = { 1: "1", 2: "2", 3: "3" };
  const now = 1_792_540_000;
  assert.deepEqual(dataSuspect(z, now, { ts: now - 600, zones: { 4: { ...z } } }, 4, 3, now), ["map_frozen"]);
  assert.deepEqual(dataSuspect(z, now, { ts: now - 600, zones: { 4: { ...z } } }, 4, 0, now), [], "a quiet continent is not frozen");
  assert.deepEqual(dataSuspect(z, now, { ts: now - 600, zones: { 4: { ...z, 3: "1" } } }, 4, 3, now), []);
  assert.deepEqual(dataSuspect(z, now - 400, null, 4, 0, now), ["map_stale"]);
});

test("commander win_pct follows the elimination override (matches the header odds)", async () => {
  const { applyElimination } = await import("../oracle-worker/src/commander.js");
  const cmd = { factions: { VS: { win_pct: 70, eliminated: false }, NC: { win_pct: 20, eliminated: true }, TR: { win_pct: 10, eliminated: true } } };
  applyElimination(cmd);
  assert.deepEqual(Object.fromEntries(Object.entries(cmd.factions).map(([f, x]) => [f, [x.win_pct, x.win_pct_raw]])), { VS: [100, 70], NC: [0, 20], TR: [0, 10] });
  const two = { factions: { VS: { win_pct: 50, eliminated: false }, NC: { win_pct: 30, eliminated: false }, TR: { win_pct: 20, eliminated: true } } };
  applyElimination(two);
  assert.deepEqual([two.factions.VS.win_pct, two.factions.NC.win_pct, two.factions.TR.win_pct], [62.5, 37.5, 0]);
});
