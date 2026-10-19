/**
 * PS2Alerts history record (history/fetch.mjs) -> archive bundle v1 (src/archive.js),
 * for POST /archive/ingest. Pure, for tests; the CLI is history/ingest.mjs.
 *
 * Keeps exactly the alerts the win-tree work trusts (grow.mjs latticeCheck: the
 * starting map must fit our lattice), plus draws, minus Meltdowns.
 *
 * Size is the budget here, not completeness: the archive D1 database caps at
 * 500 MB and ~13k alerts qualify. So a PS2Alerts bundle carries
 *   frames  first frame = every lattice facility (null = neutral / out of play),
 *           then one frame per capture time (t in minutes, 0.1 = 6 s)
 *   score   optional [t, vs, nc, tr, cutoff] per capture (PS2Alerts mapControl),
 *           so the cut rule can be checked at every capture, not only at the end
 *   final   PS2Alerts result shares incl. cutoff / outOfPlay
 * and leaves `flips` empty (the frames hold the same captures) and `ticks` empty
 * (no live engine output for alerts we did not watch).
 */
import { MELTDOWN } from "../src/engine.js";
import { lat, latticeCheck, TREE_ZONES } from "./grow.mjs";

const NAME = { 1: "VS", 2: "NC", 3: "TR" };
const tMin = (sec) => Math.round(sec / 6) / 10;

/** Archive key `world-zone-censusInstance` from a record (PS2Alerts instanceId is "world-censusInstance"). */
export function keyOf(rec) {
  const m = /^(\d+)-(\d+)$/.exec(String(rec.id));
  const inst = m ? +m[2] : Number.isInteger(rec.id) ? rec.id : null;
  if (!inst || !Number.isInteger(rec.world) || !Number.isInteger(rec.zone)) return null;
  return { key: `${rec.world}-${rec.zone}-${inst}`, instance: inst };
}

/**
 * One record -> { bundle } or { skip }.
 * opts.since  unix seconds; alerts that started earlier are out of scope
 * opts.score  include PS2Alerts' per-capture score (default true)
 */
export function bundleFrom(rec, { since = 0, score = true } = {}) {
  if (!TREE_ZONES.includes(rec.zone)) return { skip: "zone" };
  if (rec.event != null && MELTDOWN.has(+rec.event)) return { skip: "meltdown" };
  if (!rec.start || !rec.end) return { skip: "no end" };
  if (rec.start < since) return { skip: "before scope" };
  const r = rec.result || {};
  const winner = NAME[r.victor] || (r.draw ? "draw" : null);
  if (!winner) return { skip: "no winner" };
  const k = keyOf(rec);
  if (!k) return { skip: "bad id" };
  const L = lat(rec.zone);
  if (!L) return { skip: "no lattice" };
  const bad = latticeCheck(rec, L);
  if (bad) return { skip: bad.skip };

  const own = {};
  const first = {};
  for (const fid of [...L.nodes].sort()) { own[fid] = NAME[rec.init[fid]] || null; first[fid] = own[fid]; }
  const frames = [{ t: 0, set: first }];
  for (const [sec, fid0, nf] of [...(rec.flips || [])].sort((a, b) => a[0] - b[0])) {
    const fid = String(fid0);
    if (!L.nodes.has(fid)) continue;
    const o = NAME[nf] || null;
    if (own[fid] === o) continue;              // already that owner (e.g. two entries for one capture)
    own[fid] = o;
    const t = Math.max(0, tMin(sec));
    const last = frames[frames.length - 1];
    if (last.t === t && frames.length > 1) last.set[fid] = o;
    else frames.push({ t, set: { [fid]: o } });
  }

  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const final = { VS: num(r.vs), NC: num(r.nc), TR: num(r.tr), cutoff: num(r.cutoff), outOfPlay: num(r.outOfPlay) };
  const b = {
    v: 1, key: k.key, source: "ps2alerts", world: rec.world, zone: rec.zone, instance_id: k.instance,
    event_id: rec.event ?? null, start_ts: rec.start, end_ts: rec.end,
    dur: rec.dur || Math.round((rec.end - rec.start) / 60), status: "settled", winner, basis: "ps2alerts",
    final, flags: { lattice: rec.lattice ?? null, map: rec.map ?? null, per_base: rec.perBase ?? null },
    frames, ticks: [], flips: [], bench: null,
  };
  if (score && Array.isArray(rec.ctl) && rec.ctl.length) b.score = rec.ctl.map(([sec, vs, nc, tr, cut]) => [Math.max(0, tMin(sec)), vs, nc, tr, cut]);
  return { bundle: b };
}
