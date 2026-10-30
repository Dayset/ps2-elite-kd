// 🏴 Capture tags (owner 2026-10-30, Option A): worker/src/capture-tags.js, the KillMonitor routes,
// the oracle's capsOf / fightsOf, the Oracle card line and the LIVE strip. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CaptureTags, rankCapture, CAP_SETTLE_MS, CAP_ORPHAN_MS } from "../worker/src/capture-tags.js";
import { pcSubscribe } from "../worker/src/pc-stream.js";
import { KillMonitor } from "../worker/src/monitor.js";
import { capsOf, fightsOf } from "../oracle-worker/src/fights.js";
// The Oracle page modules read location at load: give them a bare page URL first.
globalThis.location ??= { search: "", pathname: "/oracle/", href: "https://example.test/oracle/" };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { capLine, capsList } = await import("../oracle/js/fights.js");
const { capsStrip, capsUrl } = await import("../live-caps.mjs");

const TS = 1793350000; // seconds
const P = (i) => `54280000000000001${String(i).padStart(2, "0")}`;
const pfc = (cid, outfit, { f = "201", w = "1", z = "2", ts = TS } = {}) => ({ event_name: "PlayerFacilityCapture", character_id: cid, outfit_id: outfit, facility_id: f, world_id: w, zone_id: z, timestamp: String(ts) });
const fc = ({ f = "201", w = "1", z = "2", ts = TS, old = "2", nw = "1", outfit = "111" } = {}) => ({ event_name: "FacilityControl", facility_id: f, world_id: w, zone_id: z, timestamp: String(ts), old_faction_id: old, new_faction_id: nw, outfit_id: outfit, duration_held: "600" });
const xp = (cid, t, amount, id = "557") => ({ event_name: "GainExperience", experience_id: id, character_id: cid, amount: String(amount), timestamp: String(t), world_id: "1", zone_id: "2" });
const fakeFetch = (tags, seen = []) => async (u) => { seen.push(u); const ids = new URL(u).searchParams.get("outfit_id").split(","); return new Response(JSON.stringify({ outfit_list: ids.filter((i) => i in tags).map((i) => ({ outfit_id: i, alias: tags[i] })) })); };
const sqlOf = () => { const db = new DatabaseSync(":memory:"); return { exec(q, ...b) { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } }; };

test("rankCapture: half people, half point XP; no-outfit players count but never lead; 50 % = clear lead", () => {
  const r = rankCapture([["111", 300], ["111", 300], ["222", 100], ["0", 100]]);
  assert.equal(r.top.id, "111");
  assert.equal(Math.round(r.top.share * 100), 63); // 0.5·2/4 + 0.5·600/800
  assert.equal(r.lead, true);
  const q = rankCapture([["111", 0], ["222", 0], ["0", 0]]);   // quick cap, nobody earned point XP → people only
  assert.equal(Math.round(q.top.share * 100), 33);
  assert.equal(q.lead, false);
  assert.equal(rankCapture([["0", 50]]).top, null, "solo players only: no outfit leads");
  assert.equal(rankCapture([]), null);
});

