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

const ORD = ["1st", "2nd", "3rd"];
/** "32% 1st place": our win chance and rank among the three (header odds). */
function standing(f, win) {
  const pct = (g) => (win && win[g] ? +(win[g].pct ?? win[g]) : NaN);
  if (!Number.isFinite(pct(f))) return "";
  const rank = ["VS", "NC", "TR"].filter((g) => g !== f && pct(g) > pct(f)).length;
  return ` ${Math.round(pct(f))}% ${ORD[rank]} place.`;
}

/**
 * Focus entry (Worker focus.js) -> spoken order, battlefield short (owner 2026-10-24):
 * no faction name (you follow your own), base, what it's worth, then our standing.
 *   "Hold Heyoka or 5% lost. 32% 1st place."   "Hold your lanes. 32% 1st place."
 */
export function sayText(f, p, win = null) {
  if (!p) return null;
  const st = standing(f, win);
  if (p.quiet || !p.focus) return `Hold your lanes.${st}`;
  const x = p.focus, d = Math.round(Math.abs((x.then ?? 0) - (x.now ?? 0)));
  const n = (x.cuts || []).length, cut = n ? `, cuts ${n}` : "";
  if (x.kind === "hold") return `Hold ${x.bases[0]} or ${d}% lost${cut}.${st}`;
  if (x.kind === "plan") return `Take ${x.bases[0]}, then ${x.bases[1]}${cut}, plus ${d}%.${st}`;
  if (x.kind === "push") return `Push ${x.bases[0]}, the fight is there.${st}`;
  if (x.kind === "guard") return `Guard ${x.bases[0]}, likely hit next.${st}`;
  if (x.kind === "spoil") return `Spoil ${x.target}: take ${x.bases[0]}${cut}.${st}`;
  return `Take ${x.bases[0]}${cut}, plus ${d}%.${st}`;
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
export function voiceToggle(f, focus, win = null) {
  if (V.on && V.fac === f) { V.on = false; if (voiceSupported()) window.speechSynthesis.cancel(); }
  else { V.on = true; V.fac = f; V.lastKey = null; }
  save();
  if (V.on) voiceTick(focus, f, true, undefined, win);
}

/** Called after every render with the alert's focus map ({VS:{focus,...}}). */
export function voiceTick(focus, fac = V.fac, force = false, nowS = Date.now() / 1000, win = null) {
  if (!V.on || !fac || !focus) return null;
  const p = focus[fac];
  const k = orderKey(fac, p);
  if (!k) return null;
  if (!force && k === V.lastKey && nowS - V.lastTs < REMIND_S) return null;
  const text = sayText(fac, p, win);
  V.lastKey = k; V.lastTs = nowS;
  speak(text);
  return text;
}
