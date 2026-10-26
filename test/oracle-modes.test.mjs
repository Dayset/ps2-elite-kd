// Commander modes + fetch timing (owner t665u): Solo sticky orders, Big squad 3-min-ahead plan,
// /live fetched right after the Worker's cycle lands. Pure modules, no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { soloStep, soloFocus, modeFocus, ownerLookup, heatLookup, pickMode, entryKey, HOLD_MIN, MARGIN, URGENT_HEAT } from "../oracle/js/sticky.js";
import { nextPoll, AFTER_S, RETRY_S, MAX_RETRY, FALLBACK_S } from "../oracle/js/poll.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const take = (base, p, now, then, target = "NC") => ({ kind: "take", bases: [base], target, p, now, then, text: `Take ${base}` });
const hold = (base, p, now, then) => ({ kind: "hold", bases: [base], target: "VS", p, now, then, text: `Hold ${base}` });
const plan = (focus, ...backups) => ({ focus, backups, quiet: false });

test("solo values come from the backtest (5 min / 0.25 / 50 %)", () => {
  assert.equal(HOLD_MIN, 5); assert.equal(MARGIN, 0.25); assert.equal(URGENT_HEAT, 50);
});

test("solo keeps an order against a slightly better one, switches on a clearly better one", () => {
  const ctx = { fac: "VS", nowS: 1000, ownerOf: () => "NC", heatOf: () => 0 };
  const a = take("Alpha", 0.5, 30, 40), b = take("Bravo", 0.5, 30, 41), c = take("Charlie", 0.5, 30, 43);
  let r = soloStep(null, plan(a), ctx);
  assert.equal(r.why, "new");
  r = soloStep(r.state, plan(b, a), { ...ctx, nowS: 1060 });
  assert.equal(r.why, "kept"); assert.equal(entryKey(r.plan.focus), entryKey(a)); assert.equal(r.plan.kept, true);
  assert.equal(entryKey(r.plan.backups[0]), entryKey(b), "the new top move is offered as backup");
  r = soloStep(r.state, plan(c), { ...ctx, nowS: 1120 });
  assert.equal(r.why, "better"); assert.equal(entryKey(r.plan.focus), entryKey(c));
});

test("solo lets go when the base is taken, lost, or time is up; urgent defence breaks in", () => {
  const a = take("Alpha", 0.5, 30, 40), b = take("Bravo", 0.5, 30, 40.5);
  const st = soloStep(null, plan(a), { fac: "VS", nowS: 0, ownerOf: () => "NC" }).state;
  assert.equal(soloStep(st, plan(b), { fac: "VS", nowS: 60, ownerOf: (n) => (n === "Alpha" ? "VS" : "NC") }).why, "taken");
  assert.equal(soloStep(st, plan(b), { fac: "VS", nowS: 60, ownerOf: (n) => (n === "Alpha" ? "TR" : "NC") }).why, "changed");
  assert.equal(soloStep(st, plan(b), { fac: "VS", nowS: HOLD_MIN * 60, ownerOf: () => "NC" }).why, "time");
  const h = hold("Home", 0.4, 30, 20);
  assert.equal(soloStep(st, plan(h), { fac: "VS", nowS: 60, ownerOf: () => "NC", heatOf: () => 60 }).why, "urgent");
  assert.equal(soloStep(st, plan(h), { fac: "VS", nowS: 60, ownerOf: () => "NC", heatOf: () => 10 }).why, "kept", "a calm, smaller defend waits");
  assert.equal(soloStep(st, plan(hold("Home", 0.8, 30, 20)), { fac: "VS", nowS: 60, ownerOf: () => "NC", heatOf: () => 10 }).why, "better", "a big defend still wins on value");
  const hs = soloStep(null, plan(h), { fac: "VS", nowS: 0, ownerOf: () => "VS" }).state;
  assert.equal(soloStep(hs, plan(a), { fac: "VS", nowS: 60, ownerOf: (n) => (n === "Home" ? "NC" : "NC") }).why, "lost");
  // Unknown owners (regions file not loaded yet): no owner checks, still sticky.
  assert.equal(soloStep(st, plan(b), { fac: "VS", nowS: 60, ownerOf: () => undefined }).why, "kept");
});

test("modeFocus: big uses the Worker's ahead plan, solo steps once per commander update", () => {
  const a = take("Alpha", 0.5, 30, 40), b = take("Bravo", 0.5, 30, 41), z = take("Zulu", 0.6, 30, 45);
  const c1 = { focus: { VS: plan(a) }, focus_ahead: { VS: plan(z) } };
  assert.equal(modeFocus(c1, "big", {}, { ts: 1 }).VS.focus, z);
  assert.equal(modeFocus({ focus: { VS: plan(a) } }, "big", {}, { ts: 1 }).VS.focus, a, "older row without focus_ahead");
  const mem = {};
  assert.equal(modeFocus(c1, "solo", mem, { ts: 100, ownerOf: () => "NC" }).VS.focus, a);
  const c2 = { focus: { VS: plan(b, a) } };
  const out = modeFocus(c2, "solo", mem, { ts: 160, ownerOf: () => "NC" });
  assert.equal(entryKey(out.VS.focus), entryKey(a), "kept");
  assert.equal(modeFocus(c2, "solo", mem, { ts: 160, ownerOf: () => "NC" }), out, "same update: no new step");
  assert.equal(pickMode("big"), "big"); assert.equal(pickMode(null), "solo"); assert.equal(pickMode("x"), "solo");
  const own = ownerLookup({ 11: "VS", 12: "" }, { 11: { name: "Alpha" }, 12: { name: "Bravo" } });
  assert.equal(own("Alpha"), "VS"); assert.equal(own("Bravo"), null); assert.equal(own("Nope"), undefined);
  const heat = heatLookup({ factions: { VS: { defend: [{ name: "Alpha", pheat: 55 }], attack: [{ name: "Alpha", pheat: 20 }] } } });
  assert.equal(heat("Alpha"), 55); assert.equal(heat("Nope"), 0);
  assert.equal(Object.keys(soloFocus({ VS: plan(a), NC: { quiet: true } }, {}, { nowS: 0 })).length, 2);
});

