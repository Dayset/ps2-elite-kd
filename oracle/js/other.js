// #114 (2026-11-07): alerts the Oracle shows without odds — Capture Facility Alerts (Dome
// Domination / Technological Advancement / Power Rush, back with the 2026-11-04 patch), Aerial
// Anomalies and Maximum Pressure — and the newest Daybreak patch notes that touch alerts, the
// lattice or captures. Pure text builders; main.js puts them in the #infoStrip.
import { t as tr } from "../../i18n.mjs";

const NAME = {
  biolab: () => tr("or.ot.biolab", "Dome Domination (hold all 3 Biolabs)"),
  tech: () => tr("or.ot.tech", "Technological Advancement (hold all 3 Tech Plants)"),
  amp: () => tr("or.ot.amp", "Power Rush (hold all 3 AMP Stations)"),
  aerial: () => tr("or.ot.aerial", "Aerial Anomalies"),
  pressure: () => tr("or.ot.pressure", "Maximum Pressure"),
};
const SAFE = /^https:\/\/store\.steampowered\.com\//;

/** cycle.other -> { text } or null. */
export function otherAlertsLine(other, worlds, now) {
  if (!Array.isArray(other) || !other.length) return null;
  const list = other.map((o) => {
    const name = (NAME[o.sub] || NAME[o.type] || (() => `#${o.event_id}`))();
    const where = [o.world_name || (worlds && worlds[o.world]) || `#${o.world}`, o.zone_name || `#${o.zone}`].join(" · ");
    const left = o.dur && o.start_ts ? Math.max(0, Math.round(o.dur - (now - o.start_ts) / 60)) : null;
    return left != null ? tr("or.ot.item", "{where}: {name}, {n} min left", { where, name, n: left }) : tr("or.ot.itemNoClock", "{where}: {name}", { where, name });
  });
  return { text: tr("or.ot.line", "Also running, no win chances for this alert type: {list}.", { list: list.join("; ") }) };
}

/** cycle.patch -> { text, url, link } or null. */
export function patchLine(p) {
  if (!p || !p.title) return null;
  const topics = (p.topics || []).map((k) => ({ alerts: tr("or.pt.alerts", "alerts"), lattice: tr("or.pt.lattice", "the lattice"), capture: tr("or.pt.capture", "captures") })[k]).filter(Boolean);
  return { text: tr("or.pt.line", "Game update \"{title}\" changes {topics}. Win chances may be off until the Oracle is re-checked.", { title: p.title, topics: topics.join(", ") }),
    url: SAFE.test(p.url || "") ? p.url : null, link: tr("or.pt.link", "Patch notes") };
}
