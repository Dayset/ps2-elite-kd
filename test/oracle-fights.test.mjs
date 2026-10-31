// ⚔️ Live fights per base (#78 step 1, paid plan 2026-10-29): oracle-worker/src/fights.js and its
// place in the cycle (state.fights, the `fight` table, the archive bundle). The cache Worker's live
// map is faked through the CACHE service binding. Needs node:sqlite (Node >= 22.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fightsOf, fightRow, liveActivity, FIGHTS_MAX } from "../oracle-worker/src/fights.js";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";

const act = (bases, zones = {}) => ({ v: 1, ns: "ps2", world: 1, stream: true, at: 1_792_300_060, window: 300, zones, bases });
const base = (f, z, n, k = {}, conv = {}, convAgo = null, fn = "Base " + f) => ({ f, fn, z, n: { VS: 0, NC: 0, TR: 0, NSO: 0, "?": 0, ...n }, k, vk: {}, conv, tick: {}, convAgo, killAgo: 5 });

test("fightsOf: the alert's continent only, small skirmishes dropped, biggest first, capped", () => {
  const a = act([
    base(261000, 4, { VS: 3, NC: 9 }, { NC: 4, tk: 1 }, { NC: 2 }, 40, "Sharpe's Run"),
    base(262000, 4, { TR: 1 }, { TR: 1 }),                 // too small
    base(263000, 4, { VS: 20, TR: 14, "?": 2 }, { VS: 12, TR: 9 }),
    base(201, 2, { VS: 30 }),                              // another continent
    ...Array.from({ length: 12 }, (_, i) => base(300000 + i, 4, { NC: 2 })),
  ], { 4: { n: { VS: 120, NC: 80, TR: 95, NSO: 7, "?": 3 }, zn: "Hossin" } });
  const f = fightsOf(a, 4, { 261000: "NC" });
  assert.equal(f.bases.length, FIGHTS_MAX);
  assert.equal(f.bases[0].fid, "263000");
  assert.deepEqual(f.bases[0].n, { VS: 20, NC: 0, TR: 14 }, "unknown faction and NSO left out of the crowd split");
  assert.equal(f.bases[1].name, "Sharpe's Run");
  assert.deepEqual(f.bases[1].k, { VS: 0, NC: 4, TR: 0 }, "team kills are not anyone's kills");
  assert.equal(f.bases[1].owner, "NC");
  assert.equal(f.bases[1].convAgo, 40);
  assert.ok(!f.bases.some((b) => b.fid === "262000" || b.fid === "201"));
  assert.deepEqual(f.pop, { VS: 120, NC: 80, TR: 95, NSO: 7 });
  assert.equal(f.live, true);
  assert.ok(!JSON.stringify(f).match(/\d{17,}/), "no character ids");
  const row = fightRow(f);
  assert.deepEqual(row.pop, [120, 80, 95, 7]);
  assert.deepEqual(row.b[1], ["261000", 3, 9, 0, 4, "NC", 40]);
  assert.equal(f.bases[0].killAgo, 5, "⚔️ last-kill age rides along (did the fight pick up after a capture)");
  assert.equal(fightsOf(null, 4), null);
  assert.equal(fightsOf(act([]), 4).bases.length, 0);
});

test("liveActivity: through the CACHE binding, null on errors, slowness or no binding", async () => {
  const seen = [];
  const env = { CACHE: { fetch: async (req) => { seen.push(req.url); return new Response(JSON.stringify(act([base(1, 4, { VS: 5 })]))); } } };
  const j = await liveActivity(env, 10);
  assert.equal(j.bases.length, 1);
  assert.ok(seen[0].includes("/live/activity?ns=ps2&world=10"));
  assert.equal(await liveActivity({}, 1), null);
  assert.equal(await liveActivity({ CACHE: { fetch: async () => new Response("no", { status: 404 }) } }, 1), null);
  assert.equal(await liveActivity({ CACHE: { fetch: async () => { throw new Error("down"); } } }, 1), null);
  const keep = setTimeout(() => {}, 500); // Node unrefs AbortSignal.timeout's timer; the Workers runtime does not
  assert.equal(await liveActivity({ CACHE: { fetch: (req) => new Promise((_, rej) => req.signal.addEventListener("abort", () => rej(new Error("aborted")))) } }, 1, 50), null);
  clearTimeout(keep);
});

