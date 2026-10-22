// PlayStation 🤝 assists (#60): stream collector (Worker) → pull → player files → apk.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PS_STREAM_ENVS, ASSIST_EXP_IDS, ASSIST_BASE_XP, KILL_BASE_XP, IDLE_MS, MAX_SESSION_MS,
  subscribeMessage, sessionAssistStats, PsSessions,
} from "../worker/src/ps-assists.js";
import * as rc from "../scripts/refresh-cache.mjs";
import { groupRows, mergeIntoPayload, pullPsAssists, PS_ASSIST_SOURCE } from "../scripts/ps-assists-pull.mjs";
import { sessionMetrics } from "../session-stats.mjs";
import { ROOMS } from "../rooms.mjs";

test("collector constants equal the PC recipe; PS environments only", () => {
  assert.deepEqual(ASSIST_EXP_IDS, rc.ASSIST_EXP_IDS);
  assert.deepEqual(ASSIST_BASE_XP, rc.ASSIST_BASE_XP);
  assert.deepEqual(KILL_BASE_XP, rc.KILL_BASE_XP);
  assert.deepEqual(Object.keys(PS_STREAM_ENVS).sort(), [...ROOMS.ps.namespaces].sort());
  assert.ok(!("ps2" in PS_STREAM_ENVS));
  assert.throws(() => subscribeMessage("ps2"));
  const m = subscribeMessage("ps2ps4eu");
  assert.deepEqual(m.worlds, ["2000"]);
  assert.deepEqual(subscribeMessage("ps2ps4us").worlds, ["1000"]);
  for (const id of [1, 2, 3, 278, 279, 371, 372]) assert.ok(m.eventNames.includes(`GainExperience_experience_id_${id}`));
  assert.ok(m.eventNames.includes("Death") && m.eventNames.includes("PlayerLogin") && m.eventNames.includes("PlayerLogout"));
  assert.ok(!m.eventNames.includes("GainExperience"), "never the whole XP firehose");
});

test("damage share matches assistStatsFromBlock (nearest kill multiplier, halve > 1, spawn assist has no share)", () => {
  const t0 = Date.parse("2026-10-22T10:00:00Z");
  const ev = (s, id, amount) => ({ sourceID: "9", experienceID: id, amount, timestamp: new Date(t0 + s * 1000).toISOString() });
  const events = [ev(0, 1, 200), ev(60, 2, 95), ev(65, 3, 0), ev(600, 278, 150), ev(610, 371, 120), ev(900, 372, 700), ev(905, 2, 48)];
  const want = rc.assistStatsFromBlock({ events }, "9");
  const refs = events.filter((e) => KILL_BASE_XP[e.experienceID]).map((e) => [Date.parse(e.timestamp), e.amount / KILL_BASE_XP[e.experienceID]]);
  const asst = events.filter((e) => ASSIST_EXP_IDS.includes(e.experienceID)).map((e) => [Date.parse(e.timestamp), e.experienceID, e.amount]);
  const got = sessionAssistStats(refs, asst);
  assert.equal(got.shareN, want.shareN);
  assert.equal(got.shareSum, Math.round(want.shareSum * 1000) / 1000);
  assert.equal(got.mult, Math.round(want.mult * 100) / 100);
});

const T = 1792700000; // seconds
const xp = (cid, id, amount, s) => ({ event_name: "GainExperience", character_id: cid, experience_id: String(id), amount: String(amount), timestamp: String(T + s), world_id: "2000" });
const death = (victim, attacker, s, tk = false) => ({ event_name: "Death", character_id: victim, attacker_character_id: attacker, timestamp: String(T + s), world_id: "2000", team_id: "1", attacker_team_id: tk ? "1" : "2" });

