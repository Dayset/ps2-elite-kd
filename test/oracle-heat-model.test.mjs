// Predicted heat (oracle-worker/history/heat-model.mjs): samples, fit, predict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { samples, fit, predict, cellKey } from "../oracle-worker/history/heat-model.mjs";
import { latticeFor } from "../oracle-worker/src/models.js";

test("samples: front-line bases every 2 min, target = changes hands in the next 10", () => {
  const L = latticeFor(4), fids = [...L.adj.keys()];
  const a = fids.find((f) => !/warpgate/i.test(L.names[f])), b = [...L.adj.get(a)][0];
  const set = Object.fromEntries(fids.map((f) => [f, "VS"])); set[b] = "NC";
  const ss = samples({ zone: 4, event_id: 154, dur: 30, frames: [{ t: 0, set }, { t: 7, set: { [a]: "NC" } }] });
  assert.ok(ss.length > 0);
  assert.ok(ss.some((s) => s.y === 1) && ss.some((s) => s.y === 0));
});

test("fit / predict: busy neighbours raise the chance; sparse cells fall back", () => {
  const mk = (nb, y, n) => Array.from({ length: n }, () => ({ p: 0.33, nb, self: false, fronts: 1, y }));
  const train = [...mk(0, 0, 900), ...mk(0, 1, 100), ...mk(3, 0, 300), ...mk(3, 1, 300)];
  const m = fit(train);
  assert.ok(predict(m, { p: 0.33, nb: 3, self: false, fronts: 1 }) > predict(m, { p: 0.33, nb: 0, self: false, fronts: 1 }));
  assert.equal(predict(m, { p: 0.33, nb: 3, self: true, fronts: 2 }), m.mid["2|3"].p, "falls back to p × nb");
  assert.equal(cellKey({ p: 0.33, nb: 5, self: true, fronts: 2 }), "2|3|1|2");
});
