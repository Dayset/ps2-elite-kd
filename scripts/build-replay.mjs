#!/usr/bin/env node
// 🎬 Replay page data (replay/index.html). Reads the PC cache (data/ranks.json, data/players,
// data/xp, data/class-times.json, data/duel-ivi-player.json, assets/weapons/catalog.json) and
// writes data/replay/<shard>.json (replay/shard.mjs) with each cached player's values and their
// percentile among all cached PC players, plus data/replay/meta.json. No network.
// Uses the site's own modules for 🪳 Zerg, 🎲 Luck and the crowd check, so numbers match the site.
// A missing value stays missing (the page then uses a neutral default and says so).
// Usage: node scripts/build-replay.mjs [repoDir=.]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(process.argv[2] || '.');
const OUT = path.join(REPO, 'data/replay');
const imp = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const { shardOf, SHARDS } = await imp('replay/shard.mjs');
const { percentileOf } = await imp('dist.mjs');
const { traitPools, zergScore, aimGap } = await imp('trait-scores.mjs');
const { playerLuck } = await imp('duels.mjs');
const { crowdSample } = await imp('zerg-revive.mjs');
const J = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
// XP ids per scene state (names from the site's data/exp-types.json, so nothing is guessed)
const EXP_NAMES = (() => { try { return J('data/exp-types.json').types || {}; } catch { return {}; } })();
const expIds = (re) => Object.entries(EXP_NAMES).filter(([, v]) => re.test(v[0]) && !/HIVE/.test(v[0])).map(([k]) => k);
const XP_GROUPS = {
  resupplyPm: ['34', '55'],                                   // Resupply Player, Squad Resupply
  capturePm: ['15', '16', '272', '556', '557'],               // control point attack/defend, convert, objective pulses
  repairPm: expIds(/Repair/),                                  // every repair tick (vehicles, MAX, terminals, constructions)
};

const ranks = J('data/ranks.json');
const ix = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
const rows = ranks.rows.map((r) => Object.fromEntries(ranks.cols.map((c, i) => [c, r[i]])));
const col = (id) => rows.map((o) => o[id]);
const tp = traitPools({ adjs: col('adjs'), ivi: col('ivi'), inflation: col('inflation'), apk: col('apk') });
const luckData = J('data/duel-ivi-player.json');
const classes = J('data/class-times.json');
const catalog = J('assets/weapons/catalog.json').items;
const INF_CATS = new Set(['Pistol', 'LMG', 'Assault Rifle', 'SMG', 'Carbine', 'Sniper Rifle', 'Scout Rifle', 'Shotgun', 'Heavy Weapon', 'Battle Rifle', 'Crossbow', 'Infantry Weapons', 'Hybrid Rifle']);
const bare = (n) => String(n || '').replace(/^\[[^\]]*\]\s*/, '').toLowerCase();
const adjsByName = new Map(rows.map((o) => [bare(o.name), o.adjs]));

// derived per-row values
for (const o of rows) {
  const z = zergScore(tp, o.inflation, o.apk, o.rvp, o.crp);
  o.zerg = z ? z.score : null;
  const g = aimGap(tp, o.adjs, o.ivi, o.hut, o.vdf, o.nbd);
  o.diff = g ? g.score : null;
  const l = playerLuck(luckData, o.slug);
  o.luck = l ? Math.round(l.gap * 1000) / 10 : null; o.luckOpps = l ? l.opps : null; o.luckLvl = l ? (l.up ? 1 : -1) * l.lvl : null;
  o.dpm = fin(o.kpm) && fin(o.kd) && o.kd > 0 ? o.kpm / o.kd : null;
}

// per-player-file values (weapons, opponents, assists) for everyone, for the pools
function fileStats(slug) {
  const f = path.join(REPO, 'data/players', slug + '.json');
  if (!fs.existsSync(f)) return null;
  let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')).player; } catch { return null; }
  if (!p) return null;
  const out = { faction: p.faction || null, world: p.world ?? null, display: p.display };
  const W = p.weapons && p.weapons.v === 1 ? p.weapons.rows : null;
  if (W) {
    // PACK: id, kills, hs, vk, killedBy, dmg, deaths, shots, hits, secs, score
    const inf = W.map((r) => ({ id: String(r[0]), kills: r[1], hs: r[2], shots: r[7], hits: r[8], secs: r[9], cat: (catalog[r[0]] || [])[1], name: (catalog[r[0]] || [])[0], img: (catalog[r[0]] || [])[3] }))
      .filter((w) => INF_CATS.has(w.cat) && w.kills > 0 && w.shots > 0);
    if (inf.length) {
      inf.sort((a, b) => b.kills - a.kills);
      const m = inf[0], S = (k) => inf.reduce((s, w) => s + w[k], 0);
      out.main = { id: m.id, name: m.name, cat: m.cat, img: m.img ? String(m.img) : null, kills: m.kills, spk: m.shots / m.kills, acc: m.hits / m.shots, hpk: m.hits / m.kills, hsr: m.hs / m.kills };
      out.spk = S('shots') / S('kills'); out.hpk = S('hits') / S('kills');
      // seconds holding the weapon per kill (Census weapon_play_time) — a "time per kill", not TTK
      const secs = S('secs'); out.spkSec = secs > 0 ? secs / S('kills') : null;
    }
  }
  if (Array.isArray(p.rows) && p.rows.length) {
    let s = 0, w = 0, n = 0;
    for (const r of p.rows) { const a = adjsByName.get(bare(r.name)); const k = (r.kills || 0) + (r.deaths || 0); if (fin(a) && k > 0) { s += a * k; w += k; n++; } }
    out.oppIvi = w > 0 ? s / w : null; out.oppKnown = n; out.oppN = p.rows.length;
    let ks = 0, ws = 0; for (const r of p.rows) { const k = (r.kills || 0) + (r.deaths || 0); if (fin(r.kpm) && k > 0) { ks += r.kpm * k; ws += k; } }
    out.oppKpm = ws > 0 ? ks / ws : null;
  }
  if (p.assists && fin(p.assists.avg_share)) out.assistShare = p.assists.avg_share;
  return out;
}

