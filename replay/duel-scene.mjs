/**
 * 🎬 Duel scene helpers (replay #98): pure lookups over a duel plan
 * (replay/duel-plan.mjs) for the pair scene — HP bars, spark colors,
 * score, lives and soldier states. No DOM, no canvas here; player.js
 * renders what these return.
 *
 * HP traces: engage() snapshots BOTH sides' HP after every shot, plus one
 * extra reset snapshot at the commit start (both back to full). So a
 * shot's own snapshot sits at index shotIdx + 1 once the commit starts
 * (commit shots and the loser's deferred return fire, which also lands in
 * the commit window); trade shots sit at their own index. sparkFor uses
 * that offset, never a time guess.
 */
const FULL = (cls) => ({ shield: 500, health: cls === "max" ? 2000 : 500, over: 0 });
const SHIELD_MAX = (cls) => 500 + (cls === "ha" ? 450 : 0);
const HEALTH_MAX = (cls) => (cls === "max" ? 2000 : 500);

/** HP snapshot [t, shield, health, over] for `side` at time t (full before the first snapshot). */
export function hpAt(eng, t, side) {
  const snaps = eng.hp?.[side] ?? [];
  let cur = null;
  for (const s of snaps) { if (s[0] <= t) cur = s; else break; }
  if (!cur) return FULL(eng[side === "a" ? "aClass" : "bClass"]);
  return { shield: cur[1], health: cur[2], over: cur[3] };
}
/** Bar fractions { shield, health } in [0, 1] from a snapshot + class. */
export function barFracs(snap, cls) {
  return {
    shield: Math.max(0, Math.min(1, (snap.shield + snap.over) / SHIELD_MAX(cls))),
    health: Math.max(0, Math.min(1, snap.health / HEALTH_MAX(cls))),
  };
}
/** Spark color for a hit shot: blue when it ate shield/overshield, red when it ate health. Null for misses. */
export function sparkFor(eng, shotIdx) {
  const shot = eng.shots[shotIdx];
  if (!shot || !shot.hit) return null;
  const victim = shot.from === "a" ? "b" : "a";
  const snaps = eng.hp?.[victim] ?? [];
  const commitT0 = eng.segments.find((s) => s.phase === "commit")?.t0 ?? null;
  const off = commitT0 != null && shot.t >= commitT0 - 1e-9 ? 1 : 0;
  const after = snaps[shotIdx + off];
  if (!after) return null;
  const before = snaps[shotIdx + off - 1] ?? [0, 500, eng[victim === "a" ? "aClass" : "bClass"] === "max" ? 2000 : 500, 0];
  const shieldBefore = before[1] + before[3], shieldAfter = after[1] + after[3];
  if (shieldAfter < shieldBefore) return "#4aa8ff"; // blue: shield hit
  if (after[2] < before[2]) return "#ff5a4a"; // red: health hit
  return null;
}
/** Session duel score { a, b } from decisive kills with killAt <= t. */
export function scoreAt(plan, t) {
  let a = 0, b = 0;
  for (const e of plan.engagements) {
    if (e.killAt == null || e.killAt > t) continue;
    if (e.outcome === "a") a++;
    else if (e.outcome === "b") b++;
  }
  return { a, b };
}
/** Engagement covering t, or null. */
export function engagementAt(plan, t) {
  return plan.engagements.find((e) => e.t0 <= t && t < e.t1) ?? null;
}
/** Current life for `side` at t, or null while dead between lives. */
export function lifeAt(plan, side, t) {
  return plan.lives[side].find((l) => l.start <= t && t < l.end) ?? null;
}
/** Soldier state for a plan phase (resolution: loser dies, winner idles). */
export function phaseState(phase, side, eng) {
  if (phase === "approach") return "run";
  if (phase === "spot") return "idle";
  if (phase === "trade" || phase === "commit") return "shoot";
  if (phase === "resolution") return eng.victim === side ? "die" : "idle";
  return "idle"; // aftermath
}
/** Killcam data for a decisive engagement (killer doc supplies weapon name + icon).
 * A real-fight engagement (#101) carries its own weaponDoc (the weapon of that
 * kill, not the killer's main weapon) — it wins over the doc. */
export function killcamFor(eng, killerDoc) {
  const killer = eng.outcome;
  const shots = eng.shots.filter((s) => s.from === killer);
  const hits = shots.filter((s) => s.hit);
  const first = eng.shots.length ? eng.shots[0].t : eng.killAt;
  return {
    killer, victim: eng.victim,
    weapon: eng.weaponDoc ? { name: eng.weaponDoc.name, img: eng.weaponDoc.img }
      : killerDoc?.main ? { name: killerDoc.main.name, img: killerDoc.main.img } : null,
    hits: hits.length, hs: hits.filter((s) => s.hs).length,
    ttk: eng.killAt != null ? Math.max(0, eng.killAt - first) : 0,
  };
}
