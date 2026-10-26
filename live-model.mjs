/**
 * 🎥 Live feed: the pure part of live.mjs (#66 step H: moved out unchanged): event classification, the overlay state
 * (killer above, player, 6 victims), stat → emoji fill and rank tier, hover texts, the 30 fps / beat / shine timing,
 * weapon lookup. No DOM; the browser part (stream, data, drawing) is live.mjs, which re-exports all of this.
 */
import { normalizePlayer, playerMetrics, shownValue } from "./player-metrics.mjs?v=20261026-psb1";
import { infDial } from "./tractor.mjs?v=20261024-trac1";
import { infantryShares } from "./infantry.mjs?v=20261023-short1";

export const FEED_MAX = 2; // victim lines below the centre (owner 2026-10-26: last 2, not 6)
export const VICTIM_LINES = FEED_MAX;

/** Death payload → { kind: "kill" | "death", opp, headshot, weapon } for target cid, or null (suicide / unrelated / no attacker).
 *  weapon = the killer's attacker_weapon_id (Census item id), null when Census sends none or "0". */
export function classifyDeath(payload, cid) {
  if (!payload || payload.event_name !== "Death") return null;
  const att = String(payload.attacker_character_id || "0");
  const vic = String(payload.character_id || "0");
  const me = String(cid);
  if (att === "0" || att === vic) return null;
  const headshot = String(payload.is_headshot) === "1";
  const w = String(payload.attacker_weapon_id || "0");
  const weapon = /^[1-9]\d*$/.test(w) ? w : null;
  if (att === me) return { kind: "kill", opp: vic, headshot, weapon };
  if (vic === me) return { kind: "death", opp: att, headshot, weapon };
  return null;
}

/**
 * Owner 2026-10-25: the in-game bounty, tracked locally from the Death stream
 * (no bounty field exists on it, and the killer's bounty-XP GainExperience is
 * not on the tracked player's own stream — streak counting IS the sync).
 * 7 kills without dying earns the bounty (💰); a death below 7 resets the
 * streak to 0; a bounty survives 3 deaths, then clears. Kills while bountied
 * change nothing (streak stays capped). State: { streak: 0-7, lives: 0-3 }
 * (lives > 0 means bountied). Session-only: a page reload restarts at 0.
 */
export const BOUNTY_KILLS = 7;
export const BOUNTY_LIVES = 3;
export function bountyNext(s, isKill) {
  const streak = s?.streak ?? 0, lives = s?.lives ?? 0;
  if (isKill) {
    if (lives > 0) return { streak, lives };
    const next = Math.min(BOUNTY_KILLS, streak + 1);
    return next >= BOUNTY_KILLS ? { streak: next, lives: BOUNTY_LIVES } : { streak: next, lives: 0 };
  }
  if (lives > 0) {
    const left = lives - 1;
    return left > 0 ? { streak, lives: left } : { streak: 0, lives: 0 };
  }
  return { streak: 0, lives: 0 };
}

/**
 * Owner 2026-10-25: imaginary DPS — estimated damage per second from the
 * Death stream alone (no damage numbers exist on it). One player = 1000 HP
 * (health + shields); a kill = 1000 damage, an assist = 500 (half a kill —
 * the stream carries no damage share, so this is the experiment's stated
 * assumption, not a measurement). The value jumps on every kill/assist and
 * drains exponentially (10 s time constant), so sustained killing converges
 * to kills-per-second × 1000. Events: [{ t, dmg }]; now in ms.
 */
