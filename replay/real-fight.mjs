// 🎬 Replay real fight (#101): one recorded fight between two players,
// from the cache Worker's pair store (duels.mjs fightsOf shape), as a
// duel-plan-shaped plan: kill order, killer, weapon, headshot, vehicle,
// both classes and the data gaps are the real ones; the shots in between
// come from engage() conditioned on each kill.
//
// Inputs: a, b: shooter() outputs (base profiles: each side's main weapon
// + lifetime stats). fight: { t0, t1, ev: [{t, aKill, w, hs, aL, bL, veh}] }
// (oldest first; t is epoch seconds). opts: { seed, weapon(id) →
// { profile, name, img } | null (the killer's weapon of that kill),
// classOf(loadout) → 'inf'|'la'|'med'|'eng'|'ha'|'max'|'', allies,
// aInfo, bInfo ({ revivedShare } for the winner's recovery roll) }.
// → { v: 1, real: true, t0: fight.t0, pA, params: { real: true },
//     thirdP: 0, breakP: 0, duration, lives, engagements, fights, cuts: [] }
//
// Timing: killAt[i] = killAt[0] + (ev[i].t - ev[0].t) — the real gaps,
// exactly, whenever the gap fits the engagement's lead-in (approach, spot,
// trade, commit) plus the previous resolution and the victim's respawn.
// The release valves, in order, are: previous aftermath → 0, respawn → 0,
// spot → 0.5 s, approach → 0.5 s. A gap tighter than the floored lead-in
// (under ~8 s — a victim cannot respawn and re-engage faster in-game)
// pushes that kill later than the real time; the plan records the shift
// on the engagement (killShift) so the deviation is visible, never silent.
//
// No breaks, no third parties, no revives: a real fight is just its kills,
// and the store carries no revive flag, so every return is a respawn.
// Classes come per kill from the event's loadouts; a life keeps the class
// it opened with (a class change without dying to the rival is invisible
// to the pair store — the player covers the viewed side with a
// per-engagement class event).
import { engage, shooter, mulberry } from "./engagement.mjs?v=20261103-real1";
import { rangeFor } from "./camera.mjs?v=20261103-cam1";
import { SHIELD, HEALTH, recoveryFor } from "./exchange.mjs?v=20261103-exch1";
import { deriveSeed } from "./duel-plan.mjs?v=20261103-real1";

const U = (rng, lo, hi) => lo + rng() * (hi - lo);

/**
 * planRealFight(a, b, fight, opts) — see the header. Throws on an empty fight.
 */
