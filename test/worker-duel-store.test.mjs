// 🤺 #83 duel pair cache: worker/src/duel-store.js (one Durable Object per player history).
// The Durable Object's SQLite is played by node:sqlite; Census by a fake history.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DuelStore, duelRoute, compactEvent, countFights, addSeg, gzip, gunzip, eventsUrl, createdUrl, STALE_MS, PAGE, GAP } from "../worker/src/duel-store.js";
import { compactEvent as siteCompact } from "../scrims.mjs";

function fakeCtx() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  const sql = {
    exec(q, ...binds) {
      const st = db.prepare(q);
      const rows = st.all(...binds);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
  return {
    storage: {
      sql,
      async setAlarm(t) { alarm = t; }, async getAlarm() { return alarm; },
      async deleteAll() { for (const t of ["blk", "meta"]) db.exec(`DELETE FROM ${t}`); },
    },
  };
}

const P = "5428000000000000001", Q = "5428000000000000002";
/** p's history, newest first: noise every 20 s, plus `fights` fights with q (6 kills each, 30 s apart), one per day. */
function history({ days = 10, fightsPerDay = 1, start = 1_790_000_000 } = {}) {
  const ev = [];
  for (let d = 0; d < days; d++) {
    const base = start + d * 86400;
    for (let i = 0; i < 300; i++) ev.push({ ts: base + i * 20, other: String(5429000000000000000n + BigInt(i % 50)), kill: i % 2 });
    for (let f = 0; f < fightsPerDay; f++) for (let k = 0; k < 6; k++) ev.push({ ts: base + 3000 + f * 2000 + k * 30, other: Q, kill: k % 2 });
  }
  return ev.sort((a, b) => b.ts - a.ts);
}
const asRow = (e) => ({ timestamp: String(e.ts), table_type: e.kill ? "kills" : "deaths", character_id: e.kill ? e.other : P, attacker_character_id: e.kill ? P : e.other, attacker_weapon_id: "7254", is_headshot: "0", zone_id: "2", attacker_loadout_id: "6", character_loadout_id: "13", attacker_vehicle_id: "0" });

function fakeCensus(hist, created = {}) {
  const calls = [], lookups = [];
  const fetchFn = async (url) => {
    if (url.includes("/character/?")) {
      lookups.push(url);
      const ids = /character_id=([\d,]+)/.exec(url)[1].split(",");
      return new Response(JSON.stringify({ character_list: ids.map((id) => ({ character_id: id, times: { creation: String(created[id] || 1_300_000_000) } })) }), { status: 200 });
    }
    calls.push(url);
    const before = +((/before=(\d+)/.exec(url) || [])[1] || Infinity);
    const after = +((/after=(\d+)/.exec(url) || [])[1] || -Infinity);
    const page = hist.filter((e) => e.ts < before && e.ts > after).slice(0, PAGE);
    return new Response(JSON.stringify({ characters_event_list: page.map(asRow), returned: page.length }), { status: 200 });
  };
  return { fetchFn, calls, lookups };
}

const ask = async (store, params) => (await store.fetch(new Request(`https://duel/pair?${new URLSearchParams({ ns: "ps2", p: P, q: Q, ...params })}`))).json();

test("compact events match the site's tuple (scrims.mjs compactEvent)", () => {
  for (const e of history({ days: 1 }).slice(0, 40).map(asRow)) assert.deepEqual(compactEvent(e, P), siteCompact(e, P));
  assert.match(eventsUrl("sid", "ps2ps4us", P, { before: 5 }), /^https:\/\/census\.daybreakgames\.com\/s:sid\/get\/ps2ps4us:v2\/characters_event\/\?character_id=\d+&type=KILL,DEATH&c:limit=1000&before=5$/);
});

test("helpers: fights by the 10-minute gap, ranges merge, gzip round trip", async () => {
  assert.equal(countFights([100, 130, 160, 100 + GAP + 61, 5000]), 3);
  assert.deepEqual(addSeg([[100, 200]], 150, 300), [[100, 300]]);
  assert.deepEqual(addSeg([[100, 200]], 300, 400), [[300, 400], [100, 200]]);
  assert.deepEqual(addSeg([[300, 400], [100, 200]], 150, 350), [[100, 400]]);
  assert.equal(await gunzip(await gzip("héllo ⚔️")), "héllo ⚔️");
});

test("first open: newest pages until 3 fights; the second open (any device) is served from storage", async () => {
  const hist = history({ days: 10 });
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn, calls } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  const r1 = await ask(store, { want: 3 });
  assert.ok(r1.fights >= 3, `fights ${r1.fights}`);
  assert.ok(r1.pages >= 1 && r1.pages <= 4);
  assert.equal(r1.done, false);
  assert.equal(r1.kills, r1.fights * 6);
  const pair = r1.events.filter((x) => x[2] === Q);
  assert.equal(pair.length, r1.kills);
  assert.ok(r1.events.length > pair.length, "context events around the fights come too (1v1 focus)");
  assert.ok(r1.events.every((x) => x[2] === Q || pair.some((y) => Math.abs(y[0] - x[0]) <= GAP)));
  const n1 = calls.length;
  // Another device, a minute later: nothing read from Census, same answer.
  const other = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now + 60e3 });
  const r2 = await ask(other, { want: 3 });
  assert.equal(calls.length, n1);
  assert.equal(r2.pages, 0);
  assert.equal(r2.kills, r1.kills);
  // seen = the last rev: nothing new to send.
  const r3 = await ask(other, { want: 3, seen: r2.rev });
  assert.equal(r3.events.length, 0);
});

