import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";
import { bareName, rankRow, buildRanks, METRIC_COLS, RANK_COLS } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

describe("build-ranks", () => {
  it("strips outfit tags for the query / ?names= name", () => {
    assert.equal(bareName("[RITE] ShloDog"), "ShloDog");
    assert.equal(bareName("cheetler"), "cheetler");
    assert.equal(bareName("  [9753] coldandhot "), "coldandhot");
  });

  it("rankRow matches playerMetrics for every metric column (same code path)", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "brackiense.json"), "utf8"));
    const m = playerMetrics(normalizePlayer(raw));
    const row = rankRow(raw, { slug: "brackiense", savedAt: raw.savedAt });
    assert.ok(row);
    assert.equal(row.length, RANK_COLS.length);
    assert.equal(row[0], "BrackieNSE");
    assert.equal(row[1], "BrackieNSE");
    assert.equal(row[2], "brackiense");
    for (let i = 0; i < METRIC_COLS.length; i++) {
      const id = METRIC_COLS[i];
      const got = row[4 + i];
      const want = m[id];
      if (want == null || !Number.isFinite(want)) {
        assert.equal(got, null, id);
      } else {
        assert.ok(Math.abs(got - want) < 1e-6, `${id}: ${got} vs ${want}`);
      }
    }
    // ⚔️ iVi below zero floors to 0 on the page; the stored value stays raw.
    assert.ok(typeof row[4] === "number");
  });

  it("buildRanks reads the shared cache and lists every usable player once", () => {
    const out = buildRanks(dataDir);
    assert.equal(out.cols.join(","), RANK_COLS.join(","));
    assert.ok(out.count >= 1000, `expected ≥1000, got ${out.count}`);
    assert.equal(out.rows.length, out.count);
    assert.ok(out.updatedAt);
    const names = new Set(out.rows.map((r) => r[2])); // slug
    assert.equal(names.size, out.count);
    // Known players present with sane ⚔️ iVi
    const shlo = out.rows.find((r) => r[2] === "shlodog");
    assert.ok(shlo, "shlodog in ranks");
    assert.equal(shlo[1], "ShloDog");
    assert.ok(typeof shlo[4] === "number" && shlo[4] > 0);
  });
});

import { mergeFreshRows } from "../rank-row.mjs";
describe("Rankings use this browser's fresher copy (t338u)", () => {
  it("recomputes only players whose browser copy is newer; others stay shared", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "brackiense.json"), "utf8"));
    const old = rankRow(raw, { slug: "brackiense", savedAt: 1000 });
    const other = old.slice(); other[0] = "Other"; other[1] = "Other"; other[2] = "other";
    const payload = { cols: RANK_COLS.slice(), rows: [old, other] };
    const p = raw.player || raw;
    const tweaked = { ...p, global_kd: (+p.global_kd || 1) * 2 };
    const now = Date.now();
    const store = { brackiense: { name: "BrackieNSE", savedAt: now, fetchedAt: now, player: tweaked } };
    const { rows, fresh } = mergeFreshRows(payload, store, { now });
    assert.equal(fresh.get("brackiense"), now);
    assert.equal(fresh.size, 1);
    assert.equal(rows[1], other);
    assert.equal(rows[0][3], now);
    const kd = RANK_COLS.indexOf("kd");
    assert.ok(Math.abs(rows[0][kd] - old[kd] * 2) < 1e-3 * Math.max(1, old[kd]));
    // Older browser copy → shared row kept.
    const stale = { brackiense: { name: "BrackieNSE", savedAt: now, fetchedAt: 500, player: tweaked } };
    const r2 = mergeFreshRows(payload, stale, { now });
    assert.equal(r2.fresh.size, 0);
    assert.equal(r2.rows[0], old);
  });
});
