// weapon-traits.mjs: the few numbers that say how to fight with a weapon, from the Census data the site
// already has (no DOM, no i18n). Used by the guide page (weapon-guide.mjs) and the comparison page.
//
// Reach = how far every shot still lands on the body: the cone half-angle reaches the 0.3 m body
// half-width (the simulator's target) at 0.3 / tan(cone / 2). It is the honest "accurate to" distance
// of a stance: past it some shots miss even with perfect aim. Cones are the stance minimums (the first
// shot); bloom only makes them wider.
//
// Census stances (player_state_id): 0 standing, 1 crouching, 2 running (= moving), 5 crouch-moving,
// 4 "Falling Long" (in the air: jumping or falling). The air row sits at the weapon's widest cone (the
// largest cof_max of its other stances) on every group checked against Census on 2026-11-22 (SMG-46
// Armistice, NC1 Gauss Rifle, NSX Naginata, NSX Kappa, NC6 Gauss SAW, SR-7, NC4 Mag-Shot: hip 7°, ADS
// 2–3°), so when a data file has no row 4 (recoil.json before the slim kept it) that maximum stands in.
export const BODY_HALF = 0.3;

/** Metres at which a cone of `deg` degrees (full angle) is as wide as the body. Infinity for no cone. */
export const reachOf = (deg) => (deg > 0 ? BODY_HALF / Math.tan((deg / 2) * Math.PI / 180) : Infinity);

const row = (states, id) => (states || []).find((r) => r.player_state_id === id) || null;
const minOf = (states, id) => { const r = row(states, id); return r && r.cof_min != null ? +r.cof_min : null; };
const airOf = (states) => {
  const r = row(states, 4);
  if (r) return +r.cof_min;
  const maxes = (states || []).map((x) => +x.cof_max).filter(Number.isFinite);
  return maxes.length ? Math.max(...maxes) : null;
};

/** The seven ways to fire, best first: [{ way, ads, cone, reach }]. ADS ways only when the weapon can aim.
 *  spread = { hip, ads } pellet spread in degrees (shotguns): pellets scatter around the cone's aim point,
 *  so the spread widens every way (without it a shotgun's 0.5° cone would read "accurate to 69 m"). */
export function fireWays(hipStates, adsStates, spread = {}) {
  const out = [];
  const add = (way, ads, cone) => {
    if (cone == null || !Number.isFinite(cone)) return;
    const c = cone + (+(ads ? spread.ads : spread.hip) || 0);
    out.push({ way, ads, cone: c, reach: reachOf(c) });
  };
  if (adsStates && adsStates.length) {
    add("adsStill", true, minOf(adsStates, 0)); add("adsCrouch", true, minOf(adsStates, 1));
    add("adsMove", true, minOf(adsStates, 2)); add("adsAir", true, airOf(adsStates));
  }
  add("hipStill", false, minOf(hipStates, 0)); add("hipMove", false, minOf(hipStates, 2)); add("hipAir", false, airOf(hipStates));
  return out.sort((a, b) => a.cone - b.cone || (a.ads === b.ads ? 0 : a.ads ? 1 : -1));
}

/** How much wider the aimed cone gets when moving: 1 = strafing is free. null without ADS data. */
export function moveCost(adsStates) {
  const s = minOf(adsStates, 0), m = minOf(adsStates, 2);
  if (s == null || m == null) return null;
  return s > 0 ? m / s : m > 0 ? Infinity : 1;
}

/** The short verdict for one weapon: { ads, strafeFree, moveX, hipM, adsMoveM, airM, airX, adsMs, best, ways }.
 *  airX compares the air with the way you would otherwise fire on the move (ADS moving, or hip moving). */
export function verdict(hipStates, adsStates, handling, spread = {}) {
  const ways = fireWays(hipStates, adsStates, spread);
  const get = (w) => ways.find((x) => x.way === w) || null;
  const ads = !!get("adsStill");
  const moveX = ads ? moveCost(adsStates) : null;
  const adsMove = get("adsMove"), hipMove = get("hipMove"), air = get(ads ? "adsAir" : "hipAir");
  const ground = ads ? adsMove : hipMove;
  return {
    ads,
    strafeFree: moveX != null && moveX <= 1.0001,
    moveX,
    adsMoveM: adsMove ? adsMove.reach : null,
    hipM: hipMove ? hipMove.reach : null,
    airM: air ? air.reach : null,
    airX: air && ground && ground.cone > 0 ? air.cone / ground.cone : null,
    adsMs: handling && handling.to_iron_sights_ms != null ? +handling.to_iron_sights_ms : null,
    best: ways[0] || null,
    ways,
  };
}

/** Share of ranges each weapon wins: winners = winnerStrip output (index, or -1 for a tie / no kill). */
export function rangeShares(winners, n) {
  const out = new Array(n).fill(0);
  if (!winners.length) return out;
  for (const w of winners) if (w >= 0) out[w]++;
  return out.map((c) => c / winners.length);
}

/**
 * One weapon against its whole class over the same ranges. curves = [weapon][range] TTK (null = no kill),
 * me = index of the weapon. best = share of ranges where it is the fastest (ties count: many weapons share
 * one damage model), near = within `tol` of the fastest, band = the longest run of ranges where it is near
 * ({ from, to } in range indices, or null).
 */
export function classStanding(curves, me, tol = 0.1) {
  const n = curves[me] ? curves[me].length : 0;
  let best = 0, near = 0, run = null, top = null;
  for (let k = 0; k < n; k++) {
    const v = curves[me][k];
    let low = Infinity;
    for (const c of curves) if (c[k] != null && c[k] < low) low = c[k];
    const isBest = v != null && v <= low * 1.005;
    const isNear = v != null && v <= low * (1 + tol);
    if (isBest) best++;
    if (isNear) { near++; run = run ? { from: run.from, to: k } : { from: k, to: k }; if (!top || run.to - run.from > top.to - top.from) top = { ...run }; }
    else run = null;
  }
  return { best: n ? best / n : 0, near: n ? near / n : 0, band: top };
}

/** Lower-case slug of a weapon name, the way the old guide pages were named (weapon-sage-<slug>.html). */
export const slugOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
