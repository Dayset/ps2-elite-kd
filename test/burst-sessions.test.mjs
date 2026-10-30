import test from "node:test";
import assert from "node:assert/strict";
import { burstSessions, burstReviewed, isBurst, storedSessions } from "../burst-sessions.mjs";

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

test("reviewed.json burst decisions: cleared / cheater, other entries ignored", () => {
  const m = burstReviewed({ players: { a: { burst: "cleared", note: "lucky orbital", at: "2026-10-19" }, b: { burst: "excluded", note: "rampage", at: "2026-10-19" }, c: { decision: "padding" } } });
  assert.deepEqual(Object.keys(m), ["a", "b"]);
  const p = (slug) => ({ slug, name: slug, cid: "1", assists: { sessions: { [slug]: [0, 30, 240, 1] } } });
  const r = burstSessions([p("a"), p("b")], { reviewed: m });
  assert.deepEqual(r.items.map((i) => [i.slug, i.status]), [["b", "cheater"], ["a", "cleared"]]);
  assert.match(r.items[1].reason, /lucky orbital/);
});

test("human review wins: reviewed players are cleared, cheaters labelled, nothing else changes", () => {
  const p = (slug) => ({ slug, name: slug, cid: "1", assists: { sessions: { [slug]: [0, 30, 240, 1] } } });
  const r = burstSessions([p("a"), p("legit"), p("bad")], { reviewed: { legit: "owner: legit", bad: "Confirmed cheater" } });
  assert.deepEqual(r.items.map((i) => [i.slug, i.status]), [["a", "review"], ["bad", "cheater"], ["legit", "cleared"]]);
  assert.equal(r.flaggedPlayers, 1);
  assert.equal(r.clearedPlayers, 1);
});

test("🛡️ carve-out: established players show as cleared, never as review", () => {
  const p = (slug, established) => ({ slug, name: slug, cid: "1", established, assists: { sessions: { [slug]: [0, 30, 240, 1] } } });
  const r = burstSessions([p("vet", true), p("new", false)], { reviewed: {} });
  assert.deepEqual(r.items.map((i) => [i.slug, i.status]), [["new", "review"], ["vet", "cleared"]]);
  assert.match(r.items.find((i) => i.slug === "vet").reason, /Established player/);
  assert.equal(r.clearedPlayers, 1);
  assert.equal(r.flaggedPlayers, 1);
});

test("🛡️ carve-out: an established burst shows as cleared even within own normal (never silently skipped)", () => {
  const five = (kpm) => Array.from({ length: 5 }, (_, i) => [0, kpm * 20, 1200, i]);
  const sess = { sessions: { b: [0, 62, 570, 1], ...Object.fromEntries(five(3.75).map((o, i) => ["o" + i, o])) } };
  const r = burstSessions([{ slug: "vet", name: "vet", cid: "1", kd: 2.5, established: true, assists: sess }], { reviewed: {} });
  assert.equal(r.ownNormalSkipped, 0);
  assert.equal(r.items[0].status, "cleared");
});

test("own-normal margin: skilled players with a burst <= 2x their median are skipped; cheaters/padders stay", () => {
  const sess = (burst, others) => ({ sessions: { b: burst, ...Object.fromEntries(others.map((o, i) => ["o" + i, o])) } });
  const five = (kpm) => Array.from({ length: 5 }, (_, i) => [0, kpm * 20, 1200, i]); // 20-min sessions
  const pl = (slug, kd, assists) => ({ slug, name: slug, cid: "1", kd, assists });
  const r = burstSessions([
    pl("plasma", 2.5, sess([0, 62, 570, 1], five(3.75))),   // 6.53 KPM vs 3.75 median -> skipped
    pl("spike", 2.5, sess([0, 62, 570, 1], five(1))),       // 6.5x own median -> review
    pl("fewsess", 2.5, { sessions: { b: [0, 62, 570, 1] } }), // no history -> review
    pl("padder", 34.8, sess([0, 378, 2748, 1], five(5.7))), // K/D >= 10 -> review
    pl("Add1ti0nal", 24.7, { sessions: { b: [0, 64, 504, 1] } }),
    pl("VanuBestFaction2", 44.3, { sessions: { b: [0, 177, 1410, 1] } }),
  ], { reviewed: { Add1ti0nal: "Confirmed cheater", VanuBestFaction2: "Excluded after review" } });
  assert.equal(r.ownNormalSkipped, 1);
  assert.deepEqual([...new Set(r.items.filter((i) => i.session === "b").map((i) => i.slug + ":" + i.status))].sort().map((x) => x.split(":")), [["Add1ti0nal", "cheater"], ["VanuBestFaction2", "cheater"], ["fewsess", "review"], ["padder", "review"], ["spike", "review"]]);
  // human review wins: a reviewed player is still listed even within own normal
  const h = burstSessions([pl("plasma", 2.5, sess([0, 62, 570, 1], five(3.75)))], { reviewed: { plasma: "Owner cleared" } });
  assert.equal(h.items[0].status, "cleared");
});
