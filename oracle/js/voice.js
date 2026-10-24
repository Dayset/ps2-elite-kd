// AI Commander voice (#65): speaks the one top order (the focus move) for the faction
// the player follows, using the browser's built-in speech (Web Speech API: the Windows
// voices in Edge / Chrome, nothing to install, nothing leaves the browser).
// Spoken when the order changes, plus a reminder after REMIND_S of the same order.
// Display only: nothing here touches the odds or the Commander.

const KEY = "ps2oracle_voice";
const REMIND_S = 300;

const V = { on: false, fac: null, lastKey: null, lastTs: 0 };
try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) { V.on = !!s.on; V.fac = s.fac || null; } } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: V.on, fac: V.fac })); } catch { /* ignore */ } };

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
export const voiceState = () => ({ on: V.on, fac: V.fac });

/** Focus entry (Worker focus.js) -> spoken sentence. Base names and percentages only. */
export function sayText(f, p) {
  if (!p) return null;
  if (p.quiet || !p.focus) return `${f}. No decisive move. Hold your lanes.`;
  const x = p.focus, stake = Math.round(Math.abs((x.then ?? 0) - (x.now ?? 0)));
  const pct = stake >= 1 ? ` ${stake} percent at stake.` : "";
  const n = (x.cuts || []).length, bases = (k) => `${k} ${k === 1 ? "base" : "bases"}`;
  if (x.kind === "hold") return `${f}. Hold ${x.bases[0]} against ${x.target}.${n ? ` Losing it cuts off ${bases(n)} of ours.` : ""}${pct}`;
  if (x.kind === "plan") return `${f}. Take ${x.bases[0]}, then ${x.bases[1]}.${n ? ` Cuts off ${n} enemy ${n === 1 ? "base" : "bases"}.` : ""}${pct}`;
  if (x.kind === "spoil") return `${f}. Spoiler: take ${x.bases[0]} from ${x.target}.`;
  return `${f}. Take ${x.bases[0]} from ${x.target}.${n ? ` Cuts off ${n} enemy ${n === 1 ? "base" : "bases"}.` : ""}${pct}`;
}

/** Same order = same kind and bases (odds wobbling doesn't re-announce). */
export const orderKey = (f, p) => (!p ? null : p.quiet || !p.focus ? `${f}|quiet` : `${f}|${p.focus.kind}|${p.focus.bases.join("+")}|${p.focus.target}`);

function speak(text) {
  if (!voiceSupported() || !text) return;
  const s = window.speechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = s.getVoices();
  const en = voices.find((v) => /^en(-|_|$)/i.test(v.lang) && v.localService) || voices.find((v) => /^en/i.test(v.lang));
  if (en) u.voice = en;
  u.rate = 1.05;
  s.speak(u);
}

/** Speaker button on a faction's Commander card: one faction is followed at a time. */
export function voiceButton(f) {
  if (!voiceSupported()) return "";
  const on = V.on && V.fac === f;
  const tip = on ? `Speaking ${f}'s top order. Click to stop.` : `Read ${f}'s top order aloud (your system voice)`;
  return ` <button type="button" class="voicebtn${on ? " on" : ""}" data-voice="${f}" aria-pressed="${on}" title="${tip}" aria-label="${tip}">${on ? "🔊" : "🔇"}</button>`;
}

/** Click on a faction's speaker (a click, so the browser allows speech): follow it, or stop. */
export function voiceToggle(f, focus) {
  if (V.on && V.fac === f) { V.on = false; if (voiceSupported()) window.speechSynthesis.cancel(); }
  else { V.on = true; V.fac = f; V.lastKey = null; }
  save();
  if (V.on) voiceTick(focus, f, true);
}

/** Called after every render with the alert's focus map ({VS:{focus,...}}). */
export function voiceTick(focus, fac = V.fac, force = false, nowS = Date.now() / 1000) {
  if (!V.on || !fac || !focus) return null;
  const p = focus[fac];
  const k = orderKey(fac, p);
  if (!k) return null;
  if (!force && k === V.lastKey && nowS - V.lastTs < REMIND_S) return null;
  const text = sayText(fac, p);
  V.lastKey = k; V.lastTs = nowS;
  speak(text);
  return text;
}
