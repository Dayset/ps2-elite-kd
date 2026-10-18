/**
 * AI Commander: a faithful JS port of oracle/backend/commander_live.py (--json)
 * plus the hossin_elimination helpers it uses (frontier_of, enemy_frontier_of,
 * war_shape). Pure, no I/O. Parity with the Python is checked by
 * test/oracle-commander.test.mjs (Python run with its lattice pinned to file
 * order, which is also the order used here).
 *
 * Inputs mirror commander_live.main():
 *   own      Map fid(string) -> faction int (0 neutral) from the live snapshot
 *   own15    same, 15 minutes earlier (or null)
 *   flips    [[ts, newFac, oldFac, facilityIdString], ...] sorted
 *   lattice  { adj: Map fid -> [fid...], names: {fid: name} }
 *   pf       capture model per_facility ({} when none), res base resistance ({} when none)
 */
import { lookup, timeBin } from "./engine.js";

const FACS = ["VS", "NC", "TR"];
const FAC = { 1: "VS", 2: "NC", 3: "TR" };
const INV = { VS: 1, NC: 2, TR: 3 };
const LANES = 3, MIN_PER_BASE = 3.0;
const FIGHT_UP_BASELINE = 0.67, FIGHT_UP_WINDOW_MIN = 20, FIGHT_UP_MIN_FLIPS = 5;

