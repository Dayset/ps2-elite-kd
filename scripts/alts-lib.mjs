/**
 * 👥 Likely alts (owner t600, hidden build-log only): pure helpers, no I/O.
 *
 * A pair of characters gets a "same person likely" % from independent clues:
 *   ⏱️ never online together  — observed overlap vs the overlap two independent
 *                                players with the same habits would have
 *   🔁 hand-offs              — one logs off, the other logs on within minutes
 *   🕘 same hours             — hour-of-week activity shape (cosine)
 *   📊 stat profile           — distance between their stat profiles
 *   🔫 weapons                — shared auraxium weapons (Jaccard)
 *   🔤 name                   — longest shared name part
 *   🏳️ outfit                 — ever in the same outfit (Honu session outfitID)
 * Each clue is cut into bins whose edges and likelihood ratios are LEARNED from
 * known alt families (positives) vs pairs of different people (negatives):
 * see calibrate(). Always "likely", never proof.
 */

export const MIN = 60; // seconds per minute
export const HANDOFF_MIN = 10; // log-off → log-on gap counted as a hand-off (minutes)
export const OVERLAP_SLOP_MIN = 5; // overlaps shorter than this are logout lag, not play
export const WEEK_MIN = 7 * 24 * 60;
export const LR_CAP = 1000; // sanity ceiling; the real limit is how many different-person pairs were checked (rule of three)

/** Honu /character/{id}/sessions → compact [[startMin, durMin], …] (oldest first) + outfit ids. */
export function compactSessions(list, { sinceMs = 0, nowMs = Date.now() } = {}) {
  const sess = [];
  const outfits = new Set();
  const teams = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const a = Date.parse(s && s.start);
    let b = s && s.end ? Date.parse(s.end) : NaN;
    if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(b)) b = Math.min(nowMs, a + 6 * 3600e3); // still online
    if (s.outfitID && s.outfitID !== "0") outfits.add(String(s.outfitID));
    if (s.teamID) teams.add(+s.teamID);
    if (b < sinceMs || b - a < 60e3) continue;
    sess.push([Math.round(a / 60e3), Math.max(1, Math.round((b - a) / 60e3))]);
  }
  sess.sort((x, y) => x[0] - y[0]);
  return { sess, outfits: [...outfits], teams: [...teams] };
}

const clipTo = (sess, lo, hi) => sess.filter(([s, d]) => s + d > lo && s < hi);

/** 168-bin minutes-per-hour-of-week (UTC) for sessions. */
export function hourOfWeek(sess) {
  const v = new Float64Array(168);
  for (const [s, d] of sess) {
    for (let m = s; m < s + d; ) {
      const how = Math.floor(((m + 3 * 1440) % WEEK_MIN) / 60); // epoch day 0 = Thursday (+3 days) → bin 0 = Monday 00:00 UTC
      const next = Math.min(s + d, (Math.floor(m / 60) + 1) * 60);
      v[how] += next - m;
      m = next;
    }
  }
  return v;
}

function hourOfWeekEvents(mins) {
  const v = new Float64Array(168);
  for (const m of mins) v[Math.floor(((m + 3 * 1440) % WEEK_MIN) / 60)]++;
  return v;
}

const smooth = (v) => v.map((x, i) => 0.5 * x + 0.25 * v[(i + 167) % 168] + 0.25 * v[(i + 1) % 168]);

export function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : null;
}

/**
 * Session clues for one pair inside the window where BOTH were active.
 * Expected values assume two independent players with these exact hour-of-week
 * habits: E[overlap] = Σ_h minA_h·minB_h / (60·weeks), same idea for hand-offs.
 */
