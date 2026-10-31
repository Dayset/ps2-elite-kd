// 🎯 Live capture chance + 🚐 spawn-gated Solo orders (#87, owner 2026-10-31).
// oracle-worker/src/capture-live.js, focus.js (pf by attacker, allowAttack), fights.js spawnMapOf,
// index.js commanderFor (capture_live, focus_solo, spawn marks), oracle/js/sticky.js (Solo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capturePairs, pairFeatures, liveChances, livePf, rowFromBase, vectorOf, predict, capP } from "../oracle-worker/src/capture-live.js";
import { CAPTURE_LIVE } from "../oracle-worker/src/capture-live.gen.js";
import { spawnMapOf, aliveSpawns, PUBLIC_SPAWNS } from "../oracle-worker/src/fights.js";
import { focusPlan } from "../oracle-worker/src/focus.js";
import { latticeFor, binGetter, captureModel } from "../oracle-worker/src/models.js";
import { soloStep, modeFocus, spawnLookup } from "../oracle/js/sticky.js";

const ZONE = 2; // Indar
const L = latticeFor(ZONE);
/** Owners by distance from the first three warpgates (a plausible front line). */
function indarOwn() {
  const wgs = Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f])).slice(0, 3);
  const own = new Map(), q = [];
  wgs.forEach((w, i) => { own.set(w, i + 1); q.push(w); });
  while (q.length) { const c = q.shift(); for (const nb of L.adj.get(c) || []) if (!own.has(nb)) { own.set(nb, own.get(c)); q.push(nb); } }
  for (const f of Object.keys(L.names)) if (!own.has(f)) own.set(f, 1);
  return own;
}
const NOW = 1_793_400_000;

test("the fitted model ships with the features the Worker computes", () => {
  assert.ok(CAPTURE_LIVE && CAPTURE_LIVE.map && CAPTURE_LIVE.both, "capture-live.gen.js is fitted");
  const own = indarOwn();
  const pair = capturePairs({ own, lattice: L, flips: [], nowTs: NOW })[0];
  const X = pairFeatures({ pair, lattice: L, flips: [], nowTs: NOW, t: 30, dur: 90, pf: captureModel(ZONE) });
  assert.equal(CAPTURE_LIVE.map.w.length, vectorOf("map", X).length + 1);
  assert.equal(CAPTURE_LIVE.both.w.length, vectorOf("both", X).length + 1);
  const p = predict(CAPTURE_LIVE.map, vectorOf("map", X));
  assert.ok(p > 0 && p < 1);
});

test("front-line pairs: linked to the attacker's warpgate, pressure from a recent neighbour capture", () => {
  const own = indarOwn();
  const pairs = capturePairs({ own, lattice: L, flips: [], nowTs: NOW });
  assert.ok(pairs.length > 5);
  for (const p of pairs) {
    assert.notEqual(p.A, p.B);
    assert.ok((L.adj.get(p.fid) || []).some((nb) => own.get(nb) === p.B), "attacker owns a neighbour");
    assert.ok(!/warpgate/i.test(L.names[p.fid]));
    assert.equal(p.pressured, false);
  }
  const p0 = pairs[0], nb = (L.adj.get(p0.fid) || []).find((n) => own.get(n) === p0.B);
  const B = ["", "VS", "NC", "TR"][p0.B];
  const fl = [[NOW - 120, B, "TR", nb]];
  const again = capturePairs({ own, lattice: L, flips: fl, nowTs: NOW }).find((p) => p.fid === p0.fid && p.B === p0.B);
  assert.equal(again.pressured, true);
  assert.equal(capturePairs({ own, lattice: L, flips: [[NOW - 1000, B, "TR", nb]], nowTs: NOW }).find((p) => p.fid === p0.fid && p.B === p0.B).pressured, false, "15-min window");
});

