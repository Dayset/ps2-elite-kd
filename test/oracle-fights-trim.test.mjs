// ⚔️ Live fights card trim (owner 2026-10-30): top 3 only, no "Recent captures" list, short rows with
// the details in hovers. Faction / outfit totals only.
import test from "node:test";
import assert from "node:assert/strict";
globalThis.location ??= { search: "", pathname: "/oracle/", href: "https://example.test/oracle/" };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { fightsCard, FIGHTS_SHOWN, capShort, fightGoneAt, CAP_GRACE_S } = await import("../oracle/js/fights.js");

const fight = (i, extra = {}) => ({ fid: i, name: `Base ${i}`, owner: "NC", n: { VS: 14, NC: 11, TR: 0 }, k: { VS: 6, NC: 5, TR: 0 }, ...extra });
const strip = (h) => h.replace(/<[^>]+>/g, "");

test("only the top 3 fights, in the given order", () => {
  assert.equal(FIGHTS_SHOWN, 3);
  const h = fightsCard({ fights: [1, 2, 3, 4, 5].map((i) => fight(i)), caps: [{ f: 9, fn: "Old Cap", fac: "TR", t: 1 }] });
  assert.deepEqual([...h.matchAll(/<li data-base="([^"]+)"/g)].map((m) => m[1]), ["Base 1", "Base 2", "Base 3"]);
  assert.doesNotMatch(h, /Recent captures|Old Cap/, "recent captures list is hidden");
});

test("a row is short; the words sit in hovers", () => {
  const h = fightsCard({ fights: [fight(1, { conv: { VS: 3 }, convAgo: 10, cap: { lead: true, tag: "RWCN", share: 45, t: 1000, fac: "VS", old: "NC" } })] }, 1010);
  const txt = strip(h);
  assert.match(txt, /Base 1 ?NC⏳VS 🏴\[RWCN\] 45%/);
  assert.match(txt, /VS 14 · NC 11 · 💀11/);
  assert.doesNotMatch(txt, /players|points|Captured by|Rough crowd|min ago/);
  assert.match(h, /title="~25 players"/);
  assert.match(h, /title="VS points · now — A capture point changed hands/);
  assert.match(h, /title="🏴 Captured by \[RWCN\] · 45% — Outfit with the biggest share/);
  assert.match(h, /<h2 data-sec="live-fights" title="Rough crowd:/);
  assert.equal(capShort({ lead: false, tag: null, share: 30 }), "", "no clear lead: nothing on the row");
});

test("a captured base stays 30 s, then leaves unless the fight picks up again", () => {
  assert.equal(CAP_GRACE_S, 30);
  const T = 10_000;
  const s = (f, at = T + 60) => ({ fights_at: at, fights: [f, fight(2)], caps: [{ f: "1", fn: "Base 1", fac: "TR", old: "NC", t: T }] });
  const names = (h) => [...h.matchAll(/<li data-base="([^"]+)"/g)].map((m) => m[1]);
  // Only mop-up kills right after the flip (last kill 50 s before the snapshot = 10 s after the flip).
  const quiet = fight(1, { killAgo: 50, convAgo: 59 });
  assert.equal(fightGoneAt(quiet, s(quiet)), T + 30);
  assert.deepEqual(names(fightsCard(s(quiet), T + 20)), ["Base 1", "Base 2"], "still shown 20 s after the capture");
  assert.match(fightsCard(s(quiet), T + 20), /data-gone="10030"/, "the page knows when to drop it");
  assert.deepEqual(names(fightsCard(s(quiet), T + 31)), ["Base 2"], "gone after 30 s");
  // Fighting back: a kill 45 s after the flip keeps (or brings back) the base like any fight.
  const back = fight(1, { killAgo: 15 });
  assert.equal(fightGoneAt(back, s(back)), null);
  assert.deepEqual(names(fightsCard(s(back), T + 300)), ["Base 1", "Base 2"]);
  // A capture point taken again after the flip counts too.
  const pts = fight(1, { killAgo: 59, convAgo: 5 });
  assert.equal(fightGoneAt(pts, s(pts)), null);
  // No capture: never dropped. The next fight fills the top 3.
  assert.equal(fightGoneAt(fight(2), s(quiet)), null);
  const five = { fights_at: T + 60, fights: [quiet, fight(2), fight(3), fight(4)], caps: s(quiet).caps };
  assert.deepEqual(names(fightsCard(five, T + 40)), ["Base 2", "Base 3", "Base 4"]);
});
