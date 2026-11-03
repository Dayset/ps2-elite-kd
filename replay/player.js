// 🎬 Duel replay: a stats-driven Planetman scene, 1:1 real time. Reads data/replay/<shard>.json
// (scripts/build-replay.mjs, built daily from the site's own cache) and data/xp/<slug>.json. Every per-minute stat is a literal per-minute rate here: a 0.05 KPM player waits
// ~20 real minutes between kills. The time in between is filled with the states in states.js.
// All randomness is seeded from the player's name.
import { Soldier, loadRigs, FX } from './soldier.js?v=20261103-mot1';
import { STATES, FILLERS, PHASES, phaseOf } from './states.js';
import { shardOf, slugOf } from './shard.mjs';
import { toDoc } from './doc.mjs?v=20261103-pair1';
import { pairOf, pairStatus, pairRow, defaultRival, rankedRivals, MED_KEYS, MED_FALLBACK } from './pair.mjs?v=20261103-pair1';
import { profileOf, shotsPerSec, toProfile, FALLBACK } from './weapons.mjs?v=20261103-weap1';
import { baseRate, bulletRate, nextKillAt, calmStretchEnd, rampTo, baseGate, resolvePace } from './director.mjs?v=20261103-pace1';
import { shooter, headChance } from './engagement.mjs?v=20261103-hs1';
import { planDuel } from './duel-plan.mjs?v=20261103-ps1';
import { planScrim, scrimPlanEnd, topScrimPartner } from './scrim-plan.mjs?v=20261103-ps1';
import { hpAt, barFracs, sparkFor, scoreAt, engagementAt, lifeAt as duelLifeAt, phaseState, killcamFor } from './duel-scene.mjs?v=20261103-duel2';
import { STRIP, coverOf, assignLanes } from './lanes.mjs?v=20261103-strip1';
import { pickWeighted, drawOpponents } from './crowd.mjs?v=20261103-crowd1';
import { kpmGauge, kdLives, accBar, hsHeads, spkGauge } from './gauges.mjs?v=20261103-gauge1';
import { t as tr, ready as i18nReady, currentLang } from '../i18n.mjs';

const cv = document.getElementById('stage'), ctx = cv.getContext('2d');
const W = STRIP.W, H = STRIP.H, GROUND = STRIP.GROUND;
const q = new URLSearchParams(location.search);
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !q.has('preview') && !q.has('play');
const debug = q.has('debug');
const reducedOS = matchMedia('(prefers-reduced-motion: reduce)').matches;   // the OS setting itself, never changed by ▶ Play anyway
// Pace selector (#110): URL ?speed=1|2|cine wins over the stored choice,
// else the stored choice, else x1. Storage failures fall back to x1.
let pace = resolvePace(q.get('speed'), (() => { try { return localStorage.getItem('ps2ekd:replayPace'); } catch { return null; } })());
if (q.has('bare')) document.body.classList.add('bare');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- data
await i18nReady;
const T = (k, fb, v) => tr('replay.' + k, fb, v);
const LOC = currentLang();
const num = (x) => (+x).toLocaleString(LOC);
const LBL = (id) => T('st.' + id, STATES[id]?.label ?? id);
// Pace selector (#110, DOM under the canvas, right-aligned): replaces the
// old canvas speed chip. The URL choice wins for this load only — it is not
// written back to storage, so a later load without ?speed keeps the stored
// choice. The rate span shows the last computed rate (advance() owns it;
// render() only displays it, so displaying never moves the ramp state).
const paceEl = document.createElement('div'); paceEl.id = 'pace';
paceEl.setAttribute('aria-label', T('paceLabel', 'Playback pace'));
const paceBtns = document.createElement('div'); paceBtns.className = 'pace-btns';
const paceBtnMap = {};
for (const [id, label, hint] of [
  ['1', '×1', T('pace1Hint', 'Real time, constant; no slow-mo, no bullet time, no jump cuts.')],
  ['2', '×2', T('pace2Hint', 'Twice real time, constant; no slow-mo, no bullet time, no jump cuts.')],
  ['cine', '🎬', T('paceCineHint', 'Cinematic: the director — ×2 calm, ×1 trade, ×0.5 before a kill, ×0.2 bullet time, jump cuts.')],
]) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.pace = id; b.textContent = label; b.title = hint; b.setAttribute('aria-label', hint);
  b.addEventListener('click', () => setPace(id)); paceBtns.append(b); paceBtnMap[id] = b;
}
const paceRateEl = document.createElement('span'); paceRateEl.className = 'pace-rate'; paceRateEl.title = T('paceRateHint', 'Current playback rate.');
paceEl.append(paceBtns, paceRateEl); cv.after(paceEl);
function setPace(p, save = true) {
  pace = p;
  if (save) { try { localStorage.setItem('ps2ekd:replayPace', p); } catch {} }
  for (const [id, b] of Object.entries(paceBtnMap)) { const on = id === p; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); }
}
setPace(pace, false);
let paceRateText = '';
function updatePaceRate() { const s = '×' + rate.toFixed(1); if (s !== paceRateText) { paceRateText = s; paceRateEl.textContent = s; } }
const rawName = (q.get('name') || '').trim().slice(0, 40);
const slug = slugOf(rawName);
// Room (#111): PC ids are name slugs; PS ids are server+cid keys (eu-…,
// us-…) straight from data-ps, because slugOf would strip the dash and the
// key would no longer match the shard. dataDir follows the room, so a PS
// page reads only data-ps/ and never touches the PC cache.
const room = q.get('room') === 'ps' ? 'ps' : 'pc';
const dataDir = room === 'ps' ? '../data-ps' : '../data';
const idk = room === 'ps' ? rawName.toLowerCase() : slug;
const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
const [meta, shard, catalog, profiles] = await Promise.all([getJson(`${dataDir}/replay/meta.json`),
  idk ? getJson(`${dataDir}/replay/${shardOf(idk)}.json`) : null, getJson('../assets/weapons/catalog.json'),
  getJson('../assets/weapons/profiles.json')]);
const doc = meta && shard?.p?.[idk] ? toDoc(shard.p[idk], { meta, catalog, slug: idk }) : null;
// PS has no faction source anywhere (player files, ranks, names, scrim rows
// all lack it), and toDoc defaults a missing faction to 'tr' — which would
// make every PS pair read as same-faction and fall back to the crowd scene.
// Unknown, not TR, is the honest value for PS.
if (room === 'ps' && doc) doc.faction = null;
let fast = false;
document.title = `🎬 ${doc ? doc.name + ' · ' : ''}${T('title', 'Duel replay')}`;
const rigs = await loadRigs();
if (!doc) {
  // no stats for this name (not in the PC cache yet, or no name): say so, keep the page quiet
  ctx.fillStyle = '#141b24'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#c9d1d9'; ctx.font = '600 28px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(rawName ? T('none', 'No replay stats for “{name}” yet.', { name: rawName }) : T('noName', 'Pick a player: 🎬 next to a name in the table.'), W / 2, H / 2);
  const n = document.createElement('div'); n.className = 'note';
  n.textContent = room === 'ps'
    ? T('noneHintPs', 'Replays cover PlayStation players in the site’s cache. A newly added player shows up after the next refresh.')
    : T('noneHint', 'Replays cover PC players in the site’s cache. A newly added player shows up after the next daily update.');
  document.getElementById('hud').append(n);
  window.__pair = () => null;
  window.__ready = true;
  await new Promise(() => {});   // nothing more to run (a module can't return early)
}

// ---------------------------------------------------------------- pair (?vs=, else A's top rival; #93 — no scene change yet)
const fit = await getJson(`${dataDir}/duel-ivi-fit.json`);
const aFile = await getJson(`${dataDir}/players/${idk}.json`);
const aRows = aFile?.player?.rows || [];
const shardCache = new Map([[shardOf(idk), shard]]);
const getShard = async (s) => { if (!shardCache.has(s)) shardCache.set(s, await getJson(`${dataDir}/replay/${shardOf(s)}.json`)); return shardCache.get(s); };
let pair = null, pairNote = null;
// Scrim mode (#111): ?room=ps&scrim=<t0> replays one stored 1v1 scrim. The
// row carries its own opponent, result and weapons, so no killboard row is
// needed. A t0 with no 1v1 row falls back to pair mode with a note.
let scrimMode = false, scrimRow = null, scrimExact = false;
const scrimsFile = room === 'ps' && idk ? await getJson(`${dataDir}/scrims/${idk}.json`) : null;
const scrimParam = q.get('scrim');
if (room === 'ps' && scrimParam && scrimsFile) {
  const t0 = Number(scrimParam);
  scrimRow = (scrimsFile.scrims || []).find((r) => r.t0 === t0 && r.o && r.o.length === 1) || null;
  scrimMode = !!scrimRow;
}
// bKey is the shard/file key, bSlug the killboard-row slug: identical on PC,
// different on PS (keys vs name slugs), so pair resolution takes both.
const resolvePair = async (bSlug, bName, bKey = bSlug) => {
  const bShard = await getShard(bKey);
  const bDoc = bShard?.p?.[bKey] ? toDoc(bShard.p[bKey], { meta, catalog, slug: bKey }) : null;
  if (room === 'ps' && bDoc) bDoc.faction = null;   // unknown, not TR (see above)
  const bFile = await getJson(`${dataDir}/players/${bKey}.json`);
  const bRows = bFile?.player?.rows || [];
  const status = pairStatus(doc, bDoc, pairRow(aRows, bRows, room === 'ps' ? slugOf(doc.name) : slug, bSlug));
  if (status !== 'pair') return status;
  pair = pairOf({ aDoc: doc, bDoc, aRows, bRows, fit, med: meta.med || null, bSlug, bName });
  return 'pair';
};
const resolveScrim = async () => {
  const [pKey, pName] = scrimRow.o[0];
  const bShard = await getShard(pKey);
  let bDoc = bShard?.p?.[pKey] ? toDoc(bShard.p[pKey], { meta, catalog, slug: pKey }) : null;
  if (!bDoc) {
    // The scrim partner is often not in the replay cache at all (only a
    // fraction of PS players are cached): synthesize him from the room's
    // medians + the row's own weapon, the way pairOf synthesizes an
    // uncached B. Without this, most scrim rows could never replay.
    const stats = {};
    for (const id of MED_KEYS) stats[id] = { v: (meta.med && Number.isFinite(meta.med[id])) ? meta.med[id] : MED_FALLBACK[id], p: null };
    const w = catalog?.items?.[scrimRow.w[1]];
    bDoc = { name: pName, slug: pKey, faction: null, server: '', poolSize: meta.pool, stats, builtAt: meta.ranksAt,
      luck: null, fightStart: null, hasXp: false,
      main: scrimRow.w[1] ? { id: scrimRow.w[1], name: w?.[0] ?? '', cat: w?.[1] ?? '', img: null, kills: null } : null, classes: null };
  }
  bDoc.faction = null;
  const share = (scrimRow.k + scrimRow.d) > 0 ? scrimRow.k / (scrimRow.k + scrimRow.d) : 0.5;
  pair = { a: doc, b: bDoc, row: { kills: scrimRow.k, deaths: scrimRow.d }, pA: share, pSrc: 'scrim',
    n: scrimRow.k + scrimRow.d, missing: { a: [], b: [] } };
  return 'pair';
};
const vsRaw = (q.get('vs') || '').trim().slice(0, 40);
if (scrimMode) {
  if ((await resolveScrim()) !== 'pair') { scrimMode = false; scrimRow = null; pairNote = T('scrimNotFound', 'No scrim found for that time — showing the pair scene instead.'); }
} else if (vsRaw) {
  let st, disp = vsRaw;
  if (room === 'ps') {
    // ?vs= carries a PS key, not a name: resolve the doc by key first, then
    // the killboard row by the partner's name slug.
    const bKey = vsRaw.toLowerCase();
    const bRaw = (await getShard(bKey))?.p?.[bKey];
    if (bRaw) { disp = bRaw.n; st = await resolvePair(slugOf(bRaw.n), bRaw.n, bKey); }
    else st = 'notFound';
  } else st = await resolvePair(slugOf(vsRaw), vsRaw);
  if (st === 'sameFaction') pairNote = T('pairSameFaction', '“{name}” fights for the same faction — showing the crowd scene instead.', { name: disp });
  if (st === 'notFound') pairNote = T('pairNotFound', 'No rival found for “{name}” — showing the crowd scene instead.', { name: disp });
} else if (room === 'ps') {
  // Default rival = top scrim partner, from the player's own scrims file.
  // PS has no faction to probe, so the killboard defaultRival — which needs
  // a confirmed cross-faction rival — can never pick one.
  const top = topScrimPartner(scrimsFile?.scrims);
  if (top) await resolvePair(slugOf(top.name), top.name, top.key);
  else pairNote = T('pairNotFound', 'No rival found for “{name}” — showing the crowd scene instead.', { name: doc.name });
} else {
  // probe only the top candidates' shards for their faction (one file each, cached above),
  // then let the pure selector pick the first confirmed cross-faction rival
  const cands = rankedRivals(doc, aRows).slice(0, 12);
  const fac = new Map();
  for (const c of cands) { const sh = await getShard(c.slug); const f = sh?.p?.[c.slug]?.f; if (f) fac.set(c.slug, f); }
  const rival = defaultRival(doc, aRows, (s) => fac.get(s) || null);
  if (rival) await resolvePair(rival.slug, rival.row.name);
  else pairNote = T('pairNotFound', 'No rival found for “{name}” — showing the crowd scene instead.', { name: doc.name });
}
if (pair) document.title = `🎬 ${pair.a.name} vs ${pair.b.name}`;
window.__pair = () => pair;
const S = doc.stats, val = id => S[id]?.v ?? null, pct = id => S[id]?.p ?? null;

