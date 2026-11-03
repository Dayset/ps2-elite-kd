// Living stat gauges (#108, pure): the math behind the DOM gauges under the
// life strip. No DOM, no T(), no clock — the caller feeds simT and the scene's
// tallies, so these functions are testable in node and honest about what they
// do not know (see the notes on each function).
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** KPM clock bar span: one data minute, unless one expected kill takes longer
 *  than a minute, in which case the smallest whole number of minutes that
 *  holds one expected kill (0.5 KPM → 120 s interval → 2 min span). */
export function kpmSpan(kpm) {
  if (!(kpm > 0)) return { spanSec: 60, spanMin: 1 };
  const interval = 60 / kpm;
  const spanMin = interval <= 60 ? 1 : Math.ceil(interval / 60);
  return { spanSec: spanMin * 60, spanMin };
}

/** The KPM gauge for one side at data time simT.
 *  - notches: expected kill moments (every 60/KPM s, continuing across bars)
 *    that fall in the CURRENT span, as fractions of the span. A notch is
 *    filled when a kill landed within half an interval of that moment; a
 *    missed notch stays hollow.
 *  - marks: EVERY kill so far, positioned by its moment modulo the span.
 *    Marks accumulate across spans (a mark belongs to its moment's position,
 *    so the count always equals the side's kill total — that is the #108
 *    headless check: marks == stats.k). The fill restarts each span.
 *  - fill: how far through the current span the data clock is. */
export function kpmGauge(kpm, simT, killTimes) {
  const { spanSec, spanMin } = kpmSpan(kpm);
  const spanIndex = Math.floor(simT / spanSec);
  const spanStart = spanIndex * spanSec;
  const fill = clamp01((simT - spanStart) / spanSec);
  const notches = [];
  if (kpm > 0) {
    const interval = 60 / kpm;
    for (let k = 1; ; k++) {
      const moment = k * interval;
      if (moment >= (spanIndex + 1) * spanSec) break;
      if (moment < spanStart) continue;
      const filled = (killTimes || []).some((t) => Math.abs(t - moment) <= interval / 2);
      notches.push({ frac: (moment - spanStart) / spanSec, filled });
    }
  }
  const marks = (killTimes || []).map((t) => ((t % spanSec) + spanSec) % spanSec / spanSec);
  return { spanSec, spanMin, spanIndex, fill, notches, marks };
}

/** One K/D coffin row: floor(K/D) coffin outlines plus a thin partial bar for
 *  the fraction (4.54 → 4 coffins + 54 %). Kills in the life fill coffins
 *  left to right; the kill past the coffins fills the partial bar, and any
 *  further kills count as over. */
export function kdRow(kd, killsInLife) {
  const full = Math.max(0, Math.floor(kd || 0));
  const frac = (kd || 0) - full;
  const filled = Math.min(killsInLife, full);
  const partialWidth = killsInLife > full ? 1 : frac;
  const over = killsInLife > full ? killsInLife - full - 1 : 0;
  return { full, frac, filled, partialWidth, over };
}

/** The last 3 lives for one side: the current life first, then the two most
 *  recent finished lives, dimmed. lives are {n, t0, t1} intervals; killTimes
 *  are that side's kill moments (main kills, or rival kills = main deaths).
 *  Kills are counted by interval, so this is exact even after a __fast jump
 *  that skipped lives — no observation of transitions is needed. */
export function kdLives(kd, lives, killTimes, simT) {
  const sorted = [...(lives || [])].sort((a, b) => a.t0 - b.t0);
  if (!sorted.length) return [];
  let cur = sorted.find((l) => simT >= l.t0 && simT < l.t1)
    ?? [...sorted].reverse().find((l) => l.t0 <= simT) ?? sorted[0];
  const count = (l, upto) => (killTimes || []).filter((t) => t >= l.t0 && t < upto).length;
  const rows = [{ n: cur.n, kills: count(cur, Math.min(simT, cur.t1)), dimmed: false, ...kdRow(kd, count(cur, Math.min(simT, cur.t1))) }];
  const finished = sorted.filter((l) => l.t1 <= simT && l !== cur).sort((a, b) => b.t1 - a.t1).slice(0, 2);
  for (const l of finished) {
    const kills = count(l, l.t1);
    rows.push({ n: l.n, kills, dimmed: true, ...kdRow(kd, kills) });
  }
  return rows;
}

/** Accuracy this fight: hits ÷ shots so far in the current fight, with the
 *  player's lifetime accuracy as the marker (clamped to the bar). */
export function accBar(hits, shots, lifetimeAcc) {
  return { frac: shots > 0 ? clamp01(hits / shots) : 0, marker: clamp01(lifetimeAcc || 0) };
}

/** HS last 10: the side's last 10 kills as headshot flags, with the expected
 *  headshot count (lifetime HS ratio × 10, rounded) marked beside them. */
export function hsHeads(recentKills, lifetimeHsr) {
  return {
    heads: (recentKills || []).slice(-10).map((r) => !!r.hs),
    expected: Math.round(clamp01(lifetimeHsr || 0) * 10),
  };
}

/** Shots/kill counter: counts up during the current fight, freezes at the
 *  kill (the caller stops feeding it when the fight ends). The bar scale is
 *  1.5× the lifetime value so the lifetime marker sits inside the bar
 *  instead of at its end; the fill caps at the lifetime value. */
export function spkGauge(currentShots, lifetimeSpk) {
  const lifetime = lifetimeSpk || 0;
  const scale = Math.max(lifetime * 1.5, currentShots, 1);
  return {
    current: currentShots,
    lifetime,
    scale,
    frac: lifetime > 0 ? Math.min(currentShots / lifetime, 1) : 0,
    markerFrac: lifetime > 0 ? lifetime / scale : 0,
  };
}
