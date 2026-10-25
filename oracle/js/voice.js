// AI Commander voice (#65): speaks the one top order (the focus move) for the faction
// the player follows, using the browser's built-in speech (Web Speech API: the Windows
// voices in Edge / Chrome, nothing to install, nothing leaves the browser).
// Spoken when the order changes, plus a reminder after REMIND_S of the same order.
// Display only: nothing here touches the odds or the Commander.
// #73: the button and menu are translated; the spoken order stays English (the Commander text is English).
import { t as tr } from "../../i18n.mjs";

const KEY = "ps2oracle_voice";
const REMIND_S = 300;

const V = { on: false, fac: null, lastKey: null, lastTs: 0, voice: null };
try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) { V.on = !!s.on; V.fac = s.fac || null; V.voice = s.voice || null; } } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: V.on, fac: V.fac, voice: V.voice })); } catch { /* ignore */ } };

/**
 * English voices, most natural first (owner 2026-10-24: the old Windows voices sound robotic):
 * Edge "Microsoft … Online (Natural)", then Chrome "Google …", then other online voices,
 * then local ones (Microsoft David / Zira).
 */
export function rankVoices(voices) {
  const score = (v) => (/natural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : !v.localService ? 2 : 3) + (/^en[-_]US/i.test(v.lang) ? 0 : 0.5);
  return (voices || []).filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
const pickVoice = () => {
  const vs = rankVoices(window.speechSynthesis.getVoices());
  return vs.find((v) => v.name === V.voice) || vs[0] || null;
};
/**
 * Voice choice (owner t650u): a small ⚙️ next to the speaker (while the voice is on) opens a
 * compact list instead of an always-visible dropdown (Edge lists dozens of voices and the
 * native dropdown rendered huge). The list is sized to the screen, long names are cut with
 * "…" (full name on hover), it scrolls when long, and closes on a pick, a tap elsewhere,
 * Escape, a page scroll or a resize. The saved choice is the same as before (KEY.voice).
 */
export function voicePicker() {
  if (!voiceSupported() || !V.on) return "";
  if (!rankVoices(window.speechSynthesis.getVoices()).length) return "";
  const t = tr("or.vc.pick", "⚙️ Choose the voice");
  return ` <button type="button" class="voicegear" data-voicegear="1" aria-haspopup="listbox" aria-expanded="false" title="${t}" aria-label="${t}">⚙️</button>`;
}
const escA = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
let menu = null, menuGear = null;
/** The voice list, positioned under the ⚙️ (fixed, kept inside the screen). */
function placeMenu() {
  if (!menu || !menuGear) return;
  const r = menuGear.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
  const below = r.bottom + 4;
  menu.style.top = `${below + h <= vh - 8 || r.top - h - 4 < 8 ? below : r.top - h - 4}px`;
}
export function closeVoiceMenu(refocus = false) {
  if (!menu) return;
  menu.hidden = true;
  if (menuGear) { menuGear.setAttribute("aria-expanded", "false"); if (refocus) menuGear.focus(); }
  menuGear = null;
}
function openVoiceMenu(gear) {
  if (typeof document === "undefined") return;
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "voicemenu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    document.body.appendChild(menu);
    menu.addEventListener("click", (e) => {
      const o = e.target.closest && e.target.closest("[data-voicename]");
      if (!o) return;
      setVoice(o.getAttribute("data-voicename"));
      closeVoiceMenu(true);
    });
    document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !(menuGear && menuGear.contains(e.target))) closeVoiceMenu(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); closeVoiceMenu(true); } });
    window.addEventListener("scroll", (e) => { if (!menu.hidden && !(e.target instanceof Node && menu.contains(e.target))) closeVoiceMenu(); }, { passive: true, capture: true });
    window.addEventListener("resize", () => closeVoiceMenu());
  }
  const vs = rankVoices(window.speechSynthesis.getVoices());
  const cur = pickVoice();
  menu.setAttribute("aria-label", tr("or.vc.voice", "Voice"));
  menu.innerHTML = vs.map((v) => {
    const on = !!(cur && v.name === cur.name);
    return `<button type="button" role="option" class="vopt${on ? " on" : ""}" aria-selected="${on}" data-voicename="${escA(v.name)}" title="${escA(v.name)}">${on ? "✓ " : ""}${escA(v.name)}</button>`;
  }).join("");
  menuGear = gear;
  gear.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  placeMenu();
  const sel = menu.querySelector(".vopt.on") || menu.querySelector(".vopt");
  if (sel) { sel.scrollIntoView({ block: "nearest" }); sel.focus({ preventScroll: true }); }
}
/** After each render: wire the ⚙️ buttons; an open list follows its re-drawn ⚙️ (or closes). */
export function bindVoiceMenu(root) {
  if (!root) return;
  const gears = root.querySelectorAll("[data-voicegear]");
  gears.forEach((g) => g.onclick = () => { if (menu && !menu.hidden && menuGear === g) closeVoiceMenu(); else openVoiceMenu(g); });
  if (menu && !menu.hidden && menuGear && !menuGear.isConnected) {
    if (gears.length) { menuGear = gears[0]; menuGear.setAttribute("aria-expanded", "true"); placeMenu(); } else closeVoiceMenu();
  }
}
export function setVoice(name) { V.voice = name; save(); speak("Voice set."); }

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
export const voiceState = () => ({ on: V.on, fac: V.fac });

