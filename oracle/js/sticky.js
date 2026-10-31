// Commander mode (owner t665u, t691u): both modes get attacks aimed 3 minutes ahead and
// defends only when a base is under attack (Worker focus_mix, oracle-worker/src/modes.js).
// "Solo" keeps one order until it is done; "Big squad" shows #1-#3 and may switch every minute.
// Pure functions: no DOM, no requests (a backtest script imports this file).
//
// Solo (sticky): an order is kept until
//   - its base is taken (attack) or lost (defend),
//   - its time is up: HOLD_MIN minutes (travel + one capture),
//   - a clearly better order appears: expected value ≥ (1 + MARGIN) × the kept one,
//   - or an urgent defence appears: our base with a predicted flip chance ≥ URGENT_HEAT %,
//   - or (🚐 #87) it is an attack and our last Sunderer / router there is gone.
// Values from a backtest on 57 past alerts (4,698 minutes, 2026-10-26), grid HOLD 3-8 min x
// MARGIN 0.25-2 x URGENT 30/50/off: the fewest switches with "attack came true" within 1.5 points
// of the plain plan and "defend held" no worse. Plain: 31.9% / 72.6%, order different 1 min
// later 40.9%. Solo 5 / 0.25 / 50: 30.5% / 73.2%, different 1 min later 24.1%.

export const HOLD_MIN = 5;
export const MARGIN = 0.25;
export const URGENT_HEAT = 50;
export const AHEAD_MIN = 3;

const MINOR = new Set(["push", "guard"]);
const ATTACK = new Set(["take", "plan", "spoil", "push"]);

/** Same order = same kind, bases and target (as the voice). */
export const entryKey = (x) => (x ? `${x.kind}|${(x.bases || []).join("+")}|${x.target}` : "quiet");

/** Expected value of a focus entry: capture chance × win change. Front-only moves (push/guard) are worth ~0. */
export function entryEv(x) {
  if (!x) return 0;
  if (MINOR.has(x.kind)) return 0.01 * ((x.heat || 0) / 100);
  return (+x.p || 0) * Math.abs((+x.then || 0) - (+x.now || 0));
}

/**
 * One Solo step for one faction.
 * prev: {x, ev, since} or null; p: the Worker plan {focus, backups, quiet};
 * ctx: {fac, nowS, ownerOf(name) -> "VS"|"NC"|"TR"|null|undefined, heatOf(name) -> 0..100,
 *       canSpawn(fac, name) -> true|false|undefined (🚐 public spawn there; undefined = no data)}
 * Returns {plan, state, why}: plan has the same shape as p (the kept order as focus).
 */
export function soloStep(prev, p, ctx, cfg = {}) {
  const hold = cfg.HOLD_MIN ?? HOLD_MIN, margin = cfg.MARGIN ?? MARGIN, urgent = cfg.URGENT_HEAT ?? URGENT_HEAT;
  const cur = p && !p.quiet && p.focus ? p.focus : null;
  const adopt = (why) => ({ plan: p, state: cur ? { x: cur, ev: entryEv(cur), since: ctx.nowS } : null, why });
  if (!prev || !prev.x) return adopt("new");
  const x = prev.x, f = ctx.fac;
  const own = ctx.ownerOf ? ctx.ownerOf(x.bases && x.bases[0]) : undefined;
  if (own !== undefined) {
    if (ATTACK.has(x.kind) && own === f) return adopt("taken");
    if (ATTACK.has(x.kind) && x.kind !== "spoil" && own !== x.target && own !== null) return adopt("changed");
    if (x.kind === "spoil" && own !== x.target && own !== null) return adopt("changed");
    if ((x.kind === "hold" || x.kind === "guard") && own !== f) return adopt("lost");
  }
  if (ctx.nowS - prev.since >= hold * 60) return adopt("time");
  if (ATTACK.has(x.kind) && x.kind !== "spoil" && ctx.canSpawn && ctx.canSpawn(f, x.bases && x.bases[0]) === false) return adopt("nospawn");
  if (x.kind === "spoil" && ctx.canSpawn && ctx.canSpawn(f, x.bases && x.bases[0]) === false) return adopt("nospawn");
  // The kept order as the Worker sees it now (fresh numbers), if it is still listed.
  const list = p && !p.quiet ? [p.focus, ...(p.backups || [])].filter(Boolean) : [];
  const k = entryKey(x);
  const fresh = list.find((y) => entryKey(y) === k);
  if (cur && entryKey(cur) === k) return { plan: p, state: { x: cur, ev: entryEv(cur), since: prev.since }, why: "same" };
  const keptEv = fresh ? entryEv(fresh) : prev.ev;
  if (cur) {
    if (MINOR.has(x.kind) && !MINOR.has(cur.kind)) return adopt("real");
    if (cur.kind === "hold" && ctx.heatOf && (ctx.heatOf(cur.bases[0]) || 0) >= urgent) return adopt("urgent");
    if (entryEv(cur) >= (1 + margin) * keptEv && entryEv(cur) > keptEv) return adopt("better");
  }
  const kept = fresh || x;
  const backups = [cur, ...((p && p.backups) || [])].filter((y) => y && entryKey(y) !== k).slice(0, 2);
  return { plan: { focus: kept, backups, quiet: false, kept: true }, state: { x: kept, ev: keptEv, since: prev.since }, why: "kept" };
}