export const DPS_HP = 1000;
export const DPS_ASSIST = 500;
export const DPS_TAU_MS = 10000;
export const DPS_ASSIST_XP = new Set([2, 3, 371, 372]); // kill-assist GainExperience ids (same list as worker ASSIST_EXP_IDS)
// Owner 2026-10-26 (assist share): the same recipe as worker
// sessionAssistStats — an assist's damage share is its XP amount divided
// by the earner's current XP multiplier (estimated from nearby kill XP)
// divided by the id's base XP. Spawn assists (id 3) have no base and no
// share; they keep the flat DPS_ASSIST.
export const ASSIST_BASE_XP = { 2: 100, 371: 150, 372: 300 };
export const KILL_BASE_XP = { 1: 100, 278: 150, 279: 300 };
export function assistShare(amount, id, mult) {
  const base = ASSIST_BASE_XP[id];
  if (!base || !Number.isFinite(amount) || amount < 0) return null;
  let share = amount / Math.max(1, mult) / base;
  if (share > 1) share /= 2;
  return Math.min(1, share);
}
export function xpMultAt(refs, t) {
  if (!refs.length) return 1;
  let best = refs[0];
  for (const x of refs) if (Math.abs(x[0] - t) < Math.abs(best[0] - t)) best = x;
  return best[1];
}
/**
 * Owner 2026-10-25 (gas-counter scroll): the scroll easing — quadratic
 * ease-in, so the counter starts slow and speeds up into its target.
 */
export const easeInQuad = (p) => p * p;

export function dpsNow(events, now, tauMs = DPS_TAU_MS, holdMs = 0) {
  const tau = tauMs > 0 ? tauMs : DPS_TAU_MS;
  const hold = holdMs > 0 ? holdMs : 0;
  if (!events.length) return 0;
  // Owner 2026-10-26 (elite combat damage meter, global hold): decay is
  // gated by the LATEST spike, not per spike. While line 2 drains (the
  // hold window after the latest spike), line 1 holds flat — running
  // between victims is still combat, not decay. Once the window runs
  // out, every surviving spike decays together by the same age. Each
  // spike still expires on its own clock (6τ + hold), so a long fight
  // cannot carry ancient damage forever.
  const lastT = Math.max(...events.map((e) => e.t));
  const age = Math.max(0, now - lastT - hold);
  let v = 0;
  for (const e of events) {
    const dt = now - e.t;
    if (dt >= 0 && dt < 6 * tau + hold) v += e.dmg * Math.exp(-age / tau);
  }
  return v / (tau / 1000);
}

/**
 * Owner 2026-10-25 (elite combat damage meter): the two holds, both
 * session averages from the player's own spikes, both adjusting to pace.
 * combatHoldMs = median of the trailing (at most 10) WITHIN-RUN gaps
 * between consecutive spikes — a gap with a death inside it is a spawn
 * run, not combat rhythm, so it never feeds this average. spawnRunHoldMs
 * = median of the trailing (at most 10) death→next-spike runs — the run
 * from spawn to combat. A death with no spike after it yet contributes
 * nothing (its run is still open). Either is 0 when unmeasured, which
 * means "no hold yet — the meter behaves as before".
 */
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/**
 * Owner 2026-10-25 (decision A), cap dropped 2026-10-26: the hold is
 * anchored at deaths — for each death, the first two spikes after it
 * contribute their gaps: death→first spike (the spawn run) and
 * first→second spike (the combat gap). Pooled across deaths, ALL of
 * them, median — no static trailing number. A fast combat pace can't
 * drag the hold below the spawn rhythm, and the hold stays gap-sized
 * (never the whole death→second-kill span, which would peg the meter).
 * With no death-anchored gap yet (no deaths, or deaths with no
 * following spike), it falls back to the within-run gaps, so the meter
 * still has a hold before the first death.
 */
/**
 * Owner 2026-10-26 (debug box): the exact gap list combatHoldMs medians
 * over — death-anchored (death→first spike, first→second spike) per
 * death, all of them, falling back to within-run gaps when no
 * death-anchored gap exists yet. Shared, so the box and the meter can
 * never disagree.
 */
export function holdGaps(spikeTimes, deathTimes) {
  const spikes = [...spikeTimes].sort((a, b) => a - b);
  const deaths = [...deathTimes].sort((a, b) => a - b);
  const gaps = [];
  for (const d of deaths) {
    const k1 = spikes.find((t) => t > d);
    if (k1 === undefined) continue;
    const g1 = k1 - d;
    if (g1 > 0) gaps.push(g1);
    const k2 = spikes.find((t) => t > k1);
    if (k2 === undefined) continue;
    const g2 = k2 - k1;
    if (g2 > 0) gaps.push(g2);
  }
  if (gaps.length) return gaps;
  // Fallback: no death-anchored gap yet — the within-run gaps, as before.
  const clean = [];
  for (let i = 1; i < spikes.length; i++) {
    const gap = spikes[i] - spikes[i - 1];
    if (gap <= 0) continue;
    if (deaths.some((d) => d > spikes[i - 1] && d < spikes[i])) continue;
    clean.push(gap);
  }
  return clean;
}
export function combatHoldMs(spikeTimes, deathTimes) {
  return median(holdGaps(spikeTimes, deathTimes));
}
export function combatRuns(deathTimes, spikeTimes) {
  const spikes = [...spikeTimes].sort((a, b) => a - b);
  const runs = [];
  for (const d of [...deathTimes].sort((a, b) => a - b)) {
    const next = spikes.find((t) => t > d);
    if (next != null) runs.push(next - d);
  }
  return runs;
}

