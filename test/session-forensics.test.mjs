// 🔎 Session forensics (t325u): rules on synthetic kill events, session picking,
// the run queue, and the real store (manimami / Add1ti0nal flagged, top legit not).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSessionKills, forensicsVerdict, pickForensicSessions, knownSessions, maxInWindow, forensicsSummary, FORENSICS_RULE } from "../session-forensics.mjs";
import { forensicsQueue, mergeForensics, FORENSICS_RECHECK_MS } from "../scripts/refresh-cache.mjs";
import { buildRanksWithGuard } from "../scripts/build-ranks.mjs";

const dataDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "data");
const ME = "111";
const t0 = Date.parse("2026-10-09T10:00:00Z");
const kill = (sec, { victim = "v" + sec, hs = false, weapon = 503, team = 2 } = {}) => ({
  event: { attackerCharacterID: ME, killedCharacterID: victim, attackerTeamID: 3, killedTeamID: team, attackerVehicleID: 0, weaponID: weapon, isHeadshot: hs, timestamp: new Date(t0 + sec * 1000).toISOString() },
  attacker: { battleRank: 17, dateCreated: "2026-10-09T05:45:01Z" }, killed: { name: victim, battleRank: 60 }, item: { name: "W" + weapon },
});
const death = (sec, by = "k1") => ({ event: { attackerCharacterID: by, killedCharacterID: ME, attackerTeamID: 2, killedTeamID: 3, timestamp: new Date(t0 + sec * 1000).toISOString() } });

describe("🔎 session forensics", () => {
  it("maxInWindow", () => {
    assert.equal(maxInWindow([0, 0, 0, 1, 5, 9], 1), 3);
    assert.equal(maxInWindow([0, 0, 0, 1, 5, 9], 10), 6);
  });

  it("⚡ same-second clusters in 3+ seconds flag; one big blast doesn't", () => {
    const one = [...Array(8)].map(() => kill(10)).concat([kill(100), kill(200)]);
    assert.equal(analyzeSessionKills(one, ME).flagged, false, "one C-4 / OS blast");
    const many = [10, 50, 90].flatMap((s) => [...Array(5)].map((_, i) => kill(s, { victim: "x" + s + i })));
    const r = analyzeSessionKills(many, ME);
    assert.equal(r.secs5plus, 3);
    assert.ok(r.flagged && r.reasons[0].startsWith("⚡"));
  });

  it("⚡ ≥ 50% 0-s gaps over ≥ 50 kills", () => {
    const ev = [];
    for (let i = 0; i < 30; i++) ev.push(kill(i * 20), kill(i * 20, { victim: "y" + i }));
    const r = analyzeSessionKills(ev, ME);
    assert.equal(r.kills, 60);
    assert.ok(r.zeroGapShare >= 0.5);
    assert.ok(r.reasons.some((x) => x.includes("0 s after")));
  });

  it("🔥 burst needs 50 in 5 min AND K/D ≥ 20", () => {
    const ev = [...Array(55)].map((_, i) => kill(i * 5));
    assert.ok(analyzeSessionKills(ev, ME).reasons.some((x) => x.startsWith("🔥")));
    const withDeaths = ev.concat([...Array(5)].map((_, i) => death(i * 30)));
    assert.ok(!analyzeSessionKills(withDeaths, ME).flagged, "K/D 11");
  });

  it("normal pace, deaths, teamkills and other players' kills: nothing", () => {
    const ev = [...Array(120)].map((_, i) => kill(i * 30)).concat([death(10), death(500), death(900)]);
    ev.push({ event: { attackerCharacterID: "zzz", killedCharacterID: "q", timestamp: new Date(t0).toISOString() } });
    ev.push(kill(5, { team: 3 }));
    const r = analyzeSessionKills(ev, ME);
    assert.equal(r.kills, 120);
    assert.equal(r.deaths, 3);
    assert.equal(r.teamKills, 1);
    assert.equal(r.flagged, false);
  });

  it("oddities: farm-like victim → review, not 🚩", () => {
    const ev = [...Array(25)].map((_, i) => kill(i * 60, { victim: "bot" })).concat([...Array(40)].map((_, i) => kill(3000 + i * 60))).concat([death(10, "a"), death(20, "b"), death(30, "c")]);
    const r = analyzeSessionKills(ev, ME);
    assert.equal(r.flagged, false);
    assert.ok(r.oddities.some((x) => x.includes("farm-like")));
  });

  it("picks most kills + highest KPM, skips done / tiny sessions", () => {
    const s = { a: { kills: 300, seconds: 7200 }, b: { kills: 80, seconds: 600 }, c: { kills: 10, seconds: 60 }, d: { kills: 40, seconds: 120 } };
    assert.deepEqual(pickForensicSessions(s), ["a", "b"]);
    assert.deepEqual(pickForensicSessions(s, { a: {} }), ["b"]);
    const k = knownSessions({ assists: { sessions: { 1: [2, 64, 505, 0] } }, honuList: [{ id: 2, kills: 260, start: "2026-10-09T10:42:01Z", end: "2026-10-09T11:45:41Z" }, { id: 3, kills: 9, start: "x" }] });
    assert.deepEqual(Object.keys(k).sort(), ["1", "2"]);
  });

  it("queue: candidate order, recheck spacing, per-run max", () => {
    const now = Date.now();
    const store = { players: { a: { checkedAt: new Date(now - 1000).toISOString() }, b: { checkedAt: new Date(now - FORENSICS_RECHECK_MS - 1).toISOString() } } };
    assert.deepEqual(forensicsQueue(["a", "b", "c", "d", "e"], store, now, 3), ["b", "c", "d"]);
    const s = mergeForensics(null, "x", { cid: "1", name: "X", report: { sessionId: "9", kills: 5, flagged: false } });
    assert.equal(s.players.x.sessions["9"].kills, 5);
  });

  it("real store: manimami ⚡ + Add1ti0nal 🔥 flagged; top legit sessions are not", () => {
    const store = JSON.parse(fs.readFileSync(path.join(dataDir, "forensics.json"), "utf8"));
    const sum = (slug) => forensicsSummary(store.players[slug]);
    assert.ok(sum("manimami").flagged);
    assert.ok(sum("manimami").worst.reasons.some((r) => r.startsWith("⚡")));
    assert.ok(sum("add1ti0nal").flagged);
    for (const slug of ["justv6me", "shlodog", "zyr0sncx", "xclonekano", "yeezy"]) {
      if (!store.players[slug]) continue;
      assert.ok(!sum(slug).flagged, slug);
      assert.ok(!sum(slug).odd, slug);
    }
    const { forensics, bins } = buildRanksWithGuard(dataDir);
    assert.ok(forensics.players.some((p) => p.slug === "manimami" && p.flagged));
    assert.ok(Array.isArray(forensics.candidates) && forensics.candidates.length > 0);
    assert.ok(bins.forensics >= 0);
    assert.equal(FORENSICS_RULE.IMPOSSIBLE.PER_SECOND, 5);
    assert.equal(forensicsVerdict(null).flagged, false);
  });
});
