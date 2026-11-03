// 🎬 Replay doc: one compact shard row (scripts/build-replay.mjs, positional by meta.cols)
// -> the doc the scene reads. Moved verbatim from replay/player.js (#93) so the pair
// module and the planner can build the same doc for either side; the caller passes the
// row's own slug (the page used to close over its own).
export function toDoc(e, { meta, catalog, slug }) {
  const stats = {}; meta.cols.forEach((id, i) => { if (e.v?.[i] != null) stats[id] = { v: e.v[i], p: e.p?.[i] ?? null }; });
  const w = e.m && catalog?.items?.[e.m[0]];
  return { name: e.n, slug, faction: e.f || 'tr', server: e.s || '', poolSize: meta.pool, stats, builtAt: meta.ranksAt,
    luck: e.l != null ? { pts: e.l } : null, fightStart: e.fs || null, hasXp: !!e.x,
    main: e.m ? { id: e.m[0], name: w?.[0] ?? '', cat: w?.[1] ?? '', img: e.m[2] && w?.[3] ? String(w[3]) : null, kills: e.m[1] } : null,
    classes: e.c && meta.classCols ? Object.fromEntries(meta.classCols.map((k, i) => [k, e.c[i]])) : null };
}