test("sessions: login → kills/deaths/assists → logout gives one row; suicides and teamkills are not kills", () => {
  const s = new PsSessions("ps2ps4eu");
  assert.deepEqual(s.onEvent({ event_name: "PlayerLogin", character_id: "11", timestamp: String(T) }), []);
  s.onEvent(death("22", "11", 10));
  s.onEvent(xp("11", 1, 200, 10));
  s.onEvent(death("23", "11", 20));
  s.onEvent(xp("11", 2, 100, 30)); // 50 % share at x2
  s.onEvent(xp("11", 3, 0, 31));
  s.onEvent(death("11", "11", 40)); // suicide: a death, no kill
  s.onEvent(death("24", "11", 50, true)); // teamkill: not a kill
  s.onEvent(death("11", "25", 60));
  const rows = s.onEvent({ event_name: "PlayerLogout", character_id: "11", timestamp: String(T + 120) });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual({ ns: r.ns, cid: r.cid, st: r.st, sec: r.sec, a: r.a, k: r.k, d: r.d, sn: r.sn, mult: r.mult }, { ns: "ps2ps4eu", cid: "11", st: T * 1000, sec: 120, a: 2, k: 2, d: 2, sn: 1, mult: 2 });
  assert.equal(r.ss, 0.5);
  // Victims got sessions too (deaths only); the teamkilled 24 has a death as well.
  assert.deepEqual(Object.keys(s.open).sort(), ["22", "23", "24", "25"]);
});

test("sessions: idle and over-long sessions close; empty logins leave nothing", () => {
  const s = new PsSessions("ps2ps4us");
  s.onEvent({ event_name: "PlayerLogin", character_id: "1", timestamp: String(T) });
  assert.deepEqual(s.onEvent({ event_name: "PlayerLogout", character_id: "1", timestamp: String(T + 50) }), []);
  s.onEvent(death("2", "3", 0));
  assert.equal(s.sweep(T * 1000 + IDLE_MS - 1000).length, 0);
  const idle = s.sweep(T * 1000 + IDLE_MS + 1000);
  assert.equal(idle.length, 2);
  assert.ok(idle.every((r) => r.sec === 0));
  s.onEvent(death("2", "4", 0));
  const cut = s.onEvent(death("5", "4", MAX_SESSION_MS / 1000 + 10));
  assert.equal(cut.length, 1, "a session past 12 h is cut before the next event");
  assert.equal(cut[0].cid, "4");
  assert.equal(s.open["4"].k, 1);
});

test("rows merge into the player file in the PC session shape; apk comes out of sessionMetrics", () => {
  const cols = ["rid", "ns", "cid", "st", "sec", "a", "k", "d", "ss", "sn", "mult", "at"];
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push([i + 1, "ps2ps4eu", "5429000000000000077", 1792700000000 + i * 7200e3, 3600, 15, 25, 20, 9.5, 14, 2, 0]);
  rows.push([7, "ps2", "5429000000000000077", 1, 1, 1, 1, 1, 0, 0, 1, 0]); // never a PC row
  const g = groupRows(cols, rows);
  assert.deepEqual(Object.keys(g), ["eu-5429000000000000077"]);
  const payload = { player: { display: "X" } };
  assert.equal(mergeIntoPayload(payload, g["eu-5429000000000000077"]), true);
  assert.equal(payload.player.assists.source, PS_ASSIST_SOURCE);
  assert.equal(payload.player.assists.sessions_counted, 6);
  assert.deepEqual(payload.player.assists.sessions["ps-1792700000000"], [15, 25, 3600, 1792700000000, 9.5, 14, 2, 20]);
  assert.equal(mergeIntoPayload(payload, g["eu-5429000000000000077"]), false, "same rows twice change nothing");
  const sm = sessionMetrics({ assists: payload.player.assists });
  assert.ok(sm && sm.measured);
  assert.equal(Math.round(sm.values.s_apk * 1000) / 1000, 0.6);
});

