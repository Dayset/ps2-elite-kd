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
  open: {},   // phone: which collapsible sections the user opened (by data-d)
  cmdFac: null, // phone: AI Commander faction picked in the segmented control
  hooks: {},   // cross-module callbacks set by main.js: openAlert
};
S.pinned = !!S.selected;
export const FACS = ["VS", "NC", "TR"];
export const COLOR = { VS: "var(--vs)", NC: "var(--nc)", TR: "var(--tr)" };
export const SLUG = { 2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur" };
export const HEXFILE = { 2: "indar_hexmap.json", 4: "replay_hexmap.json", 6: "amerish_hexmap.json", 8: "esamir_hexmap.json", 344: "oshur_hexmap.json" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (id) => document.getElementById(id);
// Phone-first (#16): below 601 px secondary content collapses; on wider screens the
// same <details> are forced open and their <summary> is hidden, so desktop is unchanged.
export const PHONE_MQ = matchMedia("(max-width: 600px)");
export const wide = () => !PHONE_MQ.matches;
// ⓘ notes (#17) are never forced open: on desktop they are small popovers.
const forced = (cls) => wide() && !/\binfo\b/.test(cls);
export const det = (id, summary, body, cls = "") => `<details class="det ${cls}" data-d="${id}"${forced(cls) || S.open[id] ? " open" : ""}><summary>${summary}</summary>${body}</details>`;
export const info = (id, body, label = "") => det(id, `ⓘ${label ? " " + label : ""}`, body, "info");
export function syncDetails(root = document) {
  root.querySelectorAll("details.det[data-d]").forEach((d) => { d.open = forced(d.className) || !!S.open[d.dataset.d]; });
}
export const stars = (p) => p >= 80 ? "★★★★★" : p >= 60 ? "★★★★" : p >= 40 ? "★★★" : p >= 20 ? "★★" : p > 0 ? "★" : "";
// Odds always with 1 decimal; territory whole numbers where space is tight (#18).
export const pct1 = (v) => (Math.round(+v * 10) / 10).toFixed(1);
export const mins = (s) => Math.max(0, Math.round(s / 60));
export const when = (ts) => new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const bar = (terr) => FACS.map((f) => `<span style="width:${terr[f] || 0}%;background:${COLOR[f]}"></span>`).join("");
