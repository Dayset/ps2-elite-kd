// 🥶 pockets (oracle-worker/src/pockets.js) and the pocket discount in the focus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computePockets } from "../oracle-worker/src/pockets.js";
import { focusPlan } from "../oracle-worker/src/focus.js";
import { ownership } from "../oracle-worker/src/commander.js";
import { regionMap, latticeFor, binGetter } from "../oracle-worker/src/models.js";
import { territory, FACS } from "../oracle-worker/src/engine.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/focus-osprey-hossin-t86.json", import.meta.url), "utf8"));
const L = latticeFor(4), own = ownership(F.z, regionMap(4));
const fidOf = (n) => Object.keys(L.names).find((f) => L.names[f] === n);
const NOW = 1_000_000;

test("a chokepoint under attack makes a pocket: hold it, these bases depend on it", () => {
  const cairn = fidOf("Cairn Station");
  const quiet = computePockets({ own, lattice: L, flips: [], nowTs: NOW });
  assert.ok(!quiet.pockets.TR.some((p) => p.chokepoint === "Cairn Station"), "no attack, no pocket");
  const hit = computePockets({ own, lattice: L, flips: [[NOW - 60, "NC", "TR", cairn]], nowTs: NOW });
  const p = hit.pockets.TR.find((x) => x.chokepoint === "Cairn Station");
  assert.ok(p, JSON.stringify(hit.pockets.TR));
  assert.equal(p.n, 4);
  assert.ok(p.bases.includes("Hurakan"));
  assert.ok(hit.frozen.TR.has(fidOf("Hurakan")));
});

test("focus: moves inside a pocket are discounted and marked", () => {
  const t1 = territory(F.z), t0 = territory(F.z15);
  const mom = Object.fromEntries(FACS.map((f) => [f, t1[f] - t0[f]]));
  const frozen = { VS: new Set(), NC: new Set(), TR: new Set([fidOf("Hurakan"), fidOf("Hurakan Secure Storage"), fidOf("Hurakan Western Pass")]) };
  const base = focusPlan({ own, lattice: L, getBin: binGetter(4), t: 60, dur: 90, mom, header: null });
  const withP = focusPlan({ own, lattice: L, getBin: binGetter(4), t: 60, dur: 90, mom, header: null, frozen });
  const all = (p) => [p.TR.focus, ...p.TR.backups].filter(Boolean);
  assert.ok(all(withP).every((x) => !x.pocket || frozen.TR.size), "pocket flag only with a pocket");
  assert.ok(all(base).every((x) => !x.pocket));
});