export function sessionClues(A, B, { expand = false } = {}) {
  if (!A || !B || !A.length || !B.length) return null;
  let lo = Math.max(A[0][0], B[0][0]);
  let hi = Math.min(A[A.length - 1][0] + A[A.length - 1][1], B[B.length - 1][0] + B[B.length - 1][1]);
  if (hi - lo < 7 * 1440) {
    // pair view: under a week side by side says nothing. Group view (expand): look at the
    // week around where they meet, so a character played on one day can still be linked by hand-offs.
    if (!expand) return { shared: false };
    const mid = (lo + hi) / 2;
    lo = mid - 3.5 * 1440; hi = mid + 3.5 * 1440;
  }
  const a = clipTo(A, lo, hi), b = clipTo(B, lo, hi);
  const weeks = (hi - lo) / WEEK_MIN;
  const days = (x) => new Set(x.map(([s]) => Math.floor(s / 1440)));
  const dA = days(a), dB = days(b);
  let coDays = 0;
  for (const d of dA) if (dB.has(d)) coDays++;
  // observed overlap (two-pointer)
  let overlap = 0, overlapN = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const ae = a[i][0] + a[i][1], be = b[j][0] + b[j][1];
    const o = Math.min(ae, be) - Math.max(a[i][0], b[j][0]);
    if (o > OVERLAP_SLOP_MIN) { overlap += o; overlapN++; }
    if (ae < be) i++; else j++;
  }
  const hA = hourOfWeek(a), hB = hourOfWeek(b);
  let expOverlap = 0;
  for (let h = 0; h < 168; h++) expOverlap += (hA[h] * hB[h]) / (60 * weeks);
  // hand-offs: one ends, the other starts 0..HANDOFF_MIN later (either direction)
  const starts = (x) => x.map(([s]) => s);
  const ends = (x) => x.map(([s, d]) => s + d);
  const countHand = (endsX, startsY) => {
    let n = 0;
    const ys = startsY;
    for (const e of endsX) {
      // binary search first start >= e - 1
      let l = 0, r = ys.length;
      while (l < r) { const m = (l + r) >> 1; if (ys[m] < e - 1) l = m + 1; else r = m; }
      if (l < ys.length && ys[l] <= e + HANDOFF_MIN) n++;
    }
    return n;
  };
  const sA = starts(a), sB = starts(b), eA = ends(a), eB = ends(b);
  const hand = countHand(eA, sB) + countHand(eB, sA);
  const evE_A = hourOfWeekEvents(eA), evS_A = hourOfWeekEvents(sA), evE_B = hourOfWeekEvents(eB), evS_B = hourOfWeekEvents(sB);
  let expHand = 0;
  for (let h = 0; h < 168; h++) expHand += ((evE_A[h] * evS_B[h] + evE_B[h] * evS_A[h]) * (HANDOFF_MIN + 1)) / (60 * weeks);
  return {
    shared: true,
    weeks: +weeks.toFixed(1),
    nA: a.length, nB: b.length,
    minA: a.reduce((t, x) => t + x[1], 0), minB: b.reduce((t, x) => t + x[1], 0),
    coDays,
    overlap, overlapN, expOverlap: +expOverlap.toFixed(1),
    hand, expHand: +expHand.toFixed(2),
    hours: cosine(smooth(hA), smooth(hB)),
  };
}

/** Lower-case letters/digits only, outfit tag dropped. */
export const bareName = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Longest common substring of two bare names (letters only count toward the length). */
export function nameClue(n1, n2) {
  const a = bareName(n1), b = bareName(n2);
  let best = "";
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best.length) best = a.slice(i, i + k);
    }
  }
  const letters = best.replace(/[0-9]/g, "").length;
  return { part: best, len: letters, ratio: a && b ? letters / Math.min(a.length, b.length) : 0 };
}

/** Profile features from a ranks.json row (cols map) – NaN when missing. */
export const PROFILE_FEATURES = [
  ["adjs", (v) => Math.log1p(Math.max(0, v))], // ⚔️ iVi
  ["pvs", (v) => v], // 🦁 Brave
  ["rf", (v) => v], // 🛡️ Resist
  ["inflation", (v) => Math.log(Math.max(0.2, v))], // feeds 🪳 Zerg
  ["inf", (v) => v], // 🪖 Infantry %
  ["hsr", (v) => v],
  ["ownKpm", (v) => v], // weapon pace (KPM)
  ["apk", (v) => v], // 🤝 Assists
];

export function profileVector(row, I) {
  return PROFILE_FEATURES.map(([k, f]) => {
    const v = row[I[k]];
    return v == null || !Number.isFinite(+v) ? NaN : f(+v);
  });
}

/** Robust scale (median / 1.4826·MAD) per feature over many vectors. */
export function robustScale(vectors) {
  const nF = PROFILE_FEATURES.length;
  const med = [], sc = [];
  for (let f = 0; f < nF; f++) {
    const xs = vectors.map((v) => v[f]).filter(Number.isFinite).sort((a, b) => a - b);
    const m = xs[xs.length >> 1] ?? 0;
    const dev = xs.map((x) => Math.abs(x - m)).sort((a, b) => a - b);
    med.push(m);
    sc.push(1.4826 * (dev[dev.length >> 1] || 1) || 1);
  }
  return { med, sc };
}

