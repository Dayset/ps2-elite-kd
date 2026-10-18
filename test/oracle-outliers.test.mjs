// Outlier report from Honu alert participants + live faction KD parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outlierReport, liveKd, OUTLIER_RULE } from "../oracle-worker/src/outliers.js";

const entry = (id, kills, deaths, minutes) => ({ characterID: id, kills, deaths, secondsOnline: minutes * 60 });
const char = (id, name, factionID, outfitTag = null) => ({ id, name, factionID, outfitTag });

test("flags KD>=5 & KPM>=2 as early, KPM>=3 as confirmed, above the sample floor", () => {
  const rep = outlierReport({
    entries: [
      entry("1", 300, 20, 90),  // KD 15, KPM 3.33 -> confirmed
      entry("2", 120, 20, 50),  // KD 6, KPM 2.4 -> early
      entry("3", 60, 20, 20),   // KD 3 -> no
      entry("4", 24, 0, 8),     // under floor (8 min, 24 kills) -> no
      entry("5", 200, 39, 60),  // KD 5.13, KPM 3.33 -> confirmed
      entry("6", 50, 50, 60),
    ],
    characters: [char("1", "Ace", 1, "TAG"), char("2", "Bee", 2), char("3", "Cee", 3), char("4", "Dee", 1), char("5", "Eff", 4), char("6", "Gee", 3)],
  });
  assert.equal(rep.players, 6);
  assert.equal(rep.flagged, 3);
  assert.equal(rep.confirmed, 2);
  assert.deepEqual(rep.outliers.map((o) => [o.name, o.severity]), [["Ace", "confirmed"], ["Eff", "confirmed"], ["Bee", "early"]]);
  assert.equal(rep.outliers[0].outfit, "TAG");
  assert.equal(rep.outliers[1].faction, "NSO");
  assert.deepEqual(rep.faction.VS, { kills: 324, deaths: 20, players: 2, kd: 16.2 });
  assert.equal(rep.faction.TR.kd, 1.57);
});

test("sample floor is part of the rule", () => {
  assert.equal(OUTLIER_RULE.MIN_MINUTES, 10);
  assert.equal(OUTLIER_RULE.MIN_KILLS, 25);
});

test("live KD from Honu realtime-alert mini list", () => {
  const list = [{ worldID: 1, zoneID: (5 << 16) | 4, vs: { kills: 300, deaths: 200 }, nc: { kills: 200, deaths: 250 }, tr: { kills: 100, deaths: 150 } }];
  assert.deepEqual(liveKd(list, 1, 4), { VS: 1.5, NC: 0.8, TR: 0.667 });
  assert.equal(liveKd(list, 10, 4), null);
  assert.equal(liveKd([{ worldID: 1, zoneID: 4, vs: { kills: 1, deaths: 0 }, nc: { kills: 1, deaths: 1 }, tr: { kills: 1, deaths: 1 } }], 1, 4), null);
  assert.equal(liveKd(null, 1, 4), null);
});
