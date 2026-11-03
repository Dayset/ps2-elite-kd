// Planetman scene states: ONE table. Add a row here to add a state; the planner and the renderer
// pick it up. Keep timing honest: a state's frequency must come from a real per-minute stat (rate),
// or from the timeline itself (kind 'core'), never from a "looks nice" loop length.
//
//   id            key used by the planner / tests
//   label         text shown on the placeholder box (and in ?debug)
//   kind          'core'   = placed by the 1:1 timeline (deaths, fights, travel, respawn …)
//                 'filler' = placed into free time between fights, as often as `rate` says
//   source        where the frequency / duration comes from (shown in ?debug, used in README)
//   rate(st)      fillers only: events per real minute, from the player's stats (null = state off)
//   dur(r, st)    seconds; r() is the seeded random [0,1)
//   anim          Soldier state that already has art ('idle' | 'run' | 'shoot' | 'dead' | 'revive' | 'respawn')
//   placeholder   true = no art yet: a labelled box with a progress bar is drawn over the soldier
//   calm          true = after slow-mo, the clock may run up to 1.25× here to catch up with real time
//   hook          optional name of an existing visual in player.js (HOOKS) run on enter / each frame
//
// Stats object `st` (player.js): kpm, dpm, spk, hpk, hs, apk, veh, revive, fightMs, healPm, revivePm,
// resupplyPm, capturePm, repairPm, cls (class time shares).
export const STATES = {
  // ---- core: the life cycle (death → respawn / revive → travel → fights … → death)
  respawnTimer: { label: 'Respawn timer', kind: 'core', source: 'game rule: 5–10 s after a death that is not revived',
    dur: (r) => 5 + 5 * r(), anim: 'dead', placeholder: true, calm: true, countdown: true },
  beingRevived: { label: 'Being revived', kind: 'core', source: '🩹 revived share (Honu XP): share of deaths that end in a revive',
    dur: (r) => 3 + 3 * r(), anim: 'dead', placeholder: true, calm: true, hook: 'revivedBy' },
  respawn: { label: 'Spawning', kind: 'core', source: 'fixed 0.9 s beam (art)', dur: () => 0.9, anim: 'respawn' },
  running: { label: 'Running to fight', kind: 'core', source: '⏱ time to fight (death → next kill/assist, LIVE formula) minus the down time',
    anim: 'run', placeholder: true, calm: true, hook: 'travel' },
  idle: { label: 'Idle', kind: 'core', source: 'whatever real time is left between the events above', anim: 'idle', calm: true },
  reloading: { label: 'Reloading', kind: 'core', source: 'only after shooting, and only when the real gap to the next shot is ≥ its duration',
    dur: () => 2.4, anim: 'idle', hook: 'reload' },
  fight: { label: 'Fighting', kind: 'core', source: 'KPM (when), shots/kill + hits/kill (tracers), HS ratio (head pops)', anim: 'shoot' },
  assist: { label: 'Fighting (assist)', kind: 'core', source: 'KPM × assists/kill; a teammate lands the last hit', anim: 'shoot' },
  trading: { label: 'Trading shots', kind: 'core', source: 'leftover shots from the shots/kill budget (no kill)', anim: 'shoot' },
  inVehicle: { label: 'In vehicle', kind: 'core', source: 'vehicle share of kills; the vehicle stint covers those kills', anim: null, hook: 'tank' },
  dying: { label: 'Down', kind: 'core', source: 'DPM (deaths per real minute)', anim: 'shoot' },

  // ---- fillers: placed in free time, as often as their per-minute rate says
  healing: { label: 'Healing', kind: 'filler', source: 'heals given per minute (Honu XP 4, 51)',
    rate: (st) => st.healPm, dur: (r) => 2.5 + 1.5 * r(), anim: 'idle', placeholder: true, hook: 'healAlly' },
  reviving: { label: 'Reviving teammate', kind: 'filler', source: 'revives given per minute (Honu XP 7, 53)',
    rate: (st) => st.revivePm, dur: (r) => 2.5 + r(), anim: 'idle', placeholder: true, hook: 'healAlly' },
  resupplying: { label: 'Resupplying', kind: 'filler', source: 'resupplies given per minute (Honu XP 34, 55)',
    rate: (st) => st.resupplyPm, dur: (r) => 2 + r(), anim: 'idle', placeholder: true, hook: 'ammoBox' },
  repairing: { label: 'Repairing', kind: 'filler', source: 'repair XP events per minute (every Honu "Repair" XP id)',
    rate: (st) => st.repairPm, dur: (r) => 2.5 + 2 * r(), anim: 'idle', placeholder: true },
  capturing: { label: 'Point control', kind: 'filler', source: 'point XP per minute (Honu XP 15, 16, 272, 556, 557)',
    rate: (st) => st.capturePm, dur: (r) => 6 + 6 * r(), anim: 'idle', placeholder: true },
  reposition: { label: 'Repositioning', kind: 'filler', source: 'scene filler: a short move about twice a minute of free time',
    rate: () => 2, dur: (r) => 1 + 1.5 * r(), anim: 'run', calm: true, hook: 'shuffle' },
};

export const FILLERS = Object.entries(STATES).filter(([, s]) => s.kind === 'filler').map(([id]) => id);
