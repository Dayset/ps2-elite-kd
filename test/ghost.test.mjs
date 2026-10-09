import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kpmBandCurve, kpmCurve } from "../math.mjs";
import {
  g,
  fitShape,
  ridge,
  fitGhostModel,
  ghostModelFor,
  ghostFeatures,
  stylePrior,
  bandGhost,
  cumulativeGhost,
  GHOST_BLEND_EVENTS,
} from "../ghost.mjs";
import GHOST_MODEL from "../ghost-model.mjs";

/** Rows whose per-opponent K/D follows exp(A + S·g(x)) exactly. */
function synthRows(A, S, { from = 0.1, to = 2.4, n = 40, ev = 60 } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = from + ((to - from) * i) / (n - 1);
    const kd = Math.exp(A + S * g(x));
    const d = ev / (1 + kd);
    rows.push({ name: "o" + i, kpm: x, kills: ev - d, deaths: d });
  }
  return rows;
}

function synthPopulation(count = 60) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = (i % 12) / 11; // style knob 0..1
    const A = -0.2 + 1.2 * t;
    const S = -1.6 + 0.8 * t;
    const rows = synthRows(A, S, { ev: 40 + (i % 5) * 10 });
    const kd = Math.exp(A);
    out.push({
      rows,
      metrics: { kd, ownKpm: 0.8 + t, acc: 20 + 10 * t, hsr: 15 + 20 * t, rf: 1 + t, slope: -1 + t, pvs: 3, inflation: 1.5 },
      A, S,
    });
  }
  return out;
}

describe("ghost: fitting", () => {
  it("fitShape recovers A and S (up to the +0.5 continuity smoothing)", () => {
    const f = fitShape(synthRows(0.5, -1.2, { ev: 4000 }));
    assert.ok(Math.abs(f.A - 0.5) < 0.02, `A ${f.A}`);
    assert.ok(Math.abs(f.S + 1.2) < 0.02, `S ${f.S}`);
  });
  it("fitShape refuses a single-KPM sample", () => {
    assert.equal(fitShape(synthRows(0, -1, { from: 1, to: 1.1, n: 6 })), null);
  });
  it("ridge recovers a linear relation", () => {
    const X = [], y = [], w = [];
    for (let i = 0; i < 50; i++) {
      const a = Math.sin(i), b = Math.cos(i * 1.7);
      X.push([a, b]); y.push(2 + 3 * a - b); w.push(1);
    }
    const r = ridge(X, y, w, 1e-6);
    assert.ok(Math.abs(r.b[0] - 3) < 1e-3 && Math.abs(r.b[1] + 1) < 1e-3);
  });
  it("population model maps style to shape", () => {
    const pop = synthPopulation();
    const model = fitGhostModel(pop);
    const hi = stylePrior(ghostFeatures(pop[11].metrics), model);
    const lo = stylePrior(ghostFeatures(pop[0].metrics), model);
    assert.ok(hi.A > lo.A, "stronger style → higher level");
    assert.ok(hi.S > lo.S, "stronger style → flatter decay");
    assert.ok(model.sigma >= 0 && model.density.values.length > 10);
  });
});

describe("ghost: prediction", () => {
  const pop = synthPopulation();
  const model = fitGhostModel(pop);
  const me = pop[5];

  it("with no fights falls back to the style model", () => {
    const gm = ghostModelFor([], me.metrics, model);
    const pr = stylePrior(ghostFeatures(me.metrics), model);
    assert.ok(Math.abs(gm.at(1).logKd - (pr.A + pr.S * g(1))) < 1e-9);
    assert.ok(gm.at(1).logSd > 0);
  });

  it("follows the player's own fights near them, with less uncertainty", () => {
    const rows = synthRows(me.A + 0.4, me.S, { from: 0.2, to: 1.0, n: 12, ev: 200 });
    const gm = ghostModelFor(rows, me.metrics, model);
    const truth = me.A + 0.4 + me.S * g(0.6);
    assert.ok(Math.abs(gm.at(0.6).logKd - truth) < 0.1, "near data ≈ data");
    assert.ok(gm.at(0.6).logSd < gm.at(2.5).logSd, "more certain near data");
  });

  it("bandGhost covers the full grid, keeps real data, only flags sparse points", () => {
    const rows = synthRows(me.A, me.S, { from: 0.3, to: 1.2, n: 10, ev: 150 });
    const band = kpmBandCurve(rows);
    const before = JSON.stringify(band);
    const gh = bandGhost(band, rows, me.metrics, model);
    assert.equal(JSON.stringify(band), before, "input untouched");
    assert.equal(gh.length, band.length);
    for (let i = 0; i < gh.length; i++) {
      assert.ok(Number.isFinite(gh[i].kd) && gh[i].kd > 0, "finite everywhere");
      assert.ok(gh[i].lo <= gh[i].kd && gh[i].kd <= gh[i].hi);
      assert.equal(gh[i].ghost, band[i].events < GHOST_BLEND_EVENTS);
      if (!gh[i].ghost) assert.ok(Math.abs(gh[i].kd - band[i].kd) < 1e-9, "real wins where supported");
    }
    assert.ok(gh.some((p) => p.ghost) && gh.some((p) => !p.ghost));
  });

  it("cumulativeGhost only fills points where the real line has no deaths", () => {
    const rows = synthRows(me.A, me.S, { from: 0.2, to: 1.3, n: 10, ev: 100 });
    const curve = kpmCurve(rows);
    const cg = cumulativeGhost(curve, rows, me.metrics, model);
    for (const pt of curve) {
      const k = Math.round(pt.kpm * 100) / 100;
      assert.equal(cg.has(k), !(pt.deaths > 0), `kpm ${k}`);
      if (cg.has(k)) assert.ok(cg.get(k).kd > 0 && cg.get(k).lo <= cg.get(k).hi);
    }
    assert.ok(cg.size > 0);
  });

  it("shipped model is well-formed", () => {
    assert.equal(GHOST_MODEL.features.length, GHOST_MODEL.mean.length);
    assert.equal(GHOST_MODEL.A.b.length, GHOST_MODEL.features.length);
    assert.ok(GHOST_MODEL.sigma > 0 && GHOST_MODEL.sigma < 2);
    assert.ok(GHOST_MODEL.n >= 100);
  });
});
