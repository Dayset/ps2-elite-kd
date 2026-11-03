// Basic replay sound effects, v0.1 — synthesized with Web Audio, no audio
// files. Deliberately placeholder: real samples replace this module later,
// the play(name) calls in player.js stay the same.
//
// Safety rules (audio must never break the scene):
// - every play() is wrapped in try/catch and is a no-op without a context;
// - a suspended context (no user gesture yet) schedules silently, no error;
// - shots are rate-limited so a burst does not become a buzzsaw.
const DEFS = {
  shot:     { type: "square", f0: 900, f1: 300, dur: 0.07, vol: 0.10, minGap: 60 },
  hit:      { type: "sine",   f0: 1400, f1: 1400, dur: 0.04, vol: 0.08, minGap: 0 },
  kill:     { type: "sine",   f0: 660, f1: 880, dur: 0.12, vol: 0.14, minGap: 0 },
  headshot: { type: "sine",   f0: 1800, f1: 2400, dur: 0.15, vol: 0.14, minGap: 0 },
  death:    { type: "sawtooth", f0: 300, f1: 80, dur: 0.35, vol: 0.14, minGap: 0 },
  revive:   { type: "sine",   f0: 440, f1: 660, dur: 0.20, vol: 0.12, minGap: 0 },
  reload:   { type: "sine",   f0: 1000, f1: 1000, dur: 0.03, vol: 0.07, minGap: 0 },
};

export function createSfx(makeCtx = () => new (window.AudioContext || window.webkitAudioContext)(), now = () => Date.now()) {
  let ctx = null, muted = false;
  const lastPlay = {};
  function ensureCtx() {
    if (!ctx) { try { ctx = makeCtx(); } catch { ctx = null; } }
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch {} }
    return ctx;
  }
  function play(name) {
    const def = DEFS[name];
    if (!def || muted) return;
    const t = now();
    if (def.minGap && t - (lastPlay[name] || 0) < def.minGap) return;
    lastPlay[name] = t;
    try {
      const c = ensureCtx();
      if (!c) return;
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = def.type;
      osc.frequency.setValueAtTime(def.f0, c.currentTime);
      if (def.f1 !== def.f0) osc.frequency.exponentialRampToValueAtTime(def.f1, c.currentTime + def.dur);
      gain.gain.setValueAtTime(def.vol, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + def.dur);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(c.currentTime); osc.stop(c.currentTime + def.dur);
    } catch {}
  }
  return {
    play,
    setMuted(m) { muted = !!m; },
    get muted() { return muted; },
    // Call on a user gesture (click / play button): creates the context
    // early so the first in-scene sound is not swallowed by autoplay rules.
    unlock() { ensureCtx(); },
  };
}

// The page's shared instance; player.js wiring calls sfx.play(name).
export const sfx = createSfx();
