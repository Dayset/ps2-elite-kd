// ⛑️ Heavy support (heavy-support.mjs, owner t760): score, pair labels, alt grouping, filters, wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HS_RULE, supportFeatures, scoreHeavySupport, supportWindows, supportRecipients, timeTogether, buildCheck, pairLabel, isTopPair,
  familyIndex, heavySupportRows, filterHeavySupport, heavySupportCounts, heavySupportRuleText, HS_LABELS } from "../heavy-support.mjs";

const iso = (h) => new Date(Date.UTC(2026, 9, 1) + h * 3600000).toISOString();

test("support features need 120+ minutes and deaths", () => {
  assert.equal(supportFeatures({ totals: { g: { 4: [10, 100] } }, seconds_counted: 60 * 60, sessions: { a: { sec: 3600, d: 3 } } }), null);
  const f = supportFeatures({ totals: { g: { 4: [240, 1000], 1: [10, 1000], 51: [60, 0] } }, seconds_counted: 4 * 3600, sessions: { a: { sec: 7200, d: 12 }, b: { sec: 7200 } } });
  assert.equal(f.spm, 300 / 240);
  assert.equal(f.sxs, 0.5);
  assert.equal(f.dpm, 0.1);
  assert.equal(f.sqs, 60 / 300);
});

test("score = mean of the three percentiles; top first", () => {
  const s = scoreHeavySupport([{ slug: "a", spm: 3, sxs: 0.8, dpm: 0.1 }, { slug: "b", spm: 1, sxs: 0.2, dpm: 0.5 }, { slug: "c", spm: 2, sxs: 0.5, dpm: 0.3 }]);
  assert.deepEqual(s.rows.map((r) => r.slug), ["a", "c", "b"]);
  assert.equal(s.rows[0].rank, 1);
});

test("support windows: newest support sessions only, merged within a day", () => {
  const sess = [
    { start: iso(0), end: iso(2), heals: 5 }, { start: iso(3), end: iso(4), revives: 1 }, { start: iso(100), end: iso(101), heals: 0 },
    { start: iso(200), end: iso(201), resupplies: 2 }, { start: iso(300), end: null, heals: 9 },
  ];
  const w = supportWindows(sess, { cap: 4 });
  assert.equal(w.length, 2);
  assert.equal(w[0].start, iso(0).replace(".000Z", "Z"));
  assert.equal(w[0].end, iso(4).replace(".000Z", "Z"));
});

test("repeat partner = squad support on 2+ days; time together both ways", () => {
  const ev = (o, x) => ({ sourceID: "1", otherID: o, experienceID: x });
  const blocks = [
    { events: [ev("2", 51), ev("2", 51), ev("3", 4)], characters: [{ id: "1", worldID: 1 }, { id: "2", name: "Buddy", outfitTag: "X" }] },
    { events: [ev("2", 53), ev("3", 4), ev("4", 51)], characters: [] },
  ];
  const r = supportRecipients("1", blocks);
  assert.deepEqual(r.picks, ["2"]);
  assert.equal(r.world, 1);
  const tt = timeTogether([{ start: iso(0), end: iso(10) }], [{ start: iso(5), end: iso(10) }]);
  assert.equal(tt.myPct, 0.5);
  assert.equal(tt.pPct, 1);
  const c = buildCheck({ cid: "1", name: "Medic", sessions: [{ start: iso(0), end: iso(10) }], blocks, partnerSessions: { 2: [{ start: iso(5), end: iso(10) }] } });
  assert.equal(c.parts[0].slug, "buddy");
  assert.equal(c.parts[0].days, 2);
  assert.equal(c.parts[0].share, 3 / 6);
});

test("labels: Ginger → Zyr0s is a pocket duo; average mutual pair is a steady squad", () => {
  const ginger = { days: 3, sq: 20, myPct: 0.15, pPct: 0.98, ivi: 1383 };
  assert.equal(pairLabel(ginger, 807), "pocket");
  assert.ok(isTopPair("pocket", ginger));
  const tony = { days: 2, sq: 5, myPct: 0.71, pPct: 0.75, ivi: 243 };
  assert.equal(pairLabel(tony, 807), "steady");
  assert.ok(isTopPair("steady", tony));
  const outfit = { days: 3, sq: 5, myPct: 0.77, pPct: 0.09, ivi: 1176 };
  assert.equal(pairLabel(outfit, 807), "general", "partner rarely with the supporter = not a pair");
  assert.equal(pairLabel({ days: 1, sq: 5, myPct: 0.9, pPct: 0.9, ivi: 2000 }, 807), "general", "one day is not a regular partner");
});

