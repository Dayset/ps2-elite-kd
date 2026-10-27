import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeSpawnCamp, spawnCampExcluded, measureSpawnCampBar, spawnCampRows } from "../spawn-camp.mjs";
import { addSpawnCampSession } from "../scripts/spawn-camp.mjs";

const me = "111";
const kill = (v, t, team = 2) => ({ event: { attackerCharacterID: me, killedCharacterID: v, attackerTeamID: 1, killedTeamID: team, timestamp: new Date(t * 1000).toISOString(), worldID: 10 } });
const xp = (v, t, id = 1) => ({ sourceID: me, otherID: v, experienceID: id, timestamp: new Date(t * 1000).toISOString() });

test("a kill without matching kill XP counts as a spawn kill; team kills are ignored", () => {
  const k = [kill("a", 100), kill("b", 200), kill("c", 300), kill("d", 400, 1)];
  const x = [xp("a", 101), xp("b", 205)];
  const r = analyzeSpawnCamp(k, x, me);
  assert.deepEqual(r, { kills: 3, sk: 2, skVictims: 2, top2: 1 });
  assert.equal(analyzeSpawnCamp(k, [], me), null, "no XP data = can't tell");
});

test("padders and 1–2 victim sessions are left out; under 60 kills too", () => {
  const rv = { players: { padme: { decision: "padding" } } };
  assert.equal(spawnCampExcluded({ name: "PadMe", kills: 100, sk: 10, top2: 0.2 }, rv), "confirmed stat padder");
  assert.match(spawnCampExcluded({ name: "x", kills: 148, sk: 110, top2: 1 }, rv), /1–2 victims/);
  assert.equal(spawnCampExcluded({ name: "x", kills: 61, sk: 4, top2: 1 }, rv), null, "fewer than 5 spawn kills: spread rule not applied");
  assert.match(spawnCampExcluded({ name: "x", kills: 59, sk: 0, top2: 0 }, rv), /under 60/);
});

test("bar = top 10% of the random sample; rows at or above it, highest first", () => {
  const sessions = {};
  for (let i = 0; i < 100; i++) sessions["s" + i] = { session: "s" + i, name: "p" + i, kills: 100, sk: i % 10, top2: 0.2, sample: true };
  sessions.f = { session: "f", name: "forensics", kills: 100, sk: 30, skVictims: 20, top2: 0.1 };
  const st = measureSpawnCampBar(sessions, null);
  assert.equal(st.n, 100);
  assert.equal(st.bar, 9);
  const rows = spawnCampRows({ stats: st, sessions }, null);
  assert.equal(rows[0].session, "f");
  assert.equal(rows.length, 11);
  assert.equal(rows[0].crowd, "unknown");
});

test("addSpawnCampSession stores a row with world and slug", () => {
  const store = {};
  const r = addSpawnCampSession(store, { session: 5, cid: me, name: "[TAG] Some Name", killRows: [kill("a", 1)], expEvents: [xp("z", 1)] });
  assert.equal(r.slug, "somename");
  assert.equal(r.world, 10);
  assert.equal(store.sessions["5"].sk, 1);
});

test("seeded data/spawncamp.json has a measured bar and is not shown on public pages", () => {
  const d = JSON.parse(fs.readFileSync(new URL("../data/spawncamp.json", import.meta.url)));
  assert.ok(d.stats.n >= 30 && d.stats.bar > d.stats.median);
  for (const f of ["index.html", "app.js", "ranks.html", "rankings.mjs", "analyze-run.mjs", "misc.html"]) {
    const src = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.ok(!/spawncamp|spawn-camp|⛺/.test(src), f + " must not show ⛺");
  }
  const bl = fs.readFileSync(new URL("../build-log.html", import.meta.url), "utf8");
  assert.match(bl, /noindex/);
  assert.match(bl, /id="cardSpawnCamp"/);
  assert.ok(!/cheater/i.test(bl.slice(bl.indexOf('id="cardSpawnCamp"'), bl.indexOf('id="cardAnoms"'))));
});