/** Solo for every faction of one commander update; mem: {[fac]: state} for this alert (mutated). */
export function soloFocus(focus, mem, ctx) {
  if (!focus) return focus;
  const out = {};
  for (const f of Object.keys(focus)) {
    const r = soloStep(mem[f] || null, focus[f], { ...ctx, fac: f });
    mem[f] = r.state; out[f] = r.plan;
  }
  return out;
}

// ---------------------------------------------------------------- page glue (still pure)

export const MODE_KEY = "ps2oracle_cmdmode";
export const pickMode = (v) => (v === "big" ? "big" : "solo");
// 🔥 Heat toggle (owner t692u): on top of either mode, remembered on this device.
export const HEAT_KEY = "ps2oracle_heatmode";
export const pickHeat = (v) => v === "1";

/** 🚐 (fac, base name) -> true when that faction has a live Sunderer / router there, false when not, undefined without data (state.spawn_map + the regions file). */
export function spawnLookup(spawnMap, regions) {
  if (!spawnMap || !Object.keys(spawnMap).length) return () => undefined;
  const fidOf = new Map();
  for (const [fid, r] of Object.entries(regions || {})) if (r && r.name && !fidOf.has(r.name)) fidOf.set(r.name, fid);
  return (fac, name) => {
    const fid = fidOf.get(name);
    if (fid == null) return undefined;
    const q = spawnMap[fid] && spawnMap[fid][fac];
    return !!(q && ((+q.su || 0) > 0 || (+q.ro || 0) > 0));
  };
}

/** Base name -> owner ("VS"|"NC"|"TR", null = neutral, undefined = unknown) from /live state.owners + the regions file. */
export function ownerLookup(owners, regions) {
  const fidOf = new Map();
  for (const [fid, r] of Object.entries(regions || {})) if (r && r.name && !fidOf.has(r.name)) fidOf.set(r.name, fid);
  return (name) => { const fid = fidOf.get(name); if (fid == null || !owners) return undefined; const o = owners[fid]; return o === undefined ? undefined : o || null; };
}

/** Base name -> predicted flip chance (%) from the commander's attack / defend rows (pheat). */
export function heatLookup(c) {
  const m = new Map();
  for (const x of Object.values((c && c.factions) || {})) for (const r of [...((x && x.attack) || []), ...((x && x.defend) || [])]) if (r && r.name) m.set(r.name, Math.max(m.get(r.name) || 0, +r.pheat || 0));
  return (name) => m.get(name) || 0;
}

/**
 * The focus the page shows for a mode. "big": the Worker's 3-min-ahead plan (falls back to the
 * plain one); "solo": sticky orders, stepped once per commander update (mem is per alert, mutated).
 */
export function modeFocus(c, mode, mem, ctx, heat = false) {
  if (!c || !c.focus) return c ? c.focus : null;
  // 🔥 Heat (owner t692u): the Worker's hottest-fight plan, no alert math (older rows: normal plan).
  if (heat && c.focus_heat) return c.focus_heat;
  // focus_mix (owner t691u): attacks aimed ahead + defends only under attack, for both modes.
  if (mode === "big") return c.focus_mix || c.focus_ahead || c.focus;
  if (mem.out && mem.ts === ctx.ts) return mem.out;
  mem.st = mem.st || {};
  // 🚐 #87: Solo attacks only where we have a Sunderer or router (Worker focus_solo; older rows: the mix).
  mem.out = soloFocus(c.focus_solo || c.focus_mix || c.focus, mem.st, { nowS: ctx.ts, ownerOf: ctx.ownerOf, heatOf: ctx.heatOf, canSpawn: c.focus_solo ? ctx.canSpawn : null });
  mem.ts = ctx.ts;
  return mem.out;
}
