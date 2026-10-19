/**
 * Commander focus: one clear move per faction, looking up to two captures ahead,
 * with the game's cut rule built in.
 *
 * The ranked lists in commander.js value each base with the win tree read on raw
 * territory in 5 % steps, so most single bases show "+0 %" and a cut that
 * removes six enemy bases from the score looks like one base. Here each
 * candidate position is scored the way the game scores it (bases cut off from
 * their warpgate count for nobody, src/cut.js), with the tree read smoothly
 * across its 5 % territory and 5-minute steps, and with the elimination rule.
 * The result is "all forces on X: NC 8 % → 61 %".
 *
 * Moves considered, per faction (only what can actually be attacked: enemy bases
 * next to territory still linked to our warpgate):
 *   take    one capture
 *   plan    two captures in a row, when there is time (≥ 8 min) and the pair is
 *           clearly worth more than its first step
 *   hold    the enemy capture that would hurt us most
 * Ranked by expected value (capture chance × win-chance change). The focus is
 * the best; up to two backups worth at least half of it. Moves that change
 * almost nothing are dropped, so a quiet front shows "no decisive move".
 *
 * Worker-only layer on top of the Python-parity commander; it never changes the
 * header odds.
 */
import { FACS, lookup, timeBin, maxSwingPP } from "./engine.js";

const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const INV = { VS: 1, NC: 2, TR: 3 };
const MIN_SWING = 2;            // win-chance change (of 100) below which a move is noise
const PLAN_MIN_LEFT = 8;        // minutes needed for a two-capture plan
const TAKE_MIN_LEFT = 1;        // a capture can still land (fights already under way)
const STEP_MIN = 3;             // minutes for one capture to land (engine MIN_PER_BASE)
const P_DEFAULT = 0.33;

/** Bases cut off from their owner's warpgate (owner has a warpgate on the map). */
export function cutOff(own, adj, wg) {
  const reach = new Set(), stack = [];
  const hasWg = new Set();
  for (const w of wg) { const o = own.get(w); if (FAC[o]) { stack.push(w); hasWg.add(o); } }
  while (stack.length) {
    const c = stack.pop();
    if (reach.has(c)) continue;
    reach.add(c);
    const o = own.get(c);
    for (const nb of adj.get(c) || []) if (!reach.has(nb) && own.get(nb) === o) stack.push(nb);
  }
  const cut = new Set();
  for (const [fid, o] of own) if (FAC[o] && hasWg.has(o) && !reach.has(fid)) cut.add(fid);
  return { cut, reach };
}

/** Game-scored shares: cut bases count for nobody. Denominator = all bases (same as the engine). */
function scored(own, cut) {
  const c = { VS: 0, NC: 0, TR: 0 };
  for (const [fid, o] of own) if (FAC[o] && !cut.has(fid)) c[FAC[o]]++;
  const n = own.size || 1;
  return { VS: (100 * c.VS) / n, NC: (100 * c.NC) / n, TR: (100 * c.TR) / n };
}

/**
 * Win chance with the tree read smoothly: territory averaged over a ±2.5 % kernel
 * (the tree's 5 % step), time blended between neighbouring 5-minute bins, then
 * the elimination rule exactly as engine.computeWin applies it.
 */
export function smoothWin(getBin, terr, mom, t, dur, nFac) {
  const tEff = dur ? (t * 90) / dur : t;
  const b0 = timeBin(t, dur), b1 = Math.min(18, b0 + 1);
  const w1 = b1 === b0 ? 0 : Math.max(0, Math.min(1, (tEff - (b0 * 5 + 2.5)) / 5));
  const raw = {};
  for (const f of FACS) {
    const others = FACS.filter((k) => k !== f);
    const marg = terr[f] - Math.max(...others.map((k) => terr[k]));
    let rival = null;
    for (const k of others) if (rival === null || terr[k] > terr[rival]) rival = k;
    let s = 0, n = 0;
    for (const [b, w] of [[b0, 1 - w1], [b1, w1]]) {
      if (!w) continue;
      const { bin, xbin } = getBin(b);
      for (const u of [-2.5, 0, 2.5]) {
        const x = Math.max(0, terr[f] + u);
        const [p] = lookup(bin, xbin, b, f, x, mom[f], marg + u, rival);
        s += w * (p ?? 0); n += w;
      }
    }
    raw[f] = n ? s / n : 0;
  }
  const leader = FACS.reduce((a, f) => (terr[f] > terr[a] ? f : a), FACS[0]);
  const swing = maxSwingPP(t, dur, nFac);
  for (const f of FACS) if (f !== leader && swing < terr[leader] - terr[f]) raw[f] = 0;
  if (FACS.filter((f) => f !== leader).every((f) => raw[f] === 0)) raw[leader] = 100;
  const tot = FACS.reduce((a, f) => a + raw[f], 0) || 1;
  return Object.fromEntries(FACS.map((f) => [f, (100 * raw[f]) / tot]));
}

