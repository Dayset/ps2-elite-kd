// Outlier report from Honu alert participants + live faction KD parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outlierReport, OUTLIER_RULE } from "../oracle-worker/src/outliers.js";

const entry = (id, kills, deaths, minutes) => ({ characterID: id, kills, deaths, secondsOnline: minutes * 60 });
const char = (id, name, factionID, outfitTag = null) => ({ id, name, factionID, outfitTag });

test("flags KD>=6 & KPM>=3 as early, KPM>=4 as confirmed, above the sample floor", () => {
  const rep = outlierReport({
    entries: [
      entry("1", 300, 20, 90),  // KD 15, KPM 3.33 -> early
      entry("2", 240, 20, 50),  // KD 12, KPM 4.8 -> confirmed
      entry("3", 60, 20, 20),   // KD 3 -> no
      entry("4", 24, 0, 8),     // under floor (8 min, 24 kills) -> no
      entry("5", 200, 39, 60),  // KD 5.13 < 6 -> no (KD bar)
      entry("6", 50, 50, 60),   // KD 1 -> no
      entry("7", 150, 25, 60),  // KD 6, KPM 2.5 < 3 -> no (KPM bar)
    ],
    characters: [char("1", "Ace", 1, "TAG"), char("2", "Bee", 2), char("3", "Cee", 3), char("4", "Dee", 1), char("5", "Eff", 4), char("6", "Gee", 3), char("7", "Heh", 2)],
  });
  assert.equal(rep.players, 7);
  assert.equal(rep.flagged, 2);
  assert.equal(rep.confirmed, 1);
  assert.deepEqual(rep.outliers.map((o) => [o.name, o.severity]), [["Bee", "confirmed"], ["Ace", "early"]]);
  assert.equal(rep.outliers[1].outfit, "TAG");
  assert.equal(rep.outliers[1].faction, "VS");
  assert.deepEqual(rep.faction.VS, { kills: 324, deaths: 20, players: 2, kd: 16.2 });
  assert.equal(rep.faction.TR.kd, 1.57);
});

test("sample floor is part of the rule", () => {
  assert.equal(OUTLIER_RULE.MIN_MINUTES, 10);
  assert.equal(OUTLIER_RULE.MIN_KILLS, 25);
});


test("burst tier (#21): short blatant sessions are ☠️, a short spawn camp is not", () => {
  const rep = outlierReport({
    entries: [
      entry("1", 25, 1, 4),       // KPM 6.25 in ~4 min -> burst
      entry("2", 154, 30, 7.8),   // KPM 19.7 in 7.8 min -> burst
      entry("3", 8, 0, 3),        // 3-min 8-kill spawn camp -> no
      entry("4", 14, 0, 2),       // KPM 7 but < 15 kills -> no
      entry("5", 20, 0, 1.5),     // < 2 min -> no
      entry("6", 360, 20, 90),    // KD 18, KPM 4 -> normal confirmed tier kept
    ],
    characters: [char("1", "Quick", 1), char("2", "Storm", 2), char("3", "Camp", 3), char("6", "Ace", 1)],
  });
  assert.equal(OUTLIER_RULE.BURST_KPM, 5);
  assert.equal(OUTLIER_RULE.BURST_KILLS, 15);
  assert.equal(OUTLIER_RULE.BURST_MIN_MINUTES, 2);
  const sev = Object.fromEntries(rep.outliers.map((o) => [o.name, o.severity]));
  assert.deepEqual(sev, { Storm: "burst", Quick: "burst", Ace: "confirmed" });
  assert.equal(rep.flagged, 3);
  assert.equal(rep.confirmed, 3);
  assert.equal(rep.burst, 2);
  assert.equal(rep.outliers.find((o) => o.name === "Storm").minutes, 7.8);
});

test("vouched players (owner: legit top-level) are never flagged, on any faction", async () => {
  const { isVouched } = await import("../oracle-worker/src/outliers.js");
  const e = (id) => ({ characterID: id, kills: 398, deaths: 1, secondsOnline: 88 * 60 });
  const rep = outlierReport({
    entries: [e("1"), e("2"), e("3"), e("4")],
    characters: [{ id: "1", name: "Fantom220TR", factionID: 3 }, { id: "2", name: "Fantom220NC", factionID: 2 },
      { id: "3", name: "PurityNC", factionID: 2 }, { id: "4", name: "Bauminator45", factionID: 3 }],
  });
  assert.deepEqual(rep.outliers.map((o) => o.name), ["Bauminator45"]);
  assert.equal(rep.flagged, 1);
  assert.equal(rep.players, 4, "still counted as players");
  assert.ok(isVouched("fantom220vs") && !isVouched("Fantom2201") && !isVouched(null));
});