test("read further back: progress is saved call by call until the start of the history", async () => {
  const hist = history({ days: 30 });
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  let r = await ask(store, { want: 3 });
  let rounds = 0, seen = r.rev, got = r.events.filter((x) => x[2] === Q).length;
  const los = [r.lo];
  while (!r.done && rounds < 50) {
    r = await ask(store, { want: 1e6, seen });
    seen = r.rev;
    got += r.events.filter((x) => x[2] === Q).length;
    los.push(r.lo);
    rounds++;
  }
  assert.equal(r.done, true);
  assert.equal(r.fights, 30);
  assert.equal(r.kills, 180);
  assert.ok(got >= 180, "every pair kill reached the client once (edge seconds may repeat)");
  assert.ok(los.every((x, i) => !i || x <= los[i - 1]), "the stored range only grows backwards");
  assert.equal(r.lo, hist[hist.length - 1].ts);
});

test("newer kills are read after 10 minutes (Census after=), older stay stored", async () => {
  const hist = history({ days: 3 });
  let now = (hist[0].ts + 60) * 1000;
  const { fetchFn, calls } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  const r1 = await ask(store, { want: 3 });
  assert.equal(r1.done, true, "a short history ends in one page");
  const hi = r1.hi;
  // New fight 1 hour later.
  for (let k = 0; k < 6; k++) hist.unshift({ ts: hi + 3600 + (5 - k) * 30, other: Q, kill: k % 2 });
  now += STALE_MS + 1;
  const n = calls.length;
  const r2 = await ask(store, { want: 3, seen: r1.rev });
  assert.equal(calls.length, n + 1);
  assert.match(calls[calls.length - 1], new RegExp(`after=${hi}$`));
  assert.equal(r2.kills, r1.kills + 6);
  assert.equal(r2.events.filter((x) => x[2] === Q).length, 6, "only the new fight is sent");
  assert.equal(r2.done, true);
});