for (const o of rows) Object.assign(o, fileStats(o.slug) || {});
// XP detail (Honu, only some players)
for (const o of rows) {
  const f = path.join(REPO, 'data/xp', o.slug + '.json');
  if (!fs.existsSync(f)) continue;
  const xp = JSON.parse(fs.readFileSync(f, 'utf8'));
  o.hasXp = 1; // the page then reads data/xp/<slug>.json for the newest ⏱ time to fight
  const s = crowdSample(xp), g = (xp.totals && xp.totals.g) || {}, mins = (xp.seconds_counted || 0) / 60;
  const c = (id) => (Array.isArray(g[id]) ? g[id][0] : 0);
  if (s) { o.revivedShare = s.rev; o.xpDeaths = s.deaths; }
  if (mins >= 120) { o.revivesGivenPm = (c(7) + c(53)) / mins; o.healsGivenPm = (c(4) + c(51)) / mins; o.xpMinutes = Math.round(mins);
    for (const [k, ids] of Object.entries(XP_GROUPS)) o[k] = ids.reduce((a, id) => a + c(id), 0) / mins; }
  // ⏱ time to fight: collected by the site's scripts/honu-xp.mjs (xp.fight histogram), if this checkout has it
  if (xp.fight && fin(xp.fight.ms) && xp.fight.n > 0) o.fightStart = { ms: xp.fight.ms, n: xp.fight.n, sessions: xp.fight.sessions ?? null };
}
const ct = classes.players;
for (const o of rows) { const c = ct[o.slug]; if (c) o.cls = Object.fromEntries(classes.cols.map((k, i) => [k, c[i]])); }

const POOL_IDS = ['kd', 'kpm', 'ownKpm', 'dpm', 'acc', 'hsr', 'ivi', 'adjs', 'rkd', 'rf', 'act', 'pvs', 'cons', 'inflation', 'ekpm', 'apk', 'infVeh', 'infMax', 'zerg', 'luck', 'diff', 'spk', 'hpk', 'oppIvi', 'oppKpm', 'revivedShare', 'revivesGivenPm', 'healsGivenPm', 'assistShare', 'resupplyPm', 'capturePm', 'repairPm'];
const pools = Object.fromEntries(POOL_IDS.map((id) => [id, rows.map((o) => o[id]).filter(fin).sort((a, b) => a - b)]));
const pct = (id, v) => (fin(v) && pools[id].length ? percentileOf(pools[id], v) : null);
const med = (id) => { const p = pools[id]; return p.length ? p[Math.floor(p.length / 2)] : null; };


const r3 = (v) => +(+v).toPrecision(3);
// only what the page uses, positional (meta.cols), to keep each shard small
const COLS = ['kd', 'kpm', 'dpm', 'acc', 'hsr', 'spk', 'hpk', 'apk', 'infVeh', 'adjs', 'oppIvi', 'ekpm', 'zerg', 'revivedShare',
  'healsGivenPm', 'revivesGivenPm', 'resupplyPm', 'repairPm', 'capturePm'];
const shards = Array.from({ length: SHARDS }, () => ({}));
for (const o of rows) {
  const d = { n: o.name, v: COLS.map((id) => (fin(o[id]) ? r3(o[id]) : null)), p: COLS.map((id) => pct(id, o[id])) };
  if (o.faction) d.f = o.faction;
  if (o.srv) d.s = o.srv;
  if (o.luck != null) d.l = o.luck;
  // 3rd value: 1 when assets/weapons/<img>.webp exists (the page then shows the icon)
  if (o.main) d.m = [+o.main.id, o.main.kills, o.main.img && fs.existsSync(path.join(REPO, 'assets/weapons', o.main.img + '.webp')) ? 1 : 0];
  if (o.cls) d.c = classes.cols.map((k) => o.cls[k]);
  if (o.fightStart) d.fs = o.fightStart;
  if (o.hasXp) d.x = 1;
  shards[parseInt(shardOf(o.slug), 16)][o.slug] = d;
}
fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
shards.forEach((s, i) => {
  const sorted = Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]]));
  const txt = JSON.stringify({ v: 1, p: sorted }).replace(/,"(?=[a-z0-9]+":\{"n")/g, ',\n"') + '\n';
  bytes += txt.length;
  fs.writeFileSync(path.join(OUT, i.toString(16).padStart(2, '0') + '.json'), txt);
});
// meta: no clock time, so an unchanged cache gives identical files (and no commit)
const meta = { v: 1, ranksAt: ranks.updatedAt, pool: rows.length, shards: SHARDS, cols: COLS, classCols: classes.cols };
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta) + '\n');
console.log(`replay: ${rows.length} players in ${SHARDS} shards, ${(bytes / 1024).toFixed(0)} KB total`);