/** RMS of robust-z differences over the features both have (null if < 4 shared). */
export function profileDistance(va, vb, scale) {
  let s = 0, n = 0;
  for (let f = 0; f < va.length; f++) {
    if (!Number.isFinite(va[f]) || !Number.isFinite(vb[f])) continue;
    const d = (va[f] - vb[f]) / scale.sc[f];
    s += d * d;
    n++;
  }
  return n >= 4 ? Math.sqrt(s / n) : null;
}

export function jaccard(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return null;
  const A = new Set(a);
  let inter = 0;
  for (const x of b) if (A.has(x)) inter++;
  return inter / (A.size + b.length - inter);
}

/**
 * Clue values → the scalar each calibrated clue is binned on.
 * null = clue not available for this pair (counts as neutral, LR 1).
 */
export const CLUES = {
  // ⏱️ time online together vs what two independent players with these habits would
  // log: log((seen + 30 min) / (expected + 30 min)). ≈ 0 = like strangers; very negative =
  // "should have met for hours but never did". Needs ≥ 30 expected minutes to say anything.
  together: (c) => (c.sess && c.sess.shared && c.sess.expOverlap >= 30 ? Math.log((c.sess.overlap + 30) / (c.sess.expOverlap + 30)) : null),
  // 🔁 hand-offs (one logs off, the other logs on ≤ 10 min later) above chance, in
  // Poisson standard deviations: (seen − expected) / √(expected + ½). Few sessions → near 0.
  // No hand-off when not even one was expected says nothing (null), it only counts as a minus when ≥ 1 was due.
  handoff: (c) => (c.sess && c.sess.shared && c.sess.nA >= 3 && c.sess.nB >= 3 && (c.sess.hand > 0 || c.sess.expHand >= 1)
    ? (c.sess.hand - c.sess.expHand) / Math.sqrt(c.sess.expHand + 0.5) : null),
  hours: (c) => (c.sess && c.sess.shared && c.sess.nA >= 5 && c.sess.nB >= 5 ? c.sess.hours : null),
  profile: (c) => c.profile,
  weapons: (c) => c.weapons,
  name: (c) => c.name.len,
  outfit: (c) => (c.outfit == null ? null : c.outfit ? 1 : 0),
};

/** +1: bigger value → more likely the same person; −1: the other way round. */
export const DIRECTION = { together: -1, handoff: 1, hours: 1, profile: -1, weapons: 1, name: 1, outfit: 1 };