test("creation floor: a new character vs a long history stops at the newer one's creation (owner note on #83)", async () => {
  // 60 days of p's history; q was created 5 days ago and fought p once a day since.
  const days = 60;
  const hist = [];
  const start = 1_790_000_000;
  for (let d = 0; d < days; d++) {
    const base = start + d * 86400;
    for (let i = 0; i < 400; i++) hist.push({ ts: base + i * 15, other: String(5429000000000000000n + BigInt(i % 50)), kill: i % 2 });
    if (d >= days - 5) for (let k = 0; k < 6; k++) hist.push({ ts: base + 3000 + k * 30, other: Q, kill: k % 2 });
  }
  hist.sort((a, b) => b.ts - a.ts);
  const qCreated = start + (days - 5) * 86400 - 3600;
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn, calls, lookups } = fakeCensus(hist, { [Q]: qCreated, [P]: 1_400_000_000 });
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  let r = await ask(store, { want: 1e6 });
  let rounds = 0;
  while (!r.done && rounds++ < 20) r = await ask(store, { want: 1e6, seen: r.rev });
  assert.equal(r.done, true);
  assert.equal(r.floorHit, true);
  assert.equal(r.floor, qCreated - GAP);
  assert.deepEqual(r.created, [1_400_000_000, qCreated]);
  assert.equal(r.fights, 5);
  assert.equal(r.kills, 30);
  assert.ok(r.lo <= qCreated - GAP, "read down to the floor");
  assert.ok(calls.length <= 4, `only the last days of a 60-day history were read (${calls.length} pages, 24 for all)`);
  assert.equal(lookups.length, 1, "creation dates looked up once, kept in the store");
  assert.match(createdUrl("sid", "ps2", [P, Q]), /character\/\?character_id=\d+,\d+&c:show=character_id,times\.creation&c:limit=2$/);
  // Later calls: no new lookup, still done.
  const again = await ask(store, { want: 1e6, seen: r.rev });
  assert.equal(again.done, true);
  assert.equal(lookups.length, 1);
});

test("two requests at once for one player: Census is read once", async () => {
  const hist = history({ days: 10 });
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn, calls } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  const [a, b] = await Promise.all([ask(store, { want: 3 }), ask(store, { want: 3 })]);
  assert.equal(a.kills, b.kills);
  assert.equal(a.pages + b.pages, calls.length);
  assert.equal(b.pages, 0);
});

test("Census busy: what is stored is still served, with error", async () => {
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn: async () => new Response("down", { status: 503 }), now: () => 1e12 });
  const r = await ask(store, { want: 3 });
  assert.equal(r.error, "census_busy");
  assert.deepEqual(r.events, []);
});

test("unused histories are deleted after the keep time", async () => {
  const hist = history({ days: 2 });
  let now = (hist[0].ts + 60) * 1000;
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn: fakeCensus(hist).fetchFn, now: () => now });
  await ask(store, { want: 3 });
  const alarm = await ctx.storage.getAlarm();
  assert.ok(alarm > now);
  now = alarm;
  await store.alarm();
  assert.equal(ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM blk").toArray()[0].c, 0);
});

test("route: checks input, refuses removed players (and wipes their store), forwards the rest", async () => {
  const stores = new Map();
  const wiped = [];
  const env = {
    DUEL_STORE: {
      idFromName: (n) => n,
      get: (n) => ({ fetch: async (u) => { if (String(u).endsWith("/wipe")) { wiped.push(n); return Response.json({ ok: true }); } stores.set(n, String(u)); return Response.json({ v: 1, ok: n }); } }),
    },
  };
  const optOut = { "_about": "x", "5428000000000000009": { name: "Gone" }, "us-5428000000000000008": { name: "GonePS" } };
  const fetchFn = async () => new Response(JSON.stringify(optOut), { status: 200 });
  const go = (qs) => duelRoute(new Request(`https://w/duels/pair?${qs}`), env, { "Access-Control-Allow-Origin": "https://dayset.github.io" }, { fetchFn });
  assert.equal((await go("ns=ps3&p=5428000000000000001&q=5428000000000000002")).status, 400);
  assert.equal((await go("ns=ps2&p=abc&q=5428000000000000002")).status, 400);
  assert.equal((await go("ns=ps2&p=5428000000000000001&q=5428000000000000001")).status, 400);
  const ok = await go("ns=ps2&p=5428000000000000001&q=5428000000000000002&want=3&seen=7");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://dayset.github.io");
  assert.match(stores.get("ps2:5428000000000000001"), /want=3&seen=7/);
  assert.equal((await go("ns=ps2&p=5428000000000000009&q=5428000000000000002")).status, 404);
  assert.deepEqual(wiped, ["ps2:5428000000000000009"]);
  assert.equal((await go("ns=ps2ps4us&p=5428000000000000001&q=5428000000000000008")).status, 404);
  assert.equal((await go("ns=ps2ps4eu&p=5428000000000000001&q=5428000000000000008")).status, 200, "us- removal does not touch Ceres");
});

