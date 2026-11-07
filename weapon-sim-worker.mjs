// Web worker for the weapon comparison page: runs the recoil simulator (weapon-sim.mjs) off the main thread,
// so dragging a slider never freezes the page. Pure maths, no DOM, no text.
//
// Messages in:  { gen, jobs: [{ key, kind: "weapon", P, distance, hp, runs }
//                             | { key, kind: "class", Ps: [P...], distance, hp, runs }] }
// Messages out: { gen, key, kind, result }   weapon -> compareBursts() result, class -> best median (ms) or null
//
// A newer `gen` makes every older job stale: stale jobs are dropped, and a long class job stops between slices.
import { compareBursts } from "./weapon-sim.mjs?v=20261107-wcfps1";

let latest = 0;
const queue = [];
let running = false;

self.onmessage = (e) => {
  const m = e.data || {};
  if (!(m.gen >= latest)) return;
  latest = m.gen;
  const done = new Map();   // a class job asked for again keeps the weapons it already ran (same key = same settings)
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].gen < latest) { if (queue[i].kind === "class") done.set(queue[i].key, queue[i]); queue.splice(i, 1); }
  for (const j of m.jobs || []) { const o = done.get(j.key); queue.push({ ...j, gen: m.gen, i: o ? o.i : 0, best: o ? o.best : null }); }
  queue.sort((a, b) => (a.kind === "weapon" ? 0 : 1) - (b.kind === "weapon" ? 0 : 1));
  if (!running) { running = true; setTimeout(step, 0); }
};

function step() {
  const t0 = Date.now();
  while (queue.length && Date.now() - t0 < 30) {
    const j = queue[0];
    if (j.gen < latest) { queue.shift(); continue; }
    if (j.kind === "weapon") {
      queue.shift();
      self.postMessage({ gen: j.gen, key: j.key, kind: j.kind, result: compareBursts(j.P, { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }) });
      continue;
    }
    // class: a few weapons per slice, so a newer message can come in between
    const stop = Math.min(j.Ps.length, j.i + 3);
    for (; j.i < stop; j.i++) {
      const b = compareBursts(j.Ps[j.i], { distance: j.distance, hp: j.hp, runs: j.runs, seed: 1 }).best;
      if (b && (j.best == null || b.median < j.best)) j.best = b.median;
    }
    if (j.i >= j.Ps.length) { queue.shift(); self.postMessage({ gen: j.gen, key: j.key, kind: j.kind, result: j.best }); }
  }
  if (queue.length) setTimeout(step, 0); else running = false;
}
