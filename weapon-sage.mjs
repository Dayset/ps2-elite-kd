// weapon-sage.mjs: plain-language verdicts for the weapon comparison page, computed from the recoil
// simulator — never written per weapon. Every line is a threshold on numbers the sim just produced,
// at the user's current settings (range, accuracy, pulldown, stance), so the advice moves when the
// sliders move and stays true when the game patches. A line only appears when its numbers clear
// the threshold; silence means the sim has nothing honest to say there.
//
// sageLines(P, base, ctx) -> [{ key, ...params }] in display order. P is the simParams object for
// the weapon, base is compareBursts(P) — the same numbers the sim card shows, so the lines never
// contradict the bars — and ctx is { distance, hp, runs, seed, weaponName, hip, compDesc }, where
// compDesc is this weapon's Compensator description (null when it cannot mount one).
import { compareBursts, burstStats, attEffects, TARGET } from "./weapon-sim.mjs";
import { idealTtk } from "./weapons-model.mjs";

// English text for each line, used as the tr() fallback on the page and mirrored in i18n/en.json
// under wc.sage.<key> (English only for now; other locales fall back to these).
export const SAGE_TEXT = {
  title: "In plain words",
  rangeClose: "Close-range gun — it falls off fast past {m} m, get closer.",
  rangeFar: "Holds up at range — the kill time barely changes out to {m} m.",
  burstRate: "Fire in {n}-shot bursts — holding the trigger wastes most of your magazine: only {pct}% of sprays finish the kill.",
  burstTime: "Fire in {n}-shot bursts — holding the trigger takes {x}× as long to kill.",
  pulldown: "Pull down while you fire — that alone makes the kill {pct}% faster.",
  aimHead: "Aim for the head — it kills {pct}% faster at this range.",
  aimTorso: "Aim at the chest, not the head — at your accuracy the head is too small a target.",
  compSmall: "The Compensator barely matters on this gun — it only makes the kill {pct}% faster. Pulling down does more.",
  compSkip: "The Compensator helps a little, but pulling down does more — spend the slot elsewhere.",
  unforgiving: "Unforgiving — when you miss, the kill drags out.",
};

const HEAD = { aimX: TARGET.headX, aimY: TARGET.headY, otherX: 0, otherY: 0 };
const TORSO = { aimX: 0, aimY: 0, otherX: TARGET.headX, otherY: TARGET.headY };
const pct = (x) => Math.round(x * 100);
const faster = (slower, quicker) => (slower - quicker) / slower;

export function sageLines(P, base, ctx = {}) {
  const { distance = 20, hp = 1000, runs = 300, seed = 1 } = ctx;
  const lines = [];
  if (!P || !base || !base.best || base.best.median == null) return lines;
  const best = base.best;
  const run = (variant) => compareBursts(variant, { distance, hp, runs, seed }).best;
  const medianOf = (row) => (row && row.median != null ? row.median : null);

  // what it is: the ideal kill time at range, from the damage falloff alone
  const t10 = idealTtk(P.profile, { range: 10, hp });
  if (t10 > 0) {
    let closeAt = null;
    for (const r of [15, 20, 25, 30, 40, 50]) {
      if (idealTtk(P.profile, { range: r, hp }) >= 1.5 * t10) { closeAt = r; break; }
    }
    if (closeAt != null) lines.push({ key: "rangeClose", m: closeAt });
    else if (idealTtk(P.profile, { range: 50, hp }) <= 1.2 * t10) lines.push({ key: "rangeFar", m: 50 });
  }

  // how to shoot it: bursting beats spraying, when the numbers say so
  if (best.burst !== Infinity) {
    const spray = burstStats(P, { burst: Infinity, distance, hp, runs, seed });
    if (spray.killRate < 0.7) lines.push({ key: "burstRate", n: best.burst, pct: pct(spray.killRate) });
    else if (spray.median != null && spray.median > 1.5 * best.median) {
      lines.push({ key: "burstTime", n: best.burst, x: (spray.median / best.median).toFixed(1) });
    }
  }

  // pulling down: the full pulldown against the current setting
  const pulled = run({ ...P, comp: 1, compX: 0.4 });
  const pulledMedian = medianOf(pulled);
  const pullGain = pulledMedian != null ? faster(best.median, pulledMedian) : -1;
  if (pullGain >= 0.15) lines.push({ key: "pulldown", pct: pct(pullGain) });

  // where to aim: head against chest, at the current accuracy
  const head = run({ ...P, ...HEAD });
  const torso = run({ ...P, ...TORSO });
  const headMedian = medianOf(head), torsoMedian = medianOf(torso);
  if (headMedian != null && torsoMedian != null) {
    if (faster(torsoMedian, headMedian) >= 0.1) lines.push({ key: "aimHead", pct: pct(faster(torsoMedian, headMedian)) });
    else if (faster(headMedian, torsoMedian) >= 0.1) lines.push({ key: "aimTorso" });
  }

  // the Compensator: the attachment against the pulldown, when the gun can mount it
  if (ctx.compDesc != null) {
    const fx = attEffects("Compensator", ctx.compDesc, ctx.weaponName, !!ctx.hip);
    if (fx && fx.vRecoil != null) {
      const att = { ...P, vMin: P.vMin * fx.vRecoil, vMax: P.vMax * fx.vRecoil };
      if (ctx.hip && fx.hipMinCof != null) att.cofMin = P.cofMin * fx.hipMinCof;
      const attMedian = medianOf(run(att));
      if (attMedian != null) {
        const attGain = faster(best.median, attMedian);
        if (attGain > 0 && attGain < 0.1 && pullGain >= 0.15) lines.push({ key: "compSmall", pct: pct(attGain) });
        else if (attGain >= 0.1 && attGain < pullGain) lines.push({ key: "compSkip" });
      }
    }
  }

  // how punishing it is: the spread of kill times at the best burst — the bad tenth of kills
  // taking twice as long as the median means a miss drags the kill out
  if (best.p90 != null && best.p90 > 2 * best.median) lines.push({ key: "unforgiving" });

  return lines;
}