const decided = (w) => FACS.some((f) => w[f] >= 99.95);

/**
 * Focus per faction. own: Map fid -> 0..3; lattice {adj, names}; mom: territory
 * change per faction over 15 min; header: {VS:{pct}} odds the dashboard shows;
 * pf(fid) -> capture chance. Returns {VS: {focus, backups, quiet}, ...}.
 */
export function focusPlan({ own, lattice, getBin, t, dur, mom, header, pf = () => P_DEFAULT, nFac, noCuts = false }) {
  const { adj, names } = lattice;
  const wg = Object.keys(names).filter((f) => /warpgate/i.test(names[f]));
  const left = dur - t;
  const zeroMom = { VS: 0, NC: 0, TR: 0 };
  const m = mom || zeroMom;
  // Positions are judged when the move lands (each capture takes ~3 min), against
  // doing nothing over the same time: with 3 minutes left, one base can decide it.
  const at = (steps) => Math.min(t + steps * STEP_MIN, dur - 0.5);
  const memo = new Map();
  const winAt = (sh, tt) => {
    const k = `${tt}|${sh.VS}|${sh.NC}|${sh.TR}`;
    let w = memo.get(k);
    if (!w) { w = smoothWin(getBin, sh, m, tt, dur, nFac); memo.set(k, w); }
    return w;
  };
  const evalPos = (o, tt = t) => {
    const { cut, reach } = noCuts ? { cut: new Set(), reach: null } : cutOff(o, adj, wg);
    const sh = scored(o, cut);
    return { cut, reach, sh, win: winAt(sh, tt) };
  };
  const base = evalPos(own);
  const quo = { 1: winAt(base.sh, at(1)), 2: winAt(base.sh, at(2)) };
  const offset = Object.fromEntries(FACS.map((f) => [f, header && header[f] && typeof header[f].pct === "number" ? header[f].pct - base.win[f] : 0]));
  const nm = (fid) => names[fid] || `#${fid}`;
  // Enemy bases f can attack: next to f's warpgate-linked territory (or any f base if cuts are off).
  const attackable = (o, reach, f) => {
    const fo = INV[f], out = [];
    for (const [fid, x] of o) {
      if (x === fo || !FAC[x] || /warpgate/i.test(names[fid] || "")) continue;
      if ((adj.get(fid) || []).some((nb) => o.get(nb) === fo && (!reach || reach.has(nb)))) out.push(fid);
    }
    return out;
  };
  const shown = (f) => base.win[f] + offset[f];
  const then = (f, w) => (decided(w) ? Math.round(w[f]) : Math.max(0.5, Math.min(99.5, w[f] + offset[f])));
  const lostBy = (before, after, owner) => [...after].filter((fid) => !before.has(fid) && own.get(fid) === INV[owner]);
  const out = {};
  for (const f of FACS) {
    const fo = INV[f];
    const cands = [];
    if (left >= TAKE_MIN_LEFT) {
      const firsts = [];
      for (const fid of attackable(own, base.reach, f)) {
        const o2 = new Map(own); const from = FAC[own.get(fid)]; o2.set(fid, fo);
        const e = evalPos(o2, at(1));
        const gain = e.win[f] - quo[1][f];
        const p = pf(fid);
        const severs = lostBy(base.cut, e.cut, from);
        const reconnects = [...base.cut].filter((x) => own.get(x) === fo && !e.cut.has(x));
        const c = { kind: "take", bases: [nm(fid)], target: from, p: +p.toFixed(2), gain, ev: p * gain, win: e.win,
          cuts: severs.map(nm), reconnects: reconnects.map(nm), _o: o2, _e: e, _fid: fid };
        cands.push(c); firsts.push(c);
      }
      if (left >= PLAN_MIN_LEFT) {
        firsts.sort((a, b) => b.ev - a.ev || b.gain - a.gain);
        for (const c1 of firsts.slice(0, 6)) {
          for (const fid of attackable(c1._o, c1._e.reach, f)) {
            if (fid === c1._fid) continue;
            const o3 = new Map(c1._o); const from = FAC[c1._o.get(fid)]; o3.set(fid, fo);
            const e = evalPos(o3, at(2));
            const gain = e.win[f] - quo[2][f];
            const p = c1.p * pf(fid);
            // Only when the pair is clearly more than its first step.
            if (at(2) <= at(1) || gain < c1.gain + MIN_SWING || gain < 1.5 * Math.max(c1.gain, 0)) continue;
            const severs = [...new Set([...c1.cuts, ...lostBy(c1._e.cut, e.cut, from).map(nm)])];
            cands.push({ kind: "plan", bases: [c1.bases[0], nm(fid)], target: from === c1.target ? from : `${c1.target}/${from}`, p: +p.toFixed(2), gain, ev: p * gain,
              win: e.win, cuts: severs, reconnects: c1.reconnects });
          }
        }
      }
    }
    // Threats: the enemy capture of one of our bases that hurts most.
    if (left >= TAKE_MIN_LEFT) {
      for (const g of FACS) {
        if (g === f) continue;
        const reachG = base.reach;
        for (const fid of attackable(own, reachG, g)) {
          if (own.get(fid) !== fo) continue;
          const o2 = new Map(own); o2.set(fid, INV[g]);
          const e = evalPos(o2, at(1));
          const loss = quo[1][f] - e.win[f];
          const p = pf(fid);
          cands.push({ kind: "hold", bases: [nm(fid)], target: g, p: +p.toFixed(2), gain: loss, ev: p * loss, win: e.win,
            cuts: lostBy(base.cut, e.cut, f).map(nm), reconnects: [] });
        }
      }
    }
    const useful = cands.filter((c) => c.gain >= MIN_SWING).sort((a, b) => b.ev - a.ev || b.gain - a.gain);
    // One entry per first base (a plan and a take on the same base: keep the better).
    const seen = new Set(), picks = [];
    for (const c of useful) {
      const k = `${c.kind === "hold" ? "h" : "a"}:${c.bases[0]}`, kp = c.kind === "plan" ? `p:${[...c.bases].sort().join("+")}` : null;
      if (seen.has(k) || (kp && seen.has(kp))) continue;
      seen.add(k); if (kp) seen.add(kp); picks.push(c);
    }
    const fmt = (c) => {
      const now = Math.round(shown(f) * 10) / 10;
      const after = c.kind === "hold" ? then(f, c.win) : then(f, c.win);
      return { kind: c.kind, bases: c.bases, target: c.target, p: c.p, cuts: c.cuts, reconnects: c.reconnects,
        now, then: Math.round(after * 10) / 10, text: describe(f, c) };
    };
    const top = picks[0];
    if (top) { out[f] = { focus: fmt(top), backups: picks.slice(1).filter((c) => c.ev >= top.ev / 2).slice(0, 2).map(fmt), quiet: false }; continue; }
    // Nothing moves our own odds: spoiler play (who wins is still ours to decide).
    const leader = FACS.filter((g) => g !== f).reduce((a, g) => (quo[1][g] > quo[1][a] ? g : a), FACS.find((g) => g !== f));
    const spoil = cands.filter((c) => c.kind === "take" && c.target === leader)
      .map((c) => ({ ...c, drop: quo[1][leader] - c.win[leader] }))
      .filter((c) => c.drop >= MIN_SWING).sort((a, b) => b.p * b.drop - a.p * a.drop)[0];
    out[f] = spoil
      ? { focus: { kind: "spoil", bases: spoil.bases, target: leader, p: spoil.p, cuts: spoil.cuts, reconnects: [], leader,
          now: Math.round(shown(leader) * 10) / 10, then: Math.round(then(leader, spoil.win) * 10) / 10,
          text: `Spoiler: take ${spoil.bases[0]} from ${leader}${spoil.cuts.length ? ` — cuts off ${spoil.cuts.length} of theirs` : ""}` }, backups: [], quiet: false }
      : { focus: null, backups: [], quiet: true };
  }
  return out;
}

const list = (xs, n = 3) => xs.slice(0, n).join(", ") + (xs.length > n ? ` +${xs.length - n}` : "");

function describe(f, c) {
  const cut = c.cuts.length ? ` — cuts off ${c.cuts.length} ${c.kind === "hold" ? "of ours" : "enemy"} base${c.cuts.length > 1 ? "s" : ""} (${list(c.cuts)})` : "";
  const rec = c.reconnects.length ? ` — reconnects ${c.reconnects.length} cut-off base${c.reconnects.length > 1 ? "s" : ""}` : "";
  if (c.kind === "hold") return `Hold ${c.bases[0]} against ${c.target}${c.cuts.length ? ` — losing it cuts off ${c.cuts.length} of ours (${list(c.cuts)})` : ""}`;
  if (c.kind === "plan") return `Take ${c.bases[0]}, then ${c.bases[1]}${cut}${rec}`;
  return `Take ${c.bases[0]} from ${c.target}${cut}${rec}`;
}
