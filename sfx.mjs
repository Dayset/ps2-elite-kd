// t402u: tiny synthetic UI sounds (Web Audio oscillators only, no files).
// AudioContext is created lazily on the first user gesture (autoplay rules).
// Sounds only play shortly after a real user gesture, so page-load restores
// stay silent. 🔊/🔇 preference in localStorage ("ps2_sfx", default on).
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

/** Play a named sound. Silent when muted or with no recent user gesture (unless force). */
export function sfx(name, { force = false } = {}) {
  if (!sfxEnabled() || !SOUNDS[name]) return;
  if (!force && !recentGesture()) return;
  const c = ensureCtx();
  if (!c || c.state !== "running") return;
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
    const t = on ? "Sounds on — click to mute" : "Sounds off — click to unmute";
    btn.title = t; btn.setAttribute("aria-label", t); btn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  btn.addEventListener("click", () => { setSfxEnabled(!sfxEnabled()); paint(); sfx("plink"); });
  paint();
}