/** Weighted pool-adjacent-violators: closest sequence that is monotone in `dir`. */
export function isotonic(ys, ws, dir = 1) {
  const blocks = [];
  for (let i = 0; i < ys.length; i++) {
    blocks.push({ y: ys[i] * dir, w: ws[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].y > blocks[blocks.length - 1].y) {
      const b = blocks.pop(), a = blocks.pop();
      blocks.push({ y: (a.y * a.w + b.y * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => new Array(b.n).fill(b.y * dir));
}

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

/**
 * Learn bins + likelihood ratios per clue from labelled pairs.
 * Edges: quartiles of the positives (where alt pairs actually sit), the
 * negatives' median and their 5 % / 1 % / 0.1 % tail, deduped; LR per bin = P(bin | alt) / P(bin | different),
 * bounded by the rule of three and made monotone in the clue's known direction.
 */
export function calibrate(pos, neg, clueMap = CLUES, dirMap = DIRECTION) {
  const model = {};
  for (const [k, f] of Object.entries(clueMap)) {
    const P = pos.map(f).filter((v) => v != null && Number.isFinite(v));
    const N = neg.map(f).filter((v) => v != null && Number.isFinite(v));
    if (P.length < 5 || N.length < 5) continue;
    // + the strangers. 5 % / 1 % / 0.1 % tail on the "same person" side, so a clue far beyond what
    //   strangers ever show gets its own (stronger) bin instead of sharing one with the crowd
    const d = dirMap[k] || 1;
    const tail = d > 0 ? [q(N, 0.95), q(N, 0.99), q(N, 0.999)] : [q(N, 0.05), q(N, 0.01), q(N, 0.001)];
    let edges = [...new Set([q(P, 0.25), q(P, 0.5), q(P, 0.75), q(N, 0.5), ...tail].map((x) => +x.toFixed(4)))].sort((a, b) => a - b);
    if (k === "outfit") edges = [0.5];
    if (k === "name") edges = [3, 4, 5, 7]; // letters shared: whole-number steps (quartiles collapse on integers)
    const bin = (v) => { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; };
    const nb = edges.length + 1;
    const cp = new Array(nb).fill(0), cn = new Array(nb).fill(0);
    P.forEach((v) => cp[bin(v)]++);
    N.forEach((v) => cn[bin(v)]++);
    // P(bin | alt) / P(bin | different). The rarer side of a bin counts as at least 3
    // ("rule of three": zero hits in n checks only proves a rate below ~3/n),
    // so an LR is never bigger than the checked pairs can support. Empty bins say nothing (1).
    const raw = cp.map((c, i) => {
      const pr = c / P.length, nr = cn[i] / N.length;
      if (c + cn[i] === 0) return 1;
      return pr >= nr ? Math.max(1, pr / Math.max(nr, 3 / N.length)) : Math.min(1, Math.max(pr, 3 / P.length) / nr);
    });
    // Every clue has a known direction (more hand-offs → more likely the same person, more
    // time online together → less likely): pool neighbouring bins that break it (isotonic fit).
    const lr = isotonic(raw.map(Math.log), cp.map((c, i) => c + cn[i] + 1e-9), d)
      .map((l) => +Math.min(LR_CAP, Math.max(1 / LR_CAP, Math.exp(l))).toFixed(4));
    model[k] = { edges, lr, nPos: P.length, nNeg: N.length, cp, cn };
  }
  return model;
}

export function binOf(edges, v) { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; }

/** Posterior "same person likely" (0..1) + per-clue LRs. priorOdds from the caller. */
export function scorePair(clues, model, priorOdds, clueMap = CLUES) {
  let logOdds = Math.log(priorOdds);
  const why = {};
  for (const [k, m] of Object.entries(model)) {
    const v = clueMap[k](clues);
    if (v == null || !Number.isFinite(v)) continue;
    const lr = m.lr[binOf(m.edges, v)];
    why[k] = { v: +(+v).toFixed(3), lr };
    logOdds += Math.log(lr);
  }
  const p = 1 / (1 + Math.exp(-logOdds));
  return { p, why };
}

/**
 * Owner t601/t602: a known alt who sometimes ran a SECOND PC at the same time as the
 * main one. For calibration only, drop that character's sessions that overlap the
 * partner(s) (> slop), so a rare second-PC evening doesn't teach the model that
 * "online together" is normal for one person.
 */
export function dropOverlapping(sess, others) {
  const o = [...others].sort((x, y) => x[0] - y[0]);
  return sess.filter(([s, d]) => !o.some(([t, e]) => Math.min(s + d, t + e) - Math.max(s, t) > OVERLAP_SLOP_MIN));
}

// ---------- 👪 groups (chains of hand-offs) ----------
/** z of hand-offs above chance + "they don't share time" test, for linking. */
export const handZ = (hand, expHand) => (hand - expHand) / Math.sqrt(expHand + 0.5);
export const LINK = { minHand: 2, minZ: 3, overlapShare: 0.2, overlapFloor: 10, sparseShare: 0.5 };
/**
 * Two characters (or a character and a group) are linked: repeated hand-offs well above
 * chance AND (almost) never online together (a few brief minutes are allowed).
 * nSess (joining a group): a character with very few sessions can't reach 3 SD, so it also
 * joins when at least half its sessions start or end in a hand-off with the family.
 */
export function linked({ hand, expHand, overlap, expOverlap }, nSess = 0) {
  if (hand < LINK.minHand || overlap > LINK.overlapFloor + LINK.overlapShare * expOverlap) return false;
  return handZ(hand, expHand) >= LINK.minZ || (nSess > 0 && hand >= LINK.sparseShare * nSess);
}
/** Sum pairwise session facts over all member pairs. pairFacts(a, b) → expanded sessionClues or null. */
export function groupFacts(members, pairFacts) {
  let overlap = 0, expOverlap = 0, hand = 0, expHand = 0, pairs = 0, overlapN = 0;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const c = pairFacts(members[i], members[j]);
    if (!c || !c.shared) continue;
    pairs++; overlap += c.overlap; overlapN += c.overlapN; expOverlap += c.expOverlap; hand += c.hand; expHand += c.expHand;
  }
  return { n: members.length, pairs, overlap, overlapN, expOverlap: +expOverlap.toFixed(1), hand, expHand: +expHand.toFixed(2) };
}
/** Group clues: same scales as the pair clues, on the sums over all member pairs. */
export const GROUP_CLUES = {
  // a few short second-PC minutes barely move this; hours together where hours were expected do
  together: (g) => (g.expOverlap >= 30 ? Math.log((g.overlap + 30) / (g.expOverlap + 30)) : null),
  handoff: (g) => (g.hand > 0 || g.expHand >= 1 ? handZ(g.hand, g.expHand) : null),
};
export const GROUP_DIRECTION = { together: -1, handoff: 1 };
