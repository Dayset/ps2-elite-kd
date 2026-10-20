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

/** One soft note: freq (Hz, or [from,to] glide), start offset s, length s. */
function tone(c, out, { f, t = 0, d = 0.12, type = "sine", g = 0.06 }) {
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
};

/** t470u 💨 poof: a short noise burst through a band-pass sweeping down (soft
 * "pff"), fast attack, ~300 ms decay, plus a faint low thump. No audio file. */
function poof(c, out) {
  const t0 = c.currentTime + 0.01, len = 0.34;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(2200, t0);
  bp.frequency.exponentialRampToValueAtTime(320, t0 + 0.28);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.16, t0 + 0.006); // attack
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.31); // decay
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + len);
  tone(c, out, { f: [170, 70], d: 0.12, g: 0.035 }); // soft thump under the air
}

/** Play a named sound. Silent when muted or with no recent user gesture (unless force). */
export function sfx(name, { force = false } = {}) {
  if (!sfxEnabled() || !(SOUNDS[name] || name === "poof")) return;
  if (!force && !recentGesture()) return;
  const c = ensureCtx();
  if (!c) return;
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
  if (name === "poof") poof(c, out);
  else for (const n of SOUNDS[name]) tone(c, out, n);
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