/*
 * Ending: the gap to the faction we race (owner t652u), in minutes of the current
 * territory swing, or in percent when minutes can't be measured or the race is tight.
 *   1st vs 2nd: "Lead 15 minutes."          2nd vs 1st / 3rd vs 2nd: "Second, 15 minutes difference."
 *   tight:      "First. Pay attention! Only plus 2 percent difference."
 * Data: Worker state.territory (share %) and state.momentum (share change over the last
 * 15 min, engine.js). minutes = gap / (|change of the gap over 15 min| / 15).
 * Thresholds measured 2026-10-25 on the Worker's own minute ticks (/history + /alert,
 * 73 alerts, 12,369 faction-pair minutes):
 *  - GAP_TIGHT 4: under 4 points apart the order of the two flips within 5 minutes in
 *    26-48 % of cases (3-4 pts: 26 %, 4-5 pts: 17 %, 5-7 pts: 10 %).
 *  - SWING_MIN 1: a 15-min gap change under 1 point is not a capture (the smallest real
 *    steps are 1.0-1.2 points, one base; 0.1-0.6 are rounding), so no minutes then.
 *    Check: "under 15 minutes" calls on a closing gap flipped within 15 min in 42-56 % of
 *    cases, 15-30 min ones in 17 %, longer ones in about 10 %.
 */
export const GAP_TIGHT = 4, SWING_MIN = 1;
const PLACE = ["First", "Second", "Third"];
const FACS3 = ["VS", "NC", "TR"];
const roundMin = (m) => (m < 10 ? Math.max(1, Math.round(m)) : m < 60 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10);
const pctWord = (d) => (d < 1 ? (Math.round(d * 10) / 10).toString() : String(Math.round(d)));
export function gapEnding(f, race) {
  const terr = race && race.territory, mom = (race && race.momentum) || {};
  if (!terr || !FACS3.every((g) => Number.isFinite(+terr[g]))) return "";
  const order = [...FACS3].sort((a, b) => terr[b] - terr[a] || (a === f ? -1 : b === f ? 1 : 0));
  const place = order.indexOf(f);
  if (place < 0) return "";
  const rival = place === 0 ? order[1] : order[place - 1];
  const gap = Math.abs(terr[f] - terr[rival]);
  const swing = Math.abs((+mom[f] || 0) - (+mom[rival] || 0));
  const sign = place === 0 ? "plus" : "minus";
  if (gap < GAP_TIGHT) return ` ${PLACE[place]}. Pay attention! Only ${sign} ${pctWord(gap)} percent difference.`;
  if (swing < SWING_MIN) return place === 0 ? ` First, ${sign} ${pctWord(gap)} percent difference.` : ` ${PLACE[place]}, ${sign} ${pctWord(gap)} percent difference.`;
  const m = roundMin(gap / (swing / 15)), mins = `${m} minute${m === 1 ? "" : "s"}`;
  return place === 0 ? ` Lead ${mins}.` : ` ${PLACE[place]}, ${mins} difference.`;
}