test("pull: cursor, fresh keys asked once, unknown players skipped, never throws", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-assists-"));
  fs.mkdirSync(path.join(dir, "players"));
  fs.writeFileSync(path.join(dir, "players/us-5429000000000000001.json"), JSON.stringify({ player: { display: "A" } }));
  fs.writeFileSync(path.join(dir, "players/eu-5429000000000000001.json"), JSON.stringify({ player: { display: "B" } }));
  const index = { players: [{ key: "us-5429000000000000001" }, { key: "eu-5429000000000000001" }] };
  const state = { players: { "us-5429000000000000001": {}, "eu-5429000000000000001": { asst: 1 } } };
  const cols = ["rid", "ns", "cid", "st", "sec", "a", "k", "d", "ss", "sn", "mult", "at"];
  const bodies = [];
  const fetchImpl = async (url, init) => {
    assert.match(url, /\/ps-assists\/export$/);
    assert.equal(init.headers["X-Proxy-Key"], "k");
    const b = JSON.parse(init.body);
    bodies.push(b);
    return { ok: true, json: async () => ({ cols, maxRid: 3, more: false, next: 3,
      rows: b.since < 3 ? [[2, "ps2ps4eu", "5429000000000000001", 1000, 60, 1, 2, 1, 0.4, 1, 1, 0], [3, "ps2ps4us", "5429000000000000999", 1000, 60, 1, 2, 1, 0.4, 1, 1, 0]] : [],
      fresh: b.fresh.includes("us-5429000000000000001") ? [[1, "ps2ps4us", "5429000000000000001", 500, 60, 3, 4, 1, 1.2, 3, 1, 0]] : [] }) };
  };
  const write = (f, t) => fs.writeFileSync(f, t);
  const r = await pullPsAssists({ dataDir: dir, index, state, proxy: "https://w", key: "k", fetchImpl, writeFile: write, log: () => {} });
  assert.deepEqual(bodies[0], { since: 0, fresh: ["us-5429000000000000001"] });
  assert.equal(r.players, 2);
  assert.equal(r.skipped, 1);
  assert.equal(state.players["us-5429000000000000001"].asst, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "assists-state.json"), "utf8")).cursor, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "players/us-5429000000000000001.json"), "utf8")).player.assists.assist_count, 3);
  // Next run: only new rows, nobody fresh.
  await pullPsAssists({ dataDir: dir, index, state, proxy: "https://w", key: "k", fetchImpl, writeFile: write, log: () => {} });
  assert.deepEqual(bodies.at(-1), { since: 3, fresh: [] });
  // Worker down: no throw, cursor kept.
  const bad = await pullPsAssists({ dataDir: dir, index, state, proxy: "https://w", key: "k", fetchImpl: async () => ({ ok: false, status: 503 }), writeFile: write, log: () => {} });
  assert.match(bad.error, /503/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "assists-state.json"), "utf8")).cursor, 3);
  assert.equal((await pullPsAssists({ dataDir: dir, index, state, proxy: "", key: "", writeFile: write })).error.length > 0, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Durable Object half: SQL storage, export cursor + fresh keys, PS worlds only (node:sqlite stand-in)", async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return t.skip("no node:sqlite"); }
  const { PsAssists } = await import("../worker/src/ps-assists.js");
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...args) => { const st = db.prepare(q); const rows = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows }; } };
  const ctx = { storage: { sql } };
  const ps = new PsAssists(ctx, {});
  const A = "5429000000000000011", B = "5429000000000000022";
  ps.onMessage("ps2ps4eu", JSON.stringify({ type: "serviceMessage", payload: { event_name: "PlayerLogin", character_id: A, timestamp: String(T), world_id: "2000" } }));
  ps.onMessage("ps2ps4eu", JSON.stringify({ type: "serviceMessage", payload: { ...death(B, A, 5) } }));
  ps.onMessage("ps2ps4eu", JSON.stringify({ type: "serviceMessage", payload: { ...xp(A, 2, 50, 6) } }));
  // A US-world payload on the EU socket is ignored.
  ps.onMessage("ps2ps4eu", JSON.stringify({ type: "serviceMessage", payload: { ...death(A, B, 7), world_id: "1000" } }));
  ps.onMessage("ps2ps4eu", JSON.stringify({ type: "serviceMessage", payload: { event_name: "PlayerLogout", character_id: A, timestamp: String(T + 60), world_id: "2000" } }));
  let ex = ps.exportRows({ since: 0 });
  assert.equal(ex.rows.length, 1);
  const r = Object.fromEntries(ex.cols.map((c, i) => [c, ex.rows[0][i]]));
  assert.deepEqual([r.ns, r.cid, r.a, r.k, r.d, r.sec], ["ps2ps4eu", A, 1, 1, 0, 60]);
  assert.equal(ex.next, r.rid);
  assert.equal(ex.maxRid, r.rid);
  assert.equal(ps.exportRows({ since: ex.next }).rows.length, 0);
  ex = ps.exportRows({ since: ex.next, fresh: [`eu-${A}`, `us-${A}`, "pc-1", "nonsense"] });
  assert.equal(ex.fresh.length, 1);
  // Checkpoint survives a restart.
  ps.checkpoint();
  const again = new PsAssists(ctx, {});
  assert.ok(again.sessions.ps2ps4eu.open[B], "victim's open session restored");
  const st = again.status();
  assert.equal(st.envs.ps2ps4eu.sessions, 1);
  assert.equal(st.envs.ps2ps4us.sessions, 0);
  assert.equal(new PsAssists(ctx, { PS_ASSISTS: "off" }).enabled(), false);
});
