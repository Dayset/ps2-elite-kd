// Commander modes, owner t691u: attacks from the plan aimed ahead, defends from now and only
// when the enemy is actually attacking that base — in both Solo and Big squad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mixPlan, underwayCheck, UNDERWAY_MIN } from "../oracle-worker/src/modes.js";
import { modeFocus } from "../oracle/js/sticky.js";
import { focusPlan } from "../oracle-worker/src/focus.js";
import { latticeFor, binGetter, captureModel } from "../oracle-worker/src/models.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const take = (base, p, now, then) => ({ kind: "take", bases: [base], target: "NC", p, now, then });
const hold = (base, p, now, then, target = "NC") => ({ kind: "hold", bases: [base], target, p, now, then });
const plan = (focus, ...backups) => ({ focus, backups, quiet: false });

// Tiny lattice: A - B - C ; VS owns A, B ; NC owns C.
const L = { names: { 1: "A", 2: "B", 3: "C", 4: "D" }, adj: new Map([["1", ["2"]], ["2", ["1", "3"]], ["3", ["2", "4"]], ["4", ["3"]]]) };
const own = new Map([["1", 1], ["2", 1], ["3", 2], ["4", 2]]);

test("underway: the attacker took a base next to ours in the last 10 min (or ours changed hands)", () => {
  assert.equal(UNDERWAY_MIN, 10);
  const now = 10_000;
  const uw = (flips) => underwayCheck({ own, lattice: L, flips, nowTs: now })("VS", hold("B", 0.4, 50, 40));
  assert.equal(uw([]), false, "no fight: no defend");
  assert.equal(uw([[now - 120, "NC", "VS", "3"]]), true, "NC just took C next to B");
  assert.equal(uw([[now - 11 * 60, "NC", "VS", "3"]]), false, "too long ago");
  assert.equal(uw([[now - 120, "NC", "VS", "4"]]), false, "not next to B");
  assert.equal(uw([[now - 120, "TR", "VS", "3"]]), false, "a different enemy than the one threatening B");
  assert.equal(uw([[now - 60, "VS", "NC", "2"]]), true, "B itself just changed hands");
});

test("mix: attacks from the ahead plan, defends only under attack, best value first, max 3", () => {
  const atk = { VS: plan(take("X", 0.5, 30, 40), take("Y", 0.5, 30, 36)) };
  const dfn = { VS: plan(hold("H1", 0.6, 30, 10), hold("H2", 0.5, 30, 28)) };
  const m = mixPlan(atk, dfn, (f, x) => x.bases[0] === "H1");
  assert.deepEqual([m.VS.focus, ...m.VS.backups].map((x) => x.bases[0]), ["H1", "X", "Y"]);
  const none = mixPlan(atk, dfn, () => false);
  assert.deepEqual([none.VS.focus, ...none.VS.backups].map((x) => x.kind), ["take", "take"], "no fight: attacks only");
  assert.equal(mixPlan({ VS: { focus: null, backups: [], quiet: true } }, {}, () => false).VS.quiet, true);
});

test("focusPlan only: attack / defend split", () => {
  const Lz = latticeFor(4), pf = captureModel(4);
  const ids = Object.keys(Lz.names), o = new Map(ids.map((f, i) => [f, (i % 3) + 1]));
  const args = { own: o, lattice: Lz, getBin: binGetter(4), t: 40, dur: 90, mom: { VS: 0, NC: 0, TR: 0 }, header: null, pf: (fid) => (pf[`${fid}|P1:pressured`] || {}).p ?? 0.33 };
  const kinds = (p) => Object.values(p).flatMap((x) => [x.focus, ...(x.backups || [])]).filter(Boolean).map((x) => x.kind);
  assert.ok(!kinds(focusPlan({ ...args, only: "attack" })).some((k) => k === "hold" || k === "guard"));
  assert.ok(!kinds(focusPlan({ ...args, only: "defend" })).some((k) => k === "take" || k === "plan" || k === "spoil" || k === "push"));
});

test("both modes use focus_mix; Solo keeps one, Big shows #1-#3", () => {
  const c = { focus: { VS: plan(take("OLD", 0.5, 30, 40)) }, focus_ahead: { VS: plan(take("AHEAD", 0.5, 30, 40)) },
    focus_mix: { VS: plan(take("MIX", 0.5, 30, 40), take("M2", 0.5, 30, 38), take("M3", 0.5, 30, 37)) } };
  assert.equal(modeFocus(c, "big", {}, { ts: 1 }).VS.focus.bases[0], "MIX");
  assert.equal(modeFocus(c, "solo", {}, { ts: 1, ownerOf: () => "NC", heatOf: () => 0 }).VS.focus.bases[0], "MIX");
  assert.equal(modeFocus({ ...c, focus_mix: undefined }, "big", {}, { ts: 1 }).VS.focus.bases[0], "AHEAD", "older Worker rows still work");
  const w = read("../oracle-worker/src/index.js");
  assert.match(w, /only: "attack"/); assert.match(w, /only: "defend"/);
  assert.match(w, /cmd\.focus_mix = mixPlan\(atk, dfn, underway\)/);
  assert.match(w, /const underway = underwayCheck\(/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(read(`../i18n/${l}.json`));
    assert.match(j["or.c.soloNote"], /\{n\}/, `${l} soloNote keeps {n}`);
  }
});