test("a capture: window from the first point XP (≤ 6 min), tags looked up with the project's service id, one row", async () => {
  const sql = sqlOf(); let rows = 0;
  const ct = new CaptureTags(sql, { meter: { op: (k) => { if (k === "rows") rows++; } } });
  const now = TS * 1000;
  ct.onEvent("ps2", xp(P(1), TS - 500, 999), now);             // older than 6 min: outside the window
  ct.onEvent("ps2", xp(P(1), TS - 200, 200, "272"), now);
  ct.onEvent("ps2", xp(P(2), TS - 100, 200), now);
  ct.onEvent("ps2", xp(P(3), TS - 50, 50), now);
  ct.onEvent("ps2", fc({ outfit: "222" }), now);
  for (const [c, o] of [[P(1), "111"], [P(2), "111"], [P(3), "222"]]) ct.onEvent("ps2", pfc(c, o), now + 2e3);
  assert.deepEqual(await ct.settle({}, now + 5e3, fakeFetch({})), [], "waits for late participants");
  const seen = [];
  const [r] = await ct.settle({ CENSUS_SERVICE_ID: "projid" }, now + 2e3 + CAP_SETTLE_MS, fakeFetch({ 111: "RWCN", 222: "BAD" }, seen));
  assert.ok(seen[0].includes("/s:projid/") && !seen[0].includes("s:example"), "own service id");
  assert.equal(r.tag, "RWCN"); assert.equal(r.cr, "BAD"); assert.equal(r.same, false);
  assert.equal(r.share, 78);   // 0.5·2/3 + 0.5·400/450
  assert.equal(r.lead, true); assert.equal(r.win, 200); assert.equal(r.quick, false);
  assert.equal(r.fn, "Indar Waste Treatment"); assert.equal(r.old, "NC"); assert.equal(r.fac, "VS"); assert.equal(r.n, 3);
  assert.equal(rows, 1);
  assert.equal(sql.exec("SELECT COUNT(*) AS n FROM cap").toArray()[0].n, 1);
  const pub = JSON.stringify(ct.recent(1, TS - 60));
  for (let i = 1; i <= 3; i++) assert.ok(!pub.includes(P(i)), "never a player id");
  assert.equal(ct.recent(10, TS - 60).length, 0, "per world");
  // survives a restart (read back from SQLite)
  assert.equal(new CaptureTags(sql).history(1, TS - 60).length, 1);
});

