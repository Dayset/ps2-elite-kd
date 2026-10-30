// ⚔️ Live fights (#78 step 1, Workers Paid plan 2026-10-29): where the fighting is right now.
// state.fights comes from the Worker (oracle-worker/src/fights.js): per base, the players seen
// fighting there in the last 5 minutes by faction, kills, and a capture-point signal. Base names
// are links like in the Commander (hover / tap highlights the base on the map). Shown only; the
// odds and orders don't read it until a backtest shows a gain.
import { FACS, COLOR, esc } from "./state.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";
import { spawnLine } from "../../forward-spawns.mjs?v=20261030-sp1";

export const FIGHTS_SHOWN = 6;
export const CAPS_SHOWN = 5;
export const CAP_FRESH_S = 120; // the 🏴 tag pops in (animation) for this long after the flip

const tagTxt = (t) => (t ? `[${t}]` : tr("or.cap.noTag", "(outfit without a tag)"));

/**
 * 🏴 One capture's tag line (owner 2026-10-30): "🏴 Captured by [RWCN] · 45%", "no clear lead"
 * under 50 %, plus the officially credited outfit when it is a different one. Outfit tags only.
 */
export function capLine(c, nowS = Math.floor(Date.now() / 1000)) {
  if (!c) return "";
  const fresh = nowS - c.t < CAP_FRESH_S ? " capnew" : "";
  const tip = esc(tr("or.cap.tip", "Outfit with the biggest share of this capture: half the players on the point, half the point-capture XP. Under 50% = no clear lead. Shown only, not used in the odds."));
  const main = c.lead && c.tag != null
    ? tr("or.cap.by", "🏴 Captured by {tag} · {p}%", { tag: `<b>${esc(tagTxt(c.tag))}</b>`, p: c.share })
    : tr("or.cap.noLead", "🏴 Captured · no clear lead");
  const cred = c.cr != null && !(c.lead && c.same) && (c.lead || c.cr) ? ` <span class="capcred">${tr("or.cap.credit", "· officially credited: {tag}", { tag: esc(tagTxt(c.cr)) })}</span>` : "";
  return `<span class="capt${fresh}" title="${tip}">${main}${cred}</span>`;
}

/** 🏴 Recent captures on this continent (newest first). */
export function capsList(s, nowS = Math.floor(Date.now() / 1000)) {
  const caps = s && Array.isArray(s.caps) ? s.caps.slice(0, CAPS_SHOWN) : [];
  if (!caps.length) return "";
  const li = caps.map((c) => {
    const nm = c.fn || `#${c.f}`;
    return `<li data-base="${esc(nm)}"><span class="blink" tabindex="0" role="button" data-base="${esc(nm)}">${esc(nm)}</span> <span class="${esc(c.fac || "")}">${esc(c.fac || "")}</span> <span class="note">${esc(agoTxt(nowS - c.t))}</span><br>${capLine(c, nowS)}${c.sp ? `<div class="fsp">${spawnLine(c.sp, tr, { own: c.old, att: c.fac, cls: nowS - c.t < CAP_FRESH_S ? "fspnew" : "" })}</div>` : ""}</li>`;
  }).join("");
  return `<h3 class="caph">${tr("or.cap.h", "🏴 Recent captures")}</h3><ul class="fights caps">${li}</ul>`;
}

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
    const flag = f.cap ? `<div class="fcapt">${capLine(f.cap)}</div>` : "";
    // 🚐 Forward spawns at this base (last 10 min): defender = owner before a fresh flip, else the owner now.
    const spl = f.sp ? spawnLine(f.sp, tr, f.cap ? { own: f.cap.old, att: f.cap.fac } : { own: f.owner || null }) : "";
    const spw = spl ? `<div class="fsp">${spl}</div>` : "";
    return `<li data-base="${esc(nm)}"><div class="fhead"><span class="blink" tabindex="0" role="button" data-base="${esc(nm)}">${esc(nm)}</span>${own}${cap}</div>${flag}` +
      `<div class="track fbar" aria-hidden="true">${seg}</div>${spw}` +
      `<div class="fnum">${nums || "·"}<span class="note"> · ${esc(tr("or.f.players", "~{n} players", { n: tot }))}${kills ? ` · ${esc(tr("or.f.kills", "{n} kills", { n: kills }))}` : ""}</span></div></li>`;
  }).join("");
  const body = list.length ? `<ul class="fights">${rows}</ul>` : `<div class="note">${s.fights_live === false ? tr("or.f.off", "Live stream reconnecting: fights show up within a minute.") : tr("or.f.none", "No big fights right now.")}</div>`;
  return `<section class="card fightcard"><h2 data-sec="live-fights">${tr("or.h.fights", "⚔️ Live fights")}</h2>${body}${capsList(s)}` +
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
