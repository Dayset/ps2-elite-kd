/**
 * ⚔️ Live fights per base (#78 step 1, Workers Paid plan 2026-10-29).
 *
 * The cache Worker's KillMonitor keeps an in-memory live map of the PC event stream
 * (worker/src/live-map.js). Once a cycle the oracle asks it, through the CACHE service
 * binding, for one world's per-base totals (GET /live/activity?ns=ps2&world=W): a rough
 * crowd per faction at each base (players placed there in the last 5 minutes), kills
 * and point-capture XP. No player id ever comes back.
 *
 * Shown on the dashboard ("⚔️ Live fights") and stored per minute (table `fight`, kept
 * like the ticks, copied into the alert archive) so the commander can be re-tuned on
 * it later. The odds and the commander do NOT read it until a backtest shows a gain
 * (owner rule, #78 step 3).
 */
export const FIGHTS_MAX = 8;
export const CAPS_MAX = 8;            // 🏴 recent captures kept per alert (newest first)
export const CAP_TAG_S = 15 * 60;     // a base row shows its capture tag this long after the flip          // bases kept per alert per minute
export const FIGHT_MIN_CROWD = 2;     // players placed at the base, or…
export const FIGHT_MIN_KILLS = 3;     // …kills there in the window
const FACS = ["VS", "NC", "TR"];

export const FIGHT_TABLE = `CREATE TABLE IF NOT EXISTS fight (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  t REAL NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (key, ts)
)`;
let fightTableOk = false;
export async function ensureFightTable(db) {
  if (fightTableOk) return;
  await db.prepare(FIGHT_TABLE).run();
  fightTableOk = true;
}

/** One world's activity from the cache Worker (null when unreachable or slow). */
export async function liveActivity(env, world, timeoutMs = 3000) {
  if (!env || !env.CACHE || typeof env.CACHE.fetch !== "function") return null;
  try {
    const r = await env.CACHE.fetch(new Request(`https://cache/live/activity?ns=ps2&world=${encodeURIComponent(world)}`, { signal: AbortSignal.timeout(timeoutMs) }));
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.bases) ? j : null;
  } catch { return null; }
}

/** 🚐 Spawn kinds (cache Worker live-map.js SPAWN_XP): Sunderer, Router, beacon, Galaxy, Valkyrie/Galaxy, ANT, Deliverer. */
export const SPAWN_KINDS = ["su", "ro", "be", "ga", "sv", "an", "de"];
/** 🚐 Forward spawns at one base, cleaned: { VS: { su: 3, n: 42 }, … } (n = spawns) with only known factions / kinds, or null. */
export function spawnsOf(sp) {
  if (!sp || typeof sp !== "object") return null;
  const out = {};
  for (const f of FACS) {
    const q = sp[f];
    if (!q || typeof q !== "object") continue;
    const o = {};
    for (const k of SPAWN_KINDS) { const n = Math.max(0, Math.min(99, Math.round(+q[k] || 0))); if (n) o[k] = n; }
    if (Object.keys(o).length) { const n = Math.max(0, Math.min(9999, Math.round(+q.n || 0))); if (n) o.n = n; out[f] = o; } // n = spawns there
  }
  return Object.keys(out).length ? out : null;
}

const pick = (o) => Object.fromEntries(FACS.map((f) => [f, Math.max(0, Math.round(+((o || {})[f]) || 0))]));

/**
 * The alert's continent out of a world's activity → { at, live, pop, bases } or null.
 * bases: [{ fid, name, n: {VS,NC,TR}, k: {VS,NC,TR}, conv: {VS,NC,TR}, convAgo }], biggest crowd first.
 */
export function fightsOf(act, zone, owners = null) {
  if (!act || !Array.isArray(act.bases)) return null;
  const z = +zone;
  const bases = [];
  for (const b of act.bases) {
    if (+b.z !== z) continue;
    const n = pick(b.n), k = pick(b.k), conv = pick(b.conv);
    const crowd = n.VS + n.NC + n.TR, kills = k.VS + k.NC + k.TR;
    if (crowd < FIGHT_MIN_CROWD && kills < FIGHT_MIN_KILLS) continue;
    const row = { fid: String(b.f), name: b.fn || null, n, k, conv, convAgo: b.convAgo == null ? null : +b.convAgo };
    if (owners && owners[row.fid]) row.owner = owners[row.fid];
    const sp = spawnsOf(b.sp);
    if (sp) row.sp = sp; // 🚐 forward spawns (shown only, not in the odds)
    bases.push(row);
  }
  const size = (x) => x.n.VS + x.n.NC + x.n.TR;
  bases.sort((x, y) => size(y) - size(x) || (y.k.VS + y.k.NC + y.k.TR) - (x.k.VS + x.k.NC + x.k.TR));
  const zp = act.zones && act.zones[z] ? act.zones[z].n : null;
  const caps = capsOf(act, z);
  const at = +act.at || Math.floor(Date.now() / 1000);
  for (const b of bases) { const c = caps.find((x) => String(x.f) === b.fid && at - x.t <= CAP_TAG_S); if (c) b.cap = c; }
  return { at: +act.at || null, live: act.stream !== false, pop: zp ? { ...pick(zp), NSO: Math.max(0, +zp.NSO || 0) } : null, bases: bases.slice(0, FIGHTS_MAX), caps };
}

/**
 * 🏴 Capture tags (cache Worker capture-tags.js) for one continent, newest first: which outfit
 * led each base capture. Outfit tags only; shown, never read by the odds.
 * → [{ t, f, fn, old, fac, tag, share, lead, cr, same, n, quick }]
 */
export function capsOf(act, zone) {
  if (!act || !Array.isArray(act.caps)) return [];
  const z = +zone, out = [];
  const str = (x) => (x == null ? null : String(x).slice(0, 8));
  for (const c of act.caps) {
    if (!c || +c.z !== z || !Number.isFinite(+c.t)) continue;
    out.push({ t: +c.t, f: String(c.f), fn: c.fn ? String(c.fn).slice(0, 60) : null, old: str(c.old), fac: str(c.fac),
      tag: c.oid ? (c.tag || "") : null, share: Math.max(0, Math.min(100, Math.round(+c.share || 0))), lead: !!c.lead,
      cr: c.co ? (c.cr || "") : null, same: !!c.same, n: Math.max(0, Math.round(+c.n || 0)), quick: !!c.quick, ...(spawnsOf(c.sp) ? { sp: spawnsOf(c.sp) } : {}) }); // 🚐
  }
  out.sort((a, b) => b.t - a.t);
  return out.slice(0, CAPS_MAX);
}

/** Compact per-minute record for the `fight` table / archive: [fid, vs, nc, tr, kills, convFac|null, convAgo|null]. */
export function fightRow(f) {
  if (!f) return null;
  return {
    pop: f.pop ? [f.pop.VS, f.pop.NC, f.pop.TR, f.pop.NSO || 0] : null,
    b: f.bases.map((x) => {
      const cf = FACS.reduce((m, q) => (x.conv[q] > (m ? x.conv[m] : 0) ? q : m), null);
      return [x.fid, x.n.VS, x.n.NC, x.n.TR, x.k.VS + x.k.NC + x.k.TR, cf, x.convAgo];
    }),
  };
}
