// 🎬 Duel replay: a stats-driven Planetman scene, 1:1 real time. Reads data/replay/<shard>.json
// (scripts/build-replay.mjs, built daily from the site's own cache) and data/xp/<slug>.json. Every per-minute stat is a literal per-minute rate here: a 0.05 KPM player waits
// ~20 real minutes between kills. The time in between is filled with the states in states.js.
// All randomness is seeded from the player's name.
import { Soldier, loadRigs, FX } from './soldier.js';
import { STATES, FILLERS, PHASES, phaseOf } from './states.js';
import { shardOf, slugOf } from './shard.mjs';
import { t as tr, ready as i18nReady, currentLang } from '../i18n.mjs';

const cv = document.getElementById('stage'), ctx = cv.getContext('2d');
const W = 1280, H = 720, GROUND = 600;
const q = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !q.has('preview');
const debug = q.has('debug');
if (q.has('bare')) document.body.classList.add('bare');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- data
await i18nReady;
const T = (k, fb, v) => tr('replay.' + k, fb, v);
const LOC = currentLang();
const num = (x) => (+x).toLocaleString(LOC);
const LBL = (id) => T('st.' + id, STATES[id]?.label ?? id);
const rawName = (q.get('name') || '').trim().slice(0, 40);
const slug = slugOf(rawName);
const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
const [meta, shard, catalog] = await Promise.all([getJson('../data/replay/meta.json'),
  slug ? getJson(`../data/replay/${shardOf(slug)}.json`) : null, getJson('../assets/weapons/catalog.json')]);
// one compact row per player (positional, meta.cols) -> the doc the scene reads
function toDoc(e) {
  const stats = {}; meta.cols.forEach((id, i) => { if (e.v?.[i] != null) stats[id] = { v: e.v[i], p: e.p?.[i] ?? null }; });
  const w = e.m && catalog?.items?.[e.m[0]];
  return { name: e.n, slug, faction: e.f || 'tr', server: e.s || '', poolSize: meta.pool, stats, builtAt: meta.ranksAt,
    luck: e.l != null ? { pts: e.l } : null, fightStart: e.fs || null, hasXp: !!e.x,
    main: e.m ? { id: e.m[0], name: w?.[0] ?? '', cat: w?.[1] ?? '', img: e.m[2] && w?.[3] ? String(w[3]) : null, kills: e.m[1] } : null,
    classes: e.c && meta.classCols ? Object.fromEntries(meta.classCols.map((k, i) => [k, e.c[i]])) : null };
}
const doc = meta && shard?.p?.[slug] ? toDoc(shard.p[slug]) : null;
let fast = false;
document.title = `🎬 ${doc ? doc.name + ' · ' : ''}${T('title', 'Duel replay')}`;
const rigs = await loadRigs();
if (!doc) {
  // no stats for this name (not in the PC cache yet, or no name): say so, keep the page quiet
  ctx.fillStyle = '#141b24'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#c9d1d9'; ctx.font = '600 28px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(rawName ? T('none', 'No replay stats for “{name}” yet.', { name: rawName }) : T('noName', 'Pick a player: 🎬 next to a name in the table.'), W / 2, H / 2);
  const n = document.createElement('div'); n.className = 'note';
  n.textContent = T('noneHint', 'Replays cover PC players in the site’s cache. A newly added player shows up after the next daily update.');
  document.getElementById('hud').append(n);
  window.__ready = true;
  await new Promise(() => {});   // nothing more to run (a module can't return early)
}
const S = doc.stats, val = id => S[id]?.v ?? null, pct = id => S[id]?.p ?? null;

