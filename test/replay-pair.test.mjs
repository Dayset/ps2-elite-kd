// 🎬 Replay pair mode (#93): shrink, default rival, same faction, B missing from the cache.
// Fixture pairs are inputs only (test/fixtures/replay-pairs.json); docs are built with the
// same toDoc the page uses, so the tests never depend on live data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toDoc } from '../replay/doc.mjs';
import { pairOf, pairStatus, defaultRival, rankedRivals, pairRow, MED_KEYS, PAIR_SHRINK_M } from '../replay/pair.mjs';
import { duelExpected } from '../duels.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const meta = JSON.parse(fs.readFileSync(ROOT + 'data/replay/meta.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync(ROOT + 'assets/weapons/catalog.json', 'utf8'));
const fit = JSON.parse(fs.readFileSync(ROOT + 'data/duel-ivi-fit.json', 'utf8'));
const fx = JSON.parse(fs.readFileSync(ROOT + 'test/fixtures/replay-pairs.json', 'utf8'));
const docOf = (p, side) => toDoc(p[side + 'Shard'], { meta, catalog, slug: p[side + 'Slug'] });
const rowsOf = (p, side) => { const r = p[side + 'Row']; return r ? [r] : []; };
const approx = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

test('toDoc move: same doc the page reads', () => {
  const p = fx.pairs[0], d = docOf(p, 'a');
  assert.equal(d.name, 'TolyaNo'); assert.equal(d.slug, 'tolyano'); assert.equal(d.faction, 'nc');
  assert.equal(d.stats.kpm.v, 1.44); assert.equal(d.stats.adjs.v, 1700); assert.equal(d.main.id, 7236);
});

test('shrink: Tolyano vs Fantom220TR wins ~40%', () => {
  const p = fx.pairs[0];
  const pair = pairOf({ aDoc: docOf(p, 'a'), bDoc: docOf(p, 'b'), aRows: rowsOf(p, 'a'), bRows: rowsOf(p, 'b'), fit, med: meta.med, bSlug: p.bSlug });
  assert.deepEqual(pair.row, { kills: 537, deaths: 794 }); assert.equal(pair.n, 1331); assert.equal(pair.pSrc, 'row');
  assert.ok(approx(pair.pA, 0.40, 0.02), `pA ${pair.pA}`);
  assert.equal(pair.b.name, 'Fantom220TR'); assert.deepEqual(pair.missing, { a: [], b: [] });
});

test('shrink formula: row share pulled towards the iVi prediction', () => {
  const a = { name: 'A', slug: 'a', faction: 'nc', poolSize: 0, stats: { adjs: { v: 1000 }, infVeh: { v: 0 } }, builtAt: '' };
  const b = { name: 'B', slug: 'b', faction: 'tr', poolSize: 0, stats: { adjs: { v: 1000 }, infVeh: { v: 0 } }, builtAt: '' };
  const rows = [{ name: 'B', kills: 30, deaths: 10, kpm: 1 }];
  const pair = pairOf({ aDoc: a, bDoc: b, aRows: rows, bRows: [], fit, med: meta.med, bSlug: 'b' });
  const p0 = duelExpected(1000, 1000, fit, 0, 0);
  assert.equal(pair.pA, (30 + PAIR_SHRINK_M * p0) / (40 + PAIR_SHRINK_M));
});

test('no row: iVi prediction, then even', () => {
  const a = { name: 'A', slug: 'a', faction: 'nc', poolSize: 0, stats: { adjs: { v: 1500 }, infVeh: { v: 10 } }, builtAt: '' };
  const b = { name: 'B', slug: 'b', faction: 'tr', poolSize: 0, stats: { adjs: { v: 1000 }, infVeh: { v: 10 } }, builtAt: '' };
  const ivi = pairOf({ aDoc: a, bDoc: b, aRows: [], bRows: [], fit, med: meta.med, bSlug: 'b' });
  assert.equal(ivi.pSrc, 'ivi'); assert.equal(ivi.pA, duelExpected(1500, 1000, fit, 0.1, 0.1)); assert.equal(ivi.n, 0);
  const even = pairOf({ aDoc: a, bDoc: b, aRows: [], bRows: [], fit: null, med: meta.med, bSlug: 'b' });
  assert.equal(even.pSrc, 'even'); assert.equal(even.pA, 0.5);
});

test('mirrored row: B lists A, A does not list B', () => {
  const p = fx.pairs[1]; // median pair: only A's row exists in the fixture
  assert.equal(p.bRow, null);
  const pair = pairOf({ aDoc: docOf(p, 'a'), bDoc: docOf(p, 'b'), aRows: rowsOf(p, 'a'), bRows: [], fit, med: meta.med, bSlug: p.bSlug });
  assert.equal(pair.pSrc, 'row'); assert.equal(pair.row.kills, 7); assert.equal(pair.row.deaths, 12);
  const a = docOf(p, 'a'), b = docOf(p, 'b');
  const flipped = pairOf({ aDoc: b, bDoc: a, aRows: [], bRows: rowsOf(p, 'a'), fit, med: meta.med, bSlug: p.aSlug });
  assert.equal(flipped.row.kills, 12); assert.equal(flipped.row.deaths, 7); // flipped to B's side
  assert.equal(pairRow([], rowsOf(p, 'a'), p.bSlug, p.aSlug).from, 'b');
});