test("liveChances: map model without a live stream, fights model with one; crowds raise the attacker's chance", () => {
  const own = indarOwn(), pf = captureModel(ZONE);
  const pair = capturePairs({ own, lattice: L, flips: [], nowTs: NOW })[0];
  const B = ["", "VS", "NC", "TR"][pair.B], A = ["", "VS", "NC", "TR"][pair.A];
  const fight = (nB, nA, conv) => [{ fid: pair.fid, n: { VS: 0, NC: 0, TR: 0, [B]: nB, [A]: nA }, k: { [B]: nB }, conv: conv ? { [B]: 5 } : {}, convAgo: conv ? 20 : null }];
  const args = { model: CAPTURE_LIVE, own, lattice: L, flips: [], nowTs: NOW, t: 40, dur: 90, pf };
  assert.equal(liveChances({ ...args, model: null }), null, "no model → caller keeps the fixed chance");
  const m = liveChances({ ...args, fights: fight(30, 4, true), fightsLive: false });
  assert.equal(m.variant, "map", "stale / off stream: map only");
  const big = liveChances({ ...args, fights: fight(30, 4, true), fightsLive: true });
  const none = liveChances({ ...args, fights: fight(2, 30, false), fightsLive: true });
  assert.equal(big.variant, "both");
  const k = `${pair.fid}|${pair.B}`;
  assert.ok(big.p.get(k) > none.p.get(k) * 1.5, `30v4 with the point ticking (${big.p.get(k)}) vs 2v30 (${none.p.get(k)})`);
  // livePf: the chance of the attacker the move is about; unknown base → the fixed chance.
  const pfL = livePf(big, pf);
  assert.equal(pfL(pair.fid, B), big.p.get(k));
  assert.equal(pfL("no-such-base", B), capP(pf, "no-such-base", true));
  assert.equal(livePf(null, pf)(pair.fid, B), capP(pf, pair.fid, true));
});

test("rowFromBase matches the stored fight row (fights.js fightRow)", () => {
  const r = rowFromBase({ fid: "1", n: { VS: 10, NC: 2, TR: 0 }, k: { VS: 5, NC: 1, TR: 0 }, conv: { VS: 3, NC: 1 }, convAgo: 20, sp: { VS: { su: 2, n: 30 } }, top: [{ f: "VS", i: 250 }] });
  assert.deepEqual(r, { n: [10, 2, 0], k: 6, cf: 1, ca: 20, sp: [2, 0, 0, 30, 0, 0], iv: [250, 0, 0] });
});

test("focusPlan: pf gets the attacker; allowAttack removes attack moves only", () => {
  const own = indarOwn(), seen = [];
  const args = { own, lattice: L, getBin: binGetter(ZONE), t: 40, dur: 90, mom: { VS: 0, NC: 0, TR: 0 }, header: null,
    pf: (fid, by) => { seen.push(by); return 0.5; } };
  const all = focusPlan(args);
  assert.ok(seen.length && seen.every((b) => ["VS", "NC", "TR"].includes(b)), "every call names the attacker");
  const none = focusPlan({ ...args, allowAttack: () => false });
  for (const f of ["VS", "NC", "TR"]) {
    const xs = [none[f].focus, ...(none[f].backups || [])].filter(Boolean);
    assert.ok(xs.every((x) => !["take", "plan", "spoil", "push"].includes(x.kind)), `${f}: no attack when nothing is allowed`);
  }
  assert.deepEqual(focusPlan({ ...args, allowAttack: () => true }), all, "allow-all = no filter");
});

test("spawn map: live public and squad spawns per faction, destroyed ones subtracted", () => {
  assert.deepEqual(PUBLIC_SPAWNS, ["su", "ro"]);
  assert.deepEqual(aliveSpawns({ su: 2, suL: 1, ro: 1, be: 3, beL: 3, n: 40 }), { su: 1, ro: 1 });
  assert.equal(aliveSpawns({ su: 1, suL: 1 }), null);
  const m = spawnMapOf({ bases: [
    { f: 1, z: 2, sp: { VS: { su: 1, suN: 20, n: 20 }, NC: { be: 2, beN: 5, n: 5 } } },
    { f: 2, z: 2, sp: { TR: { ro: 1, roL: 1, n: 3 } } },
    { f: 3, z: 4, sp: { VS: { su: 1, n: 1 } } },
  ] }, 2);
  assert.deepEqual(m, { 1: { VS: { su: 1 }, NC: { be: 2 } } });
});