test("nextPoll: one fetch just after the next cycle lands, short retries, no storm", () => {
  // Cycle started 20 s ago, took 8 s (+ commander done 10 s in): next fetch at 60 + 10 + 3 - 20 = 53 s.
  const cy = { ts: 1000, ms: 8000, age_s: 20, commander_ts: 1009 };
  let r = nextPoll(cy, null, 0, 1020, true);
  assert.equal(r.delayS, 60 + 10 + AFTER_S - 20); assert.equal(r.complete, true);
  // Same cycle seen again: retry soon, at most MAX_RETRY times, then wait for the next minute.
  let n = 0, ret = 0;
  for (;;) { r = nextPoll({ ...cy, age_s: 73 + n * RETRY_S }, 1000, ret, 1073 + n * RETRY_S, true); if (r.delayS !== RETRY_S) break; ret = r.retries; n++; }
  assert.equal(n, MAX_RETRY);
  assert.ok(r.delayS >= 2 && r.delayS <= 75, String(r.delayS));
  // New cycle but commander not in yet while an alert is live: retry.
  assert.equal(nextPoll({ ts: 1060, ms: 8000, age_s: 9, commander_ts: 1009 }, 1000, 0, 1069, true).delayS, RETRY_S);
  // No live alert: the commander stamp doesn't matter.
  assert.equal(nextPoll({ ts: 1060, ms: 8000, age_s: 12, commander_ts: 1009 }, 1000, 0, 1072, false).complete, true);
  // No hint (older Worker) or a stalled cron: the old 30-s pace.
  assert.equal(nextPoll(null, null, 0, 0).delayS, FALLBACK_S);
  assert.equal(nextPoll({ ts: 1, ms: 1, age_s: 900 }, 1, 0, 901).delayS, FALLBACK_S);
  // Requests a minute over a simulated hour (cycles 7-19 s): well under the old 4.
  let t = 0, prev = null, rr = 0, fetches = 0;
  const took = (k) => 7 + ((k * 7919) % 13);
  while (t < 3600) {
    const k = Math.floor((t - took(Math.floor(t / 60))) / 60);   // last cycle whose data is in by t
    const start = k * 60, tk = took(k);
    const hint = { ts: 1e6 + start, ms: (tk - 1) * 1000, age_s: t - start, commander_ts: 1e6 + start + tk - 1 };
    const p = nextPoll(hint, prev, rr, 1e6 + t, true);
    fetches++; if (p.complete) prev = hint.ts; rr = p.retries; t += p.delayS;
  }
  assert.ok(fetches / 60 < 2, `fetches/min ${fetches / 60}`);
});

test("page wiring: no blind 30-s poll, /health only without a hint, modes in the card", () => {
  const main = read("../oracle/js/main.js"), cmd = read("../oracle/js/commander.js");
  assert.doesNotMatch(main, /setInterval\(refreshLive/);
  assert.match(main, /live\.cycle/);
  assert.match(main, /cy \? \{ ok:.*\} : await get\("\/health"\)/);
  assert.match(main, /voiceTick\(cmdNow\.focus/, "voice follows the shown (mode) plan");
  assert.match(cmd, /data-cmode="\$\{m\}"/);
  assert.match(main, /localStorage\.setItem\(MODE_KEY/);
});

test("Worker: shorter Census limits per call, ahead plan in the same commander row", () => {
  const w = read("../oracle-worker/src/index.js");
  assert.match(w, /CENSUS_MAP_MS = 8000, CENSUS_EVENT_MS = 12000/);
  assert.match(w, /map\/\?world_id=\$\{w\}&zone_ids=\$\{ZONES\.join\(","\)\}`, CENSUS_MAP_MS\)/);
  assert.equal((w.match(/, CENSUS_EVENT_MS\)/g) || []).length, 2);
  assert.match(w, /cmd\.focus_ahead = focusPlan\(\{ \.\.\.focusArgs, t: focusArgs\.t \+ AHEAD_CLOCK_MIN/);
});

test("mode strings in all 9 languages", () => {
  const keys = ["or.c.mode", "or.c.solo", "or.c.big", "or.c.soloTip", "or.c.bigTip", "or.c.soloNote", "or.c.bigNote", "or.c.bigWait", "or.c.kept"];
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(read(`../i18n/${l}.json`));
    for (const k of keys) assert.ok(typeof j[k] === "string" && j[k].length, `${l} ${k}`);
    assert.match(j["or.c.bigNote"], /\{n\}/, `${l} or.c.bigNote keeps {n}`);
  }
});
