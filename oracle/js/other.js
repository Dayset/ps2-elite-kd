// #114 (2026-11-07): alert types beyond territory — Capture Facility Alerts (Dome Domination /
// Technological Advancement / Power Rush, back with the 2026-11-04 patch), Aerial Anomalies and
// Maximum Pressure — plus the newest Daybreak patch notes that touch alerts, the lattice or captures.
// Pure HTML/text builders for main.js.
import { t as tr } from "../../i18n.mjs";

const NAME = {
  biolab: () => tr("or.ot.biolab", "Dome Domination (hold all 3 Biolabs)"),
  tech: () => tr("or.ot.tech", "Technological Advancement (hold all 3 Tech Plants)"),
  amp: () => tr("or.ot.amp", "Power Rush (hold all 3 AMP Stations)"),
  aerial: () => tr("or.ot.aerial", "Aerial Anomalies"),
  pressure: () => tr("or.ot.pressure", "Maximum Pressure"),
};
const SAFE = /^https:\/\/store\.steampowered\.com\//;
const FACS = ["VS", "NC", "TR"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Alert type name for the title ("" for territory / Meltdown). */
export function kindName(a) {
  const s = a && a.state;
  const sub = s && s.facility && s.facility.sub;
  return a && (a.kind === "facility" || a.kind === "aerial" || a.kind === "pressure") ? (NAME[sub] || NAME[a.kind] || (() => ""))() : "";
}

/** Win-card note for the non-territory alert types (HTML). */
export function kindNoteHtml(a) {
  const s = a && a.state;
  if (!a || !s) return "";
  if (a.kind === "facility" && s.facility) {
    const t = s.facility.targets.map((x) => `<span class="${esc(x.owner || "")}">${esc(x.name)}${x.owner ? ` ${esc(x.owner)}` : ""}</span>`).join(" · ");
    return `<div class="note">${tr("or.fa.rule", "Hold all 3 to win at once; otherwise the most held at the end wins.")} 🎯 ${t}</div>`;
  }
  if (a.kind === "aerial" || a.kind === "pressure") return `<div class="note">${tr("or.ae.nolive", "The game shares no live score for this alert type, so there is no live prediction. The first faction to 10,000 points wins, otherwise the highest score when time runs out; the result shows here when it ends.")}</div>`;
  if (a.kind === "facility") return `<div class="note">${tr("or.fa.even", "The game shares no live score for this alert type, so win chances stay even.")}</div>`;
  return "";
}

/** AI Commander card for a facility alert: one order per faction (HTML) or "". */
export function facilityCmdHtml(a) {
  const f = a && a.state && a.state.facility;
  if (!f) return "";
  const lines = FACS.map((x) => {
    const o = f.orders && f.orders[x];
    const what = !o ? tr("or.fa.none", "no decisive move right now")
      : o.move === "take" ? tr("or.fa.take2", "All forces: take {base} ({now}% → {then}%)", { base: esc(o.name), now: o.now, then: o.then })
        : tr("or.fa.hold2", "All forces: hold {base} (losing it: {now}% → {then}%)", { base: esc(o.name), now: o.now, then: o.then });
    return `<div class="row"><span class="lbl ${x}">${x}</span> <span>${what}</span></div>`;
  }).join("");
  return `<section class="card cmd"><h2 data-sec="ai-commander">${tr("or.h.cmd", "🎖️ AI Commander")}</h2>${lines}</section>`;
}

/** Benchmark pool label: numbers are territory / Meltdown lengths, words are the other alert types. */
export function poolLabel(key) {
  if (/^\d+$/.test(key)) return tr("or.brierDur", "{n}-min Brier:", { n: key });
  return ({ facility: () => tr("or.pool.facility", "Facility alerts Brier:"), aerial: () => tr("or.pool.aerial", "Aerial Anomalies Brier:"), pressure: () => tr("or.pool.pressure", "Maximum Pressure Brier:") })[key]?.() || `${esc(key)}:`;
}

/** cycle.patch -> { text, url, link } or null. */
export function patchLine(p) {
  if (!p || !p.title) return null;
  const topics = (p.topics || []).map((k) => ({ alerts: tr("or.pt.alerts", "alerts"), lattice: tr("or.pt.lattice", "the lattice"), capture: tr("or.pt.capture", "captures") })[k]).filter(Boolean);
  return { text: tr("or.pt.line", "Game update \"{title}\" changes {topics}. Win chances may be off until the Oracle is re-checked.", { title: p.title, topics: topics.join(", ") }),
    url: SAFE.test(p.url || "") ? p.url : null, link: tr("or.pt.link", "Patch notes") };
}
