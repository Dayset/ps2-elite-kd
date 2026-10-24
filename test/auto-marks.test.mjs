import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { autoMarks, autoMarksHtml, AUTO_MARK_MIN } from "../auto-marks.mjs";
import { HUT_MARK_MIN } from "../hut.mjs";
import { appSource } from "./app-source.mjs";

test("🪳 next to the name only when the revive check confirms a top-quarter Zerg", () => {
  assert.deepEqual(autoMarks(null, { score: 90, rvp: 99, confirmed: true }).map((m) => m.id), ["zerg"]);
  assert.equal(autoMarks(null, { score: 60, rvp: 99, confirmed: true }).length, 0); // low Zerg: confirmed but not a zerg
  assert.equal(autoMarks(null, { score: 90, rvp: 60, confirmed: false }).length, 0);
  assert.equal(autoMarks(null, { score: 90, rvp: null, confirmed: false }).length, 0); // no XP detail / cleared in reviewed.json
  assert.deepEqual(autoMarks(null, { score: 90, rvp: 30, crp: 80, chk: 80, confirmed: true }).map((m) => m.id), ["zerg"]); // t614: crowd score alone confirms
  assert.equal(autoMarks(null, null).length, 0); // "~N" estimate = no Zerg score = no mark
});

test("🐣 next to the name when a negative Diff is softened by ≥ the 🛖 mark minimum", () => {
  assert.equal(AUTO_MARK_MIN, HUT_MARK_MIN);
  assert.deepEqual(autoMarks({ by: "nbd", raw: -35, score: -12 }, null).map((m) => m.id), ["nbd"]);
  assert.equal(autoMarks({ by: "nbd", raw: -35, score: -30 }, null).length, 0); // small change: hover only
  assert.equal(autoMarks({ by: "veh", raw: 40, score: 10 }, null).length, 0);
  assert.equal(autoMarks(null, null).length, 0);
  assert.match(autoMarksHtml({ by: "nbd", raw: -35, score: 0 }, { score: 80, rvp: 90, confirmed: true }), /poop-mark auto-mark auto-mark-zerg.*🪳.*auto-mark-nbd.*🐣/);
});

test("stats table + Rankings name cells render the marks; one auto-marks.mjs version", () => {
  const app = appSource();
  const rk = fs.readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(app, /\$\{padMarkHtml\(row\.p\)\}\$\{autoMarkHtml\(row\)\}/);
  assert.match(rk, /hutHtml\(r\) \+ autoMarksHtml\(r\._gap, r\._zerg, r\.last/);
  const v = (s) => (s.match(/auto-marks\.mjs\?v=([\w-]+)/) || [])[1];
  assert.ok(v(app));
  assert.equal(v(app), v(rk));
});

test("🪦 inactive mark: flairs.mjs rule (last activity > 365 days), 👶 / 👴🏽 never shown", async () => {
  const { inactiveMark } = await import("../auto-marks.mjs");
  const now = Date.UTC(2026, 9, 23) , day = 86400;
  const s = now / 1000;
  assert.equal(inactiveMark({ created: s - 3000 * day, last: s - 400 * day }, now).mark, "🪦");
  assert.match(inactiveMark({ created: s - 3000 * day, last: s - 400 * day }, now).tip, /^🪦 /);
  assert.equal(inactiveMark({ created: s - 3000 * day, last: s - 300 * day }, now), null); // 👴🏽 veteran: hidden
  assert.equal(inactiveMark({ created: s - 10 * day, last: s - 1 * day }, now), null); // 👶 new: hidden
  assert.equal(inactiveMark(null, now), null);
  const html = autoMarksHtml({ by: "nbd", raw: -35, score: 0 }, { score: 80, rvp: 90, confirmed: true }, { created: s - 3000 * day, last: s - 400 * day }, now);
  assert.match(html, /auto-mark-zerg.*auto-mark-inactive/);
  assert.doesNotMatch(html, /auto-mark-nbd/); // 🪦 wins over 🐣 (owner 2026-10-23)
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(fs.readFileSync(new URL(`../i18n/${l}.json`, import.meta.url), "utf8"));
    assert.match(j["flair.inactive"], /^🪦 .*\{date\}/, l);
  }
});

test("🐣 also for a new player by play time, whatever the Diff (owner 2026-10-23: A and B)", () => {
  const m = autoMarks({ by: "aim", raw: 20, score: 20 }, null, 12.4);
  assert.deepEqual(m.map((x) => x.id), ["nbd"]);
  assert.match(m[0].tip, /New player \(about 12 h played\)/);
  const both = autoMarks({ by: "nbd", raw: -40, score: 0 }, null, 3);
  assert.equal(both.length, 1);
  assert.match(both[0].tip, /about 3 h.*softened from −40/i);
  assert.match(autoMarks({ by: "nbd", raw: -40, score: 0 }, null, null)[0].tip, /Softened from −40/);
  assert.equal(autoMarks(null, null, null).length, 0);
  assert.match(autoMarksHtml(null, null, null, Date.now(), 0.4), /auto-mark-nbd.*about &lt;1 h/);
});

test("🪦 wins over 🐣: inactive player shows no 🐣 (new or softened), softening math unchanged (owner 2026-10-23)", async () => {
  const now = Date.UTC(2026, 9, 23), s = now / 1000, day = 86400;
  const grave = { created: s - 3000 * day, last: s - 400 * day };
  const active = { created: s - 3000 * day, last: s - 10 * day };
  const soft = { by: "nbd", raw: -40, score: -5 };
  // softened kind
  let h = autoMarksHtml(soft, null, grave, now);
  assert.doesNotMatch(h, /🐣/);
  assert.match(h, /auto-mark-inactive.*🪦/);
  // new-player kind (and both)
  assert.doesNotMatch(autoMarksHtml(null, null, grave, now, 3), /🐣/);
  assert.doesNotMatch(autoMarksHtml(soft, null, grave, now, 3), /🐣/);
  // other marks stay; active players keep 🐣
  assert.match(autoMarksHtml(soft, { score: 90, rvp: 99, confirmed: true }, grave, now), /🪳.*🪦/);
  assert.match(autoMarksHtml(soft, null, active, now, 3), /auto-mark-nbd.*🐣/);
  assert.match(autoMarksHtml(soft, null, null, now), /🐣/); // no times known: 🐣 stays
  // build: nbh nulled + counted, nbd factor kept
  const { applyNewbieDiffColumn } = await import("../scripts/build-ranks.mjs");
  const S = Date.now() / 1000;
  const cols = ["name", "slug", "adjs", "ivi", "hut", "vdf", "created", "last"];
  const rows = Array.from({ length: 50 }, (_, i) => ["P" + i, "p" + i, (i % 10) + 1, 10 - (i % 10), null, null, S - 3000 * day, S - (i === 1 ? 400 : 5) * day]);
  const ranks = { cols: [...cols], rows };
  const st = applyNewbieDiffColumn(ranks, { players: {} }, new Map(rows.map((r, i) => [r[1], (i + 1) * 60])));
  const ix = (c) => ranks.cols.indexOf(c);
  assert.equal(ranks.rows[1][ix("nbh")], null); // 🪦 p1: no 🐣
  assert.equal(ranks.rows[2][ix("nbh")], 3); // active new player keeps 🐣
  assert.equal(ranks.rows[1][ix("nbd")], ranks.rows[0][ix("nbd")]); // softening factor unchanged (both under lo → 0)
  assert.equal(st.graveHiddenCount, 1);
  assert.deepEqual(st.graveHidden.map((x) => [x.slug, x.kind]), [["p1", "new"]]);
  assert.equal(st.newCount, 6);
});