test("Solo: drops a kept attack once our Sunderer / router there is gone; page lookup by base name", () => {
  const regions = { 100: { name: "Alpha" }, 200: { name: "Bravo" } };
  const look = spawnLookup({ 100: { VS: { su: 1 } }, 200: { VS: { be: 2 } } }, regions);
  assert.equal(look("VS", "Alpha"), true);
  assert.equal(look("VS", "Bravo"), false, "a squad beacon is not a public spawn");
  assert.equal(look("NC", "Alpha"), false);
  assert.equal(look("VS", "Nowhere"), undefined);
  assert.equal(spawnLookup(null, regions)("VS", "Alpha"), undefined, "no data: no gate");
  const take = (b) => ({ kind: "take", bases: [b], target: "NC", p: 0.5, now: 30, then: 40, text: b });
  const plan = (x) => ({ focus: x, backups: [], quiet: false });
  const st = soloStep(null, plan(take("Alpha")), { fac: "VS", nowS: 0, ownerOf: () => "NC" }).state;
  const ctx = { fac: "VS", nowS: 60, ownerOf: () => "NC" };
  assert.equal(soloStep(st, plan(take("Bravo")), { ...ctx, canSpawn: () => true }).why, "kept");
  assert.equal(soloStep(st, plan(take("Bravo")), { ...ctx, canSpawn: (f, n) => n !== "Alpha" }).why, "nospawn");
  assert.equal(soloStep(st, plan(take("Bravo")), { ...ctx, canSpawn: () => undefined }).why, "kept", "unknown keeps it");
  // modeFocus: Solo reads focus_solo when the Worker made one, Big squad still the mix.
  const c = { focus: { VS: plan(take("OLD")) }, focus_mix: { VS: plan(take("MIX")) }, focus_solo: { VS: plan(take("SOLO")) } };
  assert.equal(modeFocus(c, "solo", {}, { ts: 1, ownerOf: () => "NC" }).VS.focus.bases[0], "SOLO");
  assert.equal(modeFocus(c, "big", {}, { ts: 1 }).VS.focus.bases[0], "MIX");
  assert.equal(modeFocus({ ...c, focus_solo: undefined }, "solo", {}, { ts: 1, ownerOf: () => "NC" }).VS.focus.bases[0], "MIX", "older rows");
});

