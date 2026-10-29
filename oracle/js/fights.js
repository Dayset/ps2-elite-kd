// ⚔️ Live fights (#78 step 1, Workers Paid plan 2026-10-29): where the fighting is right now.
// state.fights comes from the Worker (oracle-worker/src/fights.js): per base, the players seen
// fighting there in the last 5 minutes by faction, kills, and a capture-point signal. Base names
// are links like in the Commander (hover / tap highlights the base on the map). Shown only; the
// odds and orders don't read it until a backtest shows a gain.
import { FACS, COLOR, esc } from "./state.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";

export const FIGHTS_SHOWN = 6;

const agoTxt = (s) => (s == null ? "" : s < 60 ? tr("or.f.now", "now") : tr("or.f.ago", "{n} min ago", { n: Math.round(s / 60) }));

/** The card's inner HTML for one live alert state (no card when there is nothing to say). */
export function fightsCard(s) {
  if (!s || !Array.isArray(s.fights)) return "";
  const list = s.fights.slice(0, FIGHTS_SHOWN);
  const big = list.reduce((m, f) => Math.max(m, f.n.VS + f.n.NC + f.n.TR), 0) || 1;
  const rows = list.map((f) => {
    const tot = f.n.VS + f.n.NC + f.n.TR;
    const kills = f.k ? f.k.VS + f.k.NC + f.k.TR : 0;
    // Capture-point XP (272 point converted) in the last 5 min: the faction taking points, when it was.
    const cf = f.conv ? FACS.reduce((m, q) => ((f.conv[q] || 0) > (m ? f.conv[m] : 0) ? q : m), null) : null;
    const cap = cf ? `<span class="fcap" title="${esc(tr("or.f.capTip", "A capture point changed hands here: the base timer may be running."))}">⏳ <span class="${cf}">${cf}</span> ${esc(tr("or.f.points", "points"))} · ${esc(agoTxt(f.convAgo))}</span>` : "";
    const nm = f.name || `#${f.fid}`;
    const own = f.owner ? ` <span class="fown ${f.owner}" title="${esc(tr("or.f.ownTip", "Owner now"))}">${f.owner}</span>` : "";
    const seg = FACS.map((q) => (f.n[q] ? `<span style="width:${(100 * f.n[q] / big).toFixed(1)}%;background:${COLOR[q]}" title="${q} ${f.n[q]}"></span>` : "")).join("");
    const nums = FACS.filter((q) => f.n[q]).map((q) => `<span class="${q}">${q} ${f.n[q]}</span>`).join(" · ");
    return `<li data-base="${esc(nm)}"><div class="fhead"><span class="blink" tabindex="0" role="button" data-base="${esc(nm)}">${esc(nm)}</span>${own}${cap}</div>` +
      `<div class="track fbar" aria-hidden="true">${seg}</div>` +
      `<div class="fnum">${nums || "·"}<span class="note"> · ${esc(tr("or.f.players", "~{n} players", { n: tot }))}${kills ? ` · ${esc(tr("or.f.kills", "{n} kills", { n: kills }))}` : ""}</span></div></li>`;
  }).join("");
  const body = list.length ? `<ul class="fights">${rows}</ul>` : `<div class="note">${s.fights_live === false ? tr("or.f.off", "Live stream reconnecting: fights show up within a minute.") : tr("or.f.none", "No big fights right now.")}</div>`;
  return `<section class="card fightcard"><h2 data-sec="live-fights">${tr("or.h.fights", "⚔️ Live fights")}</h2>${body}` +
    `<div class="note">${tr("or.f.note", "Rough crowd: players seen fighting at each base in the last 5 min, from the game's live event stream. Not used in the odds yet.")}</div></section>`;
}

/** One line for the Win chance details: stream population on the continent. */
export function popLiveLine(s) {
  const p = s && s.pop_live;
  if (!p) return "";
  const tot = FACS.reduce((t, f) => t + (p[f] || 0), 0);
  if (!tot) return "";
  return `<div class="note">${tr("or.popLive", "Live stream: {list} seen fighting in the last 5 min.", { list: FACS.map((f) => `<span class="${f}">${f} ${p[f] || 0}</span>`).join(" · ") })}</div>`;
}