export function spawnRunHoldMs(deathTimes, spikeTimes, maxRuns = 10) {
  return median(combatRuns(deathTimes, spikeTimes).slice(-maxRuns));
}

/**
 * Owner 2026-10-25: the full-picture time to combat — median of ALL
 * death→first-combat (kill or assist) runs in the session, no trailing
 * cap, plus how many deaths it covers. Like the hold, this never drops
 * an old death; unlike the freeze (trailing 10). A death with no
 * combat after it contributes nothing. Median, not mean: one AFK gap
 * must not drag the session average.
 */
export function timeToCombatMs(deathTimes, spikeTimes) {
  const runs = combatRuns(deathTimes, spikeTimes);
  return { ms: median(runs), n: runs.length };
}

/**
 * Owner 2026-10-26 (timers): a countdown bar's width — the time left
 * over the total it drains from, capped 0–100%. No total, no timer:
 * an empty bar, never a division by zero.
 */
export function timerBarPct(leftMs, totalMs) {
  if (!(totalMs > 0)) return "0.0%";
  return `${Math.min(100, Math.max(0, (leftMs / totalMs) * 100)).toFixed(1)}%`;
}

/**
 * Owner 2026-10-25: cash-out — the ⚔️ iVi of every victim of the tracked
 * player, summed, with the average per victim. Entries are one per kill (a
 * repeat victim pays again); unknown iVi (null) is skipped from both sum and
 * count, so the average stays honest. avg is null until the first known iVi.
 */
export function cashTotals(ivs) {
  let sum = 0, count = 0;
  for (const v of ivs || []) if (typeof v === "number" && Number.isFinite(v)) { sum += v; count++; }
  return { sum, count, avg: count ? sum / count : null };
}

/**
 * Owner 2026-10-25: the cash-out as a readable formula — the total plus the
 * counted victim values that built it, so a boost (when one is ever switched
 * on) can't hide inside the number: "1234 (300 + 500 + 434)". Unknown
 * victims (null) are not counted and never shown; a known 0 IS shown (it
 * counts in the average). Empty → "0"; a single value needs no breakdown
 * → just the total.
 */
export function cashFormula(ivs, boostPct = 0) {
  const parts = [];
  for (const v of ivs || []) if (typeof v === "number" && Number.isFinite(v)) parts.push(v);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (!parts.length || sum === 0) return "0"; // a pot of nothing carries no suffix — there is nothing the boost could have lifted
  const base = parts.length > 1 ? `${sum} (${parts.join(" + ")})` : String(sum);
  return boostPct > 0 ? `${base}+${boostPct}%` : base;
}

/**
 * Feed state step: newest event on top, every event its own row (owner t587u: no dedupe — a repeat
 * opponent gets a new row too); the oldest row drops out past FEED_MAX.
 * ⏱️ stopwatch: the top row runs (gap null); when a new event lands, the old
 * top row freezes at the time between the two events.
 * Returns { rows, dropped } (dropped = the row pushed out, or null).
 */
export function feedPush(rows, ev, now = Date.now()) {
  const prev = rows.map((r, i) => (i === 0 && r.gap == null ? { ...r, gap: Math.max(0, now - r.at) } : r));
  const row = { opp: ev.opp, last: ev.kind, headshot: !!ev.headshot, weapon: ev.weapon || null, at: now, gap: null };
  // Owner t587u: no dedupe — every kill is its own new line on top (the same victim twice = two lines, two times).
  const next = [row, ...prev];
  const dropped = next.length > FEED_MAX ? next[next.length - 1] : null;
  return { rows: next.slice(0, FEED_MAX), dropped };
}

