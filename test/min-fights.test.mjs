import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePlayer,
  playerMetrics,
  MIN_FIGHTS,
  MIN_FIGHTS_TIP,
  enoughFights,
  THIN_METRICS,
  shownValue,
} from "../player-metrics.mjs";
import { reviewFlags, rampageFlag } from "../red-flags.mjs";
import { sprout, sampleEvents } from "../sprouts.mjs";
import { rankRow, RANK_COLS } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (slug) => JSON.parse(fs.readFileSync(path.join(root, "data", "players", `${slug}.json`), "utf8"));
const metricsOf = (raw) => playerMetrics(normalizePlayer(raw));
const col = (id) => RANK_COLS.indexOf(id);

describe("minimum fights for opponent-sample metrics (🏃 Activity, 🦁 Brave, ⚔️ iVi, …)", () => {
  it("blanks every opponent-sample metric, never public Census ones", () => {
    assert.deepEqual([...THIN_METRICS].sort(), ["act", "adj", "adjs", "coi", "inflation", "mech", "pvs", "rf", "rkd", "slope"]);
    for (const id of ["kd", "kpm", "ownKpm", "acc", "hsr", "ivi", "ekpm", "own"]) assert.ok(!THIN_METRICS.includes(id), id);
  });

  it("one shared threshold: 100 kills and 5 deaths", () => {
    assert.equal(MIN_FIGHTS.KILLS, 100);
    assert.equal(MIN_FIGHTS.DEATHS, 5);
    assert.ok(Object.isFrozen(MIN_FIGHTS));
    assert.match(MIN_FIGHTS_TIP, /Too few fights to measure/);
    assert.match(MIN_FIGHTS_TIP, /100\+ kills/);
  });

  it("enoughFights boundaries", () => {
    assert.equal(enoughFights(100, 5), true);
    assert.equal(enoughFights(99, 500), false);
    assert.equal(enoughFights(5000, 4), false);
    assert.equal(enoughFights(0, 0), false);
    assert.equal(enoughFights(undefined, undefined), false);
  });

  it("synthetic tiny sample: raw kept, shown values blank", () => {
    const p = normalizePlayer({
      display: "Tiny",
      own_kpm: 4,
      global_kd: 30,
      global_kpm: 4,
      rows: [
        { name: "a", kills: 40, deaths: 1, kpm: 1.2 },
        { name: "b", kills: 35, deaths: 1, kpm: 0.9 },
      ],
    });
    const m = playerMetrics(p);
    assert.equal(m.sampleKills, 75);
    assert.equal(m.sampleDeaths, 2);
    assert.equal(m.thin, true);
    assert.ok(Number.isFinite(m.act) && m.act > 50, "raw Activity kept");
    for (const id of THIN_METRICS) assert.ok(Number.isNaN(shownValue(m, id)), id);
    assert.equal(shownValue(m, "kd"), 30, "public KD untouched");
  });

  it("Add1ti0nal: Brave/Activity blank on display, still 🚩 rampage", () => {
    const m = metricsOf(load("add1ti0nal"));
    assert.equal(m.thin, true);
    for (const id of THIN_METRICS) assert.ok(Number.isNaN(shownValue(m, id)), id);
    assert.ok(m.pvs > 1000, "raw Brave unchanged for build-log");
    const f = reviewFlags(m);
    assert.equal(f.flagged, true);
    assert.ok(f.patterns.includes("rampage"));
    assert.equal(rampageFlag(m).flagged, true);
  });

  it("1-death accounts with 100+ kills are blanked too (geiloVS)", () => {
    const m = metricsOf(load("geilovs"));
    assert.ok(m.sampleKills >= 100 && m.sampleDeaths < 5);
    assert.equal(m.thin, true);
    assert.ok(Number.isNaN(shownValue(m, "act")));
    assert.ok(Number.isNaN(shownValue(m, "adjs")));
  });

  it("normal players are unchanged (YEEZY, ShloDog)", () => {
    for (const slug of ["yeezy", "shlodog"]) {
      const m = metricsOf(load(slug));
      assert.equal(m.thin, false, slug);
      for (const id of THIN_METRICS) assert.equal(shownValue(m, id), m[id], `${slug} ${id}`);
    }
  });

  it("red flags and sprouts read the raw values (same result as before)", () => {
    for (const slug of ["add1ti0nal", "1stfanofahorn", "cheetler", "geilovs", "yeezy"]) {
      const m = metricsOf(load(slug));
      const raw = { ...m, pvs: m.pvs, act: m.act };
      assert.deepEqual(reviewFlags(m), reviewFlags(raw), slug);
      const np = normalizePlayer(load(slug));
      assert.deepEqual(sprout(m, sampleEvents(np.rows)), sprout(raw, sampleEvents(np.rows)), slug);
    }
  });

  it("ranks.json rows: act/pvs null + thin=1 below the minimum", () => {
    const tiny = rankRow(load("add1ti0nal"), { slug: "add1ti0nal" });
    assert.equal(tiny[col("act")], null);
    assert.equal(tiny[col("pvs")], null);
    assert.equal(tiny[col("thin")], 1);
    assert.equal(tiny[col("adjs")], null, "⚔️ iVi blank too");
    assert.equal(tiny[col("rkd")], null);
    assert.ok(typeof tiny[col("kd")] === "number", "public KD kept");
    const ok = rankRow(load("yeezy"), { slug: "yeezy" });
    assert.equal(ok[col("thin")], 0);
    assert.ok(typeof ok[col("pvs")] === "number" && ok[col("pvs")] > 0);
  });
});
