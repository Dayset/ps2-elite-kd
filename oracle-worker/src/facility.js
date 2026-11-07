// Capture Facility Alerts (#114 follow-up, owner 2026-11-07: "it is an alert, work with it as usual
// despite low history"). Dome Domination (Biolabs), Technological Advancement (Tech Plants), Power Rush
// (AMP Stations): three target facilities; the faction holding all 3 wins at once, otherwise the one
// holding the most when the 45-min clock runs out (all 14 alerts measured 2026-11-06/07 ran the full
// 45 min, and every Census end row matched the target owners on our map 45-60 s before the end).
//
// Odds model (measured, small sample — recalibrate as the "facility" benchmark pool grows):
//   - each target changes hands at FAC_LAMBDA per minute (22 flips over 1,848 facility-minutes,
//     the start reset and the end lock left out), to either enemy with equal chance; a neutral
//     target goes to any faction with equal chance;
//   - end-owner distribution per target from that 3-state chain, then the exact winner over the
//     27 end combinations (ties split).
//   In-sample Brier on those 14 alerts: t0 0.220, t15 0.208, t30 0.104 (coin flip 0.222).
// The AI Commander's move per faction: the target whose capture (or loss) moves that faction's odds
// most, attacks only where the faction owns a lattice neighbour (it needs a way in).

export const FAC_LAMBDA = 0.012;
export const FACS3 = ["VS", "NC", "TR"];

// Targets per zone and alert type. Generated from oracle/backend/<slug>_regions.json (facility types
// 2 AMP Station, 3 Bio Lab, 4 Tech Plant; Esamir's Power Rush = Freyr (2) + Baldur and Jord (16),
// confirmed against 3 Esamir end rows). test/oracle-facility.test.mjs keeps it in sync.
export const FACILITY_TARGETS = {
  2: { amp: [[3201, "Dahaka"], [3400, "Peris"], [118000, "Zurvan"]], biolab: [[3601, "Rashnu"], [3801, "Saurva"], [4001, "Allatum"]], tech: [[4401, "Mao"], [7000, "Tawrich"], [7500, "Hvar"]] },
  4: { amp: [[299000, "Naum"], [300000, "Hurakan"], [301000, "Ixtab"]], biolab: [[302000, "Acan"], [303000, "Bitol"], [304000, "Zotz"]], tech: [[305000, "Ghanan"], [306000, "Mulac"], [307000, "Chac"]] },
  6: { amp: [[204000, "Kwahtee"], [207000, "Sungrey"], [210000, "Wokuk"]], biolab: [[205000, "Ikanam"], [209000, "Onatha"], [212000, "Xelas"]], tech: [[206000, "Heyoka"], [208000, "Mekala"], [211000, "Tumas"]] },
  8: { amp: [[253000, "Freyr"], [400314, "Baldur"], [400317, "Jord"]] },
};

export const targetsFor = (zone, sub) => (FACILITY_TARGETS[zone & 0xffff] || {})[sub] || null;

/** End-owner distribution [VS, NC, TR] of one target held by `owner` ("VS"|"NC"|"TR"|null), T minutes left. */
export function endDist(owner, T, lam = FAC_LAMBDA) {
  const k = FACS3.indexOf(owner);
  if (k < 0) return [1 / 3, 1 / 3, 1 / 3];
  const same = 1 / 3 + (2 / 3) * Math.exp(-1.5 * lam * Math.max(0, T));
  const other = (1 - same) / 2;
  return FACS3.map((_, i) => (i === k ? same : other));
}

/** Win chances {VS, NC, TR} (0..1) from the three targets' owners and the minutes left. */
export function facilityWin(owners, T, lam = FAC_LAMBDA) {
  if (owners.length === 3 && owners[0] && owners.every((o) => o === owners[0])) {
    return Object.fromEntries(FACS3.map((f) => [f, f === owners[0] ? 1 : 0])); // all 3 held: won
  }
  const d = owners.map((o) => endDist(o, T, lam));
  const w = [0, 0, 0];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const p = d[0][a] * d[1][b] * d[2][c];
    const cnt = [0, 0, 0]; cnt[a]++; cnt[b]++; cnt[c]++;
    const m = Math.max(...cnt), win = [0, 1, 2].filter((i) => cnt[i] === m);
    for (const i of win) w[i] += p / win.length;
  }
  return Object.fromEntries(FACS3.map((f, i) => [f, w[i]]));
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Live facility-alert read.
 *  owners: { fid: "VS"|"NC"|"TR" } (the map's facility owners, buildState().owners)
 *  adj: Map fid -> [fid] (lattice) or null
 * Returns { targets: [{fid, name, owner}], count, win: {f: {pct}}, orders: {f: {move, fid, name, gain} | null} } or null.
 */
export function facilityState({ zone, sub, owners, t, dur, adj = null, lam = FAC_LAMBDA }) {
  const list = targetsFor(zone, sub);
  if (!list) return null;
  const T = Math.max(0, dur - t);
  const own = list.map(([fid]) => owners[fid] || null);
  const p = facilityWin(own, T, lam);
  const count = Object.fromEntries(FACS3.map((f) => [f, own.filter((o) => o === f).length]));
  const canAttack = (fid, f) => !adj || (adj.get(fid) || adj.get(String(fid)) || []).some((n) => owners[n] === f);
  const orders = {};
  for (const f of FACS3) {
    let best = null;
    list.forEach(([fid, name], i) => {
      if (own[i] === f) {
        // hold: what losing it to the likeliest enemy (the one that can reach it, else either) would cost
        const foes = FACS3.filter((g) => g !== f && canAttack(fid, g));
        const loss = Math.max(0, ...(foes.length ? foes : FACS3.filter((g) => g !== f)).map((g) => {
          const o2 = own.slice(); o2[i] = g; return p[f] - facilityWin(o2, T, lam)[f];
        }));
        if (!best || loss > best.gain) best = { move: "hold", fid, name, gain: loss };
      } else if (canAttack(fid, f)) {
        const o2 = own.slice(); o2[i] = f;
        const gain = facilityWin(o2, T, lam)[f] - p[f];
        if (!best || gain > best.gain) best = { move: "take", fid, name, gain };
      }
    });
    // now → then (owner: no percentage points): the faction's odds now and after the move lands
    // (for a hold, after losing the base: what the hold protects).
    orders[f] = best && best.gain >= 0.02 ? { ...best, gain: round1(best.gain * 100), now: round1(p[f] * 100),
      then: round1((best.move === "take" ? p[f] + best.gain : p[f] - best.gain) * 100) } : null;
  }
  return {
    sub, targets: list.map(([fid, name], i) => ({ fid, name, owner: own[i] })), count,
    win: Object.fromEntries(FACS3.map((f) => [f, { pct: round1(p[f] * 100) }])), orders,
  };
}

/** Score races we can't see live (Aerial Anomalies, Maximum Pressure): even odds until a model earns its place. */
export const evenWin = () => Object.fromEntries(FACS3.map((f) => [f, { pct: 33.3 }]));
