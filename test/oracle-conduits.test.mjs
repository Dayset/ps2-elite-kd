// 🚩 Conduit (CTF) exclusion (owner 2026-11-02): conduit fights stay out of the
// Commander orders and the Live fights card when the toggle is off. Pure-function
// tests for oracle/js/conduits.js, CTF cases for fightsCard, and source-shape
// checks for the wiring (button, toggle handler, pins, i18n keys).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
globalThis.location ??= { search: "", pathname: "/oracle/", href: "https://example.test/oracle/" };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { ctfNames, filterPlan, filterCommander, CTF_TYPES } = await import("../oracle/js/conduits.js");
const { fightsCard } = await import("../oracle/js/fights.js");

const CTF = new Set(["J908 Impact Site", "Indar Excavation Site", "Baldur"]);
const isCtf = (n) => CTF.has(n);
const entry = (bases, extra = {}) => ({ kind: "take", bases, target: "VS", p: 0.5, now: 40, then: 50, ...extra });
const plan = (focus, backups = [], extra = {}) => ({ focus, backups, quiet: false, ...extra });

test("ctfNames: CTF facility types only, string or numeric", () => {
  assert.deepEqual([...CTF_TYPES].sort(), ["14", "15", "16", "17"]);
  const regions = {
    5100: { name: "Indar Excavation Site", type: "14" },
    5200: { name: "J908 Impact Site", type: "14" },
    400314: { name: "Baldur", type: "16" },
    400328: { name: "Spral Oasis", type: 17 },
    100: { name: "Howling Pass", type: "1" },
    200: { name: "The Palisade", type: "5" },
    300: { name: "No Type", type: undefined },
  };
  assert.deepEqual([...ctfNames(regions)].sort(), ["Baldur", "Indar Excavation Site", "J908 Impact Site", "Spral Oasis"]);
  assert.deepEqual([...ctfNames(null)], []);
});

test("filterPlan: CTF focus promotes the first surviving backup", () => {
  const p = filterPlan(plan(entry(["J908 Impact Site"]), [entry(["Good A"]), entry(["Baldur"]), entry(["Good B"])]), isCtf);
  assert.deepEqual(p.focus.bases, ["Good A"]);
  assert.deepEqual(p.backups.map((b) => b.bases[0]), ["Good B"]);
  assert.equal(p.quiet, false);
});

test("filterPlan: all conduit -> quiet, and backups slice to 2 (heat: 1)", () => {
  const q = filterPlan(plan(entry(["Baldur"]), [entry(["J908 Impact Site"])]), isCtf);
  assert.equal(q.quiet, true);
  assert.equal(q.focus, null);
  assert.deepEqual(q.backups, []);
  const many = filterPlan(plan(entry(["A"]), [entry(["B"]), entry(["C"]), entry(["D"])]), () => false);
  assert.deepEqual(many.backups.map((b) => b.bases[0]), ["B", "C"]);
  const heat = filterPlan(plan(entry(["A"]), [entry(["B"]), entry(["C"])], { heat_mode: true }), () => false);
  assert.deepEqual(heat.backups.map((b) => b.bases[0]), ["B"]);
  const quiet = { focus: null, backups: [], quiet: true };
  assert.equal(filterPlan(quiet, isCtf), quiet, "quiet plan passes through untouched");
});

test("filterPlan: an entry counts as conduit when ANY of its bases is one", () => {
  const p = filterPlan(plan(entry(["Good A", "J908 Impact Site"]), [entry(["Good B"])]), isCtf);
  assert.deepEqual(p.focus.bases, ["Good B"]);
});

test("filterCommander: rows filtered then sliced, kingmaker/pockets dropped, rest untouched", () => {
  const atk = (name) => ({ name, target: "NC", win_gain: 1 });
  const c = {
    fight_up: { text: "why" },
    second: { odds: { VS: 50, NC: 50 } },
    focus: { VS: plan(entry(["J908 Impact Site"]), [entry(["Good A"])]) },
    focus_heat: { VS: plan(entry(["Baldur"]), [], { heat_mode: true }) },
    focus_mix: { VS: plan(entry(["Good M"]), [entry(["Indar Excavation Site"])]) },
    focus_ahead: null,
    focus_solo: { VS: plan(entry(["Good S"])) },
    factions: {
      VS: {
        attack: [atk("Good 1"), atk("Baldur"), atk("Good 2"), atk("Good 3"), atk("Good 4")],
        defend: [{ name: "J908 Impact Site", vs: "NC", win_drop: 1 }],
        kingmaker: [{ text: "take Baldur, then VS 60%" }, { text: "hold Good 1" }],
      },
    },
    pockets: { VS: [{ chokepoint: "Baldur", bases: ["X"], n: 1 }, { chokepoint: "Good P", bases: ["Y"], n: 1 }] },
    second_place_kingmaker: [{ text: "NC takes J908 Impact Site" }, { text: "TR holds" }],
  };
  const out = filterCommander(c, CTF);
  assert.deepEqual(out.factions.VS.attack.map((e) => e.name), ["Good 1", "Good 2", "Good 3"]);
  assert.deepEqual(out.factions.VS.defend, []);
  assert.deepEqual(out.factions.VS.kingmaker.map((k) => k.text), ["hold Good 1"]);
  assert.deepEqual(out.pockets.VS.map((p) => p.chokepoint), ["Good P"]);
  assert.deepEqual(out.second_place_kingmaker.map((k) => k.text), ["TR holds"]);
  assert.deepEqual(out.fight_up, { text: "why" });
  assert.deepEqual(out.second, { odds: { VS: 50, NC: 50 } });
  assert.deepEqual(out.focus.VS.focus.bases, ["Good A"]);
  assert.equal(out.focus_heat.VS.quiet, true, "heat focus all-conduit goes quiet");
  assert.deepEqual(out.focus_mix.VS.focus.bases, ["Good M"]);
  assert.deepEqual(out.focus_solo.VS.focus.bases, ["Good S"]);
  assert.equal(filterCommander(null, CTF), null);
});

