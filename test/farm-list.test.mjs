// data/farm.json (t322u): owner-confirmed bot / farm accounts are always farm victims,
// whatever the automatic thresholds; not-farm.json still wins; listed bots stay out of ranks.json.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFarmVictim, isFarmListed, farmListEntry, splitFarm, setFarmList, setNotFarm } from "../padding.mjs";
import { buildRanks } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const farmJson = JSON.parse(fs.readFileSync(path.join(dataDir, "farm.json"), "utf8"));
const notFarmJson = JSON.parse(fs.readFileSync(path.join(dataDir, "not-farm.json"), "utf8"));

describe("🤖 confirmed farm list (data/farm.json)", () => {
  it("KKLKK is listed, by name (outfit tag ignored) and by cid", () => {
    assert.ok(isFarmListed({ name: "[LHEU] KKLKK" }));
    assert.ok(isFarmListed({ name: "kklkk" }));
    assert.ok(isFarmListed({ name: "renamed", cid: "5429835220927330401" }));
    assert.equal(farmListEntry({ name: "KKLKK" }).reason, "confirmed bot/farm account (owner review)");
    assert.ok(!isFarmListed({ name: "JinpingX" }));
  });

  it("a listed account is a farm victim even below every automatic threshold", () => {
    const row = { name: "[LHEU] KKLKK", kills: 12, deaths: 5, kpm: 1.5 };
    assert.ok(isFarmVictim(row));
    const s = splitFarm([row, { name: "Real", kills: 30, deaths: 20, kpm: 1 }]);
    assert.equal(s.kills, 12);
    assert.equal(s.kept.length, 1);
  });

  it("not-farm.json wins over farm.json; clearing the list restores the automatic rule", () => {
    try {
      setFarmList({ players: { dziey: { reason: "test" }, foo: {} } });
      assert.ok(!isFarmVictim({ name: "[iL0V] Dziey", kills: 500, deaths: 0, kpm: 0 }));
      assert.ok(isFarmVictim({ name: "foo", kills: 1, deaths: 1, kpm: 2 }));
      setFarmList(null);
      assert.ok(!isFarmVictim({ name: "[LHEU] KKLKK", kills: 12, deaths: 5, kpm: 1.5 }));
    } finally {
      setFarmList(farmJson);
      setNotFarm(notFarmJson);
    }
  });

  it("real cache: KKLKK is not ranked; JinpingX is a confirmed padder with KKLKK excluded", () => {
    const r = buildRanks(dataDir);
    const slug = r.cols.indexOf("slug");
    assert.ok(!r.rows.some((x) => x[slug] === "kklkk"));
    const j = r.rows.find((x) => x[slug] === "jinpingx");
    if (!j) return; // not cached yet
    assert.equal(j[r.cols.indexOf("mark")], "padding");
    assert.match(String(j[r.cols.indexOf("farm")]), /KKLKK/);
  });
});
