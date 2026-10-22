// PlayStation scrim rule (padding.mjs PS_SCRIM, owner 2026-10-22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRoomRule, isScrimRoom, chopScrims, statMark, isFarmVictim, PS_SCRIM, PADDING_RULE } from "../padding.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";
import { paddingFlag } from "../red-flags.mjs";

const rows = [
  { name: "Partner", kills: 7735, deaths: 0, kpm: 1.0 }, // one-sided, main account (real KPM)
  { name: "Scrim", kills: 4069, deaths: 99, kpm: 0.38 }, // long scrim, 2.4% back
  { name: "Rival", kills: 241, deaths: 52, kpm: 0.64 }, // big live rivalry
  ...Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, kills: 30, deaths: 12, kpm: 0.3 + i * 0.05 })),
];

test("chopScrims caps long scrims at CAP kills, K/D at KD_MAX; small rows untouched", () => {
  const { rows: out, scrims } = chopScrims(rows.slice(1));
  assert.equal(out[0].kills, PS_SCRIM.CAP);
  assert.equal(out[0].deaths, PS_SCRIM.CAP / PS_SCRIM.KD_MAX); // 4069:99 → 80:10
  assert.equal(out[1].kills, 80);
  assert.ok(Math.abs(out[1].deaths - 52 * (80 / 241)) < 1e-9); // K/D kept (4.6 < 8)
  assert.equal(out[2], rows[3]);
  assert.deepEqual(scrims.map((s) => s.name), ["Scrim", "Rival"]);
});

test("PS room: one-sided partner out, scrims capped, only the neutral † mark", () => {
  setRoomRule("ps");
  try {
    assert.equal(isScrimRoom(), true);
    assert.equal(isFarmVictim(rows[0]), true); // KPM 1.0 doesn't save a 0-death partner on PS
    const p = normalizePlayer({ player: { display: "Hkn", own_kpm: 1.2, ivi: 400, rows } });
    assert.deepEqual(p.farm.victims.map((v) => v.name), ["Partner"]);
    assert.deepEqual(p.farm.scrims.map((s) => s.name), ["Scrim", "Rival"]);
    assert.equal(p.rows.reduce((s, r) => s + r.kills, 0), 80 + 80 + 600);
    assert.equal(p.rawRows.length, rows.length);
    const mark = statMark(p.farm);
    assert.equal(mark.kind, "adjusted");
    assert.match(mark.tip, /Partner 7735\/0/);
    assert.match(mark.tip, /Scrim 4069\/99/);
    assert.doesNotMatch(mark.tip, /Rival/); // K/D kept (4.6), only down-weighted: not named
    const rivalOnly = normalizePlayer({ player: { display: "K", rows: rows.slice(2) } });
    assert.equal(rivalOnly.farm.scrims.length, 1);
    assert.equal(statMark(rivalOnly.farm).kind, "");
    const m = playerMetrics(p);
    assert.equal(paddingFlag(m).flagged, false);
    assert.ok(m.m.rkd < 3, `sample K/D ${m.m.rkd}`);
  } finally {
    setRoomRule("pc");
  }
});

test("PC rule is restored and unchanged", () => {
  assert.equal(isScrimRoom(), false);
  assert.equal(PADDING_RULE.MIN_KILLS, 100);
  assert.equal(PADDING_RULE.MAX_KPM, 0.1);
  assert.equal(isFarmVictim(rows[0]), false); // real KPM on PC → not a farm account
  const p = normalizePlayer({ player: { display: "X", rows } });
  assert.deepEqual(p.farm.scrims, []);
  assert.equal(p.rows.length, rows.length);
});