/**
 * Python round(x, nd): rounds the double's exact decimal value, half-to-even
 * only on exact ties (round(0.815, 2) == 0.81 because 0.815 is 0.81499999…).
 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(Math.min(100, nd + 60)); // exact for |x| in our ranges
  const [ip, fp] = exact.split(".");
  const keep = fp.slice(0, nd), rest = fp.slice(nd);
  let digits = BigInt(ip + keep);
  const tie = /^50*$/.test(rest);
  if (rest[0] > "5" || (rest[0] === "5" && !tie) || (tie && digits % 2n === 1n)) digits += 1n;
  const v = (x < 0 ? -1 : 1) * Number(digits) / 10 ** nd;
  return Object.is(v, -0) ? 0 : v;
}
const f1 = (x) => pyRound(x, 1).toFixed(1);
const pct0 = (x) => `${pyRound(x * 100)}%`;
const get = (m, k, d) => (m.has(k) ? m.get(k) : d);
const nbrs = (adj, fid) => adj.get(fid) || [];
const argmax = (o, keys = FACS) => keys.reduce((b, k) => (b === null || o[k] > o[b] ? k : b), null);

function shares(own) {
  const n = {};
  let tot = 0;
  for (const v of own.values()) { n[v] = (n[v] || 0) + 1; tot++; }
  tot = tot || 1;
  return { VS: ((n[1] || 0) / tot) * 100, NC: ((n[2] || 0) / tot) * 100, TR: ((n[3] || 0) / tot) * 100 };
}

function marginOf(sh, fac) {
  const ld = argmax(sh);
  if (ld === fac) return sh[fac] - Math.max(...FACS.filter((x) => x !== fac).map((x) => sh[x]));
  return sh[fac] - sh[ld];
}

function frontierOf(own, adj, faction) {
  const f = INV[faction], out = [];
  for (const [fid, o] of own) {
    if (o !== f) continue;
    for (const nb of nbrs(adj, fid)) {
      const v = get(own, nb, o);
      if (v !== f && v !== 0) { out.push(fid); break; }
    }
  }
  return out;
}

function enemyFrontierOf(own, adj, faction) {
  const f = INV[faction], out = [];
  for (const [fid, o] of own) {
    if (o === f || o === 0) continue;
    for (const nb of nbrs(adj, fid)) {
      if (own.get(nb) === f) { out.push([fid, FAC[o]]); break; }
    }
  }
  return out;
}

function warShape(own, adj) {
  const pair = new Map();
  for (const [fid, o] of own) {
    for (const nb of nbrs(adj, fid)) {
      const o2 = get(own, nb, 0);
      if (o !== o2 && o !== 0 && o2 !== 0) {
        const key = Math.min(o, o2) + "," + Math.max(o, o2);
        pair.set(key, (pair.get(key) || 0) + 1);
      }
    }
  }
  const out = {};
  for (const f of [1, 2, 3]) {
    const press = new Map();
    for (const [key, n] of pair) {
      const [a, b] = key.split(",").map(Number);
      if (a === f) press.set(b, Math.floor(n / 2));
      else if (b === f) press.set(a, Math.floor(n / 2));
    }
    let total = 0;
    const borders = [];
    for (const [k, v] of press) { borders.push([FAC[k], v]); total += v; }
    out[FAC[f]] = { borders, total };
  }
  return out;
}

function warShapeStr(ws, f) {
  const { borders, total } = ws[f];
  if (total === 0) return "no borders";
  const parts = [...borders].sort((x, y) => y[1] - x[1]);
  const desc = parts.map(([e, n]) => `${e} ${n}`).join(", ");
  if (parts.length >= 2 && parts[0][1] >= total * 0.65) return `1v1 LOCKED vs ${parts[0][0]} (${desc})`;
  if (parts.length >= 2) return `two-front (${desc})`;
  return `vs ${parts[0][0]} (${desc})`;
}

function heatScore(fid, flips, nowTs, adj, windowMin = 4) {
  if (!flips.length) return 0;
  const cutoff = nowTs - windowMin * 60;
  const neighbors = new Set(nbrs(adj, fid).map(String));
  let score = 0;
  for (const [ts, , , fac] of flips) {
    if (ts < cutoff) continue;
    const ageMin = (nowTs - ts) / 60;
    const decay = Math.max(0, 1 - ageMin / windowMin);
    if (String(fac) === String(fid)) score += 100 * decay;
    else if (neighbors.has(String(fac))) score += 40 * decay;
  }
  return Math.min(100, pyRound(score));
}

function fightUpSignal(flips, start, target, sh) {
  const order = [...FACS].sort((a, b) => sh[b] - sh[a]);
  const [leader, second, third] = order;
  const ranks = ["leader", "2nd", "3rd"];
  const freshW0 = Math.max(start, target - FIGHT_UP_WINDOW_MIN * 60);
  let chosen = null;
  for (const [w0, wlabel] of [[freshW0, `last ${FIGHT_UP_WINDOW_MIN}m`], [start, "since alert start"]]) {
    const win = flips.filter((f) => w0 <= f[0] && f[0] <= target);
    const byFac = new Map();
    for (const [, nw, old] of win) {
      if (!byFac.has(nw)) byFac.set(nw, new Map());
      const m = byFac.get(nw);
      m.set(old, (m.get(old) || 0) + 1);
    }
    const n2 = byFac.has(second) ? [...byFac.get(second).values()].reduce((s, v) => s + v, 0) : 0;
    chosen = { wlabel, win, byFac, n2 };
    if (n2 >= FIGHT_UP_MIN_FLIPS) break;
  }
  const { wlabel, win, byFac, n2 } = chosen;
  let freshNote = null;
  if (wlabel === "since alert start") {
    const fresh = flips.filter((f) => freshW0 <= f[0] && f[0] <= target && f[1] === second);
    if (fresh.length >= 3) {
      const fs = fresh.filter((f) => f[2] === leader).length / fresh.length;
      const trend = fs >= 0.5 ? "pivot toward the leader underway" : "still fighting downward";
      freshNote = `  recent ${FIGHT_UP_WINDOW_MIN}m: ${pct0(fs)} of ${second} captures from ${leader} (n=${fresh.length}) — ${trend}.`;
    }
  }
  const lines = [`TARGET SELECTION (${wlabel}, n=${win.length} directed flips):`];
  order.forEach((f, rank) => {
    const m = byFac.get(f) || new Map();
    const tot = [...m.values()].reduce((s, v) => s + v, 0);
    if (!tot) { lines.push(`  ${f} (${ranks[rank]}): no observed captures`); return; }
    const parts = [...m.keys()].sort((a, b) => m.get(b) - m.get(a)).map((v) => `${pct0(m.get(v) / tot)} from ${v}`).join(", ");
    lines.push(`  ${f} (${ranks[rank]}): ${tot} ${tot === 1 ? "capture" : "captures"} — ${parts}`);
  });
  let deviation = null;
  if (n2 >= FIGHT_UP_MIN_FLIPS) {
    const shareLeader = ((byFac.get(second) && byFac.get(second).get(leader)) || 0) / n2;
    if (shareLeader < 0.5) {
      deviation = { second, leader, third, share_leader: shareLeader, n: n2 };
      lines.push(`  DEVIATION: ${second} is fighting DOWNWARD — only ${pct0(shareLeader)} of captures from leader ${leader} ` +
        `(baseline ~${pct0(FIGHT_UP_BASELINE)} fight upward). ${leader} under less pressure than usual; expect normalization toward ${leader}.`);
    } else {
      lines.push(`  ${second} pressuring the leader normally (${pct0(shareLeader)} of captures from ${leader}, baseline ~${pct0(FIGHT_UP_BASELINE)}).`);
    }
  } else {
    lines.push(`  (insufficient flip data to judge the fight-up pattern, n=${n2})`);
  }
  if (freshNote) lines.push(freshNote);
  return { lines, deviation };
}

function warpgatesByOwner(own, names) {
  const wg = new Map();
  for (const [fid, n] of Object.entries(names)) {
    if (!n.toLowerCase().includes("warpgate")) continue;
    const o = own.get(fid);
    if (o) { if (!wg.has(o)) wg.set(o, []); wg.get(o).push(fid); }
  }
  return wg;
}

function findCutPoints(own, adj, names) {
  const cuts = new Map();
  for (const [fo, wgFids] of warpgatesByOwner(own, names)) {
    const factionFids = new Set([...own].filter(([, o]) => o === fo).map(([fid]) => fid));
    if (!factionFids.size) continue;
    const disc = new Map(), low = new Map(), parent = new Map(), ap = new Set();
    let time = 0;
    const dfs = (u) => {
      disc.set(u, time); low.set(u, time); time++;
      let children = 0;
      for (const v of nbrs(adj, u)) {
        if (own.get(v) !== fo) continue;
        if (!disc.has(v)) {
          parent.set(v, u); children++;
          dfs(v);
          low.set(u, Math.min(low.get(u), low.get(v)));
          if (parent.get(u) != null && low.get(v) >= disc.get(u)) ap.add(u);
        } else if (v !== parent.get(u)) {
          low.set(u, Math.min(low.get(u), disc.get(v)));
        }
      }
      if (parent.get(u) == null && children > 1) ap.add(u);
    };
    for (const s of wgFids) {
      if (!disc.has(s) && own.get(s) === fo) { parent.set(s, null); dfs(s); }
    }
    const connectedWithAp = new Set([...factionFids].filter((f) => disc.has(f)));
    const apCuts = [];
    for (const apFid of ap) {
      const seen = new Set();
      const stack = wgFids.filter((w) => w !== apFid && own.get(w) === fo);
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur) || cur === apFid) continue;
        seen.add(cur);
        for (const nb of nbrs(adj, cur)) if (!seen.has(nb) && nb !== apFid && own.get(nb) === fo) stack.push(nb);
      }
      const severed = [...connectedWithAp].filter((f) => !seen.has(f) && f !== apFid);
      if (severed.length && !wgFids.includes(apFid)) apCuts.push([apFid, severed.length, severed]);
    }
    apCuts.sort((a, b) => b[1] - a[1]);
    if (apCuts.length) cuts.set(fo, apCuts);
  }
  return cuts;
}

function warpgateConnected(own, adj, names) {
  const connected = new Map();
  for (const [fo, fids] of warpgatesByOwner(own, names)) {
    const seen = new Set(), stack = [...fids];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of nbrs(adj, cur)) if (!seen.has(nb) && own.get(nb) === fo) stack.push(nb);
    }
    connected.set(fo, seen);
  }
  return connected;
}

function pCapture(pf, fid, pressured = true) {
  const e = pf[`${fid}|${pressured ? "P1:pressured" : "P0:none"}`];
  return e ? e.p : pressured ? 0.33 : 0.18;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function holdFactor(res, fid, ref) {
  if (!res || ref == null) return 1.0;
  const e = res[String(fid)];
  if (!e || !e.median_hold_min) return 1.0;
  return ref / e.median_hold_min;
}

function rankedLive(sh, w0, own, adj, names, pf, winfn, flips, nowTs, res) {
  const locked = FACS.filter((f) => (w0[f] || 0) >= 100);
  const lockedWinner = locked.length ? locked[0] : null;
  let refMedian = null;
  if (res && Object.keys(res).length) {
    const holds = Object.values(res).map((v) => v.median_hold_min).filter((x) => x);
    if (holds.length) refMedian = median(holds);
  }
  const conn = warpgateConnected(own, adj, names);
  const cuts = findCutPoints(own, adj, names);
  const cutByFid = new Map();
  for (const list of cuts.values()) for (const [fid, n] of list) cutByFid.set(fid, n);
  const predHeat = new Map();
  if (flips.length && nowTs) {
    const hot = new Set();
    for (const fid of own.keys()) if (heatScore(fid, flips, nowTs, adj) >= 40) hot.add(fid);
    for (const fid of own.keys()) {
      if (hot.has(fid)) continue;
      let warming = 0;
      for (const nb of nbrs(adj, fid)) if (hot.has(nb)) warming = Math.max(warming, Math.min(60, 20 + nbrs(adj, nb).length * 5));
      if (warming) predHeat.set(fid, warming);
    }
  }
  const out = {};
  for (const f of FACS) {
    const fo = INV[f];
    const myConn = conn.get(fo);
    const attacks = [], defends = [];
    for (const [fid, enemy] of enemyFrontierOf(own, adj, f)) {
      const o2 = new Map(own); o2.set(fid, fo);
      const sh2 = shares(o2);
      const mGain = marginOf(sh2, f) - marginOf(sh, f);
      const pc = pCapture(pf, fid, true);
      const ev = pc * Math.max(0, mGain);
      const w2 = winfn(sh2);
      const mine = nbrs(adj, fid).filter((nb) => own.get(nb) === fo);
      const cut = myConn !== undefined && !mine.some((nb) => myConn.has(nb));
      const isBridge = myConn !== undefined && mine.some((nb) => myConn.has(nb)) && mine.some((nb) => !myConn.has(nb));
      const ownerConn = conn.get(INV[enemy]);
      const ownerCut = ownerConn !== undefined && !ownerConn.has(fid);
      attacks.push({ name: names[fid] || `#${fid}`, target: enemy, p_cap: pyRound(pc, 2), win_gain: pyRound(w2[f] - w0[f], 1),
        margin_gain: pyRound(mGain, 2), ev: pyRound(ev, 3), heat: heatScore(fid, flips, nowTs, adj), pred_heat: predHeat.get(fid) || 0,
        cut_off: cut, reconnect: isBridge, owner_cut: ownerCut, cut_severs: cutByFid.get(fid) || 0 });
    }
    const freezing = new Set();
    for (const [apFid, , severed] of cuts.get(fo) || []) {
      const apHeat = heatScore(apFid, flips, nowTs, adj);
      const threatened = apHeat >= 30 || nbrs(adj, apFid).some((nb) => { const v = get(own, nb, fo); return v !== fo && v !== 0; });
      if (threatened) severed.forEach((s) => freezing.add(s));
    }
    for (const fid of frontierOf(own, adj, f)) {
      let taker = null;
      for (const nb of nbrs(adj, fid)) { const v = get(own, nb, fo); if (v !== fo && v !== 0) { taker = own.get(nb); break; } }
      if (taker === null) continue;
      const o2 = new Map(own); o2.set(fid, taker);
      const sh2 = shares(o2);
      const mLoss = marginOf(sh, f) - marginOf(sh2, f);
      const pl = pCapture(pf, fid, true);
      const rf = holdFactor(res, fid, refMedian);
      const ev = pl * Math.max(0, mLoss) * rf;
      const w2 = winfn(sh2);
      const cut = myConn !== undefined && !myConn.has(fid);
      const re = (res || {})[String(fid)] || {};
      defends.push({ name: names[fid] || `#${fid}`, attacker: FAC[taker], p_loss: pyRound(pl, 2), hold_factor: pyRound(rf, 2),
        resistance: re.class ?? null, median_hold_min: re.median_hold_min ?? null, win_drop: pyRound(w0[f] - w2[f], 1),
        margin_loss: pyRound(mLoss, 2), ev: pyRound(ev, 3), heat: cut ? 0 : heatScore(fid, flips, nowTs, adj),
        pred_heat: predHeat.get(fid) || 0, cut_off: cut, owner_cut: cut, freezing: freezing.has(fid) || cut });
    }
    attacks.sort((a, b) => (b.cut_severs - a.cut_severs) || ((b.reconnect ? 1 : 0) - (a.reconnect ? 1 : 0)) || (b.ev - a.ev));
    defends.sort((a, b) => b.ev - a.ev);
    for (const a of [...attacks, ...defends]) {
      if (a.owner_cut) a.heat = 0;
      delete a.owner_cut;
      if (a.cut_off) { delete a.cut_off; a.priority = 0; continue; }
      delete a.cut_off;
      const onWinner = lockedWinner && f !== lockedWinner && a.target === lockedWinner;
      const free = (a.p_cap || 0) >= 0.9;
      if (onWinner && !free) a.priority = 0;
      else {
        const delta = a.win_gain !== undefined ? a.win_gain : (a.win_drop !== undefined ? a.win_drop : 0);
        a.priority = pyRound(Math.max(0, Math.min(100, (100 * delta) / 10)));
      }
      if (a.reconnect) a.priority = Math.max(a.priority, 70);
      delete a.reconnect;
    }
    out[f] = { attack: attacks.slice(0, 3), defend: defends.slice(0, 3) };
  }
  return out;
}

function kingmakerLive(sh, w0, own, adj, names, winfn) {
  const out = {};
  for (const f of FACS) {
    const fo = INV[f];
    const others = FACS.filter((x) => x !== f);
    const cand = new Map();
    for (const [fid, o] of own) {
      if (o === fo || o === 0) continue;
      const owner = FAC[o];
      for (const nb of nbrs(adj, fid)) {
        const nbO = get(own, nb, 0);
        if (nbO === 0 || nbO === fo || nbO === o) continue;
        const challenger = FAC[nbO];
        if (!others.includes(owner) || !others.includes(challenger)) continue;
        if (!cand.has(fid)) cand.set(fid, [owner, challenger]);
      }
    }
    const seen = new Set(), clusters = [];
    for (const [fid, pair] of cand) {
      if (seen.has(fid)) continue;
      const stack = [fid], comp = [];
      seen.add(fid);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of nbrs(adj, cur)) {
          const p = cand.get(nb);
          if (p && !seen.has(nb) && p[0] === pair[0] && p[1] === pair[1]) { seen.add(nb); stack.push(nb); }
        }
      }
      clusters.push([pair, comp]);
    }
    const ops = [];
    for (const [[owner, challenger], fids] of clusters) {
      const o2 = new Map(own);
      for (const fid of fids) o2.set(fid, INV[challenger]);
      const w2 = winfn(shares(o2));
      const swing = w2[f] - w0[f];
      if (Math.abs(swing) >= 3) {
        ops.push({ bases: fids.map((x) => names[x] || `#${x}`), n: fids.length, holder: owner, challenger,
          my_now: pyRound(w0[f], 1), my_swing: pyRound(swing, 1) });
      }
    }
    ops.sort((a, b) => Math.abs(b.my_swing) - Math.abs(a.my_swing));
    out[f] = ops.slice(0, 3);
  }
  return out;
}

function kmText(k) {
  const b = k.bases[0] + (k.n > 1 ? ` ×${k.n}` : "");
  const now = k.my_now;
  const then = now + k.my_swing;
  const outcome = `your win ${f1(now)}% → ${f1(then)}%`;
  if (k.my_swing > 0) return `help ${k.challenger} take ${b} from ${k.holder}: ${outcome} (+${f1(k.my_swing)}%)`;
  return `keep ${k.holder} on ${b} vs ${k.challenger}: if ${k.challenger} takes it, ${outcome} (${f1(k.my_swing)}%)`;
}

function makeCommanderMath(nFac) {
  const pp = 100 / nFac;
  const maxSwing = (t, dur) => { const rem = dur - t; return rem > 0 ? LANES * Math.floor(rem / MIN_PER_BASE) * (2 * pp) : 0; };
  return { maxSwing };
}

function secondPlaceProbs(sh, w0, t, mom, maxSwing, dur) {
  const locked = FACS.filter((f) => (w0[f] || 0) >= 100);
  if (!locked.length) return null;
  const winner = locked[0];
  const [B, C] = FACS.filter((f) => f !== winner);
  const gap = sh[B] - sh[C];
  const ms = maxSwing(t, dur);
  const momEdge = ((mom[B] || 0) - (mom[C] || 0)) / 2;
  const adjGap = gap + momEdge * 0.5;
  if (Math.abs(adjGap) > ms) {
    const w2 = adjGap > 0 ? B : C, l2 = w2 === B ? C : B;
    return { [w2]: 100.0, [l2]: 0.0, locked: true };
  }
  if (ms === 0) return { [B]: 50.0, [C]: 50.0, locked: false }; // Python divides by zero here
  let pB = 50 + 50 * (adjGap / ms);
  pB = Math.max(1, Math.min(99, pyRound(pB, 1)));
  return { [B]: pB, [C]: pyRound(100 - pB, 1), locked: false };
}

function secondPlaceKingmaker(sh, w0, t, mom, own, adj, names, maxSwing, dur) {
  const locked = FACS.filter((f) => (w0[f] || 0) >= 100);
  if (!locked.length) return [];
  const W = locked[0];
  const [B, C] = FACS.filter((f) => f !== W);
  const wo = INV[W];
  const sp0 = secondPlaceProbs(sh, w0, t, mom, maxSwing, dur);
  if (!sp0) return [];
  const ops = [];
  for (const [fid, o] of own) {
    const owner = FAC[o];
    if (owner !== B && owner !== C) continue;
    if (!nbrs(adj, fid).some((nb) => own.get(nb) === wo)) continue;
    const o2 = new Map(own); o2.set(fid, wo);
    const sp2 = secondPlaceProbs(shares(o2), w0, t, mom, maxSwing, dur);
    if (!sp2) continue;
    const beneficiary = owner === B ? C : B;
    const swing = (sp2[beneficiary] || 0) - (sp0[beneficiary] || 0);
    if (Math.abs(swing) >= 2) ops.push({ bases: [names[fid] || `#${fid}`], n: 1, holder: owner, beneficiary, by: W, swing: pyRound(swing, 1) });
  }
  ops.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
  return ops.slice(0, 3);
}

const spKmText = (k) => `${k.by} takes ${k.bases[0]} from ${k.holder}: ${k.swing > 0 ? "+" : ""}${f1(k.swing)}% ${k.beneficiary} second place`;

/** Region snapshot {region: faction} -> Map fid -> faction int (commander_live.snapshot_ownership). */
export function ownership(facilities, r2f) {
  const own = new Map();
  for (const [rid, f] of Object.entries(facilities || {})) {
    const fid = r2f[String(rid)];
    if (fid === undefined) continue;
    const v = parseInt(f, 10);
    if (!Number.isNaN(v)) own.set(fid, v);
  }
  return own;
}