test("alt families group 5 account pairs into one ⛑️ row; filters by label, server and name", () => {
  const fam = familyIndex({ altFamilies: { families: {} }, alts: { found: [{ a: "x1", b: "x2" }] }, extra: { g: ["g1", "g2"], z: ["z1", "z2"] } });
  assert.equal(fam.g2, fam.g1);
  assert.equal(fam.x2, fam.x1);
  const part = (slug, pPct) => ({ cid: slug, slug, name: slug.toUpperCase(), ticks: 10, sq: 10, share: 0.1, days: 3, myPct: 0.3, pPct, pHours: 10, ivi: 1500, kd: 4 });
  const store = {
    familyOf: fam, stats: { strongIvi: 807 },
    checks: {
      g1: { cid: "1", name: "G1", world: 1, windows: 4, myHours: 30, parts: [part("z1", 0.9)] },
      g2: { cid: "2", name: "G2", world: 10, windows: 4, myHours: 30, parts: [part("z2", 0.8)] },
      m: { cid: "3", name: "Medic", world: 10, windows: 4, myHours: 30, parts: [{ ...part("p", 0.05), myPct: 0.1 }] },
      t: { cid: "4", name: "Thin", world: 1, windows: 1, myHours: 1, parts: [] },
    },
  };
  const rows = heavySupportRows(store);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].label, "pocket");
  assert.ok(rows[0].top);
  assert.equal(rows[0].supporters.length, 2);
  assert.deepEqual(rows[0].worlds, [1, 10]);
  assert.equal(filterHeavySupport(rows, { label: "general" }).length, 1);
  assert.equal(filterHeavySupport(rows, { world: "10" }).length, 2);
  assert.equal(filterHeavySupport(rows, { q: "z2" }).length, 1, "partner name search");
  assert.equal(filterHeavySupport(rows, { q: "medic" }).length, 1);
  assert.deepEqual(heavySupportCounts(rows), { pocket: 1, steady: 0, general: 1, thin: 1, top: 1 });
});

test("rule fits the Honu budget and wording stays play-style", () => {
  assert.ok(HS_RULE.PER_RUN * (1 + HS_RULE.WINDOWS + HS_RULE.PICKS) <= 40);
  const text = [...heavySupportRuleText({ scored: 1, cut10: 80, strongIvi: 807 }), ...Object.values(HS_LABELS).map((l) => l.tip + l.text)].join(" ");
  assert.doesNotMatch(text, /cheat|track|locat|stalk|follow/i);
  const html = fs.readFileSync(new URL("../build-log.html", import.meta.url), "utf8");
  const card = html.slice(html.indexOf('id="cardHeavySupport"'), html.indexOf("</details>", html.indexOf('id="heavySupport"')));
  assert.match(card, /Private to this page/);
  assert.doesNotMatch(card, /cheat|track|locat|stalk/i);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  for (const page of ["index.html", "ranks.html", "misc.html", "updates.html", "live.html", "columns.html"]) {
    assert.doesNotMatch(fs.readFileSync(new URL("../" + page, import.meta.url), "utf8"), /heavy-support|Heavy support|heavysupport/, page + " must not show ⛑️");
  }
});

test("data/heavysupport.json is consistent", () => {
  const d = JSON.parse(fs.readFileSync(new URL("../data/heavysupport.json", import.meta.url), "utf8"));
  assert.ok(d.stats && d.stats.scored > 0);
  const rows = heavySupportRows(d);
  assert.ok(rows.some((r) => r.top && r.supporters.some((s) => s.slug === "gingerbaby")), "Ginger → Zyr0s is a ⛑️ pair");
  assert.equal(rows.filter((r) => r.supporters.some((s) => s.slug.startsWith("gingerbaby"))).length, 1, "the 5 Ginger accounts are one row");
});
