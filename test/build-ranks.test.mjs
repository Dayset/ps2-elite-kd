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