/** links [{facility_id_a, facility_id_b}] -> Map fid -> [fid] in file order, de-duplicated. */
export function buildAdjacency(links) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); const l = adj.get(a); if (!l.includes(b)) l.push(b); };
  for (const l of links) { const a = String(l.facility_id_a), b = String(l.facility_id_b); add(a, b); add(b, a); }
  return adj;
}

/**
 * commander_live.main() --json, for one live alert.
 * getBin(b) -> {bin, xbin} (same tree as the odds engine).
 */
export function runCommander({ world, zone, startTs, t, dur, own, own15, flips, lattice, pf = {}, res = {}, getBin }) {
  if (!own || !own.size) return null;
  t = Math.max(t, 0);
  const target = startTs + t * 60;
  const { maxSwing } = makeCommanderMath(own.size);
  const sh = shares(own);
  const sh15 = own15 && own15.size ? shares(own15) : sh;
  const mom = Object.fromEntries(FACS.map((f) => [f, sh[f] - sh15[f]]));
  const b = timeBin(t, dur);
  const { bin, xbin } = getBin(b);
  const raw = (s) => {
    const r = {};
    for (const f of FACS) {
      const others = FACS.filter((k) => k !== f);
      const marg = s[f] - Math.max(...others.map((k) => s[k]));
      const rival = argmax(s, others);
      const [p] = lookup(bin, xbin, b, f, s[f], mom[f], marg, rival);
      r[f] = p !== null ? p : 0.0;
    }
    return r;
  };
  const winfn = (s) => {
    const r = raw(s);
    const tot = FACS.reduce((a, f) => a + r[f], 0) || 1;
    return Object.fromEntries(FACS.map((f) => [f, (100 * r[f]) / tot]));
  };
  const w0 = raw(sh);
  const w0j = winfn(sh);
  const { adj, names } = lattice;
  const leader = argmax(sh);
  const fu = fightUpSignal(flips, startTs, target, sh);
  // heat only ever counts flips from the last 4 minutes: pre-filter once (same results).
  const nowTs = Math.trunc(target);
  const recent = flips.filter((f) => f[0] >= nowTs - 4 * 60);
  const elim = Object.fromEntries(FACS.map((f) => [f, f === leader ? false : maxSwing(t, dur) < sh[leader] - sh[f]]));
  const ws = warShape(own, adj);
  const ranked = rankedLive(sh, w0j, own, adj, names, pf, winfn, recent, nowTs, res);
  const km = kingmakerLive(sh, w0j, own, adj, names, winfn);
  const sp = secondPlaceProbs(sh, w0, t, mom, maxSwing, dur);
  const spKm = secondPlaceKingmaker(sh, w0, t, mom, own, adj, names, maxSwing, dur);

  const out = { t: Math.trunc(t), world, zone, start_ts: startTs, leader, factions: {} };
  if (sp) out.second_place = sp;
  if (spKm.length) {
    out.second_place_kingmaker = spKm.map((k) => ({ text: spKmText(k), swing: k.swing, bases: k.bases, holder: k.holder, beneficiary: k.beneficiary, by: k.by }));
  }
  for (const f of FACS) {
    out.factions[f] = {
      win_pct: pyRound(w0j[f], 1),
      terr_pct: pyRound(sh[f], 1),
      war_shape: warShapeStr(ws, f),
      eliminated: !!elim[f],
      defend: ranked[f].defend.map((d) => ({ name: d.name, vs: d.attacker, win_drop: pyRound(d.win_drop, 1), p_loss: pyRound(d.p_loss, 2),
        ev: pyRound(d.ev, 2), priority: d.priority || 0, heat: d.heat || 0, pred_heat: d.pred_heat || 0, freezing: !!d.freezing,
        hold_factor: d.hold_factor ?? 1.0, resistance: d.resistance ?? null, median_hold_min: d.median_hold_min ?? null })),
      attack: ranked[f].attack.map((a) => ({ name: a.name, target: a.target, win_gain: pyRound(a.win_gain, 1), margin_gain: pyRound(a.margin_gain, 1),
        p_cap: pyRound(a.p_cap, 2), ev: pyRound(a.ev, 2), priority: a.priority || 0, heat: a.heat || 0, pred_heat: a.pred_heat || 0,
        cut_severs: Math.trunc(a.cut_severs || 0) })),
      kingmaker: km[f].slice(0, 3).map((k) => ({ text: kmText(k), my_swing: pyRound(k.my_swing, 1) })),
    };
  }
  out.fight_up = fu.deviation
    ? { leader: fu.deviation.leader, second: fu.deviation.second, third: fu.deviation.third, deviation: true, text: fu.lines.join("\n") }
    : { deviation: false, text: fu.lines.join("\n") };
  return out;
}
