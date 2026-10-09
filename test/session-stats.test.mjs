import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sessionMetrics, sessionFlag, distribution, SESSION_RULE, SESSION_MIN, SESSION_METRIC_IDS, SESSION_LABELS } from "../session-stats.mjs";
import { classifyBins, RED_PATTERNS } from "../bins.mjs";
import { METRIC_LABELS } from "../outlier-guard.mjs";
import { buildRanksWithGuard } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

/** Assists-pass record: sessions [assists, kills, seconds, startMs, shareSum, shareN, mult, deaths?]. */
const assists = (rows) => ({ source: "honu-exp", sessions: Object.fromEntries(rows.map((r, i) => [String(i + 1), r])) });
/** XP-detail record with a few exp ids. */
function xp(sessions) {
  const out = { source: "honu-exp-all", sessions: {} };
  sessions.forEach((s, i) => {
    out.sessions[String(i + 1)] = { s: 1e12 + i, sec: s.sec, k: s.k, g: { 1: [s.k, s.k * 100], 2: [s.a, 0], 37: [s.hs, 0], 8: [s.ks || 0, 0], 10: [s.dom || 0, 0], 11: [s.rev || 0, 0] }, r: { 1: [s.d, 0] } };
  });
  return out;
}

describe("🧪 session stats", () => {
  it("assists-only: rates per kill / minute, best session, minimum kills", () => {
    const sm = sessionMetrics({ assists: assists([[30, 100, 3000, 1, 18, 30, 1], [10, 50, 1500, 2, 6, 10, 1], [0, 1, 100, 3, 0, 0, 1]]) });
    assert.equal(sm.kills, 151);
    assert.ok(sm.measured);
    assert.ok(Math.abs(sm.values.s_apk - 40 / 151) < 1e-9);
    assert.ok(Math.abs(sm.values.s_share - 24 / 40) < 1e-9);
    assert.ok(Math.abs(sm.values.s_maxKpm - 2) < 1e-9); // 100 kills / 50 min; the 1-kill session is too short
    assert.equal(sm.values.s_kd, null); // no deaths stored in old tuples
    assert.equal(sm.values.s_hsk, null); // needs XP detail
    assert.equal(sessionMetrics({ assists: assists([[1, 20, 1200, 1]]) }).measured, false);
    assert.equal(sessionMetrics({}), null);
  });

  it("stored session deaths give a session K/D once ≥ MIN_KILLS", () => {
    const sm = sessionMetrics({ assists: assists([[30, 120, 3000, 1, 0, 0, 1, 40]]) });
    assert.equal(sm.values.s_kd, 3);
    const tiny = sessionMetrics({ assists: assists([[1, 120, 3000, 1], [0, 10, 900, 2, 0, 0, 1, 0]]) });
    assert.equal(tiny.values.s_kd, null); // one 10-kill session can't decide K/D
  });

  it("XP detail: headshots, streaks, revenge ÷ domination, session K/D", () => {
    const sm = sessionMetrics({ xp: xp([{ sec: 3600, k: 300, a: 6, hs: 210, d: 10, ks: 280, dom: 60, rev: 3 }]) });
    assert.equal(sm.source, "xp");
    assert.ok(Math.abs(sm.values.s_hsk - 0.7) < 1e-9);
    assert.equal(sm.values.s_kd, 30);
    assert.ok(Math.abs(sm.values.s_revDom - 0.05) < 1e-9);
    assert.ok(Math.abs(sm.values.s_apk - 0.02) < 1e-9);
  });

  it("session pattern needs all three signals; lifetime fallbacks; neutral rule", () => {
    const cheat = sessionMetrics({ xp: xp([{ sec: 3600, k: 300, a: 6, hs: 210, d: 10 }]) });
    assert.equal(sessionFlag(cheat).flagged, true);
    const legit = sessionMetrics({ xp: xp([{ sec: 3600, k: 300, a: 50, hs: 190, d: 80 }]) });
    assert.equal(sessionFlag(legit).flagged, false);
    const aOnly = sessionMetrics({ assists: assists([[5, 200, 3600, 1]]) });
    assert.equal(sessionFlag(aOnly, { hsr: 60, kd: 20 }).flagged, true);
    assert.equal(sessionFlag(aOnly, { hsr: 60, kd: 4 }).flagged, false);
    assert.equal(sessionFlag(sessionMetrics({ assists: assists([[0, 50, 600, 1]]) }), { hsr: 90, kd: 90 }).flagged, false); // below minimum
    assert.ok(SESSION_RULE.APK_MAX > 0 && SESSION_RULE.KD_MIN > 4 && SESSION_MIN.MIN_KILLS >= 100);
  });

  it("'session' is a 🚩 pattern; labels exist for the guard", () => {
    assert.ok(RED_PATTERNS.includes("session"));
    assert.equal(classifyBins({ patterns: ["session"] }).bin, "red");
    for (const id of SESSION_METRIC_IDS) { assert.ok(SESSION_LABELS[id], id); assert.equal(METRIC_LABELS[id], SESSION_LABELS[id]); }
    assert.deepEqual(distribution([3, 1, 2, null]).median, 2);
  });

  it("real cache: measured confirmed cheaters match, top legit players don't", () => {
    const { session, guard } = buildRanksWithGuard(dataDir);
    const flagged = new Set(session.flagged.map((f) => f.slug));
    const hidden = JSON.parse(fs.readFileSync(path.join(dataDir, "hidden.json"), "utf8")).players;
    const cheaters = session.reference.filter((r) => r.group === "confirmed cheater");
    assert.equal(cheaters.length, Object.keys(hidden).length);
    for (const r of cheaters) {
      // Only an aim-style cheater with enough recent sessions can match; report the rest.
      if (r.measured && r.values.s_hsk >= SESSION_RULE.HS_MIN) assert.ok(flagged.has(r.slug), r.slug);
    }
    for (const s of ["yeezy", "zyr0sncx", "xclonekano", "shlodog", "justv6me"]) assert.ok(!flagged.has(s), s);
    // Every hit is an explained 🚩 player, and session outliers never go unexplained silently.
    assert.ok(session.coverage.measured >= 100);
    assert.equal(guard.playersUnexplained, 0);
  });
});

import { mergeXp } from "../scripts/honu-xp.mjs";
import { mergeAssists } from "../scripts/refresh-cache.mjs";
describe("🧪 session deaths are stored (no extra Honu calls)", () => {
  it("mergeXp keeps d; mergeAssists keeps tuple slot 7", () => {
    const x = mergeXp(null, [{ id: 9, s: 1e12, sec: 600, k: 30, d: 4, g: {}, r: {} }]);
    assert.equal(x.sessions["9"].d, 4);
    assert.equal(sessionMetrics({ xp: mergeXp(null, [{ id: 1, s: 1e12, sec: 3600, k: 120, d: 0, g: {}, r: { 1: [9, 0] } }]) }).values.s_kd, 120); // stored d wins over kill events
    const a = mergeAssists(null, [{ id: 5, assists: 3, kills: 40, deaths: 8, seconds: 1200, startMs: 1e12, shareSum: 1.5, shareN: 3, mult: 1 }]);
    assert.equal(a.sessions["5"][7], 8);
    const old = mergeAssists(null, [{ id: 6, assists: 3, kills: 40, seconds: 1200, startMs: 1e12 }]);
    assert.equal(old.sessions["6"][7], null);
  });
});
