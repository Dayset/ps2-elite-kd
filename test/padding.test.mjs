import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PADDING_RULE, isFarmVictim, splitFarm, farmNote, statMark, ADJUSTED_MARK, REVIEW_DECISIONS, reviewDecision,
} from "../padding.mjs";
import { normalizePlayer, playerMetrics, shownValue } from "../player-metrics.mjs";
import { reviewFlags, paddingFlag, isPadder, PADDING_MARK, PADDING_MARK_TIP } from "../red-flags.mjs";
import { rankRow, RANK_COLS } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (slug) => JSON.parse(fs.readFileSync(path.join(root, "data", "players", `${slug}.json`), "utf8"));
const metricsOf = (slug) => playerMetrics(normalizePlayer(load(slug)));

describe("stat padding (farm victims)", () => {
  it("farm-victim rule boundaries", () => {
    assert.equal(PADDING_RULE.MIN_KILLS, 100);
    assert.equal(isFarmVictim({ kills: 100, deaths: 2, kpm: 0.09 }), true);
    assert.equal(isFarmVictim({ kills: 99, deaths: 0, kpm: 0 }), false);
    assert.equal(isFarmVictim({ kills: 100, deaths: 3, kpm: 0 }), false); // > 2% back
    assert.equal(isFarmVictim({ kills: 500, deaths: 0, kpm: 0.1 }), false); // KPM not < 0.1
  });

  it("splitFarm keeps everything else and reports the share", () => {
    const s = splitFarm([
      { name: "bot", kills: 300, deaths: 0, kpm: 0 },
      { name: "real", kills: 700, deaths: 500, kpm: 1.1 },
    ]);
    assert.equal(s.kept.length, 1);
    assert.equal(s.kills, 300);
    assert.equal(s.share, 0.3);
    assert.match(farmNote(s), /300 kills on 1 farm account excluded/);
    assert.equal(farmNote(splitFarm([{ name: "x", kills: 5, deaths: 5, kpm: 1 }])), "");
  });

  it("Megatake: 🌾 padding (📉 chart anomaly, not 🚩 — t288u), sample K/D ≈ 1.03 after exclusion", () => {
    const m = metricsOf("megatake");
    const f = reviewFlags(m);
    assert.ok(f.patterns.includes("padding"));
    assert.equal(f.red, false);
    assert.equal(f.bins.bin, "chart");
    assert.ok(isPadder(m));
    assert.deepEqual(m.farm.victims.map((v) => v.name).sort(), ["battletank112", "hammer111", "vulcan112"]);
    assert.ok(Math.abs(m.rkd - 1.03) < 0.01, `rkd ${m.rkd}`);
    assert.ok(m.raw.rkd > 7, "raw sample kept for the older rules");
    // Graph line uses the kept rows: lowest-KPM point no longer spikes.
    const p = normalizePlayer(load("megatake"));
    const low = p.curve.reduce((a, b) => (b.kpm < a.kpm ? b : a));
    assert.ok(low.kd < 1.1, `curve K/D at kpm ${low.kpm} = ${low.kd}`);
    assert.ok(shownValue(m, "adjs") < 1000);
  });

  it("normal players are unaffected (ShloDog, YEEZY, BrackieNSE)", () => {
    for (const slug of ["shlodog", "yeezy", "brackiense"]) {
      const raw = load(slug);
      const p = normalizePlayer(raw);
      const m = playerMetrics(p);
      assert.equal(m.farm.victims.length, 0, slug);
      assert.equal(m.raw, m, slug);
      assert.equal(p.rows.length, (raw.player.rows || []).length, slug);
      assert.ok(!paddingFlag(m).flagged, slug);
    }
  });

  it("older 🚩 rules keep their inputs: cheaters stay flagged, padding is added on top", () => {
    assert.ok(reviewFlags(metricsOf("add1ti0nal")).patterns.includes("rampage"));
    assert.ok(reviewFlags(metricsOf("1stfanofahorn")).patterns.includes("rampage"));
    assert.ok(!reviewFlags(metricsOf("shlodog")).flagged);
  });

  it("ranks.json carries the * marker flag and the farm note", () => {
    const meg = rankRow(load("megatake"), { slug: "megatake" });
    assert.equal(meg[RANK_COLS.indexOf("mark")], "padding");
    assert.match(meg[RANK_COLS.indexOf("farm")], /7715 kills on 3 farm accounts excluded/);
    const shlo = rankRow(load("shlodog"), { slug: "shlodog" });
    assert.equal(shlo[RANK_COLS.indexOf("mark")], null);
    assert.equal(shlo[RANK_COLS.indexOf("farm")], null);
    assert.equal(PADDING_MARK, "*");
    assert.match(PADDING_MARK_TIP, /stat padding/);
  });

  it("re-normalizing a browser-cached copy (raw rows) gives the same result", () => {
    const p = normalizePlayer(load("megatake"));
    const again = normalizePlayer({ ...p, rows: p.rawRows, curve: p.rawCurve });
    assert.equal(again.farm.kills, p.farm.kills);
    assert.equal(again.rows.length, p.rows.length);
  });

  it("altered but under the padding line: † mark + 'adjusted' review flag in 📉 Chart anomalies, not 🚩 (MathoMesa)", () => {
    const m = metricsOf("mathomesa");
    assert.ok(m.farm.victims.length > 0 && m.farm.share < PADDING_RULE.FLAG_SHARE);
    const mk = statMark(m.farm);
    assert.equal(mk.kind, "adjusted");
    assert.equal(mk.mark, ADJUSTED_MARK);
    assert.match(mk.tip, /stats adjusted: \d+ kills on farm accounts excluded \(under review\)/);
    const f = reviewFlags(m);
    assert.deepEqual(f.patterns, ["adjusted"]);
    assert.equal(f.red, false);
    assert.equal(f.anomaly, true);
    const row = rankRow(load("mathomesa"), { slug: "mathomesa" });
    assert.equal(row[RANK_COLS.indexOf("mark")], "adjusted");
  });

  it("every player with any exclusion is marked and flagged; nobody else is", () => {
    const index = JSON.parse(fs.readFileSync(path.join(root, "data", "index.json"), "utf8"));
    const seen = new Set();
    let altered = 0;
    for (const e of index.players) {
      if (seen.has(e.file)) continue;
      seen.add(e.file);
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(root, "data", e.file), "utf8")); } catch { continue; }
      const m = playerMetrics(normalizePlayer(raw));
      const has = m.farm.victims.length > 0;
      const mk = statMark(m.farm);
      const pats = reviewFlags(m).patterns;
      assert.equal(!!mk.mark, has, e.slug);
      assert.equal(pats.includes("padding") || pats.includes("adjusted"), has, e.slug);
      assert.ok(!(pats.includes("padding") && pats.includes("adjusted")), e.slug);
      if (has) altered += 1;
    }
    assert.ok(altered >= 20, `altered ${altered}`);
  });

  it("reviewed.json scaffold: valid shape, decisions read back", () => {
    const rv = JSON.parse(fs.readFileSync(path.join(root, "data", "reviewed.json"), "utf8"));
    assert.equal(typeof rv.players, "object");
    for (const [slug, e] of Object.entries(rv.players)) assert.ok(REVIEW_DECISIONS.includes(e.decision), slug);
    const fake = { players: { a: { decision: "fluke", note: "one-off", at: "2026-10-09" }, b: { decision: "nope" } } };
    assert.deepEqual(reviewDecision(fake, "a"), { decision: "fluke", note: "one-off", at: "2026-10-09" });
    assert.equal(reviewDecision(fake, "b"), null);
    assert.equal(reviewDecision(null, "a"), null);
  });
});