/** ⏱️ "4s", "1m 05s", "1h 02m". */
export function fmtGap(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
  return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m`;
}

/** Lifetime K/D and KPM from a Census character with c:resolve=stat_history ("time" is seconds played). */
export function censusStats(ch) {
  const list = (ch && ch.stats && ch.stats.stat_history) || [];
  const at = (name) => +((list.find((s) => s.stat_name === name) || {}).all_time || 0);
  const k = at("kills"), d = at("deaths"), t = at("time");
  return { kd: d > 0 ? k / d : null, kpm: t > 0 ? k / (t / 60) : null };
}

/**
 * LIVE columns (owner t546u, t550u): one config list, in this order — change a mode or the order here.
 * Same ids / labels / digits as rankings.mjs VISIBLE. mode:
 *   "ivi"   = the plain number right after the name ("CloneKanoVS 1883", owner t560u: no ⚔️; t564u: no comma);
 *   "stack" / "emoji" = a fill-meter emoji column (owner t564u: one size for all, no number under it).
 * lowerBetter = smaller value is better (reversed percentile → more fill for a low value); no LIVE
 * column uses it now (owner t555u: 🪳 Zerg follows the raw number).
 * 🪳 Zerg is computed like the Rankings table (trait-scores.mjs zergScore from the ranks.json pools).
 * 🪖 Infantry is the ranks.json "inf" value; players without it get an empty (0%) 🪖 (owner t567u).
 */
export const LIVE_COLS = Object.freeze([
  { id: "adjs", label: "⚔️ iVi", tip: "iVi", digits: 0, floorZero: true, mode: "ivi" },
  { id: "act", label: "🏃 Activity", tip: "Activity", digits: 2, mode: "stack" },
  { id: "pvs", label: "🦁 Brave", tip: "Brave", digits: 2, mode: "stack" },
  { id: "rf", label: "🛡️ Resist", tip: "Resist", digits: 2, mode: "stack" },
  // Owner t590u: 🪖 / 🚜 dial around the data's median infantry % (tractor.mjs infDial; infUnit below) — the hover keeps the real %.
  { id: "inf", label: "🪖 Infantry", tip: "Infantry", digits: 1, unit: "%", mode: "stack", fill: "value" }, // t564u: fill = infantry % itself (fallback when no median)
  // Owner t581u: ☠️ K/D after 🪖, fill = its percentile (same p50 → p91 mapping and glow tiers).
  // Owner t590u: 🤝 Assists, 🔀 Diff and ⚡ Const removed from LIVE (t581u–t588u had them here).
  { id: "rkd", label: "☠️ K/D", tip: "K/D", digits: 2, mode: "stack" }, // owner t581u: K/D back on purpose (the main table's ☠️ K/D vs usual foes)
  { id: "zerg", label: "🪳 Zerg", tip: "Zerg", digits: 0, mode: "stack", unknown: "full" }, // t555u: bigger Zerg = bigger 🪳 (not reversed); t569u: unknown = full roach — t580u/t581u: last column
]);
/** Owner t584u hover text for one emoji / the iVi number: short label + the real value ("K/D 2.40", "Zerg 41", "Infantry 95.4%"), or "unknown". */
export function tipText(col, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${col.tip} unknown`;
  if (col.floorZero && v < 0) v = 0;
  const d = col.digits || 0;
  return `${col.tip} ${(Math.round(v * 10 ** d) / 10 ** d + 0).toFixed(d)}${col.unit || ""}`;
}

/**
 * Emoji fill meter (owner t564u, replaces the t546u/t558u rank-based sizes): every emoji has one size;
 * a hollow copy (t589u: light inner ring, dark 18% greyscale inside; was 25%-visible) shows the whole emoji and a solid copy on top fills it from the bottom up to:
 *   🪖 Infantry → the player's infantry % itself (50% infantry = half filled);
 *   🏃 🦁 🛡️ 🪳 → the player's percentile in that column (pXX = higher than XX% of ranks.json, the
 *   Rankings pools; 🪳 Zerg = percentile of the raw Zerg score, so a higher Zerg number fills more).
 * Lower-is-better columns are flipped first (none in LIVE now).
 * Owner t568u: the solid part was min(1, value / 91); t573u: clamp((value - 50) / 41, 0, 1), so p50 and below (50%- infantry) is empty and p91+ (91%+ infantry) completely full.
 */
