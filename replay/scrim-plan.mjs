// 🎬 PS scrim plans (#111, pure): a planDuel whose final score is the scrim
// row's real result. planDuel is stochastic, so seed-search plans until the
// score matches exactly (bounded tries); otherwise keep the nearest plan.
// Third-party outcomes are excluded from the search: a scrim is two players
// only, and with thirdP's 0.02 floor a third-free plan is easy to find, so
// an exact plan is third-free by construction.
import { planDuel } from './duel-plan.mjs';
import { scoreAt } from './duel-scene.mjs';

export const SCRIM_TRIES = 200;

/** planScrim(a, b, { seed, durationSec, k, d, model, aInfo, bInfo, tries })
 *  → { plan, exact, tries }: the first third-free plan whose score at
 *  durationSec is exactly k–d, else the nearest plan seen (distance = kill
 *  gap + third-party engagements). pA is the row's own share k/(k+d). */
/** Stretch or compress every time in a plan by one factor, so its shape
 *  (score, order, phases) survives while its clock fits the row window.
 *  Durations (trade/commit/respawn) scale with the times they span. */
function rescalePlan(plan, durationSec) {
  const f = durationSec / plan.duration;
  const T = (x) => x * f;
  const engagements = plan.engagements.map((e) => ({
    ...e, t0: T(e.t0), t1: T(e.t1), killAt: e.killAt == null ? null : T(e.killAt),
    tradeDur: e.tradeDur * f, commitDur: (e.commitDur ?? 0) * f, respawnDur: (e.respawnDur ?? 0) * f,
    segments: e.segments.map((s) => ({ ...s, t0: T(s.t0), t1: T(s.t1) })),
    shots: e.shots.map((s) => ({ ...s, t: T(s.t) })),
    hp: { a: e.hp.a.map(([t, s, h, o]) => [T(t), s, h, o]), b: e.hp.b.map(([t, s, h, o]) => [T(t), s, h, o]) },
  }));
  const lives = {};
  for (const side of ['a', 'b']) lives[side] = plan.lives[side].map((l) => ({ ...l, start: T(l.start), end: T(l.end) }));
  const fights = plan.fights.map((ft) => ({ ...ft, t0: T(ft.t0), t1: T(ft.t1), kills: ft.kills.map((k) => ({ ...k, t: T(k.t) })) }));
  const cuts = plan.cuts.map((c) => ({ ...c, t: T(c.t) }));
  return { ...plan, duration: durationSec, engagements, lives, fights, cuts };
}

export function planScrim(a, b, { seed, durationSec, k, d, model, aInfo, bInfo, tries = SCRIM_TRIES }) {
  const pA = (k + d) > 0 ? k / (k + d) : 0.5;
  if (k + d <= 0) {
    const plan = planDuel(a, b, { seed, durationSec, pA, model, aInfo, bInfo });
    const s = scoreAt(plan, Infinity);
    return { plan, exact: s.a === 0 && s.b === 0, tries: 1 };
  }
  // Plan at the row's own pace, then rescale to the row window: the gap
  // model alone decides how many kills fit a duration, so planning straight
  // at durationSec strands the search when the row's total (10 kills in
  // 745 s) sits far from the model's typical total (~15 at the 45 s default
  // gap). The first stage plans at (k+d) × gap × 1.1 — the 1.1 is measured:
  // 745 s at a 45 s gap averages 15 kills, i.e. duration ÷ (gap × 1.1) —
  // and measures the real mean; the second stage re-plans at the corrected
  // duration, because pace factors the estimate cannot see (the short
  // post-respawn approach alone more than doubles the kill rate: 24.1 vs
  // 10.7 kills at 495 s) would otherwise strand the search. The rescale
  // makes the played fight rate the row's own rate by construction.
  const gap = model?.gapMedianS ?? 45;
  const planDur = (k + d) * gap * 1.1;
  let best = null, bestDist = Infinity, tried = 0;
  const attempt = (plan) => {
    // The FULL played score, not scoreAt(planDur): planDuel's loop runs
    // while t < duration, so the last engagement starts inside the window
    // but its kill can land past it — and the pump plays every engagement.
    // Scoring at the window would bless a plan whose played score differs
    // (the 3–7 plan that actually plays 4–7). The scene likewise ends at
    // the plan's own end (planEnd below), not at the raw row end.
    const s = scoreAt(plan, Infinity);
    const thirds = plan.engagements.filter((e) => e.outcome === 'third').length;
    if (thirds === 0 && s.a === k && s.b === d) return true;
    const dist = Math.abs(s.a - k) + Math.abs(s.b - d) + thirds;
    if (dist < bestDist) { bestDist = dist; best = plan; }
    return false;
  };
  let totalKills = 0, measured = 0;
  const stageA = Math.min(40, tries);
  for (let i = 0; i < stageA; i++) {
    const plan = planDuel(a, b, { seed: seed + i, durationSec: planDur, pA, model, aInfo, bInfo, shortApproach: true });
    tried++;
    const s = scoreAt(plan, Infinity);
    totalKills += s.a + s.b; measured++;
    if (attempt(plan)) return { plan: rescalePlan(plan, durationSec), exact: true, tries: tried };
  }
  const meanTotal = measured ? totalKills / measured : 0;
  const planDur2 = meanTotal > 0
    ? Math.min(planDur * 5, Math.max(planDur * 0.2, planDur * (k + d) / meanTotal))
    : planDur;
  for (let i = 0; i < tries; i++) {
    const plan = planDuel(a, b, { seed: seed + stageA + i, durationSec: planDur2, pA, model, aInfo, bInfo, shortApproach: true });
    tried++;
    if (attempt(plan)) return { plan: rescalePlan(plan, durationSec), exact: true, tries: tried };
  }
  return { plan: rescalePlan(best, durationSec), exact: false, tries: tried };
}

/** The data time the scrim scene actually ends: the last engagement's end
 *  (≥ durationSec — the final engagement overruns the row window by its
 *  tail). The end card fires here, once the full played score has landed. */
export function scrimPlanEnd(plan, durationSec) {
  let end = durationSec;
  for (const e of plan.engagements) if (e.t1 > end) end = e.t1;
  return end;
}

/** Top scrim partner from a scrims file's rows: most kills+deaths against
 *  the player, ties go to more deaths (the rankedRivals order). null when
 *  there is no scrim row. Keys, not names, identify partners — namesakes
 *  on different servers stay apart. */
export function topScrimPartner(rows) {
  const agg = new Map();
  for (const r of rows || []) for (const x of r.o || []) {
    const e = agg.get(x[0]) || { key: x[0], name: x[1], kills: 0, deaths: 0 };
    e.kills += x[2] || 0; e.deaths += x[3] || 0; agg.set(x[0], e);
  }
  const sorted = [...agg.values()].sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths) || b.deaths - a.deaths);
  return sorted[0] || null;
}
