#!/usr/bin/env node
// 🎬 Pick the 5 reference pairs for test/fixtures/replay-pairs.json (#93) from the cached
// PC data (shards + player files). Inputs only: the two shard rows and the two killboard
// rows, so the pair tests never depend on live data. Deterministic: player files in slug
// order, rows in file order, first match per category; slugs are used in at most one pair.
// Usage: node scripts/pick-replay-pairs.mjs [repoDir=.]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(process.argv[2] || '.');
const { slugOf } = await import(pathToFileURL(path.join(REPO, 'replay/shard.mjs')).href);
const J = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const meta = J('data/replay/meta.json');
const ki = meta.cols.indexOf('kpm'), vi = meta.cols.indexOf('infVeh');
const shards = {};
for (let i = 0; i < 64; i++) {
  const f = path.join(REPO, 'data/replay', i.toString(16).padStart(2, '0') + '.json');
  if (fs.existsSync(f)) Object.assign(shards, J('data/replay/' + i.toString(16).padStart(2, '0') + '.json').p);
}
const files = fs.readdirSync(path.join(REPO, 'data/players')).filter((f) => f.endsWith('.json')).sort();
const rowsOf = (slug) => { try { return J(`data/players/${slug}.json`).player?.rows || []; } catch { return []; } };
const rowFor = (rows, slug) => rows.find((r) => slugOf(r.name) === slug) || null;
const kpm = (s) => shards[s]?.v?.[ki] ?? null, infVeh = (s) => shards[s]?.v?.[vi] ?? null;
const used = new Set();
const pair = (id, aSlug, bSlug) => {
  used.add(aSlug); used.add(bSlug);
  const aRows = rowsOf(aSlug), bRows = rowsOf(bSlug);
  return { id, aSlug, bSlug, aShard: shards[aSlug] || null, bShard: shards[bSlug] || null,
    aRow: rowFor(aRows, bSlug), bRow: rowFor(bRows, aSlug) };
};
const ok = (aSlug, bSlug, test) => {
  if (aSlug === bSlug || used.has(aSlug) || used.has(bSlug)) return false;
  const A = shards[aSlug], B = shards[bSlug];
  if (!A || !B || !A.f || !B.f || A.f === B.f) return false;
  return test(A, B);
};
// (1) fixed reference pair
const tRows = rowsOf('tolyano');
if (!rowFor(tRows, 'fantom220tr')) throw new Error('Tolyano–Fantom220TR row missing from cache');
const pairs = [pair('tolyano-fantom220tr', 'tolyano', 'fantom220tr')];
const want = [
  ['median', (aSlug, bSlug, r) => { const v = (r.kills || 0) + (r.deaths || 0); const ka = kpm(aSlug), kb = kpm(bSlug);
    return v >= 10 && v <= 23 && ka >= 0.25 && ka <= 0.4 && kb >= 0.25 && kb <= 0.4; }],
  ['mismatch', (aSlug, bSlug, r) => { const v = (r.kills || 0) + (r.deaths || 0); return v >= 20 && v > 0 && (r.kills || 0) / v >= 0.75; }],
  ['casual', (aSlug, bSlug, r) => { const v = (r.kills || 0) + (r.deaths || 0); const ka = kpm(aSlug), kb = kpm(bSlug);
    return v >= 4 && v <= 10 && ka >= 0.11 && ka <= 0.2 && kb >= 0.11 && kb <= 0.2; }],
  ['vehicle-heavy', (aSlug, bSlug, r) => { const v = (r.kills || 0) + (r.deaths || 0); const va = infVeh(aSlug), vb = infVeh(bSlug);
    return v >= 4 && ((va >= 25 && va <= 44) || (vb >= 25 && vb <= 44)); }],
];
for (const [id, test] of want) {
  let found = null;
  for (const f of files) {
    const aSlug = f.slice(0, -5);
    if (used.has(aSlug) || !shards[aSlug]) continue;
    for (const r of rowsOf(aSlug)) {
      const bSlug = slugOf(r.name);
      if (ok(aSlug, bSlug, (A, B) => test(aSlug, bSlug, r))) { found = [aSlug, bSlug]; break; }
    }
    if (found) break;
  }
  if (!found) throw new Error('no pair found for ' + id);
  pairs.push(pair(id, found[0], found[1]));
}
const out = { v: 1, at: new Date().toISOString(), pairs };
fs.mkdirSync(path.join(REPO, 'test/fixtures'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'test/fixtures/replay-pairs.json'), JSON.stringify(out, null, 2) + '\n');
for (const p of pairs) console.log(p.id, p.aSlug, 'vs', p.bSlug, '| aRow:', JSON.stringify(p.aRow), '| bRow:', JSON.stringify(p.bRow));
