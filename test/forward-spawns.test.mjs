// 🚐 Forward spawns (owner 2026-10-30): spawn XP → spawn points per base and faction
// (worker/src/live-map.js), the governor drops it first (pc-stream.js), the Oracle
// cleans it (oracle-worker/src/fights.js) and both pages print it (forward-spawns.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LiveMap, SPAWN_MS, SPAWN_XP } from "../worker/src/live-map.js";
import { pcSubscribe, streamLevel, PC_SPAWN_SOFT, PC_SOFT, SPAWN_XP_IDS } from "../worker/src/pc-stream.js";
import { fightsOf, capsOf, spawnsOf } from "../oracle-worker/src/fights.js";
import { spawnLine, spawnList } from "../forward-spawns.mjs";

const T0 = 1_793_340_000_000;
const ts = (ms) => String(Math.floor(ms / 1000));
const xp = (t, cid, id, other, team, extra = {}) => ({ event_name: "GainExperience", world_id: "10", zone_id: "2", character_id: cid, experience_id: String(id), other_id: other, team_id: String(team), amount: "10", timestamp: ts(t), ...extra });
const cap = (t, cid, f) => ({ event_name: "PlayerFacilityCapture", world_id: "10", zone_id: "2", character_id: cid, facility_id: String(f), outfit_id: "0", timestamp: ts(t) });
const tr = (k, fb, v) => String(fb).replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? String(v[x]) : m));
const P = (n) => String(5428000000000000000n + BigInt(n));
const V = (n) => String(25773000000 + n);

test("spawn XP: distinct Sunderers, Routers and beacons per base and faction, never a player id", () => {
  const lm = new LiveMap();
  lm.onEvent("ps2", cap(T0, P(1), 4001), T0); // owners placed at base 4001
  lm.onEvent("ps2", cap(T0, P(2), 4001), T0);
  lm.onEvent("ps2", cap(T0, P(3), 4001), T0);
  for (let i = 0; i < 5; i++) lm.onEvent("ps2", xp(T0 + i * 1e3, P(1), 233, V(1), 3), T0 + i * 1e3); // one Sunderer, 5 spawns
  lm.onEvent("ps2", xp(T0 + 6e3, P(2), 1542, V(2), 3), T0 + 6e3);                                   // a second Sunderer
  lm.onEvent("ps2", xp(T0 + 7e3, P(3), 1410, V(3), 3), T0 + 7e3);                                   // a Router
  lm.onEvent("ps2", xp(T0 + 8e3, P(4), 56, P(9), 2), T0 + 8e3);                                     // a beacon, owner not placed…
  lm.onEvent("ps2", cap(T0 + 9e3, P(4), 4001), T0 + 9e3);                                          // …until now (owner's fresh base)
  lm.onEvent("ps2", xp(T0 + 9e3, P(4), 56, P(8), 2), T0 + 9e3);                                     // same beacon, another spawn
  lm.onEvent("ps2", xp(T0 + 9e3, P(5), 233, "0", 3), T0 + 9e3);                                     // no vehicle id → ignored
  const sp = lm.spawnsAt("ps2", "10", 4001, T0 + 10e3);
  assert.deepEqual(sp, { TR: { su: 2, ro: 1, n: 7 }, NC: { be: 1, n: 2 } });
  const a = lm.activity("ps2", "10", T0 + 10e3);
  const b = a.bases.find((x) => x.f === 4001);
  assert.deepEqual(b.sp, sp);
  assert.ok(!JSON.stringify(a).includes(P(1)) && !JSON.stringify(a).includes(V(1)), "no player or vehicle id leaves the live map");
  assert.equal(lm.stats().ps2.spawns, 4);
  // Kill XP marks a known one lost and does not add a new one.
  lm.onEvent("ps2", xp(T0 + 11e3, P(7), 68, V(1), 2), T0 + 11e3);
  assert.deepEqual(lm.spawnsAt("ps2", "10", 4001, T0 + 12e3), { TR: { su: 2, ro: 1, n: 7 }, NC: { be: 1, n: 2 } });
  // Forgotten after SPAWN_MS.
  lm.prune(T0 + 12e3 + SPAWN_MS);
  assert.equal(lm.spawnsAt("ps2", "10", 4001, T0 + 12e3 + SPAWN_MS), null);
  assert.equal(lm.stats().ps2.spawns, 0);
});