/**
 * Focus entry (Worker focus.js) -> spoken order, battlefield short (owner t652u wording):
 * no faction name (you follow your own), base, what it's worth, then the gap ending.
 *   "Defend Heyoka or minus 5. Lead 15 minutes."   "Hold your lanes. Second, 10 minutes difference."
 * race = Worker state ({territory, momentum}). Pockets are not spoken for now (owner t652u);
 * the pockets argument is kept so callers don't change.
 */
export function sayText(f, p, race = null, pockets = null) { // eslint-disable-line no-unused-vars
  if (!p) return null;
  const st = gapEnding(f, race);
  if (p.quiet || !p.focus) return `Hold your lanes.${st}`;
  const x = p.focus, d = Math.round(Math.abs((x.then ?? 0) - (x.now ?? 0)));
  const n = (x.cuts || []).length, cut = n ? `, cuts ${n}` : "";
  if (x.kind === "hold") return `Defend ${x.bases[0]} or minus ${d}${cut}.${st}`;
  if (x.kind === "plan") return `Attack ${x.bases[0]}, then ${x.bases[1]}${cut}, plus ${d}.${st}`;
  if (x.kind === "push") return `Go ${x.bases[0]}, the fight is there.${st}`;
  if (x.kind === "guard") return `Prepare ${x.bases[0]}, likely next target.${st}`;
  if (x.kind === "spoil") return `Spoil ${x.target}: take ${x.bases[0]}${cut}.${st}`;
  return `Attack ${x.bases[0]}${cut}, plus ${d}.${st}`;
}

/** Same order = same kind and bases (odds wobbling doesn't re-announce). */
// Pockets aren't spoken for now (owner t652u), so a pocket change doesn't re-announce.
export const orderKey = (f, p, pockets = null) => (!p ? null : (p.quiet || !p.focus ? `${f}|quiet` : `${f}|${p.focus.kind}|${p.focus.bases.join("+")}|${p.focus.target}`)); // eslint-disable-line no-unused-vars

function speak(text) {
  if (!voiceSupported() || !text) return;
  const s = window.speechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = v && !v.localService ? 1.0 : 1.05;
  s.speak(u);
}

/** Speaker button on a faction's Commander card: one faction is followed at a time. */
export function voiceButton(f) {
  if (!voiceSupported()) return "";
  const on = V.on && V.fac === f;
  const tip = on ? tr("or.vc.on", "Speaking {f}'s top order. Click to stop.", { f }) : tr("or.vc.off", "Read {f}'s top order aloud (your system voice)", { f });
  return ` <button type="button" class="voicebtn${on ? " on" : ""}" data-voice="${f}" aria-pressed="${on}" title="${tip}" aria-label="${tip}">${on ? "🔊" : "🔇"}</button>${on ? voicePicker() : ""}`;
}

/** Click on a faction's speaker (a click, so the browser allows speech): follow it, or stop. */
export function voiceToggle(f, focus, race = null, pocketsAll = null) {
  if (V.on && V.fac === f) { V.on = false; if (voiceSupported()) window.speechSynthesis.cancel(); }
  else { V.on = true; V.fac = f; V.lastKey = null; }
  save();
  if (V.on) voiceTick(focus, f, true, undefined, race, pocketsAll);
}

/** Called after every render with the alert's focus map ({VS:{focus,...}}). */
export function voiceTick(focus, fac = V.fac, force = false, nowS = Date.now() / 1000, race = null, pocketsAll = null) {
  if (!V.on || !fac || !focus) return null;
  const p = focus[fac];
  const pockets = pocketsAll && pocketsAll[fac];
  const k = orderKey(fac, p, pockets);
  if (!k) return null;
  if (!force && k === V.lastKey && nowS - V.lastTs < REMIND_S) return null;
  const text = sayText(fac, p, race, pockets);
  V.lastKey = k; V.lastTs = nowS;
  speak(text);
  return text;
}

// Voices load late in Chrome: redraw the picker when they arrive.
if (voiceSupported()) window.speechSynthesis.onvoiceschanged = () => { if (V.on && typeof document !== "undefined") document.dispatchEvent(new Event("oracle-voices")); };