export const FILL_DIM = 0.18; // owner t589u: the empty part = a dark greyscale interior at 18% (was a 25% colour copy) …
export const HOLLOW_PX = 1.75; // … inside a light-grey inner ring this wide, just inside the black outline: a hollow, readable shape at 0%
export const HOLLOW_INK = "#e6e6e6"; // the inner ring colour (light grey, stands out on any stream background)
/** "How good" percentile 0..99 (99 = best) from the plain pXX. */
export function goodPct(col, p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const q = Math.min(99, Math.max(0, p));
  return col && col.lowerBetter ? 99 - q : q;
}
/** The value that drives a cell's fill and glow: the "good" percentile 0..99, or 🪖's infantry % 0..100; null = no value. */
export function fillDriver(col, v, p) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (col && col.fill === "value") return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return goodPct(col, p);
}
/** Owner t568u: p91 (or 91% infantry) and up = completely solid. Owner t573u: p50 (or 50% infantry) and below — the
 *  no-glow tier — is empty (faint 25%), linear in between: fill = clamp((driver - 50) / (91 - 50), 0, 1). */
export const FULL_AT = 91;
export const EMPTY_AT = 50;
/** Fill 0..100 (% of the emoji drawn solid, from the bottom) for one cell; null = no value → an empty 0% emoji (t567u). */
export function emojiFill(col, v, p) {
  const d = fillDriver(col, v, p);
  return d == null ? null : Math.round(Math.min(100, Math.max(0, ((d - EMPTY_AT) / (FULL_AT - EMPTY_AT)) * 100)) * 10) / 10;
}
/** Fill shown when a cell has no value: 0 (empty 25% emoji, t567u), or 100 for a column marked unknown: "full" —
 *  owner t569u: an unknown 🪳 Zerg (most often unknown) is drawn as a full roach. Display only, nothing is stored. */
export function unknownFill(col) { return col && col.unknown === "full" ? 100 : 0; }
/** Owner t577u: a raw 🪳 Zerg score above ZERG_GOLD_OVER always gets the top (gold) glow, whatever its percentile tier;
 *  an unknown 🪳 (drawn full, t569u) gets that full top glow too. Every other column keeps its percentile tier. */
export const ZERG_GOLD_OVER = 35;
/** Owner t590u: 🪖 / 🚜 unit for one infantry % and the data's median M (tractor.mjs infDial): emoji, fill 0..100 and a glow
 *  tier that follows the fill — the fill is mapped back onto the driver scale the other emojis use (fill 0 = EMPTY_AT,
 *  100 = FULL_AT), so the same thresholds apply: a full 🪖 (100% infantry) or a full 🚜 (≤ C/2) = TOP gold.
 *  null = no value or no median (the caller falls back to the plain 🪖). */
export function infUnit(v, M, C = null) {
  const d = infDial(v, M, C); // owner t622u: C = the 🚜 cut (below it 🚜; C..M an empty 🪖)
  if (!d) return null;
  return { emoji: d.emoji, tractor: d.tractor, fill: d.fill, glow: glowTier(EMPTY_AT + (d.fill / 100) * (FULL_AT - EMPTY_AT)) };
}
/** Owner t579u: emoji outline thickness in CSS px (all sides). */
export const OUTLINE_PX = 2.25; // t581u: bolder (was 1.75)
export function unitGlow(col, v, driver) {
  if (col && col.id === "zerg" && (v == null || !Number.isFinite(v) || v > ZERG_GOLD_OVER)) return 3;
  return v == null ? 0 : glowTier(driver);
}
/**
 * Glow halos per tier (t568u colours: green / blue / gold), drawn once into images (live-sprites.mjs); blur in rem
 * (like the old drop-shadows), alpha 0–1. Owner 2026-10-24 "clear differentiations between ranks": each tier is
 * bigger and brighter than the one below — green a thin rim, blue a wide halo, gold a double halo.
 */