test("quick cap (no point XP) = last 60 s, people only; defenses, mass flips, neutral flips and orphans skipped", async () => {
  const ct = new CaptureTags();
  const now = TS * 1000;
  ct.onEvent("ps2", fc({ f: "203" }), now);
  ct.onEvent("ps2", pfc(P(1), "111", { f: "203" }), now);
  ct.onEvent("ps2", pfc(P(2), "0", { f: "203" }), now);
  ct.onEvent("ps2", fc({ f: "204", old: "1", nw: "1" }), now);                       // defense
  ct.onEvent("ps2", pfc(P(3), "111", { f: "204" }), now);
  for (const f of ["205", "206", "207", "208"]) { ct.onEvent("ps2", fc({ f, ts: TS + 1 }), now); ct.onEvent("ps2", pfc(P(4), "333", { f, ts: TS + 1 }), now); } // mass flip
  ct.onEvent("ps2", fc({ f: "209", old: "0", nw: "3" }), now); ct.onEvent("ps2", pfc(P(5), "1", { f: "209" }), now); // from no faction
  const out = await ct.settle({}, now + CAP_SETTLE_MS + 1, fakeFetch({ 111: "AB" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].f, 203); assert.equal(out[0].quick, true); assert.equal(out[0].win, 60); assert.equal(out[0].share, 50); assert.equal(out[0].lead, true);
  assert.equal(out[0].co, "111"); assert.equal(out[0].same, true);
  assert.equal(ct.stats.mass, 4);
  await ct.settle({}, now + CAP_ORPHAN_MS + 1, fakeFetch({}));
  assert.equal(ct.pending.size, 0, "the defense's participants are dropped as orphans");
});

test("PC stream subscribes to FacilityControl (both levels), still never the whole XP firehose", () => {
  for (const l of ["full", "lean"]) { const e = pcSubscribe(l).eventNames; assert.ok(e.includes("FacilityControl")); assert.ok(!e.includes("GainExperience")); }
});

function monitor() {
  const db = new DatabaseSync(":memory:"); let alarm = null;
  const ctx = { storage: { sql: { exec(q, ...b) { const rows = db.prepare(q).all(...b); return { toArray: () => rows, one: () => rows[0] }; } }, async setAlarm(t) { alarm = t; }, async getAlarm() { return alarm; } } };
  const km = new KillMonitor(ctx, { PS_ASSISTS: "off", PC_STREAM: "off", PLAN: "free" });
  km.meta("startedAt", 1);
  return km;
}

test("KillMonitor: /live/captures and the caps riding on /live/activity (public, no player ids)", async () => {
  const km = monitor();
  const ts = Math.floor(Date.now() / 1000) - 30;
  km.caps.onEvent("ps2", fc({ ts }), ts * 1000);
  km.caps.onEvent("ps2", pfc(P(1), "111", { ts }), ts * 1000);
  await km.caps.settle({}, ts * 1000 + CAP_SETTLE_MS + 1, fakeFetch({ 111: "RWCN" }));
  const c = await (await km.fetch(new Request("https://monitor/live/captures?world=1"))).json();
  assert.equal(c.caps.length, 1); assert.equal(c.caps[0].tag, "RWCN");
  assert.ok(!JSON.stringify(c).includes(P(1)));
  assert.equal((await km.fetch(new Request("https://monitor/live/captures?world=1000"))).status, 400);
  const a = await (await km.fetch(new Request("https://monitor/live/activity?ns=ps2&world=1&zone=2"))).json();
  assert.equal(a.caps[0].tag, "RWCN");
  const u = await (await km.fetch(new Request("https://monitor/monitor/usage"))).json();
  assert.equal(u.caps.caps, 1);
});

test("oracle: capsOf keeps the alert's continent, newest first; a fight row gets its base's fresh tag", () => {
  const at = TS + 100;
  const act = { at, bases: [{ z: 2, f: 201, fn: "Indar Waste Treatment", n: { VS: 5, NC: 4, TR: 0 } }],
    caps: [{ t: TS, w: 1, z: 2, f: 201, fn: "Indar Waste Treatment", old: "NC", fac: "VS", oid: "111", tag: "RWCN", share: 45, lead: false, co: "111", cr: "RWCN", same: true, n: 7 },
      { t: TS + 50, w: 1, z: 2, f: 203, fn: "Saurva", old: "TR", fac: "VS", oid: "9", tag: "", share: 80, lead: true, co: null, n: 3 },
      { t: TS, w: 1, z: 6, f: 999, fn: "x" }] };
  const caps = capsOf(act, 2);
  assert.deepEqual(caps.map((c) => c.f), ["203", "201"]);
  assert.equal(caps[0].tag, ""); assert.equal(caps[0].cr, null);
  const fx = fightsOf(act, 2);
  assert.equal(fx.bases[0].cap.tag, "RWCN");
  assert.equal(fx.caps.length, 2);
});

test("Oracle + LIVE text: tag and share, 'no clear lead' under 50 %, credited outfit only when different", () => {
  const now = TS + 600;
  const lead = { t: TS, f: "201", fn: "A", fac: "VS", tag: "RWCN", share: 62, lead: true, cr: "BAD", same: false };
  assert.match(capLine(lead, now), /Captured by <b>\[RWCN\]<\/b> · 62%/);
  assert.match(capLine(lead, now), /officially credited: \[BAD\]/);
  assert.ok(!capLine({ ...lead, cr: "RWCN", same: true }, now).includes("credited"));
  assert.match(capLine({ ...lead, lead: false, share: 45 }, now), /no clear lead/);
  assert.ok(capLine(lead, TS + 10).includes("capnew"), "fresh tags animate");
  assert.match(capsList({ caps: [lead] }, now), /Recent captures/);
  assert.equal(capsList({ caps: [] }, now), "");
  const tr = (k, d, v = {}) => d.replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));
  const strip = capsStrip([{ t: TS, f: 201, z: 2, fn: "Indar Waste Treatment", fac: "VS", oid: "1", tag: "RWCN", share: 45, lead: false, co: "1", cr: "RWCN", same: true }], tr, now);
  assert.match(strip, /Latest captures on this server/); assert.match(strip, /no clear lead/); assert.match(strip, /Indar/);
  assert.equal(capsUrl("1000"), null, "PC servers only");
  assert.ok(capsUrl("10", TS).endsWith(`world=10&since=${TS - 1800}`));
  for (const s of [capLine(lead, now), strip]) assert.ok(!/track|locat/i.test(s), "no tracking / locating wording");
});