// ---- the cycle (same SQLite stand-in and fake Census as test/oracle-worker.test.mjs) ----
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
  return { raw: db, get queries() { return queries; }, reset() { queries = 0; }, prepare: (sql) => stmt(sql),
    async batch(list) { db.exec("BEGIN"); try { const r = list.map((s) => s._exec()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
const R2F = sqlite ? JSON.parse(readFileSync(new URL("../oracle/backend/hossin_region_to_facility.json", import.meta.url), "utf8")) : {};
const REGIONS = Object.keys(R2F);
function mapJson(shares) {
  const rows = [];
  let i = 0;
  for (const [fac, n] of Object.entries(shares)) for (let k = 0; k < n; k++) rows.push({ RowData: { RegionId: REGIONS[i++], FactionId: fac } });
  while (i < REGIONS.length) rows.push({ RowData: { RegionId: REGIONS[i++], FactionId: "0" } });
  return { map_list: [{ ZoneId: "4", Regions: { Row: rows } }], returned: 1 };
}
const mg = (instance, event, stateName, ts) => ({ event_type: "MetagameEvent", world_id: "1", zone_id: "4", instance_id: String(instance), metagame_event_id: String(event), metagame_event_state_name: stateName, timestamp: String(ts), faction_vs: "30", faction_nc: "30", faction_tr: "30" });

test("cycle: live alert gets state.fights + pop_live, one fight row per minute, archived with the alert", { skip }, async () => {
  const { runCycle, default: worker } = await import("../oracle-worker/src/index.js");
  const { buildBundle } = await import("../oracle-worker/src/archive.js");
  const census = { map: { 1: 30, 2: 30, 3: 28 }, metagame: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.includes("/map/")) body = +new URL(u).searchParams.get("world_id") === 1 ? mapJson(census.map) : { map_list: [], returned: 0 };
    else if (u.includes("type=METAGAME")) body = { world_event_list: census.metagame, returned: census.metagame.length };
    else if (u.includes("type=FACILITY")) body = { world_event_list: [], returned: 0 };
    else if (u.includes("/world/")) body = { world_list: [], returned: 0 };
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const DB = fakeD1();
  const calls = [];
  const sharpe = Object.values(R2F)[0];
  const env = { DB, ORACLE_KEY: "k", PLAN: "paid", CACHE: { fetch: async (req) => { calls.push(req.url); return new Response(JSON.stringify(act([base(+sharpe, 4, { VS: 14, NC: 11 }, { VS: 6, NC: 5 }, { VS: 3 }, 25, "Somewhere")], { 4: { n: { VS: 150, NC: 90, TR: 60, NSO: 4 } } }))); } } };
  const T0 = 1_792_300_000;
  await runCycle(env, (T0 - 1200) * 1000);
  assert.equal(calls.length, 0, "no live alert → no call");
  census.metagame = [mg(501, 153, "started", T0)];
  DB.reset();
  const rep = await runCycle(env, (T0 + 60) * 1000);
  assert.equal(rep.live, 1);
  assert.equal(rep.fights, 1);
  assert.equal(calls.length, 1, "one call per world with a live alert");
  assert.ok(DB.queries <= 50, `D1 queries per run: ${DB.queries}`);
  await runCycle(env, (T0 + 120) * 1000);
  const live = await (await worker.fetch(new Request("https://x/live"), env)).json();
  const s = live.alerts[0].state;
  assert.equal(s.fights.length, 1);
  assert.deepEqual(s.fights[0].n, { VS: 14, NC: 11, TR: 0 });
  assert.deepEqual(s.pop_live, { VS: 150, NC: 90, TR: 60, NSO: 4 });
  assert.equal(s.fights_live, true);
  assert.ok(s.win.VS.pct > 0, "odds still computed as before");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM fight").get().n, 2);
  // 🔀 Free plan (plan.json / PLAN=free): no call, no fight rows, odds as before.
  const n0 = calls.length;
  const rep3 = await runCycle({ ...env, PLAN: "free" }, (T0 + 150) * 1000);
  assert.equal(rep3.live, 1);
  assert.equal(rep3.fights, undefined);
  assert.equal(calls.length, n0, "free plan: the cache Worker is not asked");
  // Unreachable cache Worker: the cycle carries on without fights.
  env.CACHE = { fetch: async () => { throw new Error("down"); } };
  const rep2 = await runCycle(env, (T0 + 180) * 1000);
  assert.equal(rep2.live, 1);
  assert.equal(rep2.fights, undefined);
  // Archive bundle carries the per-minute fight rows.
  DB.raw.prepare("UPDATE alert SET status='settled', end_ts=? WHERE key='1-4-501'").run(T0 + 5400);
  const b = await buildBundle(DB, "1-4-501");
  assert.equal(b.fights.length, 2);
  assert.deepEqual(b.fights[0].b[0].slice(1, 5), [14, 11, 0, 11]);
  assert.deepEqual(b.fights[0].pop, [150, 90, 60, 4]);
});

test("fightRow: 🚐 spawn totals and 👥 best iVi ride along only when present (#87)", () => {
  const f = { pop: null, bases: [
    { fid: "1", n: { VS: 10, NC: 2, TR: 0 }, k: { VS: 5, NC: 1, TR: 0 }, conv: { VS: 3, NC: 0, TR: 0 }, convAgo: 20,
      sp: { VS: { su: 2, suN: 30, be: 1, beN: 4, n: 34 }, NC: { ro: 1, roN: 2, n: 2 } },
      top: [{ n: "a", f: "VS", k: 9, d: 1, i: 310 }, { n: "b", f: "VS", k: 4, d: 2, i: 120 }, { n: "c", f: "NC", k: 2, d: 5, i: null }] },
    { fid: "2", n: { VS: 0, NC: 4, TR: 4 }, k: { VS: 0, NC: 2, TR: 2 }, conv: { VS: 0, NC: 0, TR: 0 }, convAgo: null,
      top: [{ n: "d", f: "TR", k: 3, d: 0, i: 205 }] },
    { fid: "3", n: { VS: 3, NC: 0, TR: 0 }, k: { VS: 0, NC: 0, TR: 0 }, conv: { VS: 0, NC: 0, TR: 0 }, convAgo: null, top: [["555555555555555555", "VS", 1, 0]] },
  ] };
  const r = fightRow(f);
  assert.deepEqual(r.b[0], ["1", 10, 2, 0, 6, "VS", 20, [3, 1, 0, 34, 2, 0], [310, 0, 0]]);
  assert.deepEqual(r.b[1], ["2", 0, 4, 4, 4, null, null, null, [0, 0, 205]], "index 7 null when only iVi is there");
  assert.deepEqual(r.b[2], ["3", 3, 0, 0, 0, null, null], "unnamed ids never stored, row stays 7 fields");
  assert.ok(!JSON.stringify(r).match(/\d{17,}/), "no character ids");
});