export function planRealFight(a, b, fight, opts = {}) {
  const ev = [...(fight?.ev || [])].sort((x, y) => x.t - y.t);
  if (!ev.length) throw new Error("planRealFight: empty fight");
  const seed = opts.seed ?? 12345;
  const rng = mulberry(seed);
  const weapon = opts.weapon || (() => null);
  const classOf = opts.classOf || (() => "");
  const info = { a: opts.aInfo || {}, b: opts.bInfo || {} };

  const lives = { a: [], b: [] };
  const engagements = [];
  const fightKills = [];
  // Current life per side: { cls, start }. Both open at 0 with the first
  // kill's classes; a death closes the victim's life in the same iteration,
  // the next iteration reopens it with that engagement's class.
  let life = {
    a: { cls: classOf(ev[0].aL) || null, start: 0 },
    b: { cls: classOf(ev[0].bL) || null, start: 0 },
  };
  let pendingDeath = null; // { side, at } — the victim of the previous kill
  let prev = null; // previous engagement + its preferred aftermath length
  let firstKillPlan = null, prevKillActual = null;

  const intent = (side, phase, eng) => {
    const cls = eng[side === "a" ? "aClass" : "bClass"];
    if (phase === "approach") return cls === "la" ? "flank" : side === eng.outcome ? "push" : "cover";
    if (phase === "spot") return "cover";
    if (phase === "trade") return side === eng.outcome ? "push" : "cover";
    if (phase === "commit") return "push";
    if (phase === "resolution") return side === eng.outcome ? "push" : "retreat";
    if (phase === "aftermath") {
      if (side === eng.outcome && cls === "med") return "heal";
      if (cls === "eng" && (info[side].resupplyPm ?? 0) > 0) return "ammo";
      return side === eng.outcome ? "reload" : "retreat";
    }
    return "cover";
  };
  // The previous engagement's aftermath is finalized once the next gap is
  // known: its preferred length (recovery, else base), clamped to what the
  // gap leaves after the floors. The last engagement runs at full length.
  const finalizeAftermath = (eng, aftermathDur) => {
    const at = eng.tResolve + 0.5;
    if (eng.recovery) {
      let t = at;
      for (const st of eng.recovery.steps) {
        eng.segments.push({ phase: "aftermath", rec: st.id, t0: t, t1: t + st.dur,
          aIntent: intent("a", "aftermath", eng), bIntent: intent("b", "aftermath", eng) });
        t += st.dur;
      }
      eng.t1 = t;
    } else {
      eng.segments.push({ phase: "aftermath", t0: at, t1: at + aftermathDur,
        aIntent: intent("a", "aftermath", eng), bIntent: intent("b", "aftermath", eng) });
      eng.t1 = at + aftermathDur;
    }
  };

  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    const winner = e.aKill ? "a" : "b", victim = winner === "a" ? "b" : "a";
    const aClass = classOf(e.aL) || null, bClass = classOf(e.bL) || null;
    const w = weapon(e.w);
    const shooterOf = (side) => {
      const s = side === "a" ? a : b;
      return shooter(side === winner && w?.profile ? w.profile : s.profile,
        { spk: s.spk, hpk: s.hpk, hsr: s.hsr, kd: s.kd, cls: side === "a" ? aClass : bClass });
    };
    const eng = engage(shooterOf("a"), shooterOf("b"), mulberry(deriveSeed(seed, i)),
      { outcome: winner, wA: 0.5, victim, rangeFor, hsKill: e.hs ? true : false });
    const commitShots = eng.shots.filter((s) => s.phase === "commit");
    const tradeDur = commitShots.length
      ? Math.min(...commitShots.map((s) => s.t)) - 0.5
      : eng.shots.filter((s) => s.phase === "trade").reduce((mx, s) => Math.max(mx, s.t), 0);
    const commitDur = eng.killAt != null ? eng.killAt - (tradeDur + 0.5) : 0;

    // Winner's recovery (same rule as planDuel: hurt winners recover in
    // the aftermath; the base draw always runs so the stream stays aligned).
    const baseAftermath = U(rng, 1, 3);
    let recovery = null;
    {
      const snaps = eng.hp[winner] || [];
      const end = [...snaps].reverse().find(([t]) => t <= eng.killAt);
      const shield = end ? end[1] : SHIELD, health = end ? end[2] : HEALTH;
      recovery = recoveryFor({ shield, health, healthMax: (winner === "a" ? aClass : bClass) === "max" ? 2000 : HEALTH,
        allies: opts.allies ?? 0, revivedShare: info[winner].revivedShare ?? 0.3, r: mulberry(deriveSeed(seed, 100000 + i)) });
    }
    const prefAftermath = recovery ? recovery.dur : baseAftermath;

    let t0, approachDur, spot, respawnSide = null, respawnDur = 0, killShift = 0;
    if (i === 0) {
      approachDur = U(rng, 3, 8);
      spot = U(rng, 1, 3);
      t0 = 0;
    } else {
      // Kill-to-kill against the previous ACTUAL kill time; the valves
      // release in order: previous aftermath, respawn, spot, approach.
      const target = firstKillPlan + (ev[i].t - ev[0].t);
      const realGap = target - prevKillActual;
      const after = Math.max(0, Math.min(prev.prefAftermath, realGap - 0.5 - 0.5 - 0.5 - tradeDur - 0.5 - commitDur));
      const resp = Math.max(0, Math.min(U(rng, 5, 10), realGap - 0.5 - after - 0.5 - 0.5 - tradeDur - 0.5 - commitDur));
      const spt = Math.min(U(rng, 1, 3), Math.max(0.5, realGap - 0.5 - after - resp - 0.5 - tradeDur - 0.5 - commitDur));
      let appr = realGap - 0.5 - after - resp - spt - tradeDur - 0.5 - commitDur;
      if (appr < 0.5) { killShift = 0.5 - appr; appr = 0.5; }
      finalizeAftermath(prev.eng, after);
      spot = spt; approachDur = appr; respawnDur = resp; respawnSide = victim;
      t0 = prev.eng.t1 + respawnDur;
      // The victim returns for this engagement with this kill's class.
      life[victim] = { cls: victim === "a" ? aClass : bClass, start: prevKillActual + respawnDur };
    }
    const tSpot = t0 + approachDur, tTrade = tSpot + spot;
    const tResolve = tTrade + tradeDur + 0.5 + commitDur;
    const tKill = tResolve;
    if (i === 0) firstKillPlan = tKill;
    const engObj = {
      idx: i, fightIdx: 0, t0, t1: 0, outcome: winner, victim, revived: false, respawnSide, respawnDur,
      aClass, bClass, segments: [], shots: [], recovery,
      killAt: tKill, tradeDur, commitDur: Math.max(0, commitDur), tResolve,
      hp: { a: eng.hp.a.map(([t, s, h, o]) => [t + tTrade, s, h, o]), b: eng.hp.b.map(([t, s, h, o]) => [t + tTrade, s, h, o]) },
      weapon: e.w, weaponDoc: w?.name ? { name: w.name, img: w.img ?? null } : null,
      veh: e.veh || 0, hs: !!e.hs, realT: e.t, killShift,
    };
    engObj.segments.push(
      { phase: "approach", t0, t1: tSpot, aIntent: intent("a", "approach", engObj), bIntent: intent("b", "approach", engObj) },
      { phase: "spot", t0: tSpot, t1: tTrade, aIntent: intent("a", "spot", engObj), bIntent: intent("b", "spot", engObj) },
      { phase: "trade", t0: tTrade, t1: tTrade + tradeDur, aIntent: intent("a", "trade", engObj), bIntent: intent("b", "trade", engObj) },
      { phase: "commit", t0: tTrade + tradeDur + 0.5, t1: tResolve, aIntent: intent("a", "commit", engObj), bIntent: intent("b", "commit", engObj) },
      { phase: "resolution", t0: tResolve, t1: tResolve + 0.5, aIntent: intent("a", "resolution", engObj), bIntent: intent("b", "resolution", engObj) },
    );
    engObj.shots = eng.shots.map((s) => ({ ...s, t: s.t + tTrade }));
    engagements.push(engObj);
    fightKills.push({ t: tKill, winner });
    // The death closes the victim's life now; the next iteration reopens it.
    lives[victim].push({ ...life[victim], end: tKill, deathBy: winner });
    pendingDeath = { side: victim, at: tKill };
    prev = { eng: engObj, prefAftermath };
    prevKillActual = tKill;
  }
  // Last engagement's aftermath runs at full length; a side that died in
  // the last engagement stays dead (already closed, like planDuel).
  finalizeAftermath(prev.eng, prev.prefAftermath);
  const duration = prev.eng.t1;
  for (const side of ["a", "b"]) {
    if (pendingDeath && pendingDeath.side === side) continue;
    lives[side].push({ ...life[side], end: duration, deathBy: null });
  }
  const aKills = fightKills.filter((k) => k.winner === "a").length;
  return {
    v: 1, real: true, t0: ev[0].t, pA: fightKills.length ? aKills / fightKills.length : 0.5,
    params: { real: true }, thirdP: 0, breakP: 0, duration, lives, engagements,
    fights: [{ idx: 0, t0: 0, kills: fightKills, t1: duration }], cuts: [],
  };
}