test("governor: the spawn XP is the first thing dropped, before the point ticks", () => {
  for (const id of Object.keys(SPAWN_XP)) assert.ok(SPAWN_XP_IDS.includes(+id), id);
  assert.ok(SPAWN_XP_IDS.length <= 15);
  const full = pcSubscribe("full").eventNames, points = pcSubscribe("points").eventNames, lean = pcSubscribe("lean").eventNames;
  assert.ok(full.includes("GainExperience_experience_id_233") && !points.includes("GainExperience_experience_id_233"));
  assert.ok(points.includes("GainExperience_experience_id_557") && !lean.includes("GainExperience_experience_id_557"));
  assert.ok(PC_SPAWN_SOFT < PC_SOFT);
  assert.equal(streamLevel({}, 0), "full");
  assert.equal(streamLevel({}, PC_SPAWN_SOFT), "points");
  assert.equal(streamLevel({}, PC_SOFT), "lean");
  assert.equal(streamLevel({ PC_STREAM_SPAWN_SOFT: "100" }, 150), "points");
  assert.equal(streamLevel({ PC_STREAM_SOFT: "10", PC_STREAM_HARD: "20" }, 5), "full");
  assert.ok(!full.includes("GainExperience"), "never the whole XP firehose");
});

test("Oracle: spawn points pass through per fight and per capture, cleaned", () => {
  assert.equal(spawnsOf(null), null);
  assert.deepEqual(spawnsOf({ TR: { su: 3, ro: 2, x: 9 }, NSO: { su: 1 }, NC: { be: 0 } }), { TR: { su: 3, ro: 2 } });
  const act = { at: 100, bases: [{ f: 4001, fn: "Base", z: 2, n: { VS: 0, NC: 5, TR: 9 }, k: {}, conv: {}, sp: { TR: { su: 3 }, NC: { be: 2 } } }],
    caps: [{ t: 90, w: 10, z: 2, f: 4001, fn: "Base", old: "NC", fac: "TR", n: 5, sp: { TR: { su: 3 } } }] };
  const fx = fightsOf(act, 2, { 4001: "NC" });
  assert.deepEqual(fx.bases[0].sp, { TR: { su: 3 }, NC: { be: 2 } });
  assert.deepEqual(capsOf(act, 2)[0].sp, { TR: { su: 3 } });
});

test("line: attacker and defender, faction totals only, no tracking words", () => {
  assert.equal(spawnList({ su: 3, ro: 2 }, tr), "3× Sunderer · 2× Router");
  const l = spawnLine({ TR: { su: 3, ro: 2 }, NC: { be: 2 } }, tr, { own: "NC" });
  assert.match(l, /Attacker <span class="TR tr">TR<\/span> forward spawn: 3× Sunderer · 2× Router — Defender <span class="NC nc">NC<\/span>: 2× squad beacon/);
  assert.match(spawnLine({ NC: { be: 2 } }, tr, { own: "NC" }), /Attacker: no forward spawn seen/);
  assert.match(spawnLine({ NC: { be: 2 } }, tr, { own: "NC", att: "TR" }), /Attacker <span class="TR tr">TR<\/span> forward spawn: none seen/);
  assert.match(spawnLine({ VS: { su: 1 } }, tr), /Spawn points: <span class="VS vs">VS<\/span> 1× Sunderer/);
  assert.equal(spawnLine(null, tr), "");
  assert.ok(!l.includes("⛺"), "⛺ belongs to another feature");
  for (const code of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${code}.json`, import.meta.url), "utf8"));
    for (const k of ["sp.att", "sp.def", "sp.attNone", "sp.none", "sp.all", "sp.tip", "sp.be"]) assert.ok(j[k], `${code} ${k}`);
    const all = ["sp.att", "sp.def", "sp.attNone", "sp.all", "sp.tip"].map((k) => j[k]).join(" ");
    assert.ok(!all.includes("⛺"));
    if (code === "en") assert.ok(!/track|locat|player/i.test(all), "no tracking wording");
  }
});

test("pages: reduced motion respected, ⛺ not used", () => {
  const css = readFileSync(new URL("../oracle/oracle.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.fspawn\.fspnew \{ animation: none; \}/);
  assert.ok(!readFileSync(new URL("../forward-spawns.mjs", import.meta.url), "utf8").includes("⛺"));
});

test("🚐 spawn counts: live-map totals per faction, cleaned, shown wide and compact", async () => {
  const { spawnLine: line, spawnList: list } = await import("../forward-spawns.mjs");
  const tr = (k, f, v) => String(f).replace(/\{(\w+)\}/g, (_, x) => (v && v[x] != null ? v[x] : ""));
  assert.deepEqual(spawnsOf({ VS: { su: 3, n: 42.4 }, NC: { n: 5 }, TR: { be: 1, n: -3 } }), { VS: { su: 3, n: 42 }, TR: { be: 1 } });
  const l = list({ su: 3, n: 42 }, tr);
  assert.match(l, /3× Sunderer <span class="fspn fspl">\(42 spawns\)<\/span><span class="fspn fsps">\(42\)<\/span>/);
  assert.equal(list({ su: 2 }, tr), "2× Sunderer");
  const h = line({ VS: { su: 3, n: 42 }, NC: { be: 2, n: 9 } }, tr, { own: "NC" });
  assert.match(h, /Attacker .*VS.*3× Sunderer.*\(42 spawns\).*Defender .*NC.*2× squad beacon.*\(9 spawns\)/);
  assert.doesNotMatch(h, /track|locat/i);
});