export const LIVE_GLOWS = Object.freeze([
  [{ blur: 0.2, color: [120, 230, 140], alpha: 0.75 }],
  [{ blur: 0.34, color: [80, 170, 255], alpha: 0.95 }, { blur: 0.62, color: [80, 170, 255], alpha: 0.4 }],
  [{ blur: 0.3, color: [255, 226, 120], alpha: 1 }, { blur: 0.86, color: [255, 170, 30], alpha: 0.95 }],
]);
/**
 * Owner 2026-10-24: "we can draw animations 30 fps (bare minimum, 60 next step)". Every moving part of the overlay
 * (fills, the halos flaring on the beat, the gold shine) is drawn by ONE ticker at LIVE_FPS frames a second, never at the screen's
 * own rate (144/240 Hz monitors made the old CSS animations draw 5–8× more often). live.html?fps=60 = the next step.
 */
export const LIVE_FPS = 30;
export function liveFps(param) {
  const n = parseInt(param, 10);
  return n === 60 || n === 30 ? n : LIVE_FPS;
}
/**
 * Owner 2026-10-24: halo switch for lower PCs (✨ next to ⚙️ Settings on the live page). Off = no halos, no gold shine and no
 * beat (only the 10 s fills move). ?halo=0 / ?halo=1 in the URL wins (OBS links), then this browser's choice, else on.
 */
export const HALO_KEY = "ps2-elite-kd-live-halo";
export function haloOn(param, stored) {
  if (param === "0" || param === "1") return param === "1";
  if (stored === "0" || stored === "1") return stored === "1";
  return true;
}
/** CSS cubic-bezier(x1, y1, x2, y2) timing as a function of progress 0..1. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (k) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    let t = k;
    for (let i = 0; i < 8; i++) { const e = X(t) - k, d = dX(t); if (Math.abs(e) < 1e-6) return Y(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = k;
    for (let i = 0; i < 30; i++) { const x = X(t); if (Math.abs(x - k) < 1e-6) break; if (x < k) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}
/** The 10 s fill-in's easing (t578u/t588u: same curve as before, cubic-bezier(0.22, 1, 0.36, 1)). */
export const easeFill = bezier(0.22, 1, 0.36, 1);
const easeOut = bezier(0, 0, 0.58, 1);
/** Halo strength during the fill-in (t578u/t588u): off for the first 80 %, then eases in. */
export function glowIn(k) {
  return k <= 0.8 ? 0 : easeOut(Math.min(1, (k - 0.8) / 0.2));
}
const mod = (x, m) => ((x % m) + m) % m;
/**
 * Owner 2026-10-24 "clear differentiations between ranks" (replaces the ✦ star), on a shared beat so the overlay
 * stands still most of the time (no frames to draw = no CPU): every BEAT.every ms a wave runs along each line
 * (column by column, BEAT.step ms apart) for BEAT.ms —
 *   tier 1 (green): a thin steady rim, never moves;
 *   tier 2 (blue): a wide halo that flares once per beat;
 *   tier 3 (gold): a double halo that flares harder and swells, while a light band sweeps across the emoji.
 * rest = halo opacity between beats, grow = extra halo size at the top of the flare.
 * Measured headless (1920 px, 8 lines, software drawing, % of one core): halos breathing all the time at 30 fps ≈ 21 %
 * (the frames themselves are the cost, not how many halos move); this beat draws frames ~35 % of the time ≈ 9 % idle.
 */
