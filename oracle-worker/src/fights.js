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
export const FIGHTS_MAX = 8;          // bases kept per alert per minute
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
    bases.push(row);
  }
  const size = (x) => x.n.VS + x.n.NC + x.n.TR;
  bases.sort((x, y) => size(y) - size(x) || (y.k.VS + y.k.NC + y.k.TR) - (x.k.VS + x.k.NC + x.k.TR));
  const zp = act.zones && act.zones[z] ? act.zones[z].n : null;
  return { at: +act.at || null, live: act.stream !== false, pop: zp ? { ...pick(zp), NSO: Math.max(0, +zp.NSO || 0) } : null, bases: bases.slice(0, FIGHTS_MAX) };
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
