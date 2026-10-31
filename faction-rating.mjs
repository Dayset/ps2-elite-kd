/**
 * 🏳️ Faction rating (t795u, owner: "among player families that have multiple alts what's the strongest faction?
 * Make a global rating section NC TR VS NS, the alias would be NC or VS in the character input field").
 *
 * Built once per ranks build (scripts/build-ranks.mjs → data/factions.json) from the cached PC players, no network:
 *   - every faction: player count, median / mean ⚔️ iVi, median K/D, KPM and play time, its share of the top 10%
 *     and of the top 100 by ⚔️ iVi;
 *   - the alt-family comparison: families (familyIndex: the site's own alt groups) with alts on 2+ factions. Each
 *     faction's value inside a family is the play-time-weighted mean of its alts there, so the same person is
 *     compared with themselves; head-to-head wins count, per pair of factions in a family, which one was higher.
 *   - top players per faction (up to OUTFIT_MAX_NAMES = 50) for the name-box alias ("NC", "TR", "VS", "NS"/"NSO").
 * Left out: hidden players (not in ranks.json: OOR and other hides), confirmed padders (reviewed.json
 * "padding"), rows with too few fights (no ⚔️ iVi), and, in the family part, alts under the p10 play time of all
 * rated players (threshold from the data, written in the file). Faction comes from the player file ("faction",
 * saved since #80) or data/faction-backfill.json (Census, filled once for older files). DOM-free.
 */

export const FACTIONS = Object.freeze(["nc", "tr", "vs", "nso"]);
export const FACTION_LABEL = Object.freeze({ nc: "NC", tr: "TR", vs: "VS", nso: "NS" });
/** Faction colours, the same as the 🎥 live page (live.mjs). */
export const FACTION_COLOR = Object.freeze({ nc: "#3b82f6", tr: "#ef4444", vs: "#a855f7", nso: "#9ca3af" });
/** Top players an alias adds (the outfit-tag cap, outfit-tags.mjs OUTFIT_MAX_NAMES). */
export const FACTION_TOP_N = 50;
/** Family part: alts under this quantile of play time (all rated players) are too new to compare. */
export const FAMILY_MIN_PLAY_Q = 0.1;
/** Top share: the best TOP_SHARE_Q of rated players by ⚔️ iVi. */
export const TOP_SHARE_Q = 0.1;
/** Alias players: active within this many days first (the outfit-tag 6-month rule). */
export const ACTIVE_DAYS = 183;

/**
 * Typed alias → faction. Census has no active character named NC, TR, VS or NS (checked 2026-10-31); "NSO" is one
 * character last seen 2012-11-25 (battle rank 0), so it is an alias too.
 */
const ALIAS = Object.freeze({ nc: "nc", tr: "tr", vs: "vs", ns: "nso", nso: "nso" });

/** "NC" / "vs" / "Ns" → "nc" / "vs" / "nso"; anything else → null. */
export function factionAlias(token) {
  const k = String(token || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : null;
}

/**
 * Pull stand-alone faction words out of raw name-field text ("nc", "VS, Sarleyy" → ["nc"], "Sarleyy").
 * Only whole tokens (split on space, comma, semicolon) count; "[NC]" stays an outfit tag.
 * @returns {{ factions: string[], rest: string }}
 */
export function extractFactionAliases(raw) {
  const factions = [];
  const rest = String(raw || "").replace(/(^|[\s,;])([A-Za-z]{2,3})(?=$|[\s,;])/g, (all, lead, w) => {
    const f = factionAlias(w);
    if (!f) return all;
    if (!factions.includes(f)) factions.push(f);
    return lead;
  });
  return { factions, rest: factions.length ? rest.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/([,;])\s*[,;]+/g, "$1") : String(raw || "").trim() };
}

const fin = Number.isFinite;
const median = (xs) => {
  const s = xs.filter(fin).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const mean = (xs) => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const quantile = (xs, q) => { const s = xs.filter(fin).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : null; };
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);

/** Faction tag of a player file: its own "faction" (since #80), else the Census backfill by character id. */
export function factionOf(pl, backfill) {
  const f = pl && pl.faction;
  if (FACTIONS.includes(f)) return f;
  const b = backfill && pl && pl.cid != null ? backfill[String(pl.cid)] : null;
  return FACTIONS.includes(b) ? b : null;
}

/**
 * @param {{ slug:string, name:string, faction:string|null, adjs:number|null, kd:number|null, kpm:number|null,
 *           playH:number|null, last?:number|null, thin?:boolean, padder?:boolean }[]} players
 * @param {Record<string,string>} famOf slug → family key (heavy-support.mjs familyIndex)
 * @param {{ now?:number, topN?:number }} [o]
 */