export const BEAT = Object.freeze({ every: 3200, ms: 900, step: 60 });
export const TIER_MOTION = Object.freeze({ 1: null, 2: { rest: 0.75, grow: 0 }, 3: { rest: 0.7, grow: 0.1 } });
/** Progress 0..1 through this emoji's flare, or null between beats. */
export function beatAt(t, offset = 0) {
  const p = mod(t - offset, BEAT.every);
  return p < BEAT.ms ? p / BEAT.ms : null;
}
/** Halo { opacity, scale } for a tier at time t; gw = the fill-in's glow strength (1 once a line has filled). */
export function haloAt(tier, t, gw = 1, offset = 0) {
  const m = TIER_MOTION[tier];
  if (!m) return { opacity: gw, scale: 1 };
  const k = beatAt(t, offset);
  const fl = k == null ? 0 : Math.sin(Math.PI * k);
  return { opacity: gw * (m.rest + (1 - m.rest) * fl), scale: 1 + m.grow * fl };
}
/** Gold shine: frames 1..frames-1 of the pre-drawn strip while the band crosses (the first SHINE.ms of the beat), 0 = no band. */
export const SHINE = Object.freeze({ frames: 16, ms: 700 });
export function shineFrame(t, offset = 0) {
  const p = mod(t - offset, BEAT.every);
  return p < SHINE.ms ? 1 + Math.min(SHINE.frames - 2, Math.floor((p / SHINE.ms) * (SHINE.frames - 1))) : 0;
}
/** ms to sleep before the next beat starts (0 = a beat is running now, for emojis delayed up to maxOffset ms). */
export function beatSleep(t, maxOffset = 0) {
  const p = mod(t, BEAT.every);
  return p < BEAT.ms + maxOffset + 40 ? 0 : BEAT.every - p;
}

/**
 * Weapon of a kill (owner 2026-10-24: "weapon like an icon"), from assets/weapons/catalog.json
 * ({ items: { id: [name, category, faction, image_id] } }). Guns are shown as a flat silhouette in the text
 * colour (kill-feed style); grenades, mines and abilities have card-like pictures, so they keep their colours.
 * Returns { name, image, card } or null (no id, not in the catalog, or no picture).
 */
export const CARD_CATEGORIES = /grenade|explosive|abilit|gear|scanner|tool/i;
export function weaponIcon(cat, id) {
  const e = id && cat && cat.items && cat.items[id];
  if (!Array.isArray(e) || !e[3]) return null;
  return { name: String(e[0] || "").trim(), image: String(e[3]), card: CARD_CATEGORIES.test(String(e[1] || "")) };
}
/** Owner t568u glow tiers from the same driver: 3 = TOP (91+), 2 = HIGH (71–90), 1 = AVERAGE (51–70), 0 = none (50 and below or no value). */
export function glowTier(d) {
  if (typeof d !== "number" || !Number.isFinite(d)) return 0;
  return d >= 91 ? 3 : d >= 71 ? 2 : d >= 51 ? 1 : 0;
}

/**
 * Owner t576u: when the event really happened (ms). Census sends whole seconds; real events arrive 0.1–1.1 s
 * after that stamp. A stamp that is missing or more than EVENT_SKEW_MS off this PC's clock (wrong system time)
 * falls back to the moment the message arrived, so a bad clock never shows negative or huge times.
 */
export const EVENT_SKEW_MS = 15000;
export function eventAt(payload, received = Date.now()) {
  const ts = Number(payload && payload.timestamp) * 1000;
  return Number.isFinite(ts) && ts > 0 && received - ts >= -1000 && received - ts <= EVENT_SKEW_MS ? Math.min(ts, received) : received;
}

/**
 * Overlay state step (owner t575u): a kill puts the victim on top of the lines below the centre (feedPush:
 * every kill its own line — t587u, at most VICTIM_LINES); a death makes that attacker THE killer line above (replacing the last one).
 * Owner t576u: a kill also clears the killer line ("once we start to kill, clear the top"); it fills again on
 * the next death. ⏱️ one stopwatch, as before t575u: only the newest event runs; every other line is frozen at
 * the time until the next event. ev.at = the event's own time (eventAt), else `now`.
 * State = { killer: row | null, victims: rows, lastEv: the row that just arrived, gone: the killer just cleared | null }.
 */