// ⏱ time to fight. On the live site the value comes from data/xp/<slug>.json (`fight`, collected by
// scripts/honu-xp.mjs for players whose replay is opened); it is used only once the sample is big enough.
const FIGHT_MIN_RUNS = 20, FS_NEUTRAL = 19000;
let fight = doc.fightStart && doc.fightStart.n > 0 ? doc.fightStart : null;
if (doc.hasXp) { const x = await getJson(`${dataDir}/xp/${idk}.json`); if (x?.fight?.n > 0) fight = x.fight; }
// an opened replay asks the site's own collector to keep this player's sample growing (same Worker call
// and 24 h local throttle as the site's markRequested; live site, PC cache only)
if (room === 'pc' && location.origin === 'https://dayset.github.io' && !/^ps/i.test(doc.server || '')) try {
  const k = `ps2ekd:seen:${slug}`, last = +(localStorage.getItem(k) || 0);
  if (Date.now() - last > 864e5) { localStorage.setItem(k, String(Date.now()));
    fetch('https://ps2-elite-kd-cache.dayset.workers.dev/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [doc.name] }), keepalive: true }).catch(() => {}); }
} catch {}
const fightOk = fight && fight.n >= FIGHT_MIN_RUNS;

// mulberry32 seeded from the name; the plan has its own stream (rngPlan) so the
// stepping granularity (director rates, __fast dt) cannot move the plan: planCycle
// consumes rngPlan in cycle order only, while live decisions use rng
let seed = 2166136261; for (const c of doc.slug) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
const mulberry = (s) => { let a = s >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const rng = mulberry(seed);
const rngPlan = mulberry(seed ^ 0x9e3779b9);
const rngBg = mulberry(seed ^ 0x5bd1e995);   // background crowd: its own stream, so crowd timing cannot move main tallies
const sround = (x, r = rng) => Math.floor(x) + (r() < x - Math.floor(x) ? 1 : 0); // stochastic rounding keeps the long-run average exact
const pick = (a, r = rng) => a[Math.floor(r() * a.length)];
const gauss = (r = rng) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / Math.SQRT1_2 / Math.sqrt(1); };

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
const mainProfile = doc.main ? profileOf(doc.main.id, doc.main.cat, profiles?.profiles) : null;
const RATE = mainProfile ? shotsPerSec(mainProfile) : 10 + 3 * rng(); // shots/s: the main's real fire rate when his weapon resolves, else normal automatic fire
const P = {
  allies: st.zerg == null ? 0 : Math.round(st.zerg / 99 * 6),
  enemyScale: 0.46 + 0.1 * ((st.oppP ?? 50) / 99),
  suppress: lerp(9, 3.5, (st.ekpmP ?? 50) / 99),   // seconds between enemy pot-shots (they miss / graze)
  dodge: st.luck == null ? 0 : clamp(st.luck / 8) * 0.7,
  killShare: clamp(1 - 0.35 * st.apk - 0.1, 0.4, 0.85),  // share of shots/kill fired in the kill burst itself
};
if (st.apk > 0 && P.allies === 0) P.allies = 1;
if (scrimMode) P.allies = 0;   // a scrim is two players only: no allies, no back lane, no assists, 🪳 ignored
// mean down time and life length that make deaths per minute come out exactly at DPM
const DOWN_MEAN = st.revive * 4.5 + (1 - st.revive) * (7.5 + 0.9);
const CYCLE = 60 / Math.max(0.01, st.dpm);
const ALIVE_MEAN = Math.max(4, CYCLE - DOWN_MEAN - 3.2);   // 3.2 s = the death exchange (DYING)
const CLS = Object.fromEntries(Object.entries({ inf: 'Infiltrator', la: 'Light Assault', med: 'Medic', eng: 'Engineer', ha: 'Heavy Assault', max: 'MAX' })
  .map(([k, en]) => [k, T('cls.' + k, en)]));

// ---------------------------------------------------------------- crowd opponents (#103)
// The 5 enemy slots are real killboard opponents when the killboard has any:
// a weighted draw by kills+deaths from the first 20 confirmed cross-faction
// opponents (shard probes, cap 40; getShard is cached, so the pair flow's
// top-12 probes are free). Each keeps his faction, his main weapon's rate and
// mode, and his slot for the whole scene — he comes back after a respawn.
// Fewer than 5 → the rest stay bots; none → the whole crowd stays bots,
// exactly as before.
let crowdOpps = [];
if (!pair) {
  const pool = [];
  let probed = 0;
  for (const c of rankedRivals(doc, aRows)) {
    if (pool.length >= 20 || probed >= 40) break;
    const sh = await getShard(c.slug);
    probed++;
    const f = sh?.p?.[c.slug]?.f;
    if (f && f !== doc.faction && rigs[f]) {
      const e = sh.p[c.slug];
      const w = e.m && catalog?.items?.[e.m[0]];
      const prof = profileOf(e.m?.[0], w?.[1], profiles?.profiles);
      pool.push({ ...c, faction: f, rate: prof ? shotsPerSec(prof) : 9 + 3 * rng(), mode: prof?.mode ?? 'auto' });
    }
  }
  crowdOpps = drawOpponents(pool, 5, rng);
}

// ---------------------------------------------------------------- cast
// Strip stage (#105): one front lane (full size, full brightness, 3 slots per
// side, innermost first) + one back lane (dimmed, ~70% size) for the crowd.
// The duel pair takes the two innermost front slots, so the duel is always
// front lane; pickTarget only ever picks front-lane enemies (see moveToFront).
const F = (doc.faction && doc.faction in rigs) ? doc.faction : 'tr', foes = ['tr', 'nc', 'vs'].filter(f => f !== F);
const laneA = assignLanes({ nAllies: P.allies, nEnemies: scrimMode ? 0 : (pair ? 4 : 5), rival: !!pair, enemyScale: P.enemyScale, pairMode: !!pair });
const main = new Soldier(rigs[F], F, { x: laneA.main.x, y: laneA.main.y, scale: laneA.main.scale, facing: 1, seed: 0.3, rate: RATE, speed: 120, mode: mainProfile?.mode ?? 'auto', reloadMs: mainProfile?.reloadMs ?? 2400 });
main.isMain = true; main.lane = 0; main.slot = main.x;
const allies = laneA.allies.map((p, i) => {
  const a = new Soldier(rigs[F], F, { x: p.x, y: p.y, scale: p.scale, facing: 1, seed: 1.7 + i * 2.3, rate: 9 + 3 * rng(), speed: 90 });
  a.dim = p.dim; a.lane = p.lane; a.slot = p.x; return a; });
const enemies = laneA.enemies.map((p, i) => {
  const o = crowdOpps[i];
  const fac = o ? o.faction : foes[i % 2];
  const s = new Soldier(rigs[fac], fac, { x: p.x, y: p.y, scale: p.scale, facing: -1, seed: 3.1 + i * 1.9, rate: o?.rate ?? 9 + 3 * rng(), speed: 170, mode: o?.mode ?? 'auto' });
  s.dim = p.dim; s.lane = p.lane; s.slot = p.x; s.deadAt = -99; s.state = 'dead';
  if (o) { s.name = o.row.name; s.opp = o; }
  return s;
});
const everyone = [main, ...allies, ...enemies];
// cover: one basic wall tile per soldier, on the far side from the enemy, 10% transparent, and
// only up to its soldier's eyes (head() height) — the head shows over the top, the body ghosts
// through the tile. Hidden = centred on his wall; peek = stepped out past the firing edge.
// peekX is the slot/home the rest of the code already uses.
function makeCover(s) {
  return coverOf(s.x, s.y, s.scale, s.facing);
}
main.cover = makeCover(main);
for (const a of allies) a.cover = makeCover(a);
for (const e of enemies) e.cover = makeCover(e);
main.cover.wall.forMain = true;
const walls = [main.cover.wall, ...allies.map(a => a.cover.wall), ...enemies.map(e => e.cover.wall)];

// ---------------------------------------------------------------- rival (#98)
// In pair mode one enemy slot belongs to the rival: his own faction rig,
// his main weapon's rate, his slot and wall. Everyone else is already dim
// (allies) or dimmed here (enemies): third parties stay background.
let rival = null;
if (pair) {
  // PS factions are unknown (v1 placeholder): the rival takes a rig visibly
  // distinct from the main's, so the two sides stay readable, until the bot
  // stores real factions on scrim rows.
  const FB = (pair.b.faction && pair.b.faction in rigs) ? pair.b.faction : (room === 'ps' ? (F === 'tr' ? 'nc' : 'tr') : 'tr');
  const bProf = pair.b.main ? profileOf(pair.b.main.id, pair.b.main.cat, profiles?.profiles) : null;
  rival = new Soldier(rigs[FB], FB, { x: laneA.rival.x, y: laneA.rival.y, scale: laneA.rival.scale, facing: -1, seed: 7.7,
    rate: bProf ? shotsPerSec(bProf) : 10, speed: 170, mode: bProf?.mode ?? 'auto', reloadMs: bProf?.reloadMs ?? 2400 });
  rival.slot = rival.x; rival.lane = 0; rival.deadAt = -99;
  rival.cover = makeCover(rival); walls.push(rival.cover.wall); everyone.push(rival);
}

// ---------------------------------------------------------------- effects
let bullets = [], fx = [];
const stats = { k: 0, d: 0, a: 0, hs: 0, hh: 0, shots: 0, hits: 0, veh: 0, rev: 0, fills: {} };
// Living gauges (#108): kill/death moments (for KPM marks and K/D lives),
// last-10 headshot flags, and the current fight's shots. Fight counters reset
// in fire() when a new fight starts, so they stay right through a __fast jump.
const killTimes = [], deathTimes = [];
const recentMain = [], recentRival = [];
let fightShots = 0, fightHits = 0, rivalFightShots = 0, rivalFightHits = 0, fightKey = null;
let lifeIntervals = [];
let gaugeLast = 0, gaugeForce = false;
const oppKills = {}, oppDeaths = {};   // #103: per-opponent scene kills/deaths, keyed by slug
const pickStats = { kill: {}, death: {}, mix: {}, first: { kill: {}, death: {}, mix: {} }, swapOk: 0, swapFail: 0 };   // #103: pickTarget outcomes, keyed by slug
// Headshot rule (#109): a kill is a headshot kill only when the killing shot
// hits the head. Crowd bursts roll every hit: earlier hits at the per-hit
// chance from #95's formula, the final shot keeps the segment's pre-rolled
// decision (exact long-run HS share via takeWhole); duel shots already carry
// per-shot hs from engage(), so they are untouched here.
const HS_P = headChance(st.hs, mainProfile?.hsMult ?? 2);
const hsKillLog = [];
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
function fire(t, from, to, o = {}, r = rng) {
  const [x0, y0] = muzzle(from);
  const [tx, ty] = o.hs || o.close ? head(to) : body(to);
  const d = Math.hypot(tx - x0, ty - y0), v = o.shell ? 1500 : from.fx.plasma ? 1700 : 2400;
  const off = o.close ? -CONE * Math.sign(tx - x0 || 1) : o.hit ? (r() - 0.5) * 2 * 0.32 * CONE : (r() < 0.5 ? -1 : 1) * (0.48 + r() * 0.52) * CONE;
  const a = Math.atan2(ty - y0, tx - x0) + (o.shell ? 0 : off);
  bullets.push({ x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, d, left: o.hit ? d : d + 900, age: 0, from, to, ...o,
    side: o.hit ? 1 : r() < 0.5 ? -1 : 1,
    color: o.shell ? '#ffd27a' : from.fx.tracer, plasma: from.fx.plasma && !o.shell });
  if (from === main && !o.shell) { stats.shots++; if (o.hit) { stats.hits++; if (o.hs) stats.hh++; } }
  if (!o.shell) {   // #108: shots in the current fight only (pair: the engagement at t; crowd: a fight segment)
    const fk = duelPlan ? engagementAt(duelPlan, t)?.t0 ?? null : (cur?.id === 'fight' ? cur.t0 : null);
    if (fk != null) {
      if (fightKey !== fk) { fightShots = 0; fightHits = 0; rivalFightShots = 0; rivalFightHits = 0; fightKey = fk; }
      if (from === main) { fightShots++; if (o.hit) fightHits++; }
      else if (duelPlan && from === rival) { rivalFightShots++; if (o.hit) rivalFightHits++; }
    }
  }
}

// ---------------------------------------------------------------- director (wall clock -> data clock, issue #97)
// The director only scales wall time into data time; step() and the tallies never see it.
// bullet: {kind: 'kill'|'death', w0: wallT} while the bullet-time envelope runs;
// freeze: wall frames left frozen for a headshot impact; jump: the last jump cut;
// cue: the current frame plays under x0.6 (cues on). Off under reduced motion or ?speed=1.
let wallT = 0, simT = 0, skipped = 0, rate = 1, bullet = null, freeze = 0, jump = null, jumpCard = null, cue = false;
// Cinematic ramp state (#110): the shown rate, the ramp it is on, and the
// gated base rate. x1/x2 never touch this state (they return constants).
let rateShown = 1, rampTarget = null, rampFrom = 1, rampT0 = 0, baseCurrent = null, baseChangedAt = -10;
function currentRate() {
  if (pace === '1') return 1;
  if (pace === '2') return 2;
  // Cinematic: under reduced motion, the base rates only — no slow-mo,
  // bullet time, jump cuts or cue visuals (those are gated on reducedOS too).
  if (reducedOS) return baseRate(cur?.id);
  if (bullet && wallT - bullet.w0 >= 1.05) { bullet = null; rampTarget = null; rateShown = 1; }   // envelope ends at x1; the next target ramps from there
  if (bullet) return bulletRate(wallT - bullet.w0);   // the envelope owns the rate while active, as shipped
  const tKill = nextKillAt(plan.segs, simT);
  [baseCurrent, baseChangedAt] = baseGate(baseCurrent, baseRate(cur?.id), wallT, baseChangedAt, 2);
  const target = (tKill != null && tKill - simT <= 1.5) ? 0.5 : baseCurrent;
  if (target !== rampTarget) { rampTarget = target; rampFrom = rateShown; rampT0 = wallT; }
  rateShown = rampTo(rampFrom, rampTarget, wallT - rampT0, 0.4);
  return rateShown;
}

function land(t, b) {
  const s = b.to;
  if (b.shell) fx.push({ kind: 'boom', x: b.x, y: b.y + 20, t0: t, dur: 0.6 });
  else fx.push({ kind: 'spark', x: b.x, y: b.y, t0: t, dur: b.hs ? 0.45 : 0.18, big: b.hs, color: b.spark ?? b.from.fx.tracer });
  if ((s.state === 'die' || s.state === 'dead') && !(b.final && b.duel)) return;
  s.flinchAt = t;
  if (s === main && life.cls === 'ha') fx.push({ kind: 'shield', s, t0: t, dur: 0.35 });
  if (b.final) {
    s.hs = !!b.hs; s.set('die', t); s.deadAt = t; s.busy = false;
    if (s === main) { stats.d++; deathTimes.push(t); if (duelPlan) { recentRival.push({ hs: !!b.hs }); if (recentRival.length > 10) recentRival.shift(); } if (b.from.opp) oppDeaths[b.from.opp.slug] = (oppDeaths[b.from.opp.slug] || 0) + 1; if (!fast && !reducedOS && pace === 'cine') { if (b.hs) freeze = 2; bullet = { kind: 'death', w0: bullet ? wallT - 0.15 : wallT }; } return; }
    if (b.from === main) { stats.k++; killTimes.push(t); recentMain.push({ hs: !!b.hs }); if (recentMain.length > 10) recentMain.shift(); if (s.opp) oppKills[s.opp.slug] = (oppKills[s.opp.slug] || 0) + 1; if (b.hs) stats.hs++; if (b.veh) stats.veh++;
      if (b.headHitsBefore !== undefined) hsKillLog.push({ hs: !!b.hs, headBefore: b.headHitsBefore });
      if (!fast && !reducedOS && pace === 'cine') { if (b.hs) freeze = 2; bullet = { kind: 'kill', w0: bullet ? wallT - 0.15 : wallT }; }
      pop(main, b.hs ? T('pop.hs', 'headshot +1') : b.veh ? T('pop.veh', 'vehicle kill +1') : '+1', b.hs ? '#ffe066' : '#fff', t); }
    else if (b.assist) { stats.a++; pop(main, T('pop.assist', '+assist'), '#9fe8ff', t); }
  }
}

// ---------------------------------------------------------------- duel plan (#96)
// When a pair exists, the duel plan is built from the pair's own shooters
// (main-weapon profiles + shard stats) and #92's pair-model.json when it is
// there, else the planner defaults. The crowd scene keeps planCycle until
// #98 renders the plan; the plan is exposed for the headless check.
let duelPlan = null, scrimEndAt = 0;
if (pair) {
  try {
    const model = await getJson(`${dataDir}/replay/pair-model.json`);
    // weaponId overrides the doc's main weapon: a scrim row names the
    // weapon each side actually used most in that scrim.
    const mkSide = (d, weaponId = null) => {
      const prof = weaponId != null
        ? profileOf(weaponId, catalog?.items?.[weaponId]?.[1], profiles?.profiles)
        : d.main ? profileOf(d.main.id, d.main.cat, profiles?.profiles) : null;
      const s = d.stats || {};
      const val = (id) => s[id]?.v ?? null;
      const classes = {};
      if (d.classes) for (const [k, v] of Object.entries(d.classes)) if (k !== 'hours' && v > 0) classes[k] = v;
      return {
        sh: shooter(prof ?? toProfile(FALLBACK['Assault Rifle']), {
          kd: val('kd') ?? 1, spk: val('spk') ?? 39.5, hpk: val('hpk') ?? 10.4, hsr: (val('hsr') ?? 18.26) / 100,
        }),
        info: { kpm: val('kpm') ?? 1, classShares: classes, revivedShare: val('revivedShare') ?? 0.3, resupplyPm: val('resupplyPm') ?? 0 },
      };
    };
    let pairSeed = seed;
    for (const c of ('|' + pair.b.slug)) pairSeed = Math.imul(pairSeed ^ c.charCodeAt(0), 16777619);
    if (scrimMode) {
      // The scrim plan runs exactly the row's duration at the row's own
      // outcome share, and the seed search lands its final score on the
      // row's real result (else the nearest plan). The row's event rate
      // (kills+deaths over t1−t0) is what the plan's fight rate reproduces
      // in aggregate — it is NOT plugged in as a gap median, which would
      // mean something else entirely.
      const A = mkSide(pair.a, scrimRow.w[0]), B = mkSide(pair.b, scrimRow.w[1]);
      const found = planScrim(A.sh, B.sh, { seed: pairSeed, durationSec: scrimRow.t1 - scrimRow.t0,
        k: scrimRow.k, d: scrimRow.d, model, aInfo: A.info, bInfo: B.info });
      duelPlan = found.plan; scrimExact = found.exact;
      scrimEndAt = scrimPlanEnd(duelPlan, scrimRow.t1 - scrimRow.t0);
    } else {
      const A = mkSide(pair.a), B = mkSide(pair.b);
      duelPlan = planDuel(A.sh, B.sh, { seed: pairSeed, durationSec: 7200, pA: pair.pA, model, aInfo: A.info, bInfo: B.info });
    }
  } catch { duelPlan = null; }
}
window.__duelPlan = () => duelPlan;

// ---------------------------------------------------------------- duel scene (#98)
// The plan drives the duel: a flattened event list (states, shots, kills,
// returns) pumped as simT advances. Score is recomputed from the plan, so
// jumps and skips stay honest; tallies come from land() as usual.
const stripTag = (n) => (n || '').replace(/^\[[^\]]+\]\s*/, '');
let scoreEl = null, kcEl = null, backEl = null, pumpEvents = [], pumpIdx = 0, pumpT = 0;
let scrimEndEl = null, scrimEndShown = false;
const updateScore = () => {
  if (!scoreEl || !duelPlan) return;
  const s = scoreAt(duelPlan, simT);
  scoreEl.textContent = `${stripTag(pair.a.name)} ${s.a} – ${s.b} ${stripTag(pair.b.name)}`;
};
const showKillcam = (eng) => {
  if (!kcEl) return;
  const kc = killcamFor(eng, eng.outcome === 'a' ? pair.a : pair.b);
  kcEl.replaceChildren();
  const killer = document.createElement('b'); killer.textContent = stripTag(eng.outcome === 'a' ? pair.a.name : pair.b.name); kcEl.append(killer);
  if (kc.weapon) {
    kcEl.append(document.createTextNode(' · '));
    if (kc.weapon.img != null) { const im = document.createElement('img'); im.src = `../assets/weapons/${kc.weapon.img}.webp`; im.alt = ''; kcEl.append(im); kcEl.append(document.createTextNode(' ')); }
    kcEl.append(document.createTextNode(kc.weapon.name));
  }
  const line = document.createElement('div');
  line.textContent = `${kc.hits} ${T('hits', 'hits')} · ${kc.hs} ${T('headshots', 'headshots')} · TTK ${kc.ttk.toFixed(1)}s`;
  kcEl.append(line);
  kcEl.hidden = false;
};
const showBackNote = () => {
  if (!backEl) return;
  backEl.textContent = T('isBack', '{name} is back', { name: stripTag(pair.b.name) });
  backEl.hidden = false;
};
function pumpDuel(t) {
  if (!duelPlan) return;
  if (!engaged) { engaged = true; for (const e of enemies) { e.state = 'idle'; e.x = e.slot; } } // no crowd fights arrive in pair mode; wake the background battle directly
  const jump = t - pumpT > 5; // a skip jumps past shots: keep states/kills, don't fire a volley
  while (pumpIdx < pumpEvents.length && pumpEvents[pumpIdx].t <= t) {
    const ev = pumpEvents[pumpIdx++];
    if (ev.kind === 'state') (ev.side === 'a' ? main : rival).set(ev.state, t);
    else if (ev.kind === 'shot') {
      if (jump) continue;
      const sh = ev.shot, from = sh.from === 'a' ? main : rival, to = sh.from === 'a' ? rival : main;
      fire(t, from, to, { hit: sh.hit, hs: sh.hs, final: ev.kill, duel: true, spark: sh.hit ? sparkFor(ev.eng, ev.idx) : null });
    }
    else if (ev.kind === 'kill') { showKillcam(ev.eng); updateScore(); }
    else if (ev.kind === 'back') showBackNote();
    else if (ev.kind === 'cls') life.cls = ev.cls;
  }
  pumpT = t;
}
if (pair && duelPlan) {
  for (const e of duelPlan.engagements) {
    for (const s of e.segments) {
      pumpEvents.push({ t: s.t0, kind: 'state', side: 'a', state: phaseState(s.phase, 'a', e) });
      pumpEvents.push({ t: s.t0, kind: 'state', side: 'b', state: phaseState(s.phase, 'b', e) });
    }
    e.shots.forEach((sh, i) => {
      if (sh.from === 'third') return;
      pumpEvents.push({ t: sh.t, kind: 'shot', eng: e, idx: i, shot: sh,
        kill: e.killAt != null && Math.abs(sh.t - e.killAt) < 1e-9 && sh.from === e.outcome });
    });
    if (e.killAt != null) pumpEvents.push({ t: e.killAt, kind: 'kill', eng: e });
    if (e.victim) {
      const deathT = e.killAt ?? e.segments.find((s) => s.phase === 'resolution').t0;
      pumpEvents.push({ t: deathT + 1.2, kind: 'state', side: e.victim, state: 'dead' });
    }
  }
  for (const side of ['a', 'b']) {
    for (const lf of duelPlan.lives[side]) {
      if (lf.start <= 0) continue;
      const nextEng = duelPlan.engagements.find((x) => x.respawnSide === side && x.t0 >= lf.start - 1e-9);
      const revived = nextEng?.revived ?? false;
      pumpEvents.push({ t: lf.start - (revived ? 1.5 : 0.9), kind: 'state', side, state: revived ? 'revive' : 'respawn' });
      const startsNow = duelPlan.engagements.some((x) => Math.abs(x.t0 - lf.start) < 1e-9);
      if (!startsNow) pumpEvents.push({ t: lf.start, kind: 'state', side, state: 'idle' });
      if (side === 'a') pumpEvents.push({ t: lf.start, kind: 'cls', cls: lf.cls });
      if (side === 'b') pumpEvents.push({ t: lf.start, kind: 'back' });
    }
  }
  pumpEvents.sort((x, y) => x.t - y.t);
  const hud = document.getElementById('hud');
  const chips = document.createElement('div'); chips.id = 'duelChips';
  const bv = (id) => pair.b.stats?.[id]?.v ?? null;
  const f1 = (x, d = 1) => x == null ? '—' : (+x).toFixed(d);
  for (const [label, text] of [['KPM', f1(bv('kpm'), 2)], ['K/D', f1(bv('kd'), 2)], ['acc', f1(bv('acc'), 0) + '%'], ['HS', f1(bv('hsr'), 0) + '%'], ['shots/kill', f1(bv('spk'), 0)]]) {
    const c = document.createElement('span'); c.className = 'chip'; c.textContent = `${label} ${text}`; chips.append(c);
  }
  hud.append(chips);
  // ---------------------------------------------------------------- scrim end card (#111)
  // When the scene's data clock passes the plan's own end (scrimEndAt: the
  // row window plus the final engagement's tail — see scrim-plan.mjs), the
  // score has counted up to the real final result: show the card, then loop
  // by reloading — a clean restart (clocks, pump, tallies) for free, and the
  // same seed re-searches the same plan, so the replay repeats exactly.
  if (scrimMode && duelPlan) {
    scrimEndEl = document.createElement('div'); scrimEndEl.id = 'scrimEnd'; scrimEndEl.className = 'note'; scrimEndEl.hidden = true;
    const dstr = new Date(scrimRow.t0 * 1000).toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
    scrimEndEl.textContent = T('scrimEnd', 'Scrim · {date} · {a}–{b} · {min} min',
      { date: dstr, a: scrimRow.k, b: scrimRow.d, min: Math.round((scrimRow.t1 - scrimRow.t0) / 60) });
    hud.append(scrimEndEl);
  }
  scoreEl = document.createElement('div'); scoreEl.id = 'duelScore';
  scoreEl.title = T('scoreAllTime', 'All-time: {a}–{b}', { a: pair.row?.kills ?? '—', b: pair.row?.deaths ?? '—' });
  document.body.append(scoreEl);
  kcEl = document.createElement('div'); kcEl.id = 'killcam'; kcEl.hidden = true; document.body.append(kcEl);
  backEl = document.createElement('div'); backEl.id = 'duelBack'; backEl.className = 'note'; backEl.hidden = true; hud.append(backEl);
  updateScore();
}
window.__scrim = () => scrimMode ? { t0: scrimRow.t0, t1: scrimRow.t1, k: scrimRow.k, d: scrimRow.d,
  exact: scrimExact, endShown: scrimEndShown, planEnd: scrimEndAt } : null;

// ---------------------------------------------------------------- 1:1 timeline planner
// One "cycle" = from a death (or the first spawn) to the next death. Everything is placed on the real
// clock: deaths every 60/DPM s on average, kills at KPM, assists at KPM × assists/kill, fillers at their
// own per-minute rates. Counts come from accumulators (credit += rate × time; take the whole part), so
// over time every ratio converges to the stat instead of being forced per loop.
const credit = { k: 0, a: 0, hs: 0, veh: 0, rev: 0, shots: 0, hits: 0, ...Object.fromEntries(FILLERS.map(f => [f, 0])) };
const plan = { segs: [], end: 0, cycles: 0, deathsPlanned: 0 };
const takeWhole = (key, add, cap = Infinity) => { credit[key] = Math.min(cap, credit[key] + add); const n = Math.floor(credit[key]); credit[key] -= n; return n; };
const seg = (id, t0, dur, o = {}) => ({ id, t0, t1: t0 + dur, ...o });
const killShots = (r = rng) => Math.max(1, sround(st.spk * P.killShare, r));
const killHits = (r = rng) => Math.max(1, sround(st.hpk * P.killShare, r));
const burstDur = n => n / RATE + 0.45;
const DYING = 3.2;

function planCycle(T, first) {
  const rng = rngPlan;   // shadow: every random call below draws the plan stream, in cycle order
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
    else if (s.id === 'fight') { s.n = killShots(rngPlan); s.h = killHits(rngPlan); s.dur = burstDur(s.n); }
    else { s.n = Math.max(1, sround(st.spk * 0.35, rngPlan)); s.h = Math.max(0, sround(st.hpk * 0.3, rngPlan)); s.dur = burstDur(s.n) + 0.9; }
    if (!s.veh) { credit.shots -= s.n; credit.hits -= s.h; }
  }
  // first spike lands one "time to fight" after the death (LIVE formula), the rest spread over the life
  if (spikes.length) {
    const ttc = clamp(st.fightMs / 1000 * Math.exp(0.8 * gauss(rngPlan)), 3, 240);
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
        const n = Math.min(Math.floor(credit.shots), sround(6 + rng() * 10, rngPlan)), h = Math.min(Math.max(0, Math.floor(credit.hits)), sround(n * st.hpk / st.spk, rngPlan));
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
  const rn = Math.max(0, Math.min(Math.floor(credit.shots), sround(4 + rng() * 6, rngPlan))); credit.shots -= rn;
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
  if (duelPlan) return; // pair mode: the mapped duel segments are complete
  while (plan.end < t + 60) { const c = planCycle(plan.end, plan.cycles === 0); plan.segs.push(...c.segs); plan.end = c.end; }
}

// ---------------------------------------------------------------- duel segments (#98)
// Pair mode feeds the director and the life strip from the duel plan: each
// engagement maps to STATES ids (approach runs, spot idles, trade trades,
// commit fights, resolution dies for the victim, aftermath reloads when the
// winner reloads), plus respawn-timer/beam segments for main's returns.
// The pump owns soldier states; step() skips enter/exit/tick for these.
if (duelPlan) {
  const segId = (phase, e) => phase === 'approach' ? 'running' : phase === 'spot' ? 'idle'
    : phase === 'trade' ? 'trading' : phase === 'commit' ? 'fight'
    : phase === 'resolution' ? (e.victim === 'a' ? 'dying' : 'idle')
    : e.segments.find((s) => s.phase === 'aftermath')?.aIntent === 'reload' ? 'reloading' : 'idle';
  const msegs = [];
  let prevT1 = 0, prevDeathAt = null;
  for (const e of duelPlan.engagements) {
    if (e.respawnSide === 'a' && prevDeathAt != null) {
      const lf = duelPlan.lives.a.find((l) => l.start > prevDeathAt - 1e-9 && l.start <= e.t0 + 1e-9);
      const lifeStart = lf ? lf.start : prevDeathAt + e.respawnDur;
      const beamStart = lifeStart - 0.9;
      if (prevT1 < beamStart) msegs.push({ id: e.revived ? 'beingRevived' : 'respawnTimer', t0: prevT1, t1: beamStart, duel: true });
      const b0 = Math.max(prevT1, beamStart);
      if (b0 < lifeStart) msegs.push({ id: 'respawn', t0: b0, t1: lifeStart, duel: true });
    }
    for (const s of e.segments) msegs.push({ id: segId(s.phase, e), t0: s.t0, t1: s.t1, duel: true });
    prevT1 = e.t1;
    if (e.victim) prevDeathAt = e.killAt ?? e.segments.find((s) => s.phase === 'resolution').t0;
  }
  plan.segs = msegs;
  plan.end = duelPlan.duration;
  plan.lives = duelPlan.lives.a.map((lf, i) => {
    const phases = [];
    for (const s of msegs) {
      if (s.t0 < lf.start - 1e-9 || s.t1 > lf.end + 1e-9) continue;
      const ph = phaseOf(s.id), last = phases[phases.length - 1];
      if (last && last.ph === ph) last.t1 = s.t1; else phases.push({ ph, t0: s.t0, t1: s.t1 });
    }
    if (!phases.length) phases.push({ ph: 'fight', t0: lf.start, t1: lf.end });
    const retEng = duelPlan.engagements.find((x) => x.respawnSide === 'a' && x.t0 >= lf.start - 1e-9);
    return { n: i + 1, t0: lf.start, t1: lf.end, phases, revived: retEng?.revived ?? false };
  });
  life.cls = duelPlan.lives.a[0]?.cls ?? null;
}

// ---------------------------------------------------------------- execution (scene clock = real seconds)
// Lane-0 invariant (#105): every fight/assist/dying target and every killer of
// the player is on the front lane when the first shot is fired. A back enemy
// is moved to a front slot first: preferably a dead front soldier's slot
// (the #105 swap — the dead soldier inherits the back slot for its respawn),
// else a live non-busy front soldier trades places (he is not a segment's
// target, so the pop reads the same as the dead swap's, and it keeps #103's
// pick weights exact instead of falling back to front enemies whenever no
// front slot is dead or idle). Last resort (all front busy): a busy front enemy — still
// lane-correct, the double-target corner the old code kept for the same
// situation.
const laneViolations = [];
function moveToFront(e, t) {
  // Prefer a dead front soldier's slot (the #105 swap — the dead soldier
  // inherits the back slot for its respawn); else ANY non-busy front
  // soldier trades places. Restricting the live trade to idle soldiers left
  // a 24% swap-fail rate (marches, pot-shot bursts), and every failed swap
  // fell back to a front enemy — a systematic front bias in the #103 pick
  // shares. A traded runner/respawner resolves to his new slot through the
  // normal run/respawn drivers, a traded shooter keeps firing from the back
  // lane; busy soldiers (a segment's target, an ally-kill target) are never
  // traded.
  const partner = enemies.find(x => x.lane === 0 && (x.state === 'die' || x.state === 'dead'))
    || enemies.find(x => x.lane === 0 && !x.busy);
  if (!partner) return false;
  const frontSlot = partner.slot, frontY = partner.y;
  const dw = partner.cover.wall;
  // Teleport first, then rebuild the cover: coverOf bakes the soldier's
  // current x into peekX/hiddenX, and the peek pass parks idle soldiers at
  // those — rebuilding before the move stranded soldiers at stale cover
  // positions (a marching enemy's cover ended up at his march x).
  partner.slot = e.slot; partner.y = e.y; partner.lane = 1; partner.scale = partner.scale * STRIP.BACK_K; partner.dim = true;
  partner.x = partner.slot;
  partner.cover = makeCover(partner); walls.splice(walls.indexOf(dw), 1, partner.cover.wall);
  const ew = e.cover.wall;
  e.slot = frontSlot; e.y = frontY; e.lane = 0; e.scale = e.scale / STRIP.BACK_K; e.dim = false;
  e.x = e.slot;
  e.cover = makeCover(e); walls.splice(walls.indexOf(ew), 1, e.cover.wall);
  e.set('idle', t); e.busy = false;
  return true;
}
function pickTarget(t, mode = 'mix') {
  // #103: the opponent is picked FIRST, by killboard weight over the whole
  // cast — kills by the row's kills, deaths by the row's deaths, everything
  // else by kills+deaths. Bots (no opp) keep weight 1. A zero row weighs
  // zero in its mode: an opponent who never killed you never kills you in
  // the scene, so the scene shares match the killboard rows instead of a
  // floor inventing share for him (a floor of 1 gave a 0-death opponent
  // 12.5% of the deaths). If every weight is zero, pickWeighted returns
  // null and the pick falls back to uniform. Picking among ready
  // front enemies instead renormalized the shares by availability (the old
  // stage order flattened shares toward uniform and starved back enemies:
  // a 30-min probe had both back opponents at 0 kills). The picked enemy is
  // then forced front-ready: back enemies move into a dead front slot, dead
  // and respawning ones revive with the same respawn trick the old fallback
  // used, running ones snap home. Only when no dead front slot exists does
  // the pick fall back to a weighted pick among front enemies.
  const w = (s) => !s.opp ? 1 : mode === 'kill' ? s.opp.kills : mode === 'death' ? s.opp.deaths : s.opp.kills + s.opp.deaths;
  const wpick = (arr) => pickWeighted(arr, w, rng) ?? pick(arr);
  const note = (e) => { if (e?.opp) pickStats[mode][e.opp.slug] = (pickStats[mode][e.opp.slug] || 0) + 1; return e; };
  const forceReady = (e) => {
    if (e.lane === 1) { if (moveToFront(e, t)) pickStats.swapOk++; else { pickStats.swapFail++; return false; } }
    if (e.state === 'die' || e.state === 'dead' || e.state === 'respawn') { e.x = e.slot; e.set('respawn', t); e.t0 = t - 0.9; e.set('idle', t); }
    else if (e.state === 'run') { e.x = e.slot; e.set('idle', t); }
    return e.lane === 0;
  };
  let e = wpick(enemies);
  if (e?.opp) pickStats.first[mode][e.opp.slug] = (pickStats.first[mode][e.opp.slug] || 0) + 1;
  if (e && !e.busy && forceReady(e)) return note(e);
  const free = enemies.filter(x => !x.busy);
  e = free.length ? wpick(free) : null;
  if (e && forceReady(e)) return note(e);
  const front = enemies.filter(x => x.lane === 0);
  e = wpick(front);
  if (e && forceReady(e)) return note(e);
  // last resort (all front busy): a busy front enemy — still lane-correct,
  // the double-target corner the old code kept for the same situation
  e = wpick(front) || enemies[0]; e.x = e.slot; e.set('respawn', t); e.t0 = t - 0.9; e.set('idle', t); return note(e);
}
function startBurst(t, shooter, target, n, h, final, extra = {}, r = rng) {
  const hits = new Set(); if (final) hits.add(n - 1);
  while (hits.size < Math.min(n, h)) hits.add(Math.floor(r() * (final ? n - 1 : n)));
  shooter.set('shoot', t); shooter.t0 = t; shooter.facing = target.x > shooter.x ? 1 : -1;
  const [mx, my] = muzzle(shooter), [tx, ty] = body(target);
  shooter.aim = clamp(Math.atan2(ty - my, Math.abs(tx - mx)), -0.25, 0.25);
  return { shooter, target, n, hits, final, fired: 0, t0: t, rate: shooter.rate, extra, done: n <= 0, r, headHits: 0 };
}
function runBurst(b, t) {
  while (b.fired < b.n && t >= b.t0 + b.fired / b.rate) {
    const i = b.fired++, hit = b.hits.has(i), fin = b.final && i === b.n - 1;
    // Per-hit head chance (#109): earlier hits roll HS_P; the final shot keeps
    // the segment's pre-rolled decision when one was given (exact long-run
    // HS share), otherwise it rolls too. The kill's type comes from this shot
    // alone — earlier head hits never make a headshot kill by themselves.
    const hsP = b.extra.hsP ?? HS_P;
    const hs = hit && (fin ? (b.extra.hs ?? (b.r() < hsP)) : (b.r() < hsP));
    const before = b.headHits;
    if (hs) b.headHits++;
    fire(t, b.shooter, b.target, { ...(fin ? b.extra : {}), hit, hs, final: fin, headHitsBefore: fin ? before : undefined }, b.r);
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
  ammoBox: { enter(s, t) { life.box = { x: main.home + 40, t0: t, t1: s.t1 }; } },
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
    const tg = pickTarget(t, s.id === 'fight' ? 'kill' : 'mix'); if (tg.lane !== 0) laneViolations.push({ seg: s.id, t });
    tg.busy = true; s.tg = tg;
    if (s.id === 'fight' && s.veh) s.b = { tank: true, target: tg, fired: 0 };
    else s.b = startBurst(t, main, tg, s.n, s.h, s.id === 'fight', { hs: s.hs });
  }
  if (s.id === 'dying') {
    if (!engaged) arrive(t - 2);
    const k = pickTarget(t, 'death'); if (k.lane !== 0) laneViolations.push({ seg: s.id, t });
    k.busy = true; s.k = k;
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
    nextSuppress = t + P.suppress * (0.6 + 0.8 * rngBg());
    const sh = enemies.filter(e => e.state === 'idle' && !e.busy), tgts = [main, ...allies].filter(alive);
    if (sh.length && tgts.length && !tank.on) {
      const s = pick(sh, rngBg), tg = rngBg() < 0.6 && alive(main) ? main : pick(tgts, rngBg), close = tg === main && rngBg() < P.dodge;
      const b = startBurst(t, s, tg, 5 + Math.floor(rngBg() * 6), 0, false, {}, rngBg); b.close = close; b.pot = true; enemyBursts.push(b);
      if (close) pop(main, T('pop.close', 'close call'), '#c8d3ff', t + 0.35);
    }
  }
  enemyBursts = enemyBursts.filter(b => {
    while (b.fired < b.n && t >= b.t0 + b.fired / b.rate) { b.fired++; fire(t, b.shooter, b.target, { hit: false, close: b.close && b.fired === 3 }, b.r); }
    if (b.fired >= b.n) { if (b.shooter.state === 'shoot') b.shooter.set('idle', t); return false; } return true;
  });
  // the crowd fights too (their kills are theirs, not counted for the player)
  if (allies.length && t > nextAlly) {
    nextAlly = t + 7 / allies.length * (0.5 + rngBg());
    const free = allies.filter(a => a.state === 'idle'), tg = enemies.filter(e => ready(e));
    if (free.length && tg.length) {
      const kill = t > nextAllyKill; if (kill) nextAllyKill = t + 40 / allies.length * (0.6 + 0.8 * rngBg());
      const e = pick(tg, rngBg); if (kill) e.busy = true;
      allyBursts.push(startBurst(t, pick(free, rngBg), e, 6 + Math.floor(rngBg() * 6), kill ? 3 : rngBg() < 0.3 ? 1 : 0, kill, {}, rngBg));
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
  // Scrim mode runs the duel plan only: no crowd timeline (planCycle),
  // no background battle, no assists — plan.segs stays empty and cur null.
  if (!scrimMode) ensurePlan(t);
  while (plan.segs.length && plan.segs[0].t1 <= t) {
    const s = plan.segs.shift();
    if (s.duel) { if (cur === s) cur = null; continue; } // the duel pump owns states
    if (!s.entered) { s.entered = 1; enter(s, s.t0); } exit(s, t); if (cur === s) cur = null;
  }
  const s = plan.segs[0];
  if (s && s.t0 <= t) {
    if (s.duel) cur = s; // director reads the id; no enter/tick for duel segments
    else { if (!s.entered) { s.entered = 1; enter(s, t); } cur = s; tick(s, t, dt); }
  }
  pumpDuel(t);
  if (!scrimMode) background(t, dt);
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
  const hx = scroll * 0.25; ctx.fillStyle = '#243243'; ctx.beginPath(); ctx.moveTo(0, 253);
  for (let x = 0; x <= W; x += 40) { const u = x + hx; ctx.lineTo(x, 239 + 16 * Math.sin(u / 170) + 8 * Math.sin(u / 53)); }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = '#34452f'; ctx.fillRect(0, 251, W, H - 251);
  ctx.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 40; i++) ctx.fillRect((((i * 337 - scroll) % W) + W) % W, 261 + (i * 53) % 128, 26, 2);
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
    const n = Math.hypot(b.vx, b.vy), len = (b.shell ? 70 : b.plasma ? 40 : 54) * (cue ? 2 : 1), a = b.landed ? Math.max(0, 1 - b.age * 1.5) : 1;
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
        ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25; ctx.font = '700 20px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; const y = f.y - 40 * k;
        ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
      }
    }
    ctx.restore();
  }
}
// ---------------------------------------------------------------- duel overhead (#98)
// Name tag + class badge + shield-over-health bars for the two duelists,
// from the plan's HP traces. Hidden while dead between lives. The health
// fraction also feeds the soldier's hurt pose (hunch below half health).
function drawDuelistOverhead(s, t) {
  const side = s === main ? 'a' : 'b';
  const life = duelLifeAt(duelPlan, side, t);
  if (!life) return;
  const eng = engagementAt(duelPlan, t);
  const snap = eng ? hpAt(eng, t, side)
    : { shield: 500, health: life.cls === 'max' ? 2000 : 500, over: 0 };
  const fr = barFracs(snap, life.cls);
  s.hp = fr.health;
  const [hx, hy] = head(s);
  const name = stripTag(side === 'a' ? pair.a.name : pair.b.name);
  const badge = (life.cls || 'inf').toUpperCase();
  ctx.save();
  ctx.font = `700 ${Math.max(15, Math.round(26 * s.scale))}px system-ui,sans-serif`;
  const nw = ctx.measureText(name).width;
  ctx.font = `700 ${Math.max(13, Math.round(20 * s.scale))}px system-ui,sans-serif`;
  const bw = ctx.measureText(badge).width + 12;
  const tx = s.x - (bw + 6 + nw) / 2, ty = hy - 64;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(tx, ty - 15, bw, 19);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(badge, tx + bw / 2, ty);
  ctx.font = `700 ${Math.max(15, Math.round(26 * s.scale))}px system-ui,sans-serif`;
  ctx.textAlign = 'left'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.strokeText(name, tx + bw + 6, ty); ctx.fillStyle = '#fff'; ctx.fillText(name, tx + bw + 6, ty);
  const w = 160 * s.scale, x0 = s.x - w / 2, by = hy - 52;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x0 - 2, by - 2, w + 4, 22);
  ctx.fillStyle = '#4aa8ff'; ctx.fillRect(x0, by, w * fr.shield, 8);
  ctx.fillStyle = '#58d058'; ctx.fillRect(x0, by + 10, w * fr.health, 8);
  ctx.restore();
}
function drawHud(t) {
  ctx.save(); ctx.font = '700 19px system-ui,sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(12, 10, 470, 54);
  ctx.fillStyle = '#fff'; ctx.fillText(`${doc.name}`, 24, 30);
  const nw = ctx.measureText(doc.name).width; ctx.font = '500 14px system-ui,sans-serif'; ctx.fillStyle = '#c9d1d9';
  ctx.fillText(`${F.toUpperCase()} · ${doc.main?.name ?? ''}`, 32 + nw, 30);
  const f1 = (x, d = 2) => x == null ? '—' : (+x).toFixed(d);
  ctx.fillStyle = '#9aa7b4'; ctx.font = '500 13px system-ui,sans-serif';
  ctx.fillText(T('hudStats', 'K/D {kd} · KPM {kpm} · acc {acc}% · HS {hs}% · {spk} shots/kill', { kd: f1(val('kd')), kpm: f1(val('kpm')), acc: f1(val('acc'), 0), hs: f1(val('hsr'), 0), spk: f1(st.spk, 0) }), 24, 53);
  // live tally (emerges from the sim, not scripted)
  if (!reduced) {
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0, min = t / 60, pm = x => min > 0 ? (x / min).toFixed(2) : '0.00';
  const clock = `${Math.floor(t / 3600) ? Math.floor(t / 3600) + ':' : ''}${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
  const s = '⏱ ' + clock + ' · ' + (pair
    ? T('tallyPair', 'kills {k} ({kpm}/min) · deaths {d} ({dpm}/min) · assists {a} · HS kills {hs} · vehicle {veh} · hit {acc}% of {shots} shots · head hits {hh} of {hits}',
      { k: stats.k, kpm: pm(stats.k), d: stats.d, dpm: pm(stats.d), a: stats.a, hs: stats.hs, veh: stats.veh, acc, shots: stats.shots, hh: stats.hh, hits: stats.hits })
    : T('tally', 'kills {k} ({kpm}/min) · deaths {d} ({dpm}/min) · assists {a} · HS kills {hs} · vehicle {veh} · hit {acc}% of {shots} shots',
      { k: stats.k, kpm: pm(stats.k), d: stats.d, dpm: pm(stats.d), a: stats.a, hs: stats.hs, veh: stats.veh, acc, shots: stats.shots }));
  ctx.font = '500 13px system-ui,sans-serif'; const w = ctx.measureText(s).width;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(12, H - 36, w + 24, 26);
  ctx.fillStyle = '#c9d1d9'; ctx.fillText(s, 24, H - 18);
  }
  // (the old canvas speed chip is gone: #110's DOM pace selector + rate span
  // carry the current rate, and stay clickable on phones)
  // class badge over the main soldier (crowd mode only: pair mode already shows
  // the class badge in the duel overhead, and the two would overlap on the strip)
  drawStateBox(t);
  if (life.cls && alive(main) && !tank.on && !duelPlan) {
    const [x, y] = head(main); ctx.font = '700 14px system-ui,sans-serif'; ctx.textAlign = 'center';
    const lbl = CLS[life.cls], bw = ctx.measureText(lbl).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x - bw / 2, y - 90, bw, 22);
    ctx.fillStyle = '#e6edf3'; ctx.fillText(lbl, x, y - 74);
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
  const x = tank.on ? main.x : main.x, y = tank.on ? main.y - 200 : main.y - (main.state === 'dead' ? 130 : 240);
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
  ctx.save(); ctx.globalAlpha = 0.9;   // 10% transparent: the soldier ghosts through his tile
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
  // bullet-time cues: 1.12x push-in centred between shooter and victim, world desaturated
  // (background, boxes, walls); fighters, tracers and pops keep their colour
  if (cue) {
    const b = cur?.b, sh = b?.tank ? main : b?.shooter, tg = b?.target;
    if (sh && tg) { const [sx, sy] = body(sh), [tx, ty] = body(tg), cx = (sx + tx) / 2, cy = (sy + ty) / 2;
      ctx.translate(cx, cy); ctx.scale(1.12, 1.12); ctx.translate(-cx, -cy); }
    ctx.save(); ctx.filter = 'saturate(0.15)'; drawBg(); drawBox(t); ctx.restore();
  } else { drawBg(); drawBox(t); }
  drawFx(t, 'under');
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
  const wallsBefore = (y) => { while (wi < wallsSorted.length && wallsSorted[wi].y < y) { const w = wallsSorted[wi++]; if (w.forMain && tank.on) continue; if (cue) { ctx.save(); ctx.filter = 'saturate(0.15)'; drawWall(w); ctx.restore(); } else drawWall(w); } };
  for (const [i, s] of order.entries()) {
    wallsBefore(s.y);
    if (s === main && (tank.on || t - tank.off < 0.4)) { if (tank.on) { drawTank(t); drawBullets(layer[i]); continue; } drawTank(t); }
    if (s === main && alive(main)) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 70, 11, 0, 0, 7); ctx.stroke(); ctx.restore(); }
    s.draw(ctx, t); drawBullets(layer[i]);
    if (duelPlan && (s === main || s === rival)) drawDuelistOverhead(s, t);
    // crowd opponents (#103): small dimmed name tags, pair mode keeps third
    // parties unnamed (#98); hidden while the soldier is down
    if (!duelPlan && s.name && s.state !== 'dead' && s.state !== 'die') {
      const [, hy] = head(s);
      ctx.save(); ctx.font = '500 12px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = s.dim ? 'rgba(230,237,243,0.35)' : 'rgba(230,237,243,0.6)';
      ctx.fillText(stripTag(s.name), s.x, hy - 20); ctx.restore();
    }
  }
  while (wi < wallsSorted.length) { const w = wallsSorted[wi++]; if (w.forMain && tank.on) continue; if (cue) { ctx.save(); ctx.filter = 'saturate(0.15)'; drawWall(w); ctx.restore(); } else drawWall(w); }
  drawFx(t, 'over');
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  if (cue) {   // vignette + own-death red tint, world only (the HUD stays crisp)
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (bullet?.kind === 'death') { ctx.fillStyle = 'rgba(200,30,30,0.10)'; ctx.fillRect(0, 0, W, H); }
  }
  drawHud(t);
  if (jumpCard && wallT - jumpCard.w0 < 1.5) {
    ctx.save(); ctx.font = '700 30px system-ui,sans-serif'; ctx.textAlign = 'center';
    const w = ctx.measureText(jumpCard.text).width + 36;
    ctx.fillStyle = 'rgba(10,14,20,.8)'; ctx.fillRect(W / 2 - w / 2, 84, w, 44);
    ctx.fillStyle = '#fff'; ctx.fillText(jumpCard.text, W / 2, 116); ctx.restore();
  }
  recordLifeIntervals(); lifeUi(t); updateGauges(t); updatePaceRate();
  if (scrimMode && scrimEndEl && !scrimEndShown && t >= scrimEndAt) {
    scrimEndShown = true; scrimEndEl.hidden = false;
    setTimeout(() => location.reload(), 4000);   // the loop: see the end-card comment
  }
}

// ---------------------------------------------------------------- living gauges (#108, DOM under the life strip)
// One row per gauge, label left, gauge right. Pair mode shows both sides
// (player left, opponent right); crowd mode shows the player only. Updates
// at most 10 times a wall second, and __fast forces one update at its end
// (a __fast render is a discrete jump, not a frame). Reduced motion needs
// no special case: the page parks at simT 0, so the gauges show the planned
// first life with no running fill, exactly as the life strip does.
function recordLifeIntervals() {
  for (const l of plan.lives) {
    if (!lifeIntervals.some((x) => x.n === l.n && x.t0 === l.t0)) lifeIntervals.push({ n: l.n, t0: l.t0, t1: l.t1 });
  }
}
function sideVals(statsObj) {
  const v = (id) => statsObj?.[id]?.v ?? null;
  return { kpm: v('kpm'), kd: v('kd'), acc: v('acc'), hsr: v('hsr'), spk: v('spk') };
}
function gaugeState(t) {
  const mv = sideVals(S);
  const inFight = duelPlan ? !!engagementAt(duelPlan, t) : cur?.id === 'fight';
  const fightLabel = inFight ? T('gaugeThisFight', 'this fight') : (fightKey != null ? T('gaugeLastFight', 'last fight') : T('gaugeThisFight', 'this fight'));
  const main = {
    name: doc.name,
    kpm: kpmGauge(mv.kpm ?? 0, t, killTimes),
    kd: kdLives(mv.kd ?? 0, lifeIntervals, killTimes, t),
    acc: accBar(fightHits, fightShots, (mv.acc ?? 0) / 100),
    hs: hsHeads(recentMain, (mv.hsr ?? 0) / 100),
    spk: spkGauge(fightShots, mv.spk ?? 0),
    fightShots, fightHits, fightLabel,
    kpmVal: mv.kpm, kdVal: mv.kd,
  };
  let rival = null;
  if (duelPlan) {
    const rv = sideVals(pair.b.stats);
    const rivalLives = duelPlan.lives.b.map((lf, i) => ({ n: i + 1, t0: lf.start, t1: lf.end }));
    rival = {
      name: pair.b.name,
      kpm: kpmGauge(rv.kpm ?? 0, t, deathTimes),
      kd: kdLives(rv.kd ?? 0, rivalLives, deathTimes, t),
      acc: accBar(rivalFightHits, rivalFightShots, (rv.acc ?? 0) / 100),
      hs: hsHeads(recentRival, (rv.hsr ?? 0) / 100),
      spk: spkGauge(rivalFightShots, rv.spk ?? 0),
      fightShots: rivalFightShots, fightHits: rivalFightHits, fightLabel,
      kpmVal: rv.kpm, kdVal: rv.kd,
    };
  }
  return { main, rival, inFight, simT: t };
}
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function buildSide(row, name) {
  const side = mk('div', 'g-side');
  const nm = mk('span', 'g-side-name', name); side.append(nm);
  const bar = mk('div', 'g-bar'); const fill = mk('div', 'g-fill'); const marker = mk('span', 'g-marker');
  const notches = mk('div', 'g-notches'); const marks = mk('div', 'g-marks');
  bar.append(fill, marker, notches, marks); side.append(bar);
  const kdRows = mk('div', 'g-kd-rows'); side.append(kdRows);
  const heads = mk('div', 'g-heads'); side.append(heads);
  const text = mk('span', 'g-text'); side.append(text);
  row.append(side);
  return { side, nm, bar, fill, marker, notches, marks, kdRows, heads, text, lastSpan: -1, lastMarks: -1, lastKd: '', lastHeads: '' };
}
let gaugeRefs = null;
function buildGauges(el) {
  const defs = [
    ['kpm', T('gaugeKpm', 'KPM'), T('gaugeKpmHint', 'Expected kill moments in this data minute: notches are the moments, gold marks are real kills.')],
    ['kd', T('gaugeKd', 'K/D'), T('gaugeKdHint', 'Coffins per life from the lifetime K/D: each kill in the life fills one, the bar is the fraction.')],
    ['acc', T('gaugeAcc', 'Accuracy'), T('gaugeAccHint', 'Hits ÷ shots in this fight; the marker is the lifetime accuracy.')],
    ['hs', T('gaugeHs', 'HS'), T('gaugeHsHint', 'The last 10 kills as heads; gold is a headshot kill, expected is the lifetime HS ratio × 10.')],
    ['spk', T('gaugeSpk', 'Shots/kill'), T('gaugeSpkHint', 'Shots fired in this fight; it freezes at the kill. The marker is the lifetime shots per kill.')],
  ];
  const refs = {};
  for (const [id, label, hint] of defs) {
    const row = mk('div', 'gauge'); row.dataset.gauge = id;
    row.append(mk('span', 'g-label', label)); row.title = hint;
    el.append(row); refs[id] = row;
  }
  return refs;
}
function syncSide(ref, side, kind) {
  if (kind === 'kpm') {
    const g = side.kpm;
    ref.bar.style.display = ''; ref.kdRows.style.display = 'none'; ref.heads.style.display = 'none';
    ref.fill.style.width = (g.fill * 100) + '%';
    if (g.spanIndex !== ref.lastSpan) {
      ref.lastSpan = g.spanIndex; ref.notches.textContent = '';
      for (const n of g.notches) {
        const s = mk('span', 'g-notch' + (n.filled ? ' filled' : ''));
        s.style.left = (n.frac * 100) + '%'; ref.notches.append(s);
      }
    } else {
      [...ref.notches.children].forEach((s, i) => { if (g.notches[i]) s.className = 'g-notch' + (g.notches[i].filled ? ' filled' : ''); });
    }
    if (g.marks.length !== ref.lastMarks) {
      ref.lastMarks = g.marks.length; ref.marks.textContent = '';
      for (const m of g.marks) { const s = mk('span', 'g-mark'); s.style.left = (m * 100) + '%'; ref.marks.append(s); }
    }
    ref.marker.style.display = 'none';
    ref.text.textContent = side.kpmVal == null ? '—' : T('gaugeSpanMin', '{n} min', { n: g.spanMin }) + ' · ' + num(side.kpmVal.toFixed(2)) + ' KPM';
  } else if (kind === 'kd') {
    ref.bar.style.display = 'none'; ref.heads.style.display = 'none'; ref.kdRows.style.display = '';
    const json = JSON.stringify(side.kd);
    if (json !== ref.lastKd) {
      ref.lastKd = json; ref.kdRows.textContent = '';
      for (const r of side.kd) {
        const row = mk('div', 'g-kd-row' + (r.dimmed ? ' dim' : ''));
        row.append(mk('span', 'g-life', T('gaugeLife', 'Life {n}', { n: r.n })));
        const coffins = mk('span', 'g-coffins');
        for (let i = 0; i < r.full; i++) { const c = mk('span', 'coffin' + (i < r.filled ? ' filled' : ''), '⚰️'); coffins.append(c); }
        row.append(coffins);
        const partial = mk('span', 'g-partial'); const pi = mk('i'); pi.style.width = (r.partialWidth * 100) + '%'; partial.append(pi); row.append(partial);
        row.append(mk('span', 'g-kills', T('gaugeKills', '{n} kills', { n: r.kills }) + (r.over ? ' +' + r.over : '')));
        ref.kdRows.append(row);
      }
    } else {
      [...ref.kdRows.children].forEach((row, i) => {
        const r = side.kd[i]; if (!r) return;
        [...row.querySelectorAll('.coffin')].forEach((c, j) => { c.className = 'coffin' + (j < r.filled ? ' filled' : ''); });
        const pi = row.querySelector('.g-partial i'); if (pi) pi.style.width = (r.partialWidth * 100) + '%';
        const kl = row.querySelector('.g-kills'); if (kl) kl.textContent = T('gaugeKills', '{n} kills', { n: r.kills }) + (r.over ? ' +' + r.over : '');
      });
    }
    ref.text.textContent = side.kdVal == null ? '—' : num(side.kdVal.toFixed(2)) + ' K/D';
  } else if (kind === 'acc') {
    ref.bar.style.display = ''; ref.kdRows.style.display = 'none'; ref.heads.style.display = 'none';
    ref.fill.style.width = (side.acc.frac * 100) + '%';
    ref.marker.style.display = ''; ref.marker.style.left = (side.acc.marker * 100) + '%';
    ref.notches.textContent = ''; ref.marks.textContent = '';
    ref.text.textContent = side.fightHits + '/' + side.fightShots + ' · ' + side.fightLabel;
  } else if (kind === 'hs') {
    ref.bar.style.display = 'none'; ref.kdRows.style.display = 'none'; ref.heads.style.display = '';
    const json = JSON.stringify(side.hs.heads);
    if (json !== ref.lastHeads) {
      ref.lastHeads = json; ref.heads.textContent = '';
      for (const h of side.hs.heads) { const d = mk('span', 'dot' + (h ? ' hs' : '')); ref.heads.append(d); }
    }
    ref.text.textContent = T('gaugeExpected', 'expected {n}', { n: side.hs.expected });
  } else if (kind === 'spk') {
    ref.bar.style.display = ''; ref.kdRows.style.display = 'none'; ref.heads.style.display = 'none';
    ref.fill.style.width = (side.spk.frac * 100) + '%';
    ref.marker.style.display = ''; ref.marker.style.left = (side.spk.markerFrac * 100) + '%';
    ref.notches.textContent = ''; ref.marks.textContent = '';
    ref.text.textContent = side.spk.current + ' · ' + side.fightLabel + (side.spk.lifetime ? ' · lifetime ' + num(side.spk.lifetime.toFixed(1)) : '');
  }
}
function updateGauges(t) {
  const el = document.getElementById('gauges'); if (!el) return;
  const w = performance.now(); if (!gaugeForce && w - gaugeLast < 100) return; gaugeLast = w; gaugeForce = false;
  if (!gaugeRefs) {
    gaugeRefs = buildGauges(el);
    for (const id of ['kpm', 'kd', 'acc', 'hs', 'spk']) {
      gaugeRefs[id]._sides = [buildSide(gaugeRefs[id], '')];
    }
  }
  const st = gaugeState(t);
  const sides = st.rival ? [st.main, st.rival] : [st.main];
  for (const id of ['kpm', 'kd', 'acc', 'hs', 'spk']) {
    const row = gaugeRefs[id];
    while (row._sides.length < sides.length) row._sides.push(buildSide(row, ''));
    row._sides.forEach((ref, i) => {
      ref.nm.textContent = sides[i].name;
      syncSide(ref, sides[i], id);
    });
  }
}
window.__gaugeState = () => gaugeState(simT);

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
  if (pairNote) { const pn = document.createElement('div'); pn.className = 'note'; pn.textContent = pairNote; hud.append(pn); }
  // #108: living gauges under the life strip, and the old chips collapsed
  // below them. Chip content and hover texts are unchanged, only reparented;
  // the pair-mode opponent chips (#duelChips) move into the same details.
  const gaugesEl = document.createElement('div'); gaugesEl.id = 'gauges'; hud.append(gaugesEl);
  const allEl = document.createElement('details'); allEl.id = 'allStats'; allEl.className = 'allStats';
  const sum = document.createElement('summary'); sum.textContent = T('gaugeAllStats', 'All stats'); allEl.append(sum);
  const chipsWrap = document.createElement('div'); chipsWrap.className = 'chipsWrap'; allEl.append(chipsWrap);
  hud.append(allEl);
  const duelChipsEl = document.getElementById('duelChips'); if (duelChipsEl) chipsWrap.append(duelChipsEl);
  for (const [id, v, l0, h0, extra = ''] of CHIPS) {
    const l = CL(id, l0), hint = H_(id, h0) + extra;
    const c = document.createElement('span'); c.className = 'chip' + (v == null ? ' off' : '');
    const b = document.createElement('b'); b.textContent = l; c.append(b, ' ' + (v ?? '—'));
    c.title = v == null ? (id === 'fightStart' ? hint : hint + '\n' + T('missing', 'Not in the data for this player, so a neutral default is used or this part is skipped.')) : hint + pc(id);
    if (v == null && id === 'fightStart') { c.lastChild.textContent = ' ' + T('fightDefault', '19 s (default)'); if (!fight) c.title = hint + '\n' + T('fightNone', 'Not collected for this player yet, so a neutral 19 s is used.'); }
    chipsWrap.append(c);
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
// wallT = real seconds since start; simT = scene clock. The director scales wall time into data
// time (calm x2, trade x1, pre-kill x0.5, bullet time x0.2); clocks and tallies show data time.
const STEP = 1 / 120;
// the clock driver, factored so tests can step the director without drawing
function advance(w) {
  if (freeze > 0) { freeze--; wallT = w; return; }   // headshot impact: 2 frozen wall frames
  // jump cut: a calm stretch over 20 data s is stepped through (like skip, nothing skipped
  // in the sim) and carded; the stretch is what the plan holds (60 s ahead), so very long
  // stretches jump in chunks, one card each
  if (!reducedOS && pace === 'cine' && !fast && baseRate(cur?.id) === 2) {
    const end = calmStretchEnd(plan.segs, simT);
    if (end != null) {
      const from = simT;
      fast = true;
      while (simT < end) { const dt = Math.min(1 / 30, end - simT); simT += dt; step(simT, dt); }
      fast = false;
      if (simT > wallT) { skipped += simT - wallT; wallT = simT; }
      jump = { n: Math.round(simT - from), at: simT };
      jumpCard = { text: T('jumpCut', '+{n} s', { n: Math.round(simT - from) }), w0: wallT };
    }
  }
  while (wallT + STEP <= w) {
    wallT += STEP;
    rate = currentRate();
    cue = !reducedOS && pace === 'cine' && rate < 0.6;
    const dt = rate * STEP; simT += dt; step(simT, dt);
  }
}
window.__render = (w) => { advance(w); render(simT); return true; };
window.__advance = (w) => { advance(w); return true; };   // test hook: director stepping without drawing
// test hook: run the scene clock forward without drawing or the director (used by tools/probe checks)
window.__fast = (sec, dt = 1 / 30) => { fast = true; const end = simT + sec; while (simT < end) { simT += dt; wallT = simT; step(simT, dt); } fast = false; gaugeForce = true; render(simT); return window.__params(); };
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
  fast = true; bullet = null; freeze = 0;
  while (simT < to) { const dt = Math.min(1 / 30, to - simT); simT += dt; step(simT, dt); }
  fast = false; gaugeForce = true;
  if (simT > wallT) { skipped += simT - wallT; wallT = simT; }
  render(simT); lifeUi(simT, true);
  return { from, to: simT, id: ev.id, phase: phaseOf(ev.id), stats: { ...stats } };
};
window.__bullets = () => bullets.map(b => ({ hit: !!b.hit, side: b.side, deg: +(Math.atan2(b.vy, b.vx) * 180 / Math.PI).toFixed(2), from: b.from === main ? 'main' : 'other' }));
window.__cover = () => ({ walls: walls.map(w => [Math.round(w.x), w.y, Math.round(w.w), Math.round(w.h)]),
  main: { x: +main.x.toFixed(1), peekWant: main.peekWant ?? 0, cover: main.cover, state: main.state },
  allies: allies.map(a => ({ x: +a.x.toFixed(1), peekWant: a.peekWant ?? 0, cover: a.cover, state: a.state })),
  enemies: enemies.map(e => ({ x: +e.x.toFixed(1), peekWant: e.peekWant ?? 0, cover: e.cover, state: e.state, slot: e.slot })) });
// strip stage (#105): every fighter's lane + slot + scale, and every
// fight/assist/dying target picked off the front lane (must stay empty)
window.__lanes = () => everyone.map(s => ({ who: s === main ? 'main' : s === rival ? 'rival' : s.faction,
  lane: s.lane ?? null, x: Math.round(s.x), y: Math.round(s.y), scale: +s.scale.toFixed(3), dim: !!s.dim, slot: s.slot ?? null, state: s.state }));
window.__laneViolations = () => laneViolations.slice();
// headshot rule (#109): every crowd-mode kill by the player, with the killing
// shot's head flag and the head hits landed earlier in the same burst
window.__hsKills = () => hsKillLog.slice();
// crowd opponents (#103): the named cast + the scene's per-opponent kills/deaths
window.__crowdOpps = () => crowdOpps.map(o => ({ name: stripTag(o.row.name), slug: o.slug, faction: o.faction, kills: o.kills, deaths: o.deaths }));
window.__oppShares = () => ({ kills: { ...oppKills }, deaths: { ...oppDeaths } });
window.__pickStats = () => JSON.parse(JSON.stringify(pickStats));
window.__pickWeights = (mode = 'mix') => enemies.map(e => ({ slug: e.opp?.slug ?? 'bot', kills: e.opp?.kills ?? null, deaths: e.opp?.deaths ?? null, w: !e.opp ? 1 : mode === 'kill' ? Math.max(1, e.opp.kills) : mode === 'death' ? Math.max(1, e.opp.deaths) : Math.max(1, e.opp.kills + e.opp.deaths) }));
window.__life = () => { const L = lifeAt(simT); return L && { n: L.n, phase: phaseAt(L, simT)?.ph, phases: L.phases.map(p => [p.ph, +(p.t1 - p.t0).toFixed(1)]), simT }; };
window.__slow = () => ({ wallT, simT, scale: currentRate(), bullet: !!bullet });
window.__params = () => ({ st, P, RATE, CYCLE, ALIVE_MEAN, DOWN_MEAN, missing, stats, simT, cur: cur?.id, credit, fight: fightOk ? fight : null, jump });
window.__plan = () => plan.segs.map(s => [s.id, +s.t0.toFixed(1), +(s.t1 - s.t0).toFixed(1), s.veh ? 'veh' : '']);
// the loop, factored out so the reduced-motion note can start it on demand: the OS setting
// parks the scene on a still frame, but one tap on ▶ Play anyway (or ?play in the URL)
// overrides it for this page — the setting itself is never changed
function startLoop() {
  const t0 = performance.now() / 1000;
  const frame = (now) => { window.__render(now / 1000 - t0 + skipped); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
if (reduced) {
  const rm = document.getElementById('rm'); rm.hidden = false;
  const go = document.createElement('button'); go.type = 'button'; go.textContent = T('playAnyway', '▶ Play anyway');
  go.addEventListener('click', () => {
    reduced = false; rm.hidden = true; if (ui?.skip) ui.skip.hidden = false;
    for (const s of everyone) s.seed = Math.random() * 10;   // the still frame zeroed the pose phases
    startLoop();
  });
  rm.append(' ', go);
  if (!scrimMode) { ensurePlan(0); newLife(0, true); }
  engaged = true; for (const e of enemies) { e.state = 'idle'; e.x = e.slot; }
  for (const s of everyone) { s.seed = 0; s.state = 'idle'; }
  render(0);
} else if (!q.has('preview')) {
  startLoop();
}
window.__ready = true;
