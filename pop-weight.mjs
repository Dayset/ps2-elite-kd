/**
 * ⚖️ Skill weighted by population (t809u/t810u). The cache holds more of some faction × server cells
 * than really play (looked-up names, crawl order). Each cell (faction × PC server) is weighted to its
 * real share of alert players from the Oracle's Honu reports (/history?days=7, already fetched by the
 * Oracle page), and each faction's ⚔️ iVi median / mean is read from that mix.
 *
 * Build side: popCells(players) → { q: 100, cells: { "vs|osprey": { n, mean, p: [101 quantiles] } } }
 * (written into data/factions.json). Page side: alertPop(alerts) + weightedSkill(cells, pop).
 */
export const POP_FACTIONS = Object.freeze(["vs", "nc", "tr", "nso"]);
export const POP_SERVERS = Object.freeze({ 1: "osprey", 17: "osprey", 10: "wainwright", 13: "wainwright" });
export const POP_Q = 100;
const fin = Number.isFinite;

/** Quantile of a sorted array (linear). */
function qs(s, q) {
  if (!s.length) return null;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** @param {{faction:string|null, server:string|null, adjs:number|null}[]} players rated rows (no OOR / padders / thin) */
export function popCells(players) {
  const by = {};
  for (const p of players || []) {
    if (!p || !POP_FACTIONS.includes(p.faction) || !p.server || !fin(p.adjs)) continue;
    (by[`${p.faction}|${p.server}`] ||= []).push(p.adjs);
  }
  const cells = {};
  for (const [k, v] of Object.entries(by)) {
    v.sort((a, b) => a - b);
    const p = [];
    for (let i = 0; i <= POP_Q; i++) p.push(Math.round(qs(v, i / POP_Q)));
    cells[k] = { n: v.length, mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length), p };
  }
  return { q: POP_Q, cells };
}

/**
 * Real players per cell from settled-alert reports: report.faction[F].players per world; NS = report.players
 * minus the three factions (Honu counts NSO apart). Returns { pop: { "vs|osprey": n }, alerts }.
 */
export function alertPop(alerts) {
  const pop = {};
  let n = 0;
  for (const a of alerts || []) {
    const r = a && a.report, srv = a && POP_SERVERS[+a.world];
    if (!srv || !r || !r.faction) continue;
    let sum = 0, any = false;
    for (const f of ["VS", "NC", "TR"]) {
      const v = +(r.faction[f] && r.faction[f].players);
      if (!(v > 0)) continue;
      pop[`${f.toLowerCase()}|${srv}`] = (pop[`${f.toLowerCase()}|${srv}`] || 0) + v; sum += v; any = true;
    }
    if (!any) continue;
    n++;
    const ns = (+r.players || 0) - sum;
    if (ns > 0) pop[`nso|${srv}`] = (pop[`nso|${srv}`] || 0) + ns;
  }
  return { pop, alerts: n };
}

/** CDF of one cell's quantile table at x. */
function cdf(p, x) {
  const last = p.length - 1;
  if (x < p[0]) return 0;
  if (x >= p[last]) return 1;
  let i = 0;
  while (i < last && p[i + 1] <= x) i++;
  const span = p[i + 1] - p[i];
  return (i + (span > 0 ? (x - p[i]) / span : 0)) / last;
}

/**
 * Per faction: the median and mean of its cells mixed by real population (each server weighted by that
 * faction's real players there). Null for a faction without cells or population.
 * @returns {{ [f:string]: { med:number, mean:number, n:number } | null }}
 */
export function weightedSkill(cellsInfo, pop) {
  const cells = (cellsInfo && cellsInfo.cells) || {};
  const out = {};
  for (const f of POP_FACTIONS) {
    const parts = Object.entries(cells).filter(([k, c]) => k.split("|")[0] === f && c && Array.isArray(c.p) && c.p.length > 1 && (pop[k] || 0) > 0)
      .map(([k, c]) => ({ c, m: pop[k] }));
    if (!parts.length) { out[f] = null; continue; }
    const M = parts.reduce((a, x) => a + x.m, 0);
    const F = (x) => parts.reduce((a, x2) => a + x2.m * cdf(x2.c.p, x), 0) / M;
    let lo = Math.min(...parts.map((x) => x.c.p[0])), hi = Math.max(...parts.map((x) => x.c.p[x.c.p.length - 1]));
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (F(mid) < 0.5) lo = mid; else hi = mid; }
    out[f] = { med: Math.round((lo + hi) / 2), mean: Math.round(parts.reduce((a, x) => a + x.m * x.c.mean, 0) / M), n: parts.reduce((a, x) => a + x.c.n, 0) };
  }
  return out;
}