export function overlayPush(state, ev, now = Date.now()) {
  const s = state || { killer: null, victims: [], lastEv: null, gone: null };
  const at = Number.isFinite(ev.at) ? ev.at : now;
  const stop = (r) => (r && r.gap == null ? { ...r, gap: Math.max(0, at - r.at) } : r);
  const killer = stop(s.killer);
  const victims = s.victims.map((r, i) => (i === 0 ? stop(r) : r));
  if (ev.kind === "death") {
    const k = { opp: ev.opp, last: "death", headshot: !!ev.headshot, weapon: ev.weapon || null, at, gap: null };
    return { killer: k, victims, lastEv: k, gone: null };
  }
  const { rows } = feedPush(victims, ev, at);
  return { killer: null, victims: rows, lastEv: rows[0], gone: killer || s.gone }; // owner 2026-10-26: the dim killer stays through further kills, until the next death
}
/** Every opponent on screen (killer first), for the background-fetch queue. */
export function overlayRows(state) { return state ? [state.killer, ...state.victims].filter(Boolean) : []; }
/**
 * Background-fetch queue step (#32): next opponent cid to fetch = newest-first queue entry
 * that is still in the feed and was never tried this page load; or null.
 */
export function nextBgFetch(queue, rows, tried) {
  const inFeed = new Set((rows || []).map((r) => r.opp));
  return (queue || []).find((cid) => inFeed.has(cid) && !(tried && tried.has(cid))) || null;
}

/** A fetched player (app.js loadOne) → the LIVE_COLS row the cache would give; 🪳 Zerg needs Honu (null). */
export function liveRowFromPlayer(player, name) {
  const m = playerMetrics(normalizePlayer(player));
  const o = { name: name || (player && player.display) || "" };
  for (const c of LIVE_COLS) {
    // 🪳 Zerg and 🤝 Assists need Honu (not in a Census fetch); 🔀 Diff needs the build's 🛖/🚜/🐣 factors → unknown
    // (empty emoji) until the player is in the cache. 🪖 Infantry = the same share build-ranks.mjs stores.
    const sh = c.id === "inf" ? infantryShares(player && player.infantry) : null;
    const v = c.id === "zerg" ? null : c.id === "inf" ? (sh ? sh.inf : null) : shownValue(m, c.id);
    o[c.id] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  // 🚜 cut on ⚔️ iVi (same fields as ranks.json vcut / infVeh / infMax).
  o.vcut = m.vehCut > 0 ? Math.round(m.vehCut * 1000) / 10 : null;
  o.infVeh = Number.isFinite(m.vehOnly) ? m.vehOnly * 100 : null;
  o.infMax = Number.isFinite(m.maxShare) ? m.maxShare * 100 : null;
  return o;
}

/** Owner t586u: the tracked (centre) player's numbers are re-fetched from Census every ME_REFRESH_MS while the tab
 *  is visible. Measured cost of one refresh: 9 Census calls (name, killboard, 2 × 3 opponent batches, infantry
 *  split), 0 Honu calls, ~9–20 s — too heavy for every viewer once a minute, so every 5 minutes. */
export const ME_REFRESH_MS = 5 * 60000;
/** Fresh row over the cached one: a fresh number wins; what a Census fetch can't give (🪳 Zerg, 🤝 Assists, 🔀 Diff) stays cached. */
export function mergeFresh(cached, fresh) {
  const o = { ...(cached || {}) };
  for (const [k, v] of Object.entries(fresh || {})) if (v != null && (typeof v !== "number" || Number.isFinite(v))) o[k] = v;
  return o;
}

/** Shared-cache batching (#33): at most one POST /add a minute, at most 10 names each. */
export const SHARE_EVERY_MS = 60000;
export const SHARE_MAX = 10;
/** ms to wait before the next /add flush: a full batch goes as soon as allowed, a partial one waits for the window. */
export function shareDelay(now, lastSent, firstPendingAt, pending) {
  if (!pending) return null;
  const allowed = lastSent == null ? now : lastSent + SHARE_EVERY_MS;
  const due = pending >= SHARE_MAX ? allowed : Math.max(allowed, firstPendingAt + SHARE_EVERY_MS);
  return Math.max(0, due - now);
}

/** "1,357" / "2.80" / "—" for one cell. */
export function cellText(col, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (col.floorZero && v < 0) v = 0;
  // Owner t557u: the small numbers under the emojis fit 4 characters ("0.63", "95.4"): bigger values drop decimals (100.0 → "100").
  let d = col.digits;
  if (col.mode === "stack") while (d > 0 && Math.abs(v).toFixed(d).length > 4) d--;
  // Owner t564u: the iVi number has no thousands separator ("1600", not "1,600").
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: col.mode !== "ivi" });
}

export const slugKey = (name) => String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");
