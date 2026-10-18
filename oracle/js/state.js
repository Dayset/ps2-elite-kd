// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
// Shared state and small helpers used by every module.
export const S = {
  alerts: [], selected: new URLSearchParams(location.search).get("alert"), mapCache: {}, namesCache: {},
  // pinned: the user asked for this alert (deep link or results row), so keep it even
  // when it is not in /live; its data then comes from /alert (extra).
  pinned: false, extra: null, benchFor: null,
  ticksFor: null, ticks: [], outliers: null,
  histRows: [], histAll: false, lastAlertEvt: "",
  me: null, authTimer: null,
  hooks: {},   // cross-module callbacks set by main.js: openAlert
};
S.pinned = !!S.selected;
export const FACS = ["VS", "NC", "TR"];
export const COLOR = { VS: "var(--vs)", NC: "var(--nc)", TR: "var(--tr)" };
export const SLUG = { 2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur" };
export const HEXFILE = { 2: "indar_hexmap.json", 4: "replay_hexmap.json", 6: "amerish_hexmap.json", 8: "esamir_hexmap.json", 344: "oshur_hexmap.json" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (id) => document.getElementById(id);
export const stars = (p) => p >= 80 ? "★★★★★" : p >= 60 ? "★★★★" : p >= 40 ? "★★★" : p >= 20 ? "★★" : p > 0 ? "★" : "";
export const mins = (s) => Math.max(0, Math.round(s / 60));
export const when = (ts) => new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const bar = (terr) => FACS.map((f) => `<span style="width:${terr[f] || 0}%;background:${COLOR[f]}"></span>`).join("");
