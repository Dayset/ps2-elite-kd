// Cut-cost measurement (oracle-worker/history/cut-swing.mjs, #63) on a scripted Hossin alert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertEvents, summarize } from "../oracle-worker/history/cut-swing.mjs";
import { latticeFor } from "../oracle-worker/src/models.js";
import { cutOff } from "../oracle-worker/src/focus.js";

const L = latticeFor(4);
const wg = Object.keys(L.names).filter((f) => /warpgate/i.test(L.names[f]));

// Split the map by distance from the three warpgates, then find one capture that cuts.
function startMap() {
  const own = new Map(), q = [];
  wg.forEach((w, i) => { own.set(w, ["VS", "NC", "TR"][i]); q.push(w); });
  while (q.length) { const c = q.shift(); for (const nb of L.adj.get(c)) if (!own.has(nb)) { own.set(nb, own.get(c)); q.push(nb); } }
  return own;
}

test("a capture that cuts bases off is counted as a cut with its immediate scored loss", () => {
  const own = startMap();
  const n = (o) => new Map([...o].map(([f, x]) => [f, { VS: 1, NC: 2, TR: 3 }[x]]));
  let pick = null;
  for (const [fid, o] of own) {
    if (wg.includes(fid)) continue;
    const enemy = [...L.adj.get(fid)].map((nb) => own.get(nb)).find((x) => x !== o);
    if (!enemy) continue;
    const o2 = new Map(own); o2.set(fid, enemy);
    const before = cutOff(n(own), L.adj, wg).cut, after = cutOff(n(o2), L.adj, wg).cut;
    if (after.size > before.size) { pick = { fid, enemy, cut: after.size - before.size }; break; }
  }
  assert.ok(pick, "the lattice has a cut point on the front line");
  const frames = [{ t: 0, set: Object.fromEntries(own) }, { t: 10, set: { [pick.fid]: pick.enemy } }];
  const evs = alertEvents({ key: "x", zone: 4, event_id: 154, dur: 90, winner: pick.enemy, frames });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].sev, pick.cut);
  assert.ok(evs[0].imm < evs[0].immR, "scored loss includes the cut bases, raw only the captured one");
  assert.equal(evs[0].fate.still, pick.cut, "nothing happened in the 15 minutes after");
  const s = summarize(evs);
  assert.equal(s.cuts, 1);
  assert.equal(s.ordinary, 0);
});

test("Meltdowns, Oshur and captures without 15 in-alert minutes after them are left out", () => {
  const own = startMap();
  const f = [...own.keys()].find((x) => !wg.includes(x));
  const other = own.get(f) === "VS" ? "NC" : "VS";
  const frames = [{ t: 0, set: Object.fromEntries(own) }, { t: 80, set: { [f]: other } }];
  assert.equal(alertEvents({ key: "a", zone: 4, event_id: 154, dur: 90, frames }).length, 0);
  assert.equal(alertEvents({ key: "b", zone: 4, event_id: 176, dur: 45, frames: [frames[0], { t: 5, set: { [f]: other } }] }).length, 0);
  assert.equal(alertEvents({ key: "c", zone: 344, event_id: 154, dur: 90, frames }).length, 0);
});
