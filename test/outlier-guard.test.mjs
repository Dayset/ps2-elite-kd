import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metricBounds, findOutliers, guardStatus, groupOutliers, GUARD_RULE, KNOWN_EXTREMES, METRIC_LABELS } from "../outlier-guard.mjs";
import { buildRanksWithGuard, METRIC_COLS } from "../scripts/build-ranks.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

/** 200 ordinary players with values spread around 2, plus extras. */
function population(extra = []) {
  const ps = [];
  for (let i = 0; i < 200; i++) ps.push({ slug: "p" + i, name: "P" + i, flagged: false, values: { pvs: 1 + (i % 20) * 0.1 } });
  return ps.concat(extra);
}

describe("outlier guard", () => {
  it("metricBounds: robust centre and spread, needs MIN_N values", () => {
    const b = metricBounds(population().map((p) => p.values.pvs));
    assert.ok(b.ok);
    assert.ok(b.median > 1.8 && b.median < 2.1);
    assert.ok(b.hi > b.p99 && b.lo < b.p01);
    assert.equal(metricBounds([1, 2, 3]).ok, false);
    assert.equal(metricBounds([null, NaN, undefined]).n, 0);
  });

  it("catches a planted Brave 6094 (the add1ti0nal gap) as unexplained", () => {
    const r = findOutliers(population([{ slug: "tiny", name: "Tiny", flagged: false, values: { pvs: 6094 } }]), ["pvs"], { known: {} });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].slug, "tiny");
    assert.equal(r.items[0].side, "high");
    assert.equal(r.items[0].explained, false);
  });

  it("ignores blanked (null) values, mild extremes and explains 🚩 / reviewed players", () => {
    const r = findOutliers(population([
      { slug: "blank", name: "Blank", flagged: false, values: { pvs: null } },
      { slug: "mild", name: "Mild", flagged: false, values: { pvs: 3.5 } },
      { slug: "cheat", name: "Cheat", flagged: true, patterns: ["rampage"], values: { pvs: 900 } },
      { slug: "known", name: "Known", flagged: false, values: { pvs: 500 } },
    ]), ["pvs"], { known: { known: "reviewed" } });
    assert.deepEqual(r.items.map((o) => o.slug).sort(), ["cheat", "known"]);
    assert.ok(r.items.every((o) => o.explained));
    const st = guardStatus(r);
    assert.equal(st.unexplained, 0);
    assert.equal(st.explained, 2);
    assert.match(st.rule, new RegExp(`±${GUARD_RULE.Z}`));
  });

  it("groups hits by player: one row each, all metrics inline, sorted unexplained first then by count; counts are players", () => {
    const pop = [];
    for (let i = 0; i < 200; i++) pop.push({ slug: "p" + i, name: "P" + i, flagged: false, values: { kd: 1 + (i % 20) * 0.1, act: 2 + (i % 20) * 0.1, kpm: 1 + (i % 20) * 0.05 } });
    pop.push({ slug: "multi", name: "Multi", flagged: true, patterns: ["rampage"], values: { kd: 90, act: 300, kpm: 40 } });
    pop.push({ slug: "two", name: "Two", flagged: false, values: { kd: 80, act: 250, kpm: 1 } });
    pop.push({ slug: "adj", name: "Adj", flagged: true, patterns: ["adjusted"], values: { kd: 70, act: 2, kpm: 1 } });
    const r = findOutliers(pop, ["kd", "act", "kpm"], { known: {} });
    assert.equal(r.items.length, 6);
    const g = groupOutliers(r.items);
    assert.deepEqual(g.map((p) => [p.slug, p.metrics.length, p.explained]), [["two", 2, false], ["multi", 3, true], ["adj", 1, true]]);
    assert.match(g[1].reason, /🚩 red flags \(rampage\)/);
    assert.match(g[2].reason, /📉 chart anomalies/);
    assert.ok(!/🚩/.test(g[2].reason));
    assert.equal(g[1].metrics[0].label, METRIC_LABELS[g[1].metrics[0].id]);
    const st = guardStatus(r);
    assert.equal(st.items.length, 6); // per-hit list kept for older readers
    assert.equal(st.unexplained, 2);
    assert.equal(st.players.length, 3);
    assert.equal(st.playersUnexplained, 1);
    assert.equal(st.playersExplained, 2);
    // Reader fallback on an old status.json (items only) gives the same grouping.
    assert.deepEqual(groupOutliers(st.items).map((p) => p.slug), st.players.map((p) => p.slug));
  });

  it("every ranks metric has a label", () => {
    for (const id of METRIC_COLS) assert.ok(METRIC_LABELS[id], id);
  });

  it("would have caught the old raw values in the cache (before MIN_FIGHTS)", () => {
    const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
    const players = [];
    for (const e of index.players) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8")); } catch { continue; }
      const m = playerMetrics(normalizePlayer(raw));
      players.push({ slug: e.slug, name: e.name, flagged: false, values: { pvs: m.pvs, act: m.act } });
    }
    const r = findOutliers(players, ["pvs", "act"], { known: {} });
    assert.ok(r.items.some((o) => o.slug === "add1ti0nal" && o.id === "pvs"), "raw Brave 6094 is caught");
  });

  it("current cache: no UNEXPLAINED outliers in any ranks.html metric (review + KNOWN_EXTREMES if this fails)", () => {
    const { guard } = buildRanksWithGuard(dataDir);
    const bad = guard.items.filter((o) => !o.explained).map((o) => `${o.name} ${o.id}=${o.value} (bound ${o.bound}, z ${o.z})`);
    assert.deepEqual(bad, []);
    // Every ranks metric is checked.
    assert.ok(METRIC_COLS.length >= 18);
    for (const slug of Object.keys(KNOWN_EXTREMES)) assert.match(slug, /^[a-z0-9]+$/);
  });
});