test("short pages are re-asked once before they count as the end (owner 2026-10-28)", async () => {
  const now = 1_790_100_000 * 1000;
  // 1. Error payload with an empty list: throws, nothing stored.
  {
    const ctx = fakeCtx();
    const fetchFn = async () => new Response(JSON.stringify({ error: "Census busy", characters_event_list: [] }), { status: 200 });
    const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
    await assert.rejects(store.page("ps2", P, {}), /census/);
    assert.equal(ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM blk").toArray()[0].c, 0);
  }
  // 2. Short page, then a full page: the read continues (full), union stored.
  {
    const hist = history({ days: 10 });
    const short = hist.slice(0, 2).map(asRow);
    const full = hist.slice(0, 1000).map(asRow);
    let calls = 0;
    const fetchFn = async () => new Response(JSON.stringify({ characters_event_list: calls++ === 0 ? short : full }), { status: 200 });
    const ctx = fakeCtx();
    const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
    const r = await store.page("ps2", P, {});
    assert.equal(r.full, true);
    assert.equal(r.events.length, 1000, "the full retry stands (the blip events are inside it)");
    assert.equal(ctx.storage.sql.exec("SELECT n FROM blk").toArray()[0].n, 1000);
  }
  // 3. Short page, then a SHORTER one (flapping): throws, nothing sealed.
  {
    const hist = history({ days: 10 });
    let calls = 0;
    const fetchFn = async () => new Response(JSON.stringify({ characters_event_list: hist.slice(0, calls++ === 0 ? 5 : 3).map(asRow) }), { status: 200 });
    const ctx = fakeCtx();
    const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
    await assert.rejects(store.page("ps2", P, {}), /census/);
    assert.equal(ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM blk").toArray()[0].c, 0);
  }
});

test("a done flag from before the retry rule is re-verified, not trusted (owner 2026-10-28)", async () => {
  const hist = history({ days: 30 });
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  // One first-open call stores only the newest range; then a pre-fix done flag is planted.
  const r1 = await ask(store, { want: 3 });
  assert.equal(r1.done, false);
  assert.ok(r1.kills < 180, "only the newest fights are stored yet");
  ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('done', '1')");
  // The planted done must not stop the read: loop to the true end.
  let r = await ask(store, { want: 1e6, seen: r1.rev });
  let rounds = 0;
  while (!r.done && rounds++ < 50) r = await ask(store, { want: 1e6, seen: r.rev });
  assert.equal(r.done, true);
  assert.equal(r.kills, 180, "the full history is reached despite the planted done");
});

test("a true done costs one verification page and stands", async () => {
  const hist = history({ days: 30 });
  const now = (hist[0].ts + 60) * 1000;
  const { fetchFn, calls } = fakeCensus(hist);
  const ctx = fakeCtx();
  const store = new DuelStore(ctx, {}, { blob: (u8) => u8, fetchFn, now: () => now });
  let r = await ask(store, { want: 1e6 });
  let rounds = 0;
  while (!r.done && rounds++ < 50) r = await ask(store, { want: 1e6, seen: r.rev });
  assert.equal(r.done, true);
  assert.equal(r.kills, 180);
  const n = calls.length;
  const again = await ask(store, { want: 1e6, seen: r.rev });
  assert.equal(again.done, true);
  assert.equal(again.kills, 180);
  assert.equal(calls.length, n + 2, "one verification page, re-asked once as a short page, then it stands");
});