test('default rival: most volume, ties to more deaths, skip "0" and same faction', () => {
  const a = { name: 'A', slug: 'a', faction: 'nc', poolSize: 0, stats: {}, builtAt: '' };
  const rows = [
    { name: '0', kills: 999, deaths: 999, kpm: 1 },
    { name: '[XX] SameFac', kills: 500, deaths: 500, kpm: 1 },
    { name: 'TieLow', kills: 100, deaths: 50, kpm: 1 },
    { name: 'TieHigh', kills: 90, deaths: 60, kpm: 1 },
    { name: 'Quiet', kills: 1, deaths: 0, kpm: 1 },
  ];
  const fac = (s) => (s === 'samefac' ? 'nc' : 'tr');
  assert.equal(defaultRival(a, rows, fac).slug, 'tiehigh'); // 150 vol beats 150? no: TieHigh 150 = TieLow 150, more deaths wins
  assert.equal(defaultRival(a, [{ name: 'SameFac', kills: 10, deaths: 10 }], fac), null);
  assert.equal(defaultRival(a, [{ name: 'Zero', kills: 0, deaths: 0 }], fac), null);
  assert.deepEqual(rankedRivals(a, rows).map((c) => c.slug), ['samefac', 'tiehigh', 'tielow', 'quiet']);
});

test('same faction / not found gating', () => {
  const a = { name: 'A', slug: 'a', faction: 'nc', poolSize: 0, stats: {}, builtAt: '' };
  const same = { name: 'B', slug: 'b', faction: 'nc', poolSize: 0, stats: {}, builtAt: '' };
  const other = { ...same, faction: 'tr' };
  const row = { kills: 5, deaths: 5 };
  assert.equal(pairStatus(a, same, row), 'sameFaction');
  assert.equal(pairStatus(a, other, row), 'pair');
  assert.equal(pairStatus(a, other, null), 'pair'); // shard doc alone is enough (ivi odds)
  assert.equal(pairStatus(a, null, row), 'pair'); // row alone is enough (synthesized B)
  assert.equal(pairStatus(a, null, null), 'notFound');
  assert.equal(pairStatus(a, { ...other, faction: null }, row), 'pair'); // unknown faction never counts as same
});

test('B missing from the cache: synthesized from the row + medians', () => {
  const p = fx.pairs[0];
  const pair = pairOf({ aDoc: docOf(p, 'a'), bDoc: null, aRows: rowsOf(p, 'a'), bRows: [], fit, med: meta.med, bSlug: p.bSlug });
  assert.equal(pair.b.name, 'Fantom220TR'); assert.equal(pair.b.faction, null);
  assert.equal(pair.b.stats.kpm.v, 1.8548258502276838); // the pair row's KPM, not the median
  assert.equal(pair.b.stats.acc.v, meta.med.acc);
  assert.deepEqual(pair.missing.b, MED_KEYS.filter((k) => k !== 'kpm'));
  assert.equal(pair.pSrc, 'row'); assert.ok(approx(pair.pA, 0.40, 0.02), `pA ${pair.pA}`);
  const noMed = pairOf({ aDoc: docOf(p, 'a'), bDoc: null, aRows: rowsOf(p, 'a'), bRows: [], fit, med: null, bSlug: p.bSlug });
  assert.equal(noMed.b.stats.acc.v, 20.03); // stale-meta fallback
});

test('fixture pairs meet their selection bands', () => {
  assert.equal(fx.pairs.length, 5);
  const byId = Object.fromEntries(fx.pairs.map((p) => [p.id, p]));
  const k = (p, s) => docOf(p, s).stats.kpm.v, v = (p, s) => docOf(p, s).stats.infVeh.v;
  const vol = (p) => p.aRow.kills + p.aRow.deaths;
  assert.ok(k(byId.median, 'a') >= 0.25 && k(byId.median, 'a') <= 0.4 && k(byId.median, 'b') >= 0.25 && k(byId.median, 'b') <= 0.4);
  assert.ok(vol(byId.median) >= 10 && vol(byId.median) <= 23);
  assert.ok(vol(byId.mismatch) >= 20 && byId.mismatch.aRow.kills / vol(byId.mismatch) >= 0.75);
  assert.ok(k(byId.casual, 'a') >= 0.11 && k(byId.casual, 'a') <= 0.2 && k(byId.casual, 'b') >= 0.11 && k(byId.casual, 'b') <= 0.2);
  assert.ok(vol(byId.casual) >= 4 && vol(byId.casual) <= 10);
  assert.ok((v(byId['vehicle-heavy'], 'a') >= 25 && v(byId['vehicle-heavy'], 'a') <= 44) ||
    (v(byId['vehicle-heavy'], 'b') >= 25 && v(byId['vehicle-heavy'], 'b') <= 44));
  for (const p of fx.pairs) assert.notEqual(docOf(p, 'a').faction, docOf(p, 'b').faction);
});
