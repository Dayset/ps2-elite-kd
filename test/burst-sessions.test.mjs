import test from "node:test";
import assert from "node:assert/strict";
import { burstSessions, isBurst, storedSessions } from "../burst-sessions.mjs";

test("burst rule: KPM >= 5, kills >= 15, >= 2 min, no 10-minute floor", () => {
  assert.equal(isBurst({ kills: 15, seconds: 180 }), true); // 3 min, 5 KPM
  assert.equal(isBurst({ kills: 14, seconds: 120 }), false); // too few kills
  assert.equal(isBurst({ kills: 15, seconds: 119 }), false); // under 2 min
  assert.equal(isBurst({ kills: 40, seconds: 600 }), false); // 4 KPM
});

test("stored sessions merge assists tuples and XP detail", () => {
  const s = storedSessions({ sessions: { 1: [3, 20, 200, 1000] } }, { sessions: { 2: { s: 2000, sec: 300, k: 30 } } });
  assert.deepEqual(s, { 1: { kills: 20, seconds: 200, startMs: 1000 }, 2: { kills: 30, seconds: 300, startMs: 2000 } });
});

test("human review wins: reviewed players are cleared, cheaters labelled, nothing else changes", () => {
  const p = (slug) => ({ slug, name: slug, cid: "1", assists: { sessions: { [slug]: [0, 30, 240, 1] } } });
  const r = burstSessions([p("a"), p("legit"), p("bad")], { reviewed: { legit: "owner: legit", bad: "Confirmed cheater" } });
  assert.deepEqual(r.items.map((i) => [i.slug, i.status]), [["a", "review"], ["bad", "cheater"], ["legit", "cleared"]]);
  assert.equal(r.flaggedPlayers, 1);
  assert.equal(r.clearedPlayers, 1);
});
