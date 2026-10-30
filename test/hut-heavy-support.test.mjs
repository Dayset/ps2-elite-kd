// owner t781u: "We need to get rid of spawn room warrior icon if it's combat squad pocket med/engi/support
// (replace spawnroom warrior with ⛑️) because same safe activity but outside of the spawnroom".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hutMarkOf, hutHsCleared, HUT_MARK, HUT_HS_MARK } from "../hut.mjs";
import { heavySupportSlugs, familyIndex } from "../heavy-support.mjs";
import { applyHutColumn, readHeavySupportSlugs } from "../scripts/build-ranks.mjs";

test("hutMarkOf: 1 → 🛖, 2 → ⛑️, else nothing", () => {
  assert.equal(hutMarkOf(1).mark, HUT_MARK);
  assert.equal(hutMarkOf(2).mark, HUT_HS_MARK);
  assert.equal(hutMarkOf(2).mark, "⛑️");
  assert.equal(hutMarkOf(0), null);
  assert.equal(hutMarkOf(null), null);
});

test("heavySupportSlugs: labelled supporters and their linked accounts; 'thin' and partners left out", () => {
  const part = (slug, pPct) => ({ slug, name: slug, days: 3, sq: 5, pPct, myPct: 0.5, pHours: 10, ticks: 5, share: 0.1 });
  const store = {
    checks: {
      sup: { name: "Sup", windows: 4, myHours: 10, parts: [part("mate", 0.8)] },
      med: { name: "Med", windows: 4, myHours: 10, parts: [] },
      thinny: { name: "Thinny", windows: 1, myHours: 1, parts: [] },
    },
  };
  const fam = familyIndex({ extra: { s: ["sup", "supalt"], m: ["mate", "matealt"] } });
  const s = heavySupportSlugs(store, fam);
  assert.deepEqual([...s].sort(), ["med", "sup", "supalt"]);
});

test("real data: every GingerBaby account is ⛑️ Heavy support", () => {
  const s = readHeavySupportSlugs("data");
  for (const k of ["gingerbaby", "gingerbabynce", "gingerbabyvse", "gingerbabyeunc", "gingerbabyeu"]) assert.ok(s.has(k), k);
  assert.ok(!s.has("zyr0s") && !s.has("xzyr0s"), "the supported partner keeps whatever they had");
});

test("build: a 🛖 player in the Heavy support set gets hutMk 2 (same damping); reviewed 'heavySupport: cleared' keeps 🛖", () => {
  // same population as test/hut.test.mjs: many normal players + 3 safe-spot players
  const cols = ["name", "slug", "act", "kpm", "kd", "acc", "inf", "adjs", "ivi"];
  const pop = Array.from({ length: 100 }, (_, i) => ({ act: (i + 1) / 100, kpm: (i + 1) / 100, kd: 1, acc: i + 1, inf: 90 }));
  const rows = pop.map((p, i) => [`P${i}`, `p${i}`, p.act, p.kpm, p.kd, p.acc, p.inf, i, 100 - i]);
  for (const s of ["hutA", "hutB"]) rows.push([s, s.toLowerCase(), 0.05, 0.02, 1, 5, 99, 200, -5]);
  const mk = (hsSlugs, reviewed) => {
    const ranks = { cols: cols.slice(), rows: rows.map((r) => r.slice()) };
    const st = applyHutColumn(ranks, reviewed, { hsSlugs });
    const ih = ranks.cols.indexOf("hut"), im = ranks.cols.indexOf("hutMk");
    return { st, by: Object.fromEntries(ranks.rows.map((r) => [r[1], [r[ih], r[im]]])) };
  };
  const base = mk(null, null);
  const marked = Object.entries(base.by).filter(([, v]) => v[1] === 1).map(([k]) => k);
  assert.ok(marked.length >= 2, "fixture has 🛖 players: " + marked.join());
  const [a, b] = marked;
  const sw = mk(new Set([a, "p0"]), { players: { [b]: { heavySupport: "cleared" } } });
  assert.equal(sw.by[a][1], 2, "⛑️ instead of 🛖");
  assert.equal(sw.by[a][0], base.by[a][0], "same Diff damping");
  assert.equal(sw.by.p0[1], base.by.p0[1], "Heavy support alone never adds a mark");
  const sw2 = mk(new Set([a, b]), { players: { [b]: { heavySupport: "cleared" } } });
  assert.equal(sw2.by[b][1], 1, "owner override keeps 🛖");
  assert.equal(sw2.st.hsSwapped, 1);
  assert.ok(sw2.st.players.find((p) => p.slug === a).hs);
  assert.ok(hutHsCleared({ players: { x: { heavySupport: "cleared" } } }, "x"));
});

test("site: ⛑️ text in all 9 languages; columns page explains it; no 'cheater' / tracking words", () => {
  for (const c of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const d = JSON.parse(fs.readFileSync(`i18n/${c}.json`, "utf8"));
    for (const k of ["hut.hsTip", "cp.hsLong"]) {
      assert.ok(d[k] && d[k].startsWith("⛑️"), c + " " + k);
      assert.doesNotMatch(d[k], /cheat|track|locat/i);
    }
    assert.match(d["cp.hutHead"], /⛑️/);
  }
  assert.match(fs.readFileSync("columns.html", "utf8"), /data-i18n="cp.hsLong"/);
  for (const f of ["rankings.mjs", "chart.mjs", "stats-table.mjs"]) assert.match(fs.readFileSync(f, "utf8"), /hutMarkOf\(/, f);
});