test("filterCommander with no CTF set: slice normalization only, nothing dropped", () => {
  const atk = (name) => ({ name, target: "NC", win_gain: 1 });
  const c = {
    focus: { VS: plan(entry(["A"]), [entry(["B"]), entry(["C"]), entry(["D"])]) },
    focus_heat: { VS: plan(entry(["A"]), [entry(["B"]), entry(["C"])], { heat_mode: true }) },
    factions: { VS: { attack: [1, 2, 3, 4, 5, 6].map((i) => atk("A" + i)), defend: [], kingmaker: [{ text: "take Baldur" }] } },
  };
  const out = filterCommander(c, null);
  assert.deepEqual(out.factions.VS.attack.map((e) => e.name), ["A1", "A2", "A3"]);
  assert.deepEqual(out.factions.VS.kingmaker.map((k) => k.text), ["take Baldur"]);
  assert.deepEqual(out.focus.VS.backups.map((b) => b.bases[0]), ["B", "C"]);
  assert.deepEqual(out.focus_heat.VS.backups.map((b) => b.bases[0]), ["B"]);
});

const fight = (name, n) => ({ fid: name, name, n, k: { VS: 0, NC: 0, TR: 0 } });
const rows = (h) => [...h.matchAll(/<li data-base="([^"]+)"/g)].map((m) => m[1]);

test("fightsCard: conduit fights dropped before the top 3, Worker order kept", () => {
  const s = { fights: [fight("Base D", { VS: 0, NC: 0, TR: 40 }), fight("J908 Impact Site", { VS: 30, NC: 0, TR: 0 }), fight("Base A", { VS: 20, NC: 14, TR: 0 }), fight("Base C", { VS: 10, NC: 0, TR: 10 })], fights_at: 1000, caps: [], fights_live: true };
  assert.deepEqual(rows(fightsCard(s, null, 1000, CTF)), ["Base D", "Base A", "Base C"]);
  assert.deepEqual(rows(fightsCard(s, null, 1000, null)), ["Base D", "J908 Impact Site", "Base A"]);
  assert.deepEqual(rows(fightsCard(s, "VS", 1000, CTF)), ["Base A", "Base C"], "faction filter and conduit filter compose");
  const noname = { fights: [{ fid: 999, n: { VS: 50, NC: 0, TR: 0 }, k: { VS: 0, NC: 0, TR: 0 } }], fights_at: 1000, caps: [], fights_live: true };
  assert.deepEqual(rows(fightsCard(noname, null, 1000, CTF)), ["#999"], "a fight without a name never matches a CTF name");
});

test("wiring: button, toggle handler, filter call, pins, keys", () => {
  const commander = readFileSync(new URL("../oracle/js/commander.js", import.meta.url), "utf8");
  const sticky = readFileSync(new URL("../oracle/js/sticky.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("../oracle/js/main.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../oracle/index.html", import.meta.url), "utf8");
  const map = readFileSync(new URL("../oracle/js/map.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../oracle/oracle.css", import.meta.url), "utf8");
  const en = JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8"));
  assert.ok(commander.includes("export function conduitButton(on)"), "conduitButton exported");
  assert.ok(commander.includes("liveName = null, conduits = true"), "commander() 8th param defaults to included");
  assert.ok(commander.includes('${f === on ? conduitButton(conduits) : ""}'), "button only on the followed faction's card");
  assert.ok(commander.includes('data-conduit="1"'), "button carries data-conduit");
  assert.ok(sticky.includes('export const CONDUIT_KEY = "ps2oracle_conduits"'), "conduit storage key");
  assert.ok(sticky.includes('export const pickConduits = (v) => v !== "0"'), "default included for null/unknown");
  assert.ok(main.includes('from "./conduits.js?v=20261102-conduit1"'), "main imports conduits");
  assert.ok(main.includes("filterCommander(a.commander || (s && s.commander), ctfSet)"), "filter runs before withMode");
  assert.ok(main.includes("fightsCard(s, S.cmdOn, now, ctfSet)"), "fights card gets the same CTF set");
  assert.ok(main.includes("commander(cmdView, a.commander_ts, now, lead, cmdMode, heatOn, liveTop, conduitsOn)"), "commander gets the toggle state");
  assert.ok(main.includes("[data-conduit]"), "toggle click handler exists");
  assert.ok(main.includes("delete soloMem[S.selected]"), "toggle clears sticky state");
  assert.ok(main.includes('localStorage.setItem(CONDUIT_KEY'), "toggle persists");
  assert.ok(main.includes("delete soloMem[a.key]"), "regions load clears sticky state");
  assert.ok(index.includes('js/main.js?v=20261107-t114'), "main pin bumped");
  assert.ok(index.includes('oracle.css?v=20261102-layout1'), "css pin bumped");
  assert.ok(map.includes('fights.js?v=20261102-conduit1'), "map fights import bumped");
  assert.ok(css.includes(".conduitbtn:not(.on)"), "conduit button off style");
  assert.ok(css.includes(".conduitbtn.on"), "conduit button on style");
  assert.equal(en["or.c.conduitOn"], "🚩 Conduits included: conduit fights can appear in the orders and live fights. Click to exclude them.");
  assert.equal(en["or.c.conduitOff"], "🚩 Conduits excluded: conduit fights stay out of the orders and live fights");
});
