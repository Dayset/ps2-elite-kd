import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metricBounds, findOutliers, guardStatus, GUARD_RULE, KNOWN_EXTREMES } from "../outlier-guard.mjs";
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