// ---- end to end: cycle with a live map where only VS has Sunderers, then the commander ----
let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";
const SCHEMA = readFileSync(new URL("../oracle-worker/schema.sql", import.meta.url), "utf8");
function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    _exec() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(list) { db.exec("BEGIN"); try { const r = list.map((s) => s._exec()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}

test("commander: live capture chance from fights, Solo attacks only where we have a Sunderer, orders carry spawns", { skip }, async () => {
  const { runCycle, commanderFor } = await import("../oracle-worker/src/index.js");
  const R2F = JSON.parse(readFileSync(new URL("../oracle/backend/hossin_region_to_facility.json", import.meta.url), "utf8"));
  const regions = Object.keys(R2F);
  const shares = { 1: 30, 2: 30, 3: 28 };
  const mapJson = () => {
    const rows = []; let i = 0;
    for (const [fac, n] of Object.entries(shares)) for (let k = 0; k < n; k++) rows.push({ RowData: { RegionId: regions[i++], FactionId: fac } });
    while (i < regions.length) rows.push({ RowData: { RegionId: regions[i++], FactionId: "0" } });
    return { map_list: [{ ZoneId: "4", Regions: { Row: rows } }], returned: 1 };
  };
  const T0 = 1_792_300_000;
  const metagame = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.includes("/map/")) body = +new URL(u).searchParams.get("world_id") === 1 ? mapJson() : { map_list: [], returned: 0 };
    else if (u.includes("type=METAGAME")) body = { world_event_list: metagame, returned: metagame.length };
    else if (u.includes("type=FACILITY")) body = { world_event_list: [], returned: 0 };
    else if (u.includes("/world/")) body = { world_list: [], returned: 0 };
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  // Every base on Hossin: a small crowd and a live Sunderer of ONE faction (spFac); nobody else has a spawn.
  // On this synthetic map TR is the one with attacks to make.
  const fids = [...new Set(Object.values(R2F).map(String))];
  let spFac = "TR";
  const act = () => ({ v: 1, ns: "ps2", world: 1, stream: true, at: T0 + 60, window: 300, zones: { 4: { n: { VS: 100, NC: 100, TR: 100, NSO: 0 } } },
    bases: fids.map((f) => ({ f: +f, fn: "B" + f, z: 4, n: { VS: 0, NC: 0, TR: 0, NSO: 0, "?": 0, [spFac]: 3 }, k: {}, vk: {}, conv: {}, tick: {}, convAgo: null, killAgo: null, sp: { [spFac]: { su: 1, suN: 10, n: 10 } } })) });
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k", PLAN: "paid", CACHE: { fetch: async () => new Response(JSON.stringify(act())) } };
  metagame.push({ event_type: "MetagameEvent", world_id: "1", zone_id: "4", instance_id: "601", metagame_event_id: "153", metagame_event_state_name: "started", timestamp: String(T0), faction_vs: "30", faction_nc: "30", faction_tr: "30" });
  await runCycle(env, (T0 - 900) * 1000);
  await runCycle(env, (T0 + 60) * 1000);
  const st = JSON.parse(DB.raw.prepare("SELECT state FROM alert WHERE key='1-4-601'").get().state);
  assert.ok(Object.keys(st.spawn_map).length > 50, "spawn map covers every base, not just the 8 fights");
  assert.deepEqual(st.spawn_map[fids[0]], { TR: { su: 1 } });
  const r = await commanderFor(env, "1-4-601", (T0 + 120) * 1000);
  assert.equal(r.ok, true, JSON.stringify(r));
  const cmd = JSON.parse(DB.raw.prepare("SELECT commander FROM alert WHERE key='1-4-601'").get().commander);
  assert.equal(cmd.focus_error, undefined, cmd.focus_error);
  assert.equal(cmd.capture_live.variant, "both");
  assert.ok(cmd.focus_solo, "Solo plan made when spawns are known");
  const atk = (p) => [p.focus, ...(p.backups || [])].filter((x) => x && ["take", "plan", "spoil", "push"].includes(x.kind));
  assert.ok(atk(cmd.focus_solo.TR).length > 0, "TR still gets attacks in Solo");
  for (const x of atk(cmd.focus_solo.TR)) assert.deepEqual(x.spawn, { su: 1 }, "TR attacks carry the Sunderer");
  for (const f of ["VS", "NC"]) assert.equal(atk(cmd.focus_solo[f]).length, 0, `${f} has no spawn anywhere: no Solo attack`);
  // Same map, the Sunderers are VS's: TR's attacks leave Solo (🚐✗ in Big squad), flagged nospawn.
  spFac = "VS";
  await runCycle(env, (T0 + 120) * 1000);
  await commanderFor(env, "1-4-601", (T0 + 150) * 1000);
  const cmdV = JSON.parse(DB.raw.prepare("SELECT commander FROM alert WHERE key='1-4-601'").get().commander);
  assert.equal(atk(cmdV.focus_solo.TR).length, 0);
  assert.equal(cmdV.focus_solo.TR.nospawn, true, "the page says: no attack with a Sunderer or router");
  assert.ok(atk(cmdV.focus_mix.TR).length > 0 && atk(cmdV.focus_mix.TR).every((x) => x.spawn === null), "Big squad keeps them, marked 🚐✗");
  // Stream stale (fights older than 5 min): map model, no Solo gate.
  const r2 = await commanderFor(env, "1-4-601", (T0 + 120 + 400) * 1000);
  assert.equal(r2.ok, true);
  const cmd2 = JSON.parse(DB.raw.prepare("SELECT commander FROM alert WHERE key='1-4-601'").get().commander);
  assert.equal(cmd2.capture_live.variant, "map");
  assert.equal(cmd2.focus_solo, undefined);
});
