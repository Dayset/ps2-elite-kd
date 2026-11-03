// 🎬 Replay pair mode (#93): two players, their shared killboard row, and who wins how often.
// Pure (no DOM, no fetch): the page resolves docs and rows, this module decides.
import { duelExpected, bareName } from '../duels.mjs?v=20261102-luck5';
import { slugOf } from './shard.mjs';

/** Bayesian shrink towards the iVi prediction: pA = (kills + m·p0) / (kills + deaths + m). */
export const PAIR_SHRINK_M = 20;
/** Stat ids a synthesized side fills from population medians (meta.json `med`). */
export const MED_KEYS = ['kpm', 'dpm', 'acc', 'hsr', 'spk', 'hpk', 'apk', 'infVeh'];
/** Fallback medians (same pools as scripts/build-replay.mjs, computed 2026-11-03); a current
 *  meta.json `med` always overrides these, so they only cover a stale meta. */
export const MED_FALLBACK = { kpm: 0.303, dpm: 0.324, acc: 20.03, hsr: 18.26, spk: 39.48, hpk: 10.39, apk: 0.439, infVeh: 14.8 };

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
/** Killboard row for a slug (row names may carry an outfit tag; slugOf strips it). */
export function findRow(rows, slug) { return (rows || []).find((r) => slugOf(r.name) === slug) || null; }
/**
 * The shared row between A and B, from A's side when present, else B's side flipped
 * (B's kills on A become A's deaths). kpm is the pair pace from whichever side lists the
 * pair, A's side preferred. null when neither side lists the pair.
 */
export function pairRow(aRows, bRows, aSlug, bSlug) {
  const ra = findRow(aRows, bSlug);
  if (ra) return { kills: ra.kills || 0, deaths: ra.deaths || 0, kpm: fin(ra.kpm) ? ra.kpm : null, from: 'a', name: bareName(ra.name) };
  const rb = findRow(bRows, aSlug);
  if (rb) return { kills: rb.deaths || 0, deaths: rb.kills || 0, kpm: fin(rb.kpm) ? rb.kpm : null, from: 'b', name: bareName(rb.name) };
  return null;
}
/**
 * Whether a pair can play: 'sameFaction' when both factions are known and equal,
 * 'notFound' when B has neither a shard doc nor a killboard row, else 'pair'. An unknown
 * faction (null) never counts as same — only a confirmed same faction falls back to crowd.
 */
export function pairStatus(aDoc, bDoc, row) {
  if (bDoc && aDoc && aDoc.faction && bDoc.faction && aDoc.faction === bDoc.faction) return 'sameFaction';
  if (!bDoc && !row) return 'notFound';
  return 'pair';
}
/** A's killboard opponents worth rivalling, best first: skip the "0" row and zero-volume
 *  rows; most kills+deaths wins, ties go to more deaths. Faction is NOT decided here — the
 *  caller probes it (shard files) and feeds defaultRival. */
export function rankedRivals(aDoc, aRows) {
  const out = [];
  for (const r of aRows || []) {
    if (bareName(r.name) === '0') continue;
    const kills = r.kills || 0, deaths = r.deaths || 0;
    if (kills + deaths <= 0) continue;
    out.push({ row: r, slug: slugOf(r.name), kills, deaths });
  }
  out.sort((x, y) => (y.kills + y.deaths) - (x.kills + x.deaths) || y.deaths - x.deaths);
  return out;
}
/** First ranked rival whose faction is known and differs from A's (factionOf: slug -> faction
 *  or null when unknown). null when no confirmed cross-faction rival exists. */
export function defaultRival(aDoc, aRows, factionOf) {
  for (const c of rankedRivals(aDoc, aRows)) {
    const f = factionOf ? factionOf(c.slug) : null;
    if (f && f !== aDoc.faction) return c;
  }
  return null;
}
/**
 * pairOf({ aDoc, bDoc, aRows, bRows, fit, med, bSlug, bName }) -> { a, b, row, pA, pSrc, n, missing }.
 * aDoc is required (the page's own doc). bDoc may be null: then B is synthesized from the
 * pair row (KPM) and population medians (everything else), and those ids land in missing.b.
 * bSlug is required to find the killboard row when B has no shard doc; bName is the display
 * fallback for a synthesized B (e.g. the ?vs= input) when no row names them.
 * pA: with a row, the row share shrunk towards the iVi prediction p0 (m = 20); without a
 * row, p0 itself ('ivi'); with neither a row nor a usable fit, 0.5 ('even'). Vehicle shares
 * enter the fit as fractions (shard infVeh is a percent); a null share lets the fit fall
 * back to its own median. missing lists, per side, the MED_KEYS that did not come from real
 * data (null in the doc, or filled from medians for a synthesized B).
 */
export function pairOf({ aDoc, bDoc, aRows, bRows, fit, med, bSlug, bName }) {
  if (!aDoc) throw new Error('pairOf: aDoc is required');
  const full = pairRow(aRows, bRows, aDoc.slug, bSlug);
  const row = full ? { kills: full.kills, deaths: full.deaths } : null;
  const n = row ? row.kills + row.deaths : 0;
  const frac = (v) => (v == null ? null : v / 100);
  const exp = duelExpected(aDoc.stats?.adjs?.v ?? null, bDoc?.stats?.adjs?.v ?? null, fit,
    frac(aDoc.stats?.infVeh?.v), bDoc ? frac(bDoc.stats?.infVeh?.v) : null);
  let pA, pSrc;
  if (row) { const p0 = exp ?? 0.5; pA = (row.kills + PAIR_SHRINK_M * p0) / (n + PAIR_SHRINK_M); pSrc = 'row'; }
  else if (exp != null) { pA = exp; pSrc = 'ivi'; }
  else { pA = 0.5; pSrc = 'even'; }
  const medFor = (id) => (med && fin(med[id]) ? med[id] : MED_FALLBACK[id]);
  const missingFor = (doc) => MED_KEYS.filter((id) => doc?.stats?.[id]?.v == null);
  let b, missingB;
  if (bDoc) { b = bDoc; missingB = missingFor(bDoc); }
  else {
    const stats = {};
    for (const id of MED_KEYS) stats[id] = { v: medFor(id), p: null };
    if (full?.kpm != null) stats.kpm = { v: full.kpm, p: null };
    missingB = MED_KEYS.filter((id) => !(id === 'kpm' && full?.kpm != null));
    b = { name: (full?.from === 'a' ? full.name : null) || bName || bSlug, slug: bSlug, faction: null, server: '',
      poolSize: aDoc.poolSize, stats, builtAt: aDoc.builtAt, luck: null, fightStart: null, hasXp: false,
      main: null, classes: null };
  }
  return { a: aDoc, b, row, pA, pSrc, n, missing: { a: missingFor(aDoc), b: missingB } };
}
