// 🎬 Replay crowd opponents (#103): weighted picks + draws, pure + deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWeighted, drawOpponents } from '../replay/crowd.mjs';

const seqRng = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

test('pickWeighted: fixed draws land on the weighted item, null on empty/zero weights', () => {
  const items = [{ n: 'a', w: 10 }, { n: 'b', w: 30 }, { n: 'c', w: 60 }];
  assert.equal(pickWeighted(items, (x) => x.w, seqRng([0])).n, 'a');
  assert.equal(pickWeighted(items, (x) => x.w, seqRng([0.11])).n, 'b'); // r=11: past a's 10, inside b's 30
  assert.equal(pickWeighted(items, (x) => x.w, seqRng([0.999])).n, 'c');
  assert.equal(pickWeighted([], () => 1, seqRng([0.5])), null);
  assert.equal(pickWeighted([{ w: 0 }, { w: 0 }], (x) => x.w, seqRng([0.5])), null);
});

test('drawOpponents: at most n, distinct, deterministic for one seed, all when fewer', () => {
  const pool = [
    { slug: 'a', kills: 50, deaths: 50 }, { slug: 'b', kills: 30, deaths: 10 },
    { slug: 'c', kills: 5, deaths: 5 }, { slug: 'd', kills: 1, deaths: 1 },
    { slug: 'e', kills: 100, deaths: 0 }, { slug: 'f', kills: 0, deaths: 40 },
  ];
  const one = drawOpponents(pool, 3, seqRng([0.05, 0.9, 0.2]));
  const two = drawOpponents(pool, 3, seqRng([0.05, 0.9, 0.2]));
  assert.deepEqual(one, two, 'same seed -> same draw');
  assert.equal(one.length, 3);
  assert.equal(new Set(one.map((x) => x.slug)).size, 3, 'no repeats');
  assert.ok(one.every((x) => pool.includes(x)), 'drawn from the pool');
  const few = drawOpponents(pool.slice(0, 2), 5, seqRng([0.5]));
  assert.equal(few.length, 2, 'fewer candidates than n -> all of them');
});