export function buildFactionRating(players, famOf = {}, { now = Date.now(), topN = FACTION_TOP_N } = {}) {
  const rated = (players || []).filter((p) => p && FACTIONS.includes(p.faction) && !p.padder && !p.thin && fin(p.adjs));
  const left = { padders: (players || []).filter((p) => p && p.padder).length, noFaction: (players || []).filter((p) => p && !FACTIONS.includes(p.faction)).length, thin: (players || []).filter((p) => p && !p.padder && (p.thin || !fin(p.adjs))).length };
  const byIvi = [...rated].sort((a, b) => b.adjs - a.adjs);
  const topCut = Math.max(1, Math.round(byIvi.length * TOP_SHARE_Q));
  const top = byIvi.slice(0, topCut);
  const top100 = byIvi.slice(0, 100);
  const factions = {};
  for (const f of FACTIONS) {
    const g = rated.filter((p) => p.faction === f);
    const nTop = top.filter((p) => p.faction === f).length;
    factions[f] = {
      n: g.length,
      medIvi: r1(median(g.map((p) => p.adjs))),
      meanIvi: r1(mean(g.map((p) => p.adjs))),
      p90Ivi: r1(quantile(g.map((p) => p.adjs), 0.9)),
      medKd: r2(median(g.map((p) => p.kd))),
      medKpm: r3(median(g.map((p) => p.kpm))),
      medH: r1(median(g.map((p) => p.playH))),
      top: nTop,
      topShare: byIvi.length ? r3(nTop / top.length) : null,
      topRate: g.length ? r3(nTop / g.length) : null,
      top100: top100.filter((p) => p.faction === f).length,
    };
  }

  // Alt families: alts with enough play time, families with alts on 2+ factions.
  const minH = quantile(rated.map((p) => p.playH), FAMILY_MIN_PLAY_Q);
  const fam = new Map();
  for (const p of rated) {
    const k = famOf[p.slug];
    if (!k || !(fin(p.playH) && p.playH >= minH && p.playH > 0)) continue;
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(p);
  }
  const blank = () => Object.fromEntries(FACTIONS.map((f) => [f, []]));
  const delta = blank(), kdR = blank(), kpmR = blank();
  const best = Object.fromEntries(FACTIONS.map((f) => [f, 0]));
  const h2h = Object.fromEntries(FACTIONS.map((f) => [f, { w: 0, n: 0 }]));
  const pairs = {};
  let nFam = 0, nAlts = 0;
  for (const members of fam.values()) {
    const by = {};
    for (const p of members) (by[p.faction] = by[p.faction] || []).push(p);
    const fs = FACTIONS.filter((f) => by[f]);
    if (fs.length < 2) continue;
    nFam++;
    nAlts += members.length;
    const wm = (l, key) => { const w = l.reduce((s, p) => s + p.playH, 0); return l.reduce((s, p) => s + p[key] * p.playH, 0) / w; };
    const v = Object.fromEntries(fs.map((f) => [f, { i: wm(by[f], "adjs"), kd: wm(by[f], "kd"), kpm: wm(by[f], "kpm") }]));
    const avg = (key) => fs.reduce((s, f) => s + v[f][key], 0) / fs.length;
    const mi = avg("i"), mk = avg("kd"), mp = avg("kpm");
    best[fs.reduce((a, f) => (v[f].i > v[a].i ? f : a))]++;
    for (const f of fs) {
      delta[f].push(v[f].i - mi);
      if (mk > 0) kdR[f].push(v[f].kd / mk);
      if (mp > 0) kpmR[f].push(v[f].kpm / mp);
    }
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i], b = fs[j], key = a + "-" + b;
      const w = v[a].i >= v[b].i ? a : b;
      pairs[key] = pairs[key] || { n: 0, [a]: 0, [b]: 0 };
      pairs[key].n++;
      pairs[key][w]++;
      h2h[a].n++; h2h[b].n++; h2h[w].w++;
    }
  }
  const families = {
    n: nFam,
    alts: nAlts,
    minH: r1(minH),
    best,
    h2h: Object.fromEntries(FACTIONS.map((f) => [f, { ...h2h[f], rate: h2h[f].n ? r3(h2h[f].w / h2h[f].n) : null }])),
    pairs,
    delta: Object.fromEntries(FACTIONS.map((f) => [f, { n: delta[f].length, mean: r1(mean(delta[f])), med: r1(median(delta[f])) }])),
    kd: Object.fromEntries(FACTIONS.map((f) => [f, r3(median(kdR[f]))])),
    kpm: Object.fromEntries(FACTIONS.map((f) => [f, r3(median(kpmR[f]))])),
  };

  // Alias lists: best ⚔️ iVi first, players active in the last ACTIVE_DAYS before the rest.
  const cutSec = now / 1000 - ACTIVE_DAYS * 86400;
  const lists = {};
  for (const f of FACTIONS) {
    const g = byIvi.filter((p) => p.faction === f);
    const act = g.filter((p) => fin(p.last) && p.last >= cutSec);
    const rest = g.filter((p) => !(fin(p.last) && p.last >= cutSec));
    lists[f] = [...act, ...rest].slice(0, topN).map((p) => p.name);
  }
  return { v: 1, rated: rated.length, topCut, left, factions, families, top: lists };
}

/** Faction with the highest value of pick(stats) (ties: first in FACTIONS order). */
export function leader(fr, pick) {
  let b = null, bv = -Infinity;
  for (const f of FACTIONS) { const x = pick(fr, f); if (fin(x) && x > bv) { bv = x; b = f; } }
  return b;
}
