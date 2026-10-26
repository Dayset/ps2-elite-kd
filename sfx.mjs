import { t as tr } from "./i18n.mjs";
// t402u: tiny synthetic UI sounds (Web Audio oscillators only, no files).
// The AudioContext is created at page load ("preloaded") but stays suspended
// until a real user gesture resumes it (autoplay rules), so page-load
// restores stay silent. A sound requested right after a gesture is scheduled
// even if the resume hasn't landed yet — the tones play the moment the
// context runs, instead of being dropped and only the next sound heard.
// 🔊/🔇 preference in localStorage ("ps2_sfx", default on).
const KEY = "ps2_sfx";
let ctx = null;
let lastGesture = -1e9;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function sfxEnabled() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSfxEnabled(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
}
/** True if a real click/tap/key happened within `ms`. */
export function recentGesture(ms = 1500) { return now() - lastGesture < ms; }

function ensureCtx() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}
if (typeof window !== "undefined") {
  const onGesture = () => {
    lastGesture = now();
    if (!sfxEnabled()) return;
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, onGesture, { capture: true, passive: true });
}

// Preload: create the context at page load (suspended until a gesture).
// Creation is cheap and no sound can play before the first gesture resumes
// it, so this only removes the first-click setup cost from the click path.
if (typeof window !== "undefined" && sfxEnabled()) ensureCtx();

let sfxRate = 1;
/** Streamer mode plays sounds faster (1.3×): start offsets and lengths scale, pitch stays. */
export function setSfxRate(r) { sfxRate = Number.isFinite(r) && r > 0 ? r : 1; }

/** One soft note: freq (Hz, or [from,to] glide), start offset s, length s. */
function tone(c, out, { f, t = 0, d = 0.12, type = "sine", g = 0.06 }) {
  t /= sfxRate; d /= sfxRate;
  const t0 = c.currentTime + 0.01 + t;
  const o = c.createOscillator();
  const v = c.createGain();
  o.type = type;
  if (Array.isArray(f)) { o.frequency.setValueAtTime(f[0], t0); o.frequency.exponentialRampToValueAtTime(f[1], t0 + d); }
  else o.frequency.setValueAtTime(f, t0);
  v.gain.setValueAtTime(0.0001, t0);
  v.gain.linearRampToValueAtTime(g, t0 + 0.008); // attack (no click)
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + d); // release
  o.connect(v).connect(out);
  o.start(t0);
  o.stop(t0 + d + 0.03);
}

const SOUNDS = {
  boop: [{ f: [520, 360], d: 0.13, g: 0.07 }],
  plink: [{ f: 1320, d: 0.09, type: "triangle", g: 0.05 }, { f: 1980, t: 0.04, d: 0.08, g: 0.025 }],
  plonk: [{ f: [440, 300], d: 0.14, type: "triangle", g: 0.055 }],
  sparkle: [1568, 2093, 2637, 3136].map((f, i) => ({ f, t: i * 0.04, d: 0.09, g: 0.03 })),
  bonk: [{ f: [200, 140], d: 0.16, type: "triangle", g: 0.07 }],
  fail: [{ f: 660, d: 0.14, type: "triangle", g: 0.045 }, { f: 494, t: 0.13, d: 0.17, type: "triangle", g: 0.045 }],
  chime: [784, 988, 1175, 1568].map((f, i) => ({ f, t: i * 0.07, d: i === 3 ? 0.36 : 0.22, g: 0.04 })),
  fresh: [{ f: 1047, d: 0.3, g: 0.04 }, { f: 1568, t: 0.09, d: 0.4, g: 0.03 }],
  // Owner 2026-10-26: live feed event sounds. Death: a sad descent. Assist: a short rising
  // motivational run. Kill: a victory fanfare. Pot rise: casino dings — its notes start at 0.6 s,
  // right after the victory fanfare ends, so a kill reads as victory… then money, not a muddle.
  sad: [{ f: 330, d: 0.25, type: "triangle", g: 0.05 }, { f: 262, t: 0.22, d: 0.25, type: "triangle", g: 0.05 }, { f: 196, t: 0.44, d: 0.4, type: "triangle", g: 0.05 }],
  assist: [{ f: 523, d: 0.1, g: 0.04 }, { f: 659, t: 0.08, d: 0.1, g: 0.04 }, { f: 784, t: 0.16, d: 0.18, g: 0.04 }],
  victory: [{ f: 523, d: 0.12, g: 0.05 }, { f: 659, t: 0.1, d: 0.12, g: 0.05 }, { f: 784, t: 0.2, d: 0.12, g: 0.05 }, { f: 1047, t: 0.3, d: 0.3, g: 0.05 }],
  chaChing: [{ f: 2093, t: 0.6, d: 0.12, g: 0.04 }, { f: 2637, t: 0.72, d: 0.12, g: 0.04 }, { f: 3520, t: 0.84, d: 0.25, g: 0.04 }],
};

/** Play a named sound. Silent when muted or with no recent user gesture (unless force).
 *  Live feed events pass { event: true }: they are not gestures, and they must never queue
 *  on a suspended context — its clock is frozen, so every queued tone would blast at once
 *  on the next resume. Event sounds play only while the context is already running (i.e.
 *  the user has clicked the page at least once); before that they stay silent. */
export function sfx(name, { force = false, event = false } = {}) {
  if (!sfxEnabled() || !SOUNDS[name]) return;
  if (!force && !event && !recentGesture()) return;
  const c = ensureCtx();
  if (!c) return;
  if (event && c.state !== "running") return;
  // The gesture that just happened resumes the context asynchronously; the
  // click's sound must not wait for that promise — schedule the tones now
  // and they play as soon as the context runs (same gesture, milliseconds).
  // Without this the click sound was dropped whenever the resume hadn't
  // landed yet, and only the next sound (e.g. the ~2 s-later completion
  // chime) was heard, which read as a delayed button sound.
  if (c.state === "suspended") c.resume().catch(() => {});
  const out = c.createGain();
  out.gain.value = 0.8;
  out.connect(c.destination);
  for (const n of SOUNDS[name]) tone(c, out, n);
  setTimeout(() => { try { out.disconnect(); } catch { /* ignore */ } }, 900);
}

/** Wire a 🔊/🔇 toggle button. */
export function mountSfxToggle(btn) {
  if (!btn) return;
  const paint = () => {
    const on = sfxEnabled();
    btn.textContent = on ? "🔊" : "🔇";
    const t = on ? tr("sfx.on", "Sounds on — click to mute") : tr("sfx.off", "Sounds off — click to unmute");
    btn.title = t; btn.setAttribute("aria-label", t); btn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  btn.addEventListener("click", () => { setSfxEnabled(!sfxEnabled()); paint(); sfx("plink"); });
  paint();
}
