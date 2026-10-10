import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isFarmVictim, isNotFarm, splitFarm, statMark, setNotFarm, reviewDecision } from "../padding.mjs";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

const allow = JSON.parse(fs.readFileSync(new URL("../data/not-farm.json", import.meta.url), "utf8"));

test("data/not-farm.json lists Dziey with reason + date", () => {
  const e = allow.players.dziey;
  assert.ok(e && e.reason && /^\d{4}-\d{2}-\d{2}$/.test(e.at));
});

test("allowlisted real player is never a farm victim (tag / case / cid)", () => {
  setNotFarm(allow);
  const row = { name: "[iL0V] Dziey", kills: 113, deaths: 2, kpm: 0.046 };
  assert.equal(isNotFarm(row), true);
  assert.equal(isNotFarm({ name: "DZIEY" }), true);
  assert.equal(isNotFarm({ name: "renamed", cid: "5428451988636165425" }), true);
  assert.equal(isFarmVictim(row), false);
  assert.equal(isFarmVictim({ name: "vulcan112", kills: 300, deaths: 0, kpm: 0 }), true);
  const f = splitFarm([row, { name: "x", kills: 50, deaths: 40, kpm: 1 }]);
  assert.equal(f.victims.length, 0);
  assert.equal(statMark(f).kind, "");
});

test("without the allowlist the same row would be a farm victim", () => {
  setNotFarm(null);
  assert.equal(isFarmVictim({ name: "[iL0V] Dziey", kills: 113, deaths: 2, kpm: 0.046 }), true);
  setNotFarm(allow);
});

test("Faelswoop: Dziey kills count again, no † mark, reviewed bad-luck", () => {
  setNotFarm(allow);
  const raw = JSON.parse(fs.readFileSync(new URL("../data/players/faelswoop.json", import.meta.url), "utf8"));
  const p = normalizePlayer(raw);
  assert.ok(p.rows.some((r) => /Dziey/.test(r.name)));
  const m = playerMetrics(p);
  assert.equal(statMark(m.farm).kind, "");
  const reviewed = JSON.parse(fs.readFileSync(new URL("../data/reviewed.json", import.meta.url), "utf8"));
  const r = reviewDecision(reviewed, "faelswoop");
  assert.equal(r.decision, "bad-luck");
  assert.equal(r.note, "Dziey is a real player");
});