// ⏱ time to fight. On the live site the value comes from data/xp/<slug>.json (`fight`, collected by
// scripts/honu-xp.mjs for players whose replay is opened); it is used only once the sample is big enough.
const FIGHT_MIN_RUNS = 20, FS_NEUTRAL = 19000;
let fight = doc.fightStart && doc.fightStart.n > 0 ? doc.fightStart : null;
if (doc.hasXp) { const x = await getJson(`../data/xp/${slug}.json`); if (x?.fight?.n > 0) fight = x.fight; }
// an opened replay asks the site's own collector to keep this player's sample growing (same Worker call
// and 24 h local throttle as the site's markRequested; live site, PC cache only)
if (location.origin === 'https://dayset.github.io' && !/^ps/i.test(doc.server || '')) try {
  const k = `ps2ekd:seen:${slug}`, last = +(localStorage.getItem(k) || 0);
  if (Date.now() - last > 864e5) { localStorage.setItem(k, String(Date.now()));
    fetch('https://ps2-elite-kd-cache.dayset.workers.dev/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [doc.name] }), keepalive: true }).catch(() => {}); }
} catch {}
const fightOk = fight && fight.n >= FIGHT_MIN_RUNS;

// mulberry32 seeded from the name
let seed = 2166136261; for (const c of doc.slug) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
const rng = (() => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const sround = x => Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0); // stochastic rounding keeps the long-run average exact
const pick = a => a[Math.floor(rng() * a.length)];
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rng(); return (u - 3) / Math.SQRT1_2 / Math.sqrt(1); };

// ---------------------------------------------------------------- stats (literal per-minute rates)
const missing = [];
const CL = (id, en) => T('chip.' + id, en);
const need = (id, label, dflt) => { if (val(id) == null) { missing.push(CL(id, label)); return dflt; } return val(id); };
const kpm = need('kpm', 'KPM', 0.3), kd = need('kd', 'K/D', 1);
const st = {
  kpm, dpm: val('dpm') ?? kpm / Math.max(0.05, kd),
  spk: need('spk', 'Shots/kill', 39.5), hpk: need('hpk', 'Hits/kill', 10.4),  // population medians when missing
  hs: (need('hsr', 'HS', 0)) / 100, apk: need('apk', 'Assists/kill', 0),
  veh: (need('infVeh', 'Vehicle', 0)) / 100, revive: Math.min(0.8, need('revivedShare', 'Revived', 0)),
  fightMs: fightOk ? fight.ms : FS_NEUTRAL,
  healPm: val('healsGivenPm') ?? 0, revivePm: val('revivesGivenPm') ?? 0,
  resupplyPm: val('resupplyPm') ?? 0, capturePm: val('capturePm') ?? 0, repairPm: val('repairPm') ?? 0,
  zerg: need('zerg', '🪳 Zerg', null), luck: doc.luck?.pts ?? (missing.push(CL('luck', '🎲 Luck')), null),
  oppP: pct('oppIvi') ?? (missing.push(CL('oppIvi', 'Enemy iVi')), null), ekpmP: pct('ekpm'),
  classes: doc.classes ? ['inf', 'la', 'med', 'eng', 'ha', 'max'].map(k => [k, doc.classes[k] || 0]).filter(c => c[1] > 0) : null,
};
if (!fightOk) missing.push(CL('fightStart', '⏱ To fight'));
const RATE = 10 + 3 * rng();                       // shots/s, normal automatic fire (weapon fire rates are not in the data)
const P = {
  allies: st.zerg == null ? 0 : Math.round(st.zerg / 99 * 6),
  enemyScale: 0.46 + 0.1 * ((st.oppP ?? 50) / 99),
  suppress: lerp(9, 3.5, (st.ekpmP ?? 50) / 99),   // seconds between enemy pot-shots (they miss / graze)
  dodge: st.luck == null ? 0 : clamp(st.luck / 8) * 0.7,
  killShare: clamp(1 - 0.35 * st.apk - 0.1, 0.4, 0.85),  // share of shots/kill fired in the kill burst itself
};
if (st.apk > 0 && P.allies === 0) P.allies = 1;
// mean down time and life length that make deaths per minute come out exactly at DPM
const DOWN_MEAN = st.revive * 4.5 + (1 - st.revive) * (7.5 + 0.9);
const CYCLE = 60 / Math.max(0.01, st.dpm);
const ALIVE_MEAN = Math.max(4, CYCLE - DOWN_MEAN - 3.2);   // 3.2 s = the death exchange (DYING)
const CLS = Object.fromEntries(Object.entries({ inf: 'Infiltrator', la: 'Light Assault', med: 'Medic', eng: 'Engineer', ha: 'Heavy Assault', max: 'MAX' })
  .map(([k, en]) => [k, T('cls.' + k, en)]));

// ---------------------------------------------------------------- cast
const F = doc.faction in rigs ? doc.faction : 'tr', foes = ['tr', 'nc', 'vs'].filter(f => f !== F);
const main = new Soldier(rigs[F], F, { x: 350, y: GROUND + 5, scale: 0.5, facing: 1, seed: 0.3, rate: RATE, speed: 120 });
main.isMain = true;
// the crowd: dimmed, spread wide and staggered in depth, each behind his own wall tile —
// they sit in cover and only step out to shoot, instead of a line staring at the enemy
const ALLY_SLOTS = [[110, -115, 0.66], [190, -50, 0.72], [500, -100, 0.66], [600, -30, 0.70], [700, -115, 0.66], [790, -55, 0.72]];
const allies = ALLY_SLOTS.slice(0, P.allies).map(([x, dy, k], i) => {
  const a = new Soldier(rigs[F], F, { x, y: GROUND + dy, scale: main.scale * k, facing: 1, seed: 1.7 + i * 2.3, rate: 9 + 3 * rng(), speed: 90 });
  a.dim = true; return a; });
const ENEMY_SLOTS = [[850, -120, 0.85], [945, -25, 0.95], [1020, 5, 1], [1100, -95, 0.88], [975, -60, 0.9]];
const enemies = ENEMY_SLOTS.map(([x, dy, k], i) => {
  const s = new Soldier(rigs[foes[i % 2]], foes[i % 2], { x, y: GROUND + dy, scale: P.enemyScale * k, facing: -1, seed: 3.1 + i * 1.9, rate: 9 + 3 * rng(), speed: 170 });
  s.slot = x; s.deadAt = -99; s.state = 'dead'; return s;
});
const everyone = [main, ...allies, ...enemies];
// cover: one basic wall tile per soldier, on the far side from the enemy. Hidden = the soldier
// centred on his wall (the wall, drawn later in depth order, occludes him); peek = stepped out
// past the wall's firing edge. peekX is the slot/home the rest of the code already uses.
function makeCover(s) {
  // rig height is 520 (rigs.json `height`, head top at -520); the wall must clear it, plus a
  // margin, and clear the head's ~289 width — otherwise helmets poke out over the tile
  const w = 310 * s.scale, h = 580 * s.scale;
  const wx = s.facing > 0 ? s.x - 30 - w : s.x + 30;
  const wall = { x: wx, y: s.y + 8, w, h };
  return { wall, hiddenX: wx + w / 2, peekX: s.x };
}
main.cover = makeCover(main);
for (const a of allies) a.cover = makeCover(a);
for (const e of enemies) e.cover = makeCover(e);
main.cover.wall.forMain = true;
const walls = [main.cover.wall, ...allies.map(a => a.cover.wall), ...enemies.map(e => e.cover.wall)];

// ---------------------------------------------------------------- effects
let bullets = [], fx = [];
const stats = { k: 0, d: 0, a: 0, hs: 0, shots: 0, hits: 0, veh: 0, rev: 0, fills: {} };
const tank = { on: false, t0: 0, off: -9 };
let life = { cls: null, box: null };
const body = s => [s.x + s.facing * 10 * s.scale, s.y - 190 * s.scale];
const head = s => [s.x - s.facing * 4 * s.scale, s.y - 380 * s.scale];
const muzzle = s => {
  if (s === main && tank.on) return [main.x + 150, main.y - 118];
  const m = s.rig.points.muzzle; return [s.x + s.facing * m[0] * s.scale, s.y + (m[1] - 4) * s.scale];
};
const pop = (s, text, color = '#fff', t) => fx.push({ kind: 'pop', x: s.x, y: s.y - 560 * s.scale, text, color, t0: t, dur: 1.3 });
const alive = s => s.state === 'idle' || s.state === 'shoot' || s.state === 'run' || s.state === 'revive';
const ready = s => (s.state === 'idle' || s.state === 'shoot') && (Math.abs(s.x - s.slot) < 2 || (s.cover && Math.abs(s.x - s.cover.hiddenX) < 2)) && !s.busy;

// Shots fly straight inside a narrow cone of fire (5° wide) from the muzzle toward the aim point:
// hits deviate ≤ 0.8°, misses 1.2–2.5° and keep flying past the target (drawn on a lane just in front
// of or behind it, see render). A close call is aimed at the head and passes at the cone's top edge.
const CONE = 2.5 * Math.PI / 180;
function fire(t, from, to, o = {}) {
  const [x0, y0] = muzzle(from);
  const [tx, ty] = o.hs || o.close ? head(to) : body(to);
  const d = Math.hypot(tx - x0, ty - y0), v = o.shell ? 1500 : from.fx.plasma ? 1700 : 2400;
  const off = o.close ? -CONE * Math.sign(tx - x0 || 1) : o.hit ? (rng() - 0.5) * 2 * 0.32 * CONE : (rng() < 0.5 ? -1 : 1) * (0.48 + rng() * 0.52) * CONE;
  const a = Math.atan2(ty - y0, tx - x0) + (o.shell ? 0 : off);
  bullets.push({ x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, d, left: o.hit ? d : d + 900, age: 0, from, to, ...o,
    side: o.hit ? 1 : rng() < 0.5 ? -1 : 1,
    color: o.shell ? '#ffd27a' : from.fx.tracer, plasma: from.fx.plasma && !o.shell });
  if (from === main && !o.shell) { stats.shots++; if (o.hit) stats.hits++; }
}

// ---------------------------------------------------------------- slow motion (wall-clock envelope)
// headshot kill / main soldier's death: ~0.7 s down to 30% speed; normal kill: lighter (~0.45 s, 55%),
// every 3rd kill at most. The scene clock lags behind real time during slow-mo and catches up later in
// calm states (≤ 1.25×), so long-run per-minute rates are not changed. Off under reduced motion.
let wallT = 0, simT = 0, skipped = 0, slow = null, slowNext = 0, killsSinceSlow = 0;
const SLOW = { hs: [0.7, 0.30], death: [0.75, 0.28], kill: [0.45, 0.55] };
function slowmo(kind) {
  if (reduced || fast) return;
  if (kind === 'kill') { if (++killsSinceSlow < 3 || wallT < slowNext) return; }
  else if (wallT < slowNext - 1.2) return;
  const [dur, speed] = SLOW[kind]; slow = { w0: wallT, dur, speed }; slowNext = wallT + dur + 2.6; killsSinceSlow = 0;
}
function timeScale(w) {
  if (!slow) return 1; const k = (w - slow.w0) / slow.dur; if (k >= 1) { slow = null; return 1; } if (k < 0) return 1;
  const ease = x => x * x * (3 - 2 * x), env = k < 0.25 ? ease(k / 0.25) : k > 0.6 ? ease((1 - k) / 0.4) : 1;
  return 1 - (1 - slow.speed) * env;
}

function land(t, b) {
  const s = b.to;
  if (b.shell) fx.push({ kind: 'boom', x: b.x, y: b.y + 20, t0: t, dur: 0.6 });
  else fx.push({ kind: 'spark', x: b.x, y: b.y, t0: t, dur: b.hs ? 0.45 : 0.18, big: b.hs, color: b.from.fx.tracer });
  if (s.state === 'die' || s.state === 'dead') return;
  s.flinchAt = t;
  if (s === main && life.cls === 'ha') fx.push({ kind: 'shield', s, t0: t, dur: 0.35 });
  if (b.final) {
    s.hs = !!b.hs; s.set('die', t); s.deadAt = t; s.busy = false;
    if (s === main) { stats.d++; slowmo('death'); return; }
    if (b.from === main) { stats.k++; if (b.hs) stats.hs++; if (b.veh) stats.veh++; slowmo(b.hs ? 'hs' : 'kill');
      pop(main, b.hs ? T('pop.hs', 'headshot +1') : b.veh ? T('pop.veh', 'vehicle kill +1') : '+1', b.hs ? '#ffe066' : '#fff', t); }
    else if (b.assist) { stats.a++; pop(main, T('pop.assist', '+assist'), '#9fe8ff', t); }
  }
}

// ---------------------------------------------------------------- 1:1 timeline planner
// One "cycle" = from a death (or the first spawn) to the next death. Everything is placed on the real
// clock: deaths every 60/DPM s on average, kills at KPM, assists at KPM × assists/kill, fillers at their
// own per-minute rates. Counts come from accumulators (credit += rate × time; take the whole part), so
// over time every ratio converges to the stat instead of being forced per loop.
const credit = { k: 0, a: 0, hs: 0, veh: 0, rev: 0, shots: 0, hits: 0, ...Object.fromEntries(FILLERS.map(f => [f, 0])) };
const plan = { segs: [], end: 0, cycles: 0, deathsPlanned: 0 };
const takeWhole = (key, add, cap = Infinity) => { credit[key] = Math.min(cap, credit[key] + add); const n = Math.floor(credit[key]); credit[key] -= n; return n; };
const seg = (id, t0, dur, o = {}) => ({ id, t0, t1: t0 + dur, ...o });
const killShots = () => Math.max(1, sround(st.spk * P.killShare));
const killHits = () => Math.max(1, sround(st.hpk * P.killShare));
const burstDur = n => n / RATE + 0.45;
const DYING = 3.2;

function planCycle(T, first) {
  const out = [];
  let t = T;
  // down time
  if (first) { out.push(seg('respawn', t, 0.9)); t += 0.9; }
  else if (takeWhole('rev', st.revive)) { const d = STATES.beingRevived.dur(rng); out.push(seg('beingRevived', t, d)); t += d; }
  else { const d = STATES.respawnTimer.dur(rng); out.push(seg('respawnTimer', t, d)); t += d; out.push(seg('respawn', t, 0.9)); t += 0.9; }
  const revived = out[0].id === 'beingRevived';
  // alive time: mean makes DPM exact; drift from earlier lives is paid back
  const drift = (T - 0) - plan.deathsPlanned * CYCLE - (first ? 0 : 0);
  let aliveEnd = t + clamp(ALIVE_MEAN * (0.35 + 1.3 * rng()) - 0.5 * drift, 4, ALIVE_MEAN * 3 + 30);
  const cyc = aliveEnd + DYING - T;
  // what happens in this life
  const nK = takeWhole('k', st.kpm / 60 * cyc), nA = takeWhole('a', st.kpm * st.apk / 60 * cyc);
  credit.shots += st.spk * st.kpm / 60 * cyc; credit.hits += st.hpk * st.kpm / 60 * cyc;
  const spikes = [];
  for (let i = 0; i < nK; i++) { const veh = takeWhole('veh', st.veh) > 0; spikes.push({ id: 'fight', veh, hs: !veh && takeWhole('hs', st.hs) > 0 }); }
  for (let i = 0; i < nA; i++) spikes.push({ id: 'assist' });
  for (let i = spikes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [spikes[i], spikes[j]] = [spikes[j], spikes[i]]; }
  // vehicle kills sit together in one stint
  spikes.sort((a, b) => (b.veh ? 1 : 0) - (a.veh ? 1 : 0));
  const nV = spikes.filter(s => s.veh).length;
  if (nV && spikes.length > nV) { const at = Math.floor(rng() * (spikes.length - nV + 1)); const v = spikes.splice(0, nV); spikes.splice(at, 0, ...v); }
  for (const s of spikes) {
    if (s.id === 'fight' && s.veh) { s.n = 2; s.dur = 1.4; }
    else if (s.id === 'fight') { s.n = killShots(); s.h = killHits(); s.dur = burstDur(s.n); }
    else { s.n = Math.max(1, sround(st.spk * 0.35)); s.h = Math.max(0, sround(st.hpk * 0.3)); s.dur = burstDur(s.n) + 0.9; }
    if (!s.veh) { credit.shots -= s.n; credit.hits -= s.h; }
  }
  // first spike lands one "time to fight" after the death (LIVE formula), the rest spread over the life
  if (spikes.length) {
    const ttc = clamp(st.fightMs / 1000 * Math.exp(0.8 * gauss()), 3, 240);
    const minFirst = t + (revived ? 1 : 3.5);
    let at = Math.max(minFirst, T + ttc - spikes[0].dur);
    const need = spikes.reduce((a, s) => a + s.dur + 1.2, 0) + (nV ? 4 : 0);
    if (at + need > aliveEnd - 2.5) aliveEnd = at + need + 2.5;
    spikes[0].t0 = at;
    const a = at + spikes[0].dur + 1.2, b = aliveEnd - 2.5, n = spikes.length - 1;
    for (let i = 1; i <= n; i++) spikes[i].t0 = a + (b - a) * (i - 1 + 0.15 + 0.7 * rng()) / n;
    for (let i = 1; i < spikes.length; i++) spikes[i].t0 = Math.max(spikes[i].t0, spikes[i - 1].t0 + spikes[i - 1].dur + 1.2 + (spikes[i - 1].veh !== spikes[i].veh ? 2 : 0));
    const last = spikes.at(-1); if (last.t0 + last.dur > aliveEnd - 2) aliveEnd = last.t0 + last.dur + 2;
  }
  { // a life stretched to fit its fights: the extra real time still earns its share for later lives
    const extra = aliveEnd + DYING - T - cyc;
    if (extra > 0) { credit.k += st.kpm / 60 * extra; credit.a += st.kpm * st.apk / 60 * extra;
      credit.shots += st.spk * st.kpm / 60 * extra; credit.hits += st.hpk * st.kpm / 60 * extra; } }
  // travel after a respawn: until shortly before the first fight (or ~25 s at most), then the area is "live"
  let free0 = t;
  if (!revived) {
    const until = spikes.length ? spikes[0].t0 - 1.6 - (spikes[0].veh ? 2 : 0) : t + clamp(st.fightMs / 1000 - DOWN_MEAN, 3, 25);
    const d = clamp(until - t, 1.5, 25); out.push(seg('running', t, d, { veh: spikes[0]?.veh && nV > 0 })); free0 = t + d;
  }
  // vehicle stint around its kills
  let stint = null;
  if (nV) { const v = spikes.filter(s => s.veh); stint = [v[0].t0 - 2, v.at(-1).t0 + v.at(-1).dur + 1.5]; }
  const busy = spikes.map(s => seg(s.id, s.t0, s.dur, s));
  // fill free time: reload (only if the gap allows), fillers by rate, leftover shots, idle
  const fillers = FILLERS.map(id => [id, takeWhole(id, (STATES[id].rate(st) || 0) / 60 * cyc, 4)]).filter(f => f[1] > 0);
  const queue = []; for (const [id, n] of fillers) for (let i = 0; i < n; i++) queue.push(id);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  const marks = [free0, ...busy.flatMap(b => [b.t0, b.t1]), aliveEnd];
  const gaps = []; for (let i = 0; i < marks.length; i += 2) if (marks[i + 1] - marks[i] > 0.2) gaps.push([marks[i], marks[i + 1], i > 0]);
  const fills = [];
  for (const [g0, g1, afterShots] of gaps) {
    let c = g0;
    const inVeh = x => stint && x >= stint[0] && x <= stint[1];
    if (afterShots && !inVeh(c) && g1 - c >= STATES.reloading.dur() + 0.3) { fills.push(seg('reloading', c, STATES.reloading.dur())); c += STATES.reloading.dur() + 0.2; }
    while (g1 - c > 1) {
      if (inVeh(c)) { fills.push(seg('idle', c, g1 - c)); break; }
      const room = g1 - c;
      const qi = queue.findIndex(id => STATES[id].dur(() => 1) + 0.5 < room);
      if (qi >= 0 && rng() < 0.6) {
        const id = queue.splice(qi, 1)[0], d = Math.min(STATES[id].dur(rng), room - 0.5);
        const pad = Math.min(room - d - 0.3, 1 + rng() * 6); if (pad > 0.3) { fills.push(seg('idle', c, pad)); c += pad; }
        fills.push(seg(id, c, d)); c += d; continue;
      }
      if (credit.shots >= 8 && room > 8 && rng() < 0.35) {   // leftover shots: an exchange without a kill
        const n = Math.min(Math.floor(credit.shots), sround(6 + rng() * 10)), h = Math.min(Math.max(0, Math.floor(credit.hits)), sround(n * st.hpk / st.spk));
        credit.shots -= n; credit.hits -= h;
        const pad = 1 + rng() * Math.min(10, room - burstDur(n) - 3.5); fills.push(seg('idle', c, pad)); c += pad;
        fills.push(seg('trading', c, burstDur(n), { n, h })); c += burstDur(n) + 0.2;
        if (g1 - c >= STATES.reloading.dur() + 0.3) { fills.push(seg('reloading', c, STATES.reloading.dur())); c += STATES.reloading.dur() + 0.2; }
        continue;
      }
      const d = Math.min(room, 4 + rng() * 14); fills.push(seg('idle', c, d)); c += d;
    }
    if (g1 - c > 0) fills.push(seg('idle', c, g1 - c));
  }
  for (const id of queue) credit[id] = Math.min(4, credit[id] + 1);   // did not fit: kept for later
  // death: a short exchange the main soldier loses; return fire comes from the shot budget
  const rn = Math.max(0, Math.min(Math.floor(credit.shots), sround(4 + rng() * 6))); credit.shots -= rn;
  const death = seg('dying', aliveEnd, DYING, { n: rn });
  const all = [...out, ...busy, ...fills, death].sort((a, b) => a.t0 - b.t0);
  for (const s of all) if (stint && s.t0 >= stint[0] - 0.01 && s.t0 < stint[1] && s.id !== 'running') s.veh = true;
  // the life as phases (timeline strip): consecutive segments of one phase merged, gaps closed
  const phases = [];
  for (const s of all) { const ph = phaseOf(s.id), last = phases.at(-1);
    if (last && last.ph === ph) last.t1 = Math.max(last.t1, s.t1); else { if (last) last.t1 = s.t0; phases.push({ ph, t0: s.t0, t1: s.t1 }); } }
  if (phases.length) { phases[0].t0 = T; phases.at(-1).t1 = aliveEnd + DYING; }
  plan.lives.push({ n: plan.cycles + 1, t0: T, t1: aliveEnd + DYING, phases, revived });
  plan.cycles++; plan.deathsPlanned++;
  if (stint) plan.stints.push(stint);
  return { segs: all, end: aliveEnd + DYING };
}
plan.stints = []; plan.lives = [];
function ensurePlan(t) {
  while (plan.end < t + 60) { const c = planCycle(plan.end, plan.cycles === 0); plan.segs.push(...c.segs); plan.end = c.end; }
}

// ---------------------------------------------------------------- execution (scene clock = real seconds)
function pickTarget(t) {
  let r = enemies.filter(ready); if (r.length) return pick(r);
  r = enemies.filter(e => e.state === 'run'); if (r.length) { const e = pick(r); e.x = e.slot; e.set('idle', t); return e; }
  const e = pick(enemies.filter(e => !e.busy)); e.x = e.slot; e.set('respawn', t); e.t0 = t - 0.9; e.set('idle', t); return e;
}
function startBurst(t, shooter, target, n, h, final, extra = {}) {
  const hits = new Set(); if (final) hits.add(n - 1);
  while (hits.size < Math.min(n, h)) hits.add(Math.floor(rng() * (final ? n - 1 : n)));
  shooter.set('shoot', t); shooter.t0 = t; shooter.facing = target.x > shooter.x ? 1 : -1;
  const [mx, my] = muzzle(shooter), [tx, ty] = body(target);
  shooter.aim = clamp(Math.atan2(ty - my, Math.abs(tx - mx)), -0.25, 0.25);
  return { shooter, target, n, hits, final, fired: 0, t0: t, rate: shooter.rate, extra, done: n <= 0 };
}
function runBurst(b, t) {
  while (b.fired < b.n && t >= b.t0 + b.fired / b.rate) {
    const i = b.fired++, hit = b.hits.has(i), fin = b.final && i === b.n - 1;
    fire(t, b.shooter, b.target, { hit, final: fin, ...(fin ? b.extra : {}) });
  }
  if (b.fired >= b.n && !b.done) { b.done = true; b.end = t; if (b.shooter.state === 'shoot') b.shooter.set('idle', t); }
  return b.done;
}

let cur = null, engaged = false, scroll = 0;
const HOOKS = {
  travel: { enter(s, t) { engaged = false; for (const e of enemies) if (e.state !== 'dead') { e.set('dead', t); e.deadAt = t; }
              for (const a of allies) a.set('run', t); },
            tick(s, t, dt) { scroll += dt * (s.veh ? 260 : 150); },
            exit(s, t) { for (const a of allies) a.set('idle', t); arrive(t); } },
  reload: { enter(s, t) { main.reloadAt = t + 0.2; } },
  revivedBy: { enter(s, t) { const m = allies.length ? pick(allies) : null; s.medic = m; },
               tick(s, t) { const tl = t - s.t0, d = s.t1 - s.t0;
                 if (s.medic && !s.healFx && tl > d - 2) { s.healFx = 1; fx.push({ kind: 'heal', from: s.medic, to: main, t0: t, dur: 1.2 }); }
                 if (!s.up && tl > d - 0.8) { s.up = 1; main.downKeep = false; main.set('revive', t); stats.rev++; pop(main, T('pop.revived', 'revived'), '#8dffa5', t); } } },
  healAlly: { enter(s, t) { const tg = allies.length ? pick(allies) : null; if (tg) fx.push({ kind: 'heal', from: main, to: tg, t0: t, dur: s.t1 - s.t0 }); } },
  ammoBox: { enter(s, t) { life.box = { x: main.home - 170, t0: t, t1: s.t1 }; } },
  shuffle: { enter(s, t) { s.x0 = main.x; s.dx = (main.x > main.home ? -1 : 1) * (20 + rng() * 40); },
             tick(s, t) { const k = clamp((t - s.t0) / (s.t1 - s.t0)); main.x = lerp(s.x0, s.x0 + s.dx, k);
               main.facing = s.dx > 0 ? 1 : -1; main.hop = life.cls === 'la' ? 40 * Math.sin(k * Math.PI) : 0; },
             exit(s, t) { main.hop = 0; main.facing = 1; } },
};
function arrive(t) {
  engaged = true; let i = 0;
  for (const e of enemies) { e.x = W + 80 + 60 * i++; e.set('run', t); e.busy = false; e.hs = false; }
}
function enter(s, t) {
  const def = STATES[s.id];
  if (s.veh && !tank.on) { tank.on = true; tank.t0 = t; stats.vehStint = (stats.vehStint || 0) + 1; }
  if (!s.veh && tank.on && s.id !== 'dying') { tank.on = false; tank.off = t; }
  if (def.anim && !(s.veh && def.anim !== 'dead')) {
    if (def.anim === 'dead') { if (main.state !== 'dead') { main.downKeep = s.id === 'beingRevived'; main.set('dead', t); } }
    else if (def.anim !== 'shoot') main.set(def.anim, t);
  }
  if (s.id === 'respawn') { main.x = main.home; main.downKeep = false; newLife(t, plan.firstDone !== true); plan.firstDone = true; }
  if (s.id === 'fight' || s.id === 'assist' || s.id === 'trading') {
    if (!engaged) arrive(t - 2);
    const tg = pickTarget(t); tg.busy = true; s.tg = tg;
    if (s.id === 'fight' && s.veh) s.b = { tank: true, target: tg, fired: 0 };
    else s.b = startBurst(t, main, tg, s.n, s.h, s.id === 'fight', { hs: s.hs });
  }
  if (s.id === 'dying') {
    if (!engaged) arrive(t - 2);
    const k = pickTarget(t); k.busy = true; s.k = k;
    s.b = startBurst(t + 0.3, k, main, 14, 5, true); s.b.t0 = t + 0.3; s.b.rate = 12;
    s.back = startBurst(t, main, k, s.n, Math.min(s.n, sround(s.n * st.hpk / st.spk)), false); if (s.veh) s.back = { done: true };
  }
  def.hook && HOOKS[def.hook]?.enter?.(s, t);
  stats.fills[s.id] = (stats.fills[s.id] || 0) + 1;
}
function tick(s, t, dt) {
  const def = STATES[s.id], tl = t - s.t0;
  def.hook && HOOKS[def.hook]?.tick?.(s, t, dt);
  if (s.b?.tank) {
    while (s.b.fired < 2 && tl >= 0.3 + s.b.fired * 0.55) { s.b.fired++; tank.recoil = t; fire(t, main, s.b.target, { hit: true, shell: true, veh: true, final: s.b.fired === 2 }); }
  } else if (s.id === 'dying') {
    if (!s.back.done && alive(main)) runBurst(s.back, t);
    if (t >= s.b.t0) runBurst(s.b, t);
    if (s.b.done) s.k.busy = false;
    if (tank.on && tl > 0.6 && !s.bail) { s.bail = 1; tank.on = false; tank.off = t; main.set('idle', t); }
  } else if (s.b) {
    runBurst(s.b, t);
    if (s.id === 'assist' && s.b.done && !s.ally) {
      const al = allies.filter(alive); s.ally = al.length ? startBurst(t, pick(al), s.tg, 6, 2, true, { assist: true }) : { done: true };
      if (s.ally.rate) s.ally.rate = 13;
      if (!al.length) { stats.a++; pop(main, T('pop.assist', '+assist'), '#9fe8ff', t); s.tg.busy = false; }   // teammate off screen
    }
    if (s.ally && !s.ally.done) runBurst(s.ally, t);
  }
}
function exit(s, t) {
  const def = STATES[s.id];
  def.hook && HOOKS[def.hook]?.exit?.(s, t);
  if (s.tg && s.id !== 'fight' && !(s.id === 'assist' && s.ally?.final)) s.tg.busy = false;
  if (s.b && !s.b.tank && !s.b.done) { while (s.b.fired < s.b.n) runBurst(s.b, s.b.t0 + 1e3); }   // never drop budgeted shots
  if (main.state === 'shoot') main.set('idle', t);
  if (s.id === 'dying' && main.state !== 'die' && main.state !== 'dead') { main.hs = false; main.set('die', t - 1); stats.d++; } // safety: the death always happens
}
function newLife(t, first) {
  let cls = null;
  if (st.classes && first) cls = st.classes.reduce((a, c) => c[1] > a[1] ? c : a)[0]; // first life: most-played class
  else if (st.classes) { const tot = st.classes.reduce((a, c) => a + c[1], 0); let r = rng() * tot;
    for (const [k, w] of st.classes) { r -= w; if (r <= 0) { cls = k; break; } } cls ??= st.classes.at(-1)[0]; }
  life = { cls, t0: t, box: null };
}

// ---------------------------------------------------------------- background activity (only while in the fight area)
let nextSuppress = 3, nextAlly = 2, nextAllyKill = 20, allyBursts = [], enemyBursts = [];
function background(t, dt) {
  for (const e of enemies) {
    if (e.state === 'die' && t - e.deadAt > 1.75) e.set('dead', t);
    if (engaged && e.state === 'dead' && t - e.deadAt > 7 + (e.seed * 3) % 5) { e.x = Math.min(W - 70, e.slot + 140); e.set('respawn', t); e.hs = false; }
    if (e.state === 'respawn' && t - e.t0 > 0.9) e.set('run', t);
    if (e.state === 'run') { e.facing = -1; e.x -= e.speed * dt; if (e.x <= e.slot) { e.x = e.slot; e.set('idle', t); } }
  }
  if (!engaged) return;
  // enemy pot-shots that miss; luck turns some into visible close calls
  if (t > nextSuppress) {
    nextSuppress = t + P.suppress * (0.6 + 0.8 * rng());
    const sh = enemies.filter(e => e.state === 'idle' && !e.busy), tgts = [main, ...allies].filter(alive);
    if (sh.length && tgts.length && !tank.on) {
      const s = pick(sh), tg = rng() < 0.6 && alive(main) ? main : pick(tgts), close = tg === main && rng() < P.dodge;
      const b = startBurst(t, s, tg, 5 + Math.floor(rng() * 6), 0, false); b.close = close; b.pot = true; enemyBursts.push(b);
      if (close) pop(main, T('pop.close', 'close call'), '#c8d3ff', t + 0.35);
    }
  }
  enemyBursts = enemyBursts.filter(b => {
    while (b.fired < b.n && t >= b.t0 + b.fired / b.rate) { b.fired++; fire(t, b.shooter, b.target, { hit: false, close: b.close && b.fired === 3 }); }
    if (b.fired >= b.n) { if (b.shooter.state === 'shoot') b.shooter.set('idle', t); return false; } return true;
  });
  // the crowd fights too (their kills are theirs, not counted for the player)
  if (allies.length && t > nextAlly) {
    nextAlly = t + 7 / allies.length * (0.5 + rng());
    const free = allies.filter(a => a.state === 'idle'), tg = enemies.filter(e => ready(e));
    if (free.length && tg.length) {
      const kill = t > nextAllyKill; if (kill) nextAllyKill = t + 40 / allies.length * (0.6 + 0.8 * rng());
      const e = pick(tg); if (kill) e.busy = true;
      allyBursts.push(startBurst(t, pick(free), e, 6 + Math.floor(rng() * 6), kill ? 3 : rng() < 0.3 ? 1 : 0, kill));
    }
  }
  allyBursts = allyBursts.filter(b => !runBurst(b, t));
}

// ---------------------------------------------------------------- step
function step(t, dt) {
  // cover: a shooter peeks to fire, and the target of a real burst peeks with him — so at the
  // kill moment the enemy is out in the open, not behind his wall (the kill shot is always the
  // burst's last, seconds after the peek starts). Pot-shots never pull a target out: they miss
  // anyway. Only idle/shoot move: run, dead, dying and revive leave x to their own drivers.
  const live = [cur?.b, cur?.ally, cur?.back, ...allyBursts, ...enemyBursts];
  for (const s of everyone) {
    if (!s.cover) continue;
    const shooting = s.state === 'shoot';
    const targeted = live.some(b => b && !b.done && !b.pot && b.target === s && (b.tank ? b.fired < 2 : b.shooter.state === 'shoot'))
      || bullets.some(b => b.final && b.to === s);   // killing shot still flying: the target stays out until it lands
    s.peekWant = (shooting || targeted) ? 1 : 0;
    if (s.state !== 'idle' && s.state !== 'shoot') continue;
    const tx = s.peekWant ? s.cover.peekX : s.cover.hiddenX;
    s.x += (tx - s.x) * Math.min(1, dt * 10);
  }
  ensurePlan(t);
  while (plan.segs.length && plan.segs[0].t1 <= t) { const s = plan.segs.shift(); if (!s.entered) { s.entered = 1; enter(s, s.t0); } exit(s, t); if (cur === s) cur = null; }
  const s = plan.segs[0];
  if (s && s.t0 <= t) { if (!s.entered) { s.entered = 1; enter(s, t); } cur = s; tick(s, t, dt); }
  background(t, dt);
  for (const b of bullets) {
    const sx = b.vx * dt, sy = b.vy * dt; b.x += sx; b.y += sy; b.age += dt; b.left -= Math.hypot(sx, sy);
    if (b.left <= 0 && !b.landed) { b.landed = true; if (b.hit) land(t, b); }
  }
  bullets = bullets.filter(b => !(b.hit && b.landed) && b.age < 1.2 && b.x > -60 && b.x < W + 60);
  fx = fx.filter(f => t - f.t0 < f.dur);
  // allies ride their cover (moved in step's peek pass above); coverless allies still drift home
  for (const a of allies) if (!a.cover) a.x += (a.home - a.x) * Math.min(1, dt * 3);
}

// ---------------------------------------------------------------- drawing
// ---------------------------------------------------------------- drawing
function drawBg() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b2635'); g.addColorStop(0.62, '#2a3a4c'); g.addColorStop(0.63, '#34452f'); g.addColorStop(1, '#202b1d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // parallax: hills move at 1/4 of the ground while running to the fight
  const hx = scroll * 0.25; ctx.fillStyle = '#243243'; ctx.beginPath(); ctx.moveTo(0, 455);
  for (let x = 0; x <= W; x += 40) { const u = x + hx; ctx.lineTo(x, 430 + 28 * Math.sin(u / 170) + 14 * Math.sin(u / 53)); }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = '#34452f'; ctx.fillRect(0, 452, W, H - 452);
  ctx.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 40; i++) ctx.fillRect((((i * 337 - scroll) % W) + W) % W, 470 + (i * 53) % 230, 26, 3);
}
const TANK = { tr: ['#7a2a24', '#b8473b'], nc: ['#23407a', '#3f69c0'], vs: ['#4a2a78', '#7a4fc0'] };
function drawTank(t) {
  const a = tank.on ? clamp((t - tank.t0) / 0.5) : 1 - clamp((t - tank.off) / 0.4); if (a <= 0) return;
  const x = main.x, y = main.y, [dk, lt] = TANK[F], rc = Math.exp(-(t - (tank.recoil ?? -9)) * 8) * 10;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, -30 * (1 - a));
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 150, 14, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b2f36'; rr(x - 140, y - 46, 280, 46, 22);                 // tracks
  ctx.fillStyle = '#4a515c'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x - 112 + i * 45, y - 23, 15, 0, 7); ctx.fill(); }
  ctx.fillStyle = dk; rr(x - 130, y - 92, 260, 50, 14);                         // hull
  ctx.fillStyle = lt; rr(x - 70 - rc * 0.3, y - 138, 130, 52, 18);              // turret
  ctx.fillStyle = dk; rr(x + 50 - rc, y - 124, 110, 14, 6);                     // barrel
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(x - 120, y - 88, 240, 8, 4);
  ctx.restore();
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
}
function drawBullets(list = bullets) {
  if (!list.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const b of list) {
    const n = Math.hypot(b.vx, b.vy), len = b.shell ? 70 : b.plasma ? 40 : 54, a = b.landed ? Math.max(0, 1 - b.age * 1.5) : 1;
    ctx.strokeStyle = b.color; ctx.globalAlpha = a * (b.hit ? 1 : 0.7); ctx.lineWidth = b.shell ? 8 : b.plasma ? 8 : 3;
    ctx.shadowColor = b.color; ctx.shadowBlur = b.plasma || b.shell ? 16 : 8;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx / n * len, b.y - b.vy / n * len); ctx.stroke();
  }
  ctx.restore();
}
function drawFx(t, layer) {
  for (const f of fx) {
    const k = (t - f.t0) / f.dur; if (k < 0) continue;
    ctx.save();
    if (layer === 'under' && f.kind === 'heal') {
      const [x0, y0] = body(f.from), [x1, y1] = body(f.to);
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(120,255,150,${0.7 * Math.sin(k * Math.PI)})`;
      ctx.lineWidth = 6; ctx.shadowColor = '#7f7'; ctx.shadowBlur = 14; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 120;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 60, x1, y1); ctx.stroke();
    }
    if (layer === 'over') {
      if (f.kind === 'spark') {
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f.big ? '#fff3a0' : f.color; ctx.globalAlpha = 1 - k;
        const r = (f.big ? 34 : 12) * (0.5 + k); ctx.beginPath();
        for (let i = 0; i <= 16; i++) { const a = i / 16 * 2 * Math.PI, l = i % 2 ? r * 0.35 : r; ctx.lineTo(f.x + Math.cos(a) * l, f.y + Math.sin(a) * l); }
        ctx.fill();
      } else if (f.kind === 'boom') {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 90 * (0.4 + k));
        g.addColorStop(0, '#fff6c8'); g.addColorStop(0.4, 'rgba(255,150,40,.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 90 * (0.4 + k), 0, 7); ctx.fill();
      } else if (f.kind === 'shield') {
        const [x, y] = body(f.s); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,220,120,${0.8 * (1 - k)})`;
        ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, y - 40 * f.s.scale, 190 * f.s.scale, 300 * f.s.scale, 0, 0, 7); ctx.stroke();
      } else if (f.kind === 'pop') {
        ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25; ctx.font = '700 24px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; const y = f.y - 40 * k;
        ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
      }
    }
    ctx.restore();
  }
}
function drawHud(t) {
  ctx.save(); ctx.font = '700 22px system-ui,sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(14, 12, 560, 62);
  ctx.fillStyle = '#fff'; ctx.fillText(`${doc.name}`, 28, 40);
  const nw = ctx.measureText(doc.name).width; ctx.font = '500 16px system-ui,sans-serif'; ctx.fillStyle = '#c9d1d9';
  ctx.fillText(`${F.toUpperCase()} · ${doc.main?.name ?? ''}`, 36 + nw, 40);
  const f1 = (x, d = 2) => x == null ? '—' : (+x).toFixed(d);
  ctx.fillStyle = '#9aa7b4'; ctx.font = '500 15px system-ui,sans-serif';
  ctx.fillText(T('hudStats', 'K/D {kd} · KPM {kpm} · acc {acc}% · HS {hs}% · {spk} shots/kill', { kd: f1(val('kd')), kpm: f1(val('kpm')), acc: f1(val('acc'), 0), hs: f1(val('hsr'), 0), spk: f1(st.spk, 0) }), 28, 63);
  // live tally (emerges from the sim, not scripted)
  if (!reduced) {
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0, min = t / 60, pm = x => min > 0 ? (x / min).toFixed(2) : '0.00';
  const clock = `${Math.floor(t / 3600) ? Math.floor(t / 3600) + ':' : ''}${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
  const s = '⏱ ' + clock + ' · ' + T('tally', 'kills {k} ({kpm}/min) · deaths {d} ({dpm}/min) · assists {a} · HS {hs} · vehicle {veh} · hit {acc}% of {shots} shots',
    { k: stats.k, kpm: pm(stats.k), d: stats.d, dpm: pm(stats.d), a: stats.a, hs: stats.hs, veh: stats.veh, acc, shots: stats.shots });
  ctx.font = '500 15px system-ui,sans-serif'; const w = ctx.measureText(s).width;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(14, H - 44, w + 28, 30);
  ctx.fillStyle = '#c9d1d9'; ctx.fillText(s, 28, H - 24);
  }
  // class badge over the main soldier
  drawStateBox(t);
  if (life.cls && alive(main) && !tank.on) {
    const [x, y] = head(main); ctx.font = '700 14px system-ui,sans-serif'; ctx.textAlign = 'center';
    const lbl = CLS[life.cls], bw = ctx.measureText(lbl).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x - bw / 2, y - 158, bw, 22);
    ctx.fillStyle = '#e6edf3'; ctx.fillText(lbl, x, y - 142);
  }
  ctx.restore();
}
function drawBox(t) {
  if (!life.box || t < life.box.t0 || t > life.box.t1) return; const x = life.box.x, y = main.home === main.x ? main.y : main.y;
  ctx.save(); ctx.fillStyle = '#5b4a2a'; ctx.fillRect(x - 18, y - 22, 36, 22); ctx.fillStyle = '#e0b040'; ctx.fillRect(x - 18, y - 14, 36, 5);
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4); ctx.fillStyle = '#ffe9a0'; ctx.fillRect(x - 3, y - 30, 6, 6); ctx.restore();
}
// placeholder box for states without art (states.js: placeholder: true), progress bar = real time left
function drawStateBox(t) {
  const s = cur; if (!s) return; const def = STATES[s.id];
  const show = def.placeholder || (s.veh && tank.on) || debug; if (!show) return;
  let lbl = s.veh && tank.on && s.id !== 'running' ? (s.id === 'idle' ? LBL('inVehicle') : `${LBL('inVehicle')} · ${LBL(s.id)}`) : LBL(s.id);
  if (s.id === 'running' && s.veh) lbl = T('st.driving', 'Driving to fight');
  if (def.countdown) lbl += ` ${Math.max(1, Math.ceil(s.t1 - t))}`;
  const k = clamp((t - s.t0) / (s.t1 - s.t0));
  const x = tank.on ? main.x : main.x, y = tank.on ? main.y - 200 : main.y - (main.state === 'dead' ? 130 : 250);
  ctx.save(); ctx.font = '600 15px system-ui,sans-serif'; ctx.textAlign = 'center';
  const w = Math.max(120, ctx.measureText(lbl).width + 22);
  ctx.fillStyle = 'rgba(10,14,20,.72)'; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.rect(x - w / 2, y - 26, w, 32); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#e6edf3'; ctx.fillText(lbl, x, y - 6);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - w / 2 + 6, y + 1, w - 12, 3);
  ctx.fillStyle = '#9fe8ff'; ctx.fillRect(x - w / 2 + 6, y + 1, (w - 12) * k, 3);
  if (debug) { ctx.font = '500 12px system-ui,sans-serif'; ctx.fillStyle = '#9aa7b4'; ctx.fillText(`${s.id} · ${(s.t1 - s.t0).toFixed(1)} s`, x, y + 18); }
  ctx.restore();
}
function drawWall(w) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(w.x + w.w / 2, w.y + 2, w.w * 0.55, 10, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#46525f'; ctx.fillRect(w.x, w.y - w.h, w.w, w.h);   // basic wall tile
  ctx.fillStyle = '#6d7c8c'; ctx.fillRect(w.x, w.y - w.h, w.w, 6);      // lit top edge
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(w.x, w.y - w.h + 6, w.w, 10);
  ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(w.x, w.y - w.h * 0.55, w.w, 3);  // block seams
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(w.x + w.w * 0.5, w.y - w.h, 3, w.h);
  ctx.restore();
}
function render(t) {
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  drawBg(); drawBox(t); drawFx(t, 'under');
  // depth: soldiers by ground y (main always on top); each tracer moves from its shooter's layer to
  // its target's: a hit ends just in front of the target, a miss passes just in front of or behind it
  const order = [...everyone].sort((a, b) => (a === main) - (b === main) || a.y - b.y);
  const rank = new Map(order.map((s, i) => [s, i])), layer = order.map(() => []), back = [];
  for (const b of bullets) {
    const r0 = rank.get(b.from) ?? order.length, r1 = (rank.get(b.to) ?? 0) + b.side * 0.5;
    const k = lerp(r0 + 0.5, r1, clamp((b.d - b.left) / (b.d || 1)));
    const i = Math.floor(k); (i < 0 ? back : layer[Math.min(order.length - 1, i)]).push(b);
  }
  drawBullets(back);
  // walls ride the same depth order (by ground y): a wall in front of a soldier occludes him,
  // which is what "behind cover" means here. Main's wall is skipped while the tank is out.
  const wallsSorted = walls.slice().sort((a, b) => a.y - b.y);
  let wi = 0;
  const wallsBefore = (y) => { while (wi < wallsSorted.length && wallsSorted[wi].y < y) { const w = wallsSorted[wi++]; if (w.forMain && tank.on) continue; drawWall(w); } };
  for (const [i, s] of order.entries()) {
    wallsBefore(s.y);
    if (s === main && (tank.on || t - tank.off < 0.4)) { if (tank.on) { drawTank(t); drawBullets(layer[i]); continue; } drawTank(t); }
    if (s === main && alive(main)) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 70, 11, 0, 0, 7); ctx.stroke(); ctx.restore(); }
    s.draw(ctx, t); drawBullets(layer[i]);
  }
  while (wi < wallsSorted.length) { const w = wallsSorted[wi++]; if (w.forMain && tank.on) continue; drawWall(w); }
  drawFx(t, 'over'); drawHud(t);
  lifeUi(t);
}

// ---------------------------------------------------------------- DOM hints (details live in hover titles)
const pc = id => pct(id) == null ? '' : '\n' + T('pct', 'Higher than {p}% of {n} players.', { p: pct(id), n: num(doc.poolSize) });
const fmt = (id, d = 2, u = '') => val(id) == null ? null : (+val(id)).toFixed(d) + u;
const RH = ' ' + T('rate', 'In the scene: a literal per-minute rate on the real clock.');
const H_ = (id, en) => T('hint.' + id, en);
const PM = T('perMin', '/min');
const CHIPS = [
  ['kd', fmt('kd'), 'K/D', 'Lifetime kills per death. Shown; the scene uses KPM and DPM directly (K/D = KPM ÷ DPM).'],
  ['kpm', fmt('kpm'), 'KPM', 'Kills per minute. 1.0 = one kill a minute, 0.05 = one every 20 minutes.', RH],
  ['dpm', fmt('dpm'), 'DPM', 'Deaths per minute. Each death is followed by a 5–10 s respawn timer, or a revive.', RH],
  ['spk', fmt('spk', 1), 'Shots/kill', 'Infantry weapon shots fired per kill. In the scene: all of the player’s tracers over time ÷ kills comes out at this number.'],
  ['hpk', fmt('hpk', 1), 'Hits/kill', 'Infantry hits per kill. In the scene: this many tracers land per kill, on average.'],
  ['acc', fmt('acc', 1, '%'), 'Accuracy', 'Lifetime accuracy (all weapons). The live tally’s hit % comes out close to it.'],
  ['hsr', fmt('hsr', 1, '%'), 'HS', 'Headshot kill ratio. In the scene: this share of infantry kills land on the head.'],
  ['oppIvi', fmt('oppIvi', 0), 'Enemy iVi', 'Average ⚔️ iVi of the people this player fought. In the scene: enemy size.'],
  ['ekpm', fmt('ekpm', 2), 'Enemy pace', 'Average kill pace of the weapons used against this player. In the scene: how often enemies take pot-shots.'],
  ['apk', fmt('apk', 2), 'Assists/kill', 'Assists per kill. In the scene: a teammate lands the last hit (+assist).'],
  ['infVeh', fmt('infVeh', 0, '%'), 'Vehicle', 'Share of kills made from vehicles. In the scene: that share of kills comes from a tank stint.'],
  ['fightStart', fightOk ? (fight.ms / 1000).toFixed(0) + ' s' : null, '⏱ To fight', 'Time to fight: median time from a death to the next kill or assist (as on the LIVE page). In the scene: when the first fight of each life starts.',
    fight && !fightOk ? '\n' + T('fightFew', 'Only {n} samples so far (needs {min}); a neutral 19 s is used until then.', { n: fight.n, min: FIGHT_MIN_RUNS })
      : fightOk ? '\n' + T('fightFrom', 'From {n} deaths in {s} sessions.', { n: num(fight.n), s: fight.sessions ?? '?' }) : ''],
  ['healsGivenPm', fmt('healsGivenPm', 2, PM), 'Heals', 'Heals given per minute (Honu XP sample).', RH],
  ['revivesGivenPm', fmt('revivesGivenPm', 2, PM), 'Revives', 'Revives given per minute (Honu XP sample).', RH],
  ['resupplyPm', fmt('resupplyPm', 2, PM), 'Resupply', 'Resupplies given per minute (Honu XP sample).', RH],
  ['repairPm', fmt('repairPm', 2, PM), 'Repairs', 'Repair XP events per minute (Honu XP sample).', RH],
  ['capturePm', fmt('capturePm', 2, PM), 'Points', 'Point attack/defend/capture XP per minute (Honu XP sample).', RH],
  ['zerg', fmt('zerg', 0), '🪳 Zerg', 'How much this player fights inside a big crowd. In the scene: number of teammates on screen (0–6).'],
  ['revivedShare', val('revivedShare') == null ? null : Math.round(val('revivedShare') * 100) + '%', 'Revived', 'Revives received per death (Honu XP sample, capped at 100%). In the scene: share of deaths that end in a revive instead of a respawn (max 80%).'],
  ['luck', doc.luck ? (doc.luck.pts > 0 ? '+' : '') + doc.luck.pts : null, '🎲 Luck', 'Gap between real duel results and what iVi predicts. Positive: some enemy shots become visible close calls.'],
  ['adjs', fmt('adjs', 0), '⚔️ iVi', 'The site’s main skill score. Shown only.'],
];
{
  const hud = document.getElementById('hud');
  const back = document.createElement('a'); back.className = 'back'; back.href = '../?names=' + encodeURIComponent(doc.name);
  back.textContent = '←'; back.title = T('back', 'Open this player on the main page'); hud.append(back);
  const who = document.createElement('span'); who.className = 'who';
  if (doc.main?.img) { const im = new Image(); im.src = `../assets/weapons/${doc.main.img}.webp`; im.alt = ''; im.onerror = () => im.remove(); who.append(im); }
  who.append(`${doc.name} · ${F.toUpperCase()}${doc.main?.name ? ' · ' + doc.main.name : ''}`);
  who.title = (doc.main ? T('main', 'Most-used infantry weapon: {w} ({cat}), {k} kills.', { w: doc.main.name, cat: doc.main.cat, k: num(doc.main.kills) }) : '') +
    (doc.classes ? '\n' + T('classes', 'Class time: {list}. Each life in the scene picks a class by these shares.',
      { list: ['ha', 'med', 'eng', 'la', 'inf', 'max'].map(k => `${CLS[k]} ${doc.classes[k] ?? 0}%`).join(', ') }) : '');
  hud.append(who);
  for (const [id, v, l0, h0, extra = ''] of CHIPS) {
    const l = CL(id, l0), hint = H_(id, h0) + extra;
    const c = document.createElement('span'); c.className = 'chip' + (v == null ? ' off' : '');
    const b = document.createElement('b'); b.textContent = l; c.append(b, ' ' + (v ?? '—'));
    c.title = v == null ? (id === 'fightStart' ? hint : hint + '\n' + T('missing', 'Not in the data for this player, so a neutral default is used or this part is skipped.')) : hint + pc(id);
    if (v == null && id === 'fightStart') { c.lastChild.textContent = ' ' + T('fightDefault', '19 s (default)'); if (!fight) c.title = hint + '\n' + T('fightNone', 'Not collected for this player yet, so a neutral 19 s is used.'); }
    hud.append(c);
  }
  const n = document.createElement('div'); n.className = 'note';
  n.textContent = T('note', 'Real time: the scene runs 1:1 with the stats, so quiet players have long quiet stretches. Stand-in art. Site data of {date}.',
    { date: new Date(doc.builtAt).toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' }) }) +
    (missing.length ? ' ' + T('missingList', 'Missing here: {list}.', { list: missing.join(', ') }) : '');
  hud.append(n);
}

// ---------------------------------------------------------------- life timeline (DOM, under the canvas)
// Phase label + its running timer, a strip of this life's phases (filled as it plays), time alive,
// the life number and the session clock. All of it reads the planner's segments (states.js phase),
// so it shows the real 1:1 timeline, not a separate animation. Reduced motion: the first life as planned.
const PH_ICON = { spawn: '⏬', travel: '🏃', fight: '🔫', death: '💀' };
const PH_EN = { spawn: 'Spawn', travel: 'Travel', fight: 'Fight', death: 'Death' };
const PH_HINT = {
  spawn: 'Respawn timer (5–10 s) and beam-in, or a revive (then no travel).',
  travel: 'Running or driving to the fight; its length comes from ⏱ time to fight.',
  fight: 'Shooting, kills, assists, reloads, vehicle time and support actions, at the player’s real per-minute rates.',
  death: 'The lost exchange that ends the life (DPM).' };
const PH = (ph) => T('ph.' + ph, PH_EN[ph]);
const PHH = (ph) => T('phHint.' + ph, PH_HINT[ph]);
const clk = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, x = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const lifeAt = (t) => { while (plan.lives.length > 1 && plan.lives[0].t1 <= t) plan.lives.shift();
  return plan.lives.find(l => t >= l.t0 && t < l.t1) ?? plan.lives[0] ?? null; };
const phaseAt = (L, t) => L.phases.find(p => t >= p.t0 && t < p.t1) ?? L.phases.at(-1);
const ui = (() => {
  const box = document.getElementById('life'); if (!box) return null;
  const mk = (tag, cls, title) => { const e = document.createElement(tag); e.className = cls; if (title) e.title = title; return e; };
  const now = mk('span', 'ph-now'), strip = mk('div', 'strip', T('strip', 'This life, phase by phase. The filled part has already played.'));
  const alive = mk('span', 'alive', T('aliveHint', 'Time alive in this life, from the end of the spawn to now.'));
  const sess = mk('span', 'sess', T('sessionHint', 'Life number and session clock: real time since the scene started (skipped time included, so per-minute rates stay true).'));
  const skip = mk('button', 'skip', T('skipHint', 'Skip waiting: jump to the next kill, death or phase change. The skipped time still counts on the clocks and tallies.'));
  skip.type = 'button'; skip.textContent = '⏭'; skip.setAttribute('aria-label', skip.title);
  skip.addEventListener('click', () => window.__skip());
  if (reduced) skip.hidden = true;
  box.append(now, strip, alive, sess, skip); box.hidden = false;
  return { box, now, strip, alive, sess, skip, life: null, cells: [], last: -1 };
})();
function lifeUi(t, force) {
  if (!ui) return;
  const L = lifeAt(t); if (!L) return;
  if (ui.life !== L) {   // a new life: rebuild the strip (widths = planned real time per phase)
    ui.life = L; ui.strip.textContent = ''; ui.cells = [];
    const len = L.t1 - L.t0;
    for (const p of L.phases) {
      const c = document.createElement('span'); c.className = 'seg ph-' + p.ph; c.style.flexGrow = String(Math.max(0.001, p.t1 - p.t0) / len);
      c.title = T('seg', '{phase}: {d} s', { phase: PH(p.ph), d: (p.t1 - p.t0).toFixed(1) }) + '\n' + PHH(p.ph);
      const f = document.createElement('i'); c.append(f); ui.strip.append(c); ui.cells.push([p, f]);
    }
  }
  if (reduced) {   // static readout: the planned first life, no running clocks
    ui.now.textContent = T('plan', 'Life plan'); ui.now.title = T('planHint', 'Reduced motion: the first life as planned, no running clock.');
    for (const [, f] of ui.cells) f.style.width = '0';
    ui.alive.textContent = L.phases.map(p => PH_ICON[p.ph] + ' ' + clk(Math.round(p.t1 - p.t0))).join(' · ');
    ui.sess.textContent = ''; return;
  }
  const w = performance.now(); if (!force && w - ui.last < 100) return; ui.last = w;
  const p = phaseAt(L, t);
  ui.now.textContent = `${PH_ICON[p.ph]} ${PH(p.ph)} ${clk(t - p.t0)}`;
  ui.now.className = 'ph-now ph-' + p.ph;
  ui.now.title = PHH(p.ph) + (cur ? '\n' + T('phNow', 'Now: {state}', { state: LBL(cur.id) }) : '');
  for (const [q, f] of ui.cells) f.style.width = (100 * clamp((t - q.t0) / (q.t1 - q.t0))) + '%';
  const sp = L.phases.find(q => q.ph === 'spawn'), de = L.phases.find(q => q.ph === 'death');
  const a0 = sp ? sp.t1 : L.t0, a1 = de ? Math.min(t, de.t0) : t;
  ui.alive.textContent = '❤ ' + T('alive', 'Alive {t}', { t: t < a0 ? '0:00' : clk(a1 - a0) });
  ui.sess.textContent = T('session', 'Life {n} · ⏱ {t}', { n: L.n, t: clk(t) });
}

// ---------------------------------------------------------------- run
// wallT = real seconds since start; simT = scene clock. Slow-mo lets simT fall behind; calm states then
// run at up to 1.25× until simT is back on wallT, so per-minute rates hold over any long stretch.
const STEP = 1 / 120;
window.__render = (w) => {
  while (wallT + STEP <= w) {
    wallT += STEP;
    let k = timeScale(wallT);
    const debt = wallT - simT;
    if (!slow && debt > 1e-4 && cur && STATES[cur.id].calm) k = Math.min(1.25, 1 + debt * 4, 1 + debt / STEP);
    const dt = k * STEP; simT += dt; step(simT, dt);
  }
  render(simT); return true; };
// test hook: run the scene clock forward without drawing or slow-mo (used by tools/probe checks)
window.__fast = (sec, dt = 1 / 30) => { fast = true; const end = simT + sec; while (simT < end) { simT += dt; wallT = simT; step(simT, dt); } fast = false; render(simT); return window.__params(); };
// ⏭ skip waiting (testing aid): run the same 1:1 clock forward to just before the next kill, assist,
// death or phase change. Nothing is cut: every skipped second is stepped through the scene, so the
// tallies, the session clock and every per-minute rate stay exactly as if it had been watched.
const SKIP_EVENTS = new Set(['fight', 'assist', 'dying']);
function nextEvent(t) {
  const ph = phaseOf(cur?.id ?? plan.segs[0]?.id);
  for (let ahead = 60; ahead <= 7200; ahead *= 2) {
    ensurePlan(t + ahead);
    const s = plan.segs.find(s => s.t0 > t + 0.6 && (SKIP_EVENTS.has(s.id) || phaseOf(s.id) !== ph));
    if (s) return s;
  }
  return null;
}
window.__skip = () => {
  const from = simT, ev = nextEvent(simT); if (!ev) return null;
  // a phase change lands just inside the new phase; a kill/assist/death in the same phase just before it
  const to = Math.max(simT, phaseOf(ev.id) !== phaseOf(cur?.id ?? ev.id) ? ev.t0 + 0.02 : ev.t0 - 0.4);
  fast = true; slow = null;
  while (simT < to) { const dt = Math.min(1 / 30, to - simT); simT += dt; step(simT, dt); }
  fast = false;
  if (simT > wallT) { skipped += simT - wallT; wallT = simT; }
  render(simT); lifeUi(simT, true);
  return { from, to: simT, id: ev.id, phase: phaseOf(ev.id), stats: { ...stats } };
};
window.__bullets = () => bullets.map(b => ({ hit: !!b.hit, side: b.side, deg: +(Math.atan2(b.vy, b.vx) * 180 / Math.PI).toFixed(2), from: b.from === main ? 'main' : 'other' }));
window.__cover = () => ({ walls: walls.map(w => [Math.round(w.x), w.y, Math.round(w.w), Math.round(w.h)]),
  main: { x: +main.x.toFixed(1), peekWant: main.peekWant ?? 0, cover: main.cover, state: main.state },
  allies: allies.map(a => ({ x: +a.x.toFixed(1), peekWant: a.peekWant ?? 0, cover: a.cover, state: a.state })),
  enemies: enemies.map(e => ({ x: +e.x.toFixed(1), peekWant: e.peekWant ?? 0, cover: e.cover, state: e.state, slot: e.slot })) });
window.__life = () => { const L = lifeAt(simT); return L && { n: L.n, phase: phaseAt(L, simT)?.ph, phases: L.phases.map(p => [p.ph, +(p.t1 - p.t0).toFixed(1)]), simT }; };
window.__slow = () => ({ wallT, simT, scale: timeScale(wallT) });
window.__params = () => ({ st, P, RATE, CYCLE, ALIVE_MEAN, DOWN_MEAN, missing, stats, simT, cur: cur?.id, credit, fight: fightOk ? fight : null });
window.__plan = () => plan.segs.map(s => [s.id, +s.t0.toFixed(1), +(s.t1 - s.t0).toFixed(1), s.veh ? 'veh' : '']);
if (reduced) {
  document.getElementById('rm').hidden = false;
  ensurePlan(0); newLife(0, true); engaged = true; for (const e of enemies) { e.state = 'idle'; e.x = e.slot; }
  for (const s of everyone) { s.seed = 0; s.state = 'idle'; }
  render(0);
} else if (!q.has('preview')) {
  const t0 = performance.now() / 1000;
  const frame = (now) => { window.__render(now / 1000 - t0 + skipped); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
window.__ready = true;
