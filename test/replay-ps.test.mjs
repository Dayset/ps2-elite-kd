// 🎬 #111 PS replay page (node): namesake keys stay apart, scrim mode is
// a two-fighter cast with a short post-respawn approach, and a ?room=ps
// page never fetches the PC tree or the PC Worker namespace.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shardOf } from "../replay/shard.mjs";
import { psKey } from "../rooms.mjs";
import { planScrim, topScrimPartner } from "../replay/scrim-plan.mjs";
import { planDuel } from "../replay/duel-plan.mjs";
import { shooter } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";
import { scoreAt } from "../replay/duel-scene.mjs";

const A = shooter(toProfile(FALLBACK["Assault Rifle"]), { kd: 1, spk: 39.5, hpk: 10.4, hsr: 0.18 });
const B = shooter(toProfile(FALLBACK["Assault Rifle"]), { kd: 1, spk: 39.5, hpk: 10.4, hsr: 0.18 });
const info = { kpm: 1, classShares: {}, revivedShare: 0.3, resupplyPm: 0 };

test("namesake keys: same cid on two servers is two identities, two shards", () => {
  const eu = psKey("eu", "5428352936459348305"), us = psKey("us", "5428352936459348305");
  assert.notEqual(eu, us, "the server prefix is part of the key, so namesakes never share a shard entry");
  assert.notEqual(shardOf(eu), shardOf(us), "sharding uses the full key, not the name");
});

test("top scrim partner: volume wins, ties go to more deaths, empty is null", () => {
  const rows = [
    { t0: 1, o: [["eu-1", "A", 3, 7]] },
    { t0: 2, o: [["eu-2", "B", 5, 5], ["eu-3", "C", 1, 1]] },
    { t0: 3, o: [["eu-1", "A", 4, 4]] },
  ];
  assert.deepEqual(topScrimPartner(rows), { key: "eu-1", name: "A", kills: 7, deaths: 11 });
  assert.deepEqual(topScrimPartner([{ t0: 1, o: [["eu-2", "B", 5, 5]] }, { t0: 2, o: [["eu-3", "C", 4, 6]] }]),
    { key: "eu-3", name: "C", kills: 4, deaths: 6 }, "10–10 tie goes to more deaths");
  assert.equal(topScrimPartner([]), null);
  assert.equal(topScrimPartner(null), null);
});

test("scrim cast: two fighters only, no third parties, exact row score", () => {
  const { plan, exact } = planScrim(A, B, { seed: 12345, durationSec: 745, k: 3, d: 7, model: null, aInfo: info, bInfo: info });
  assert.equal(exact, true);
  assert.deepEqual(scoreAt(plan, Infinity), { a: 3, b: 7 });
  assert.ok(plan.engagements.every((e) => e.outcome === "a" || e.outcome === "b" || e.outcome === "break"),
    "a scrim has no third-party outcomes");
  assert.equal(plan.duration, 745, "the plan is rescaled to the row window, so its rate is the row's rate");
});

test("short approach after a respawn: capped at 2 s in scrim plans", () => {
  const plan = planDuel(A, B, { seed: 12345, durationSec: 495, pA: 0.3, model: null, aInfo: info, bInfo: info, shortApproach: true });
  const post = plan.engagements.filter((e) => e.respawnSide);
  assert.ok(post.length > 0, "the fixture plan has post-respawn engagements to cap");
  for (const e of post) {
    const appr = e.segments[0].t1 - e.segments[0].t0;
    assert.ok(appr <= 2 + 1e-9, `post-respawn approach is ${appr}, over the 2 s cap`);
  }
  const uncapped = planDuel(A, B, { seed: 12345, durationSec: 495, pA: 0.3, model: null, aInfo: info, bInfo: info });
  const maxUncapped = Math.max(...uncapped.engagements.filter((e) => e.respawnSide).map((e) => e.segments[0].t1 - e.segments[0].t0));
  assert.ok(maxUncapped > 2, `the cap bites: uncapped max post-respawn approach is ${maxUncapped}`);
});

test("no PC fetch in ?room=ps: every data fetch goes through dataDir", () => {
  const src = fs.readFileSync(new URL("../replay/player.js", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/getJson\(`\.\.\/data\//.test(code) && !/getJson\('\.\.\/data\//.test(code),
    "no hardcoded ../data/ fetch survives: the room picks the tree");
  const dataDirFetches = (code.match(/getJson\(`\$\{dataDir\}\//g) || []).length;
  assert.ok(dataDirFetches >= 7, `expected all data fetches via dataDir, found ${dataDirFetches}`);
  const lines = src.split("\n");
  const seenAt = lines.findIndex((l) => l.includes("workers.dev"));
  assert.ok(seenAt >= 0, "the seen POST still exists");
  assert.ok(lines.slice(Math.max(0, seenAt - 5), seenAt + 1).some((l) => l.includes("room === 'pc'")),
    "the PC Worker call is guarded to room=pc, so a PS page never posts there");
});
