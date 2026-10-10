// t323u: confirmed cheaters (data/hidden.json "confirmed cheater …") never appear in the
// 🧪 outlier guard / 📉 chart anomalies; they still count toward the population bounds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOutliers } from "../outlier-guard.mjs";
import { isConfirmedCheater, hiddenList } from "../hidden.mjs";
import { buildRanksWithGuard } from "../scripts/build-ranks.mjs";

const dataDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "data");

describe("📉 outlier guard omits confirmed cheaters", () => {
  it("isConfirmedCheater reads the hide-list reason", () => {
    assert.ok(isConfirmedCheater({ reason: "confirmed cheater (rampage) — kept for comparison only" }));
    assert.ok(!isConfirmedCheater({ reason: "streamer asked to be left out" }));
    assert.ok(!isConfirmedCheater(null));
  });

  it("a confirmed cheater shapes the bounds but is not an item", () => {
    const players = Array.from({ length: 300 }, (_, i) => ({ slug: "p" + i, name: "p" + i, values: { x: 1 + (i % 10) * 0.1 } }));
    players.push({ slug: "cheat", name: "cheat", confirmedCheater: true, values: { x: 500 } });
    players.push({ slug: "odd", name: "odd", values: { x: 400 } });
    const r = findOutliers(players, ["x"], { known: {} });
    assert.ok(r.items.some((o) => o.slug === "odd"));
    assert.ok(!r.items.some((o) => o.slug === "cheat"));
    assert.equal(r.bounds.x.max, 500);
  });

  it("real cache: no hide-list confirmed cheater in status outlier rows", () => {
    const h = hiddenList(JSON.parse(fs.readFileSync(path.join(dataDir, "hidden.json"), "utf8")));
    const { guard } = buildRanksWithGuard(dataDir);
    for (const p of guard.players) assert.ok(!isConfirmedCheater(h.match({ slug: p.slug, name: p.name })), p.name);
    for (const o of guard.items) assert.ok(!isConfirmedCheater(h.match({ slug: o.slug, name: o.name })), o.name);
  });
});
