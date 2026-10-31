// ⚔️ Live fights (#78 step 1, Workers Paid plan 2026-10-29): where the fighting is right now.
// state.fights comes from the Worker (oracle-worker/src/fights.js): per base, the players seen
// fighting there in the last 5 minutes by faction, kills, and a capture-point signal. Base names
// are links like in the Commander (hover / tap highlights the base on the map). Shown only; the
// odds and orders don't read it until a backtest shows a gain.
import { FACS, COLOR, esc } from "./state.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";
import { spawnLine } from "../../forward-spawns.mjs?v=20261030-sp3";

export const FIGHTS_SHOWN = 3; // top 3 only (owner 2026-10-30): less to read
export const CAPS_SHOWN = 5;
export const CAP_GRACE_S = 30; // ⚔️ a captured base stays in Live fights this long (owner 2026-10-30)
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

/** 🏴 Fight-row capture tag, short (owner 2026-10-30): "🏴[RWCN] 45%"; full capLine wording in the hover. */
export function capShort(c) {
  if (!c || !c.lead || c.tag == null) return "";
  const full = capLine(c).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return ` <span class="capt fcapt" title="${esc(`${full} — ${tr("or.cap.tip", "Outfit with the biggest share of this capture: half the players on the point, half the point-capture XP. Under 50% = no clear lead. Shown only, not used in the odds.")}`)}">🏴<b>${esc(tagTxt(c.tag))}</b> ${c.share}%</span>`;
}

const agoTxt = (s) => (s == null ? "" : s < 60 ? tr("or.f.now", "now") : tr("or.f.ago", "{n} min ago", { n: Math.round(s / 60) }));

/**
 * ⚔️ When a captured base leaves Live fights (owner 2026-10-30): 30 s after its latest capture, unless the
 * fight picked up again there (a kill or a capture point taken more than 30 s after the flip), then it stays
 * like any other fight. Returns the epoch second it goes, or null (stays). Display only; the data stays.
 */
export function fightGoneAt(f, s) {
  const fid = String(f.fid);
  let t = f.cap && Number.isFinite(+f.cap.t) ? +f.cap.t : null;
  for (const c of (s && Array.isArray(s.caps) ? s.caps : [])) if (String(c.f) === fid && Number.isFinite(+c.t) && (t == null || +c.t > t)) t = +c.t;
  if (t == null) return null;
  const at = s && Number.isFinite(+s.fights_at) ? +s.fights_at : null;
  const back = (ago) => (at != null && ago != null && Number.isFinite(+ago) ? at - +ago : -Infinity);
  if (Math.max(back(f.killAgo), back(f.convAgo)) > t + CAP_GRACE_S) return null; // fighting again after the flip
  return t + CAP_GRACE_S;
}

/** The card's inner HTML for one live alert state (no card when there is nothing to say). */
/** 👥 Scoreboards the reader unfolded stay open across the minute refresh (by base name). */
export const SB_OPEN = new Set();
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d || !d.classList || !d.classList.contains("fsb")) return;
    if (d.open) SB_OPEN.add(d.dataset.sb); else SB_OPEN.delete(d.dataset.sb);
  }, true);
}

/** 👥 Folded scoreboard under one fight (owner 2026-10-30): top 3 players by kills there in the last 5 min. */
export function scoreboard(f, nm) {
  const top = Array.isArray(f.top) ? f.top.filter((p) => p && typeof p === "object").slice(0, 3) : [];
  if (!top.length) return "";
  const li = top.map((p) => {
    const iv = Number.isFinite(p.i) && p.i > 0 ? String(Math.round(p.i)) : "–";
    const k = Math.max(0, +p.k || 0), d = Math.max(0, +p.d || 0);
    const hint = tr("or.f.sbRow", "{k} kills, {d} deaths at this base · iVi {i}", { k, d, i: iv });
    return `<li title="${esc(hint)}"><span class="${FACS.includes(p.f) ? p.f : ""}">${esc(p.n || "?")}</span> <span class="note">${k}/${d} · ${iv}</span></li>`;
  }).join("");
  const tip = tr("or.f.sbTip", "Top 3 players seen at this base in the last 5 min, ranked by kills here (fewer deaths first on a tie). Numbers: kills/deaths · iVi from the site's stats (– when unknown). Rough, from the game's live event stream; not used in the odds.");
  return `<details class="fsb" data-sb="${esc(nm)}"${SB_OPEN.has(nm) ? " open" : ""}><summary title="${esc(tip)}">${tr("or.f.sb", "👥 Top 3")}</summary><ol>${li}</ol></details>`;
}

export function fightsCard(s, nowS = Math.floor(Date.now() / 1000)) {
  if (!s || !Array.isArray(s.fights)) return "";
  const list = s.fights.filter((f) => { const g = fightGoneAt(f, s); return g == null || nowS < g; }).slice(0, FIGHTS_SHOWN);
  const big = list.reduce((m, f) => Math.max(m, f.n.VS + f.n.NC + f.n.TR), 0) || 1;
  const rows = list.map((f) => {
    const tot = f.n.VS + f.n.NC + f.n.TR;
    const kills = f.k ? f.k.VS + f.k.NC + f.k.TR : 0;
    // Capture-point XP (272 point converted) in the last 5 min: the faction taking points, when it was.
    const cf = f.conv ? FACS.reduce((m, q) => ((f.conv[q] || 0) > (m ? f.conv[m] : 0) ? q : m), null) : null;
    // ⏳ Short on screen (owner 2026-10-30): "⏳VS"; "VS points · now" and the meaning sit in the hover.
    const cap = cf ? `<span class="fcap" title="${esc(`${cf} ${tr("or.f.points", "points")} · ${agoTxt(f.convAgo)} — ${tr("or.f.capTip", "A capture point changed hands here: the base timer may be running.")}`)}">⏳<span class="${cf}">${cf}</span></span>` : "";
    const nm = f.name || `#${f.fid}`;
    const own = f.owner ? ` <span class="fown ${f.owner}" title="${esc(tr("or.f.ownTip", "Owner now"))}">${f.owner}</span>` : "";
    const seg = FACS.map((q) => (f.n[q] ? `<span style="width:${(100 * f.n[q] / big).toFixed(1)}%;background:${COLOR[q]}" title="${q} ${f.n[q]}"></span>` : "")).join("");
    const nums = FACS.filter((q) => f.n[q]).map((q) => `<span class="${q}">${q} ${f.n[q]}</span>`).join(" · ");
    const flag = f.cap ? capShort(f.cap) : "";
    // 🚐 Forward spawns at this base (last 10 min): defender = owner before a fresh flip, else the owner now.
    const spl = f.sp ? spawnLine(f.sp, tr, f.cap ? { own: f.cap.old, att: f.cap.fac } : { own: f.owner || null }) : "";
    const spw = spl ? `<div class="fsp">${spl}</div>` : "";
    // One number line: "VS 14 · NC 11 · 💀11"; the crowd total ("~25 players") is the hover.
    const kl = kills ? ` · <span class="fkills" title="${esc(tr("or.f.kills", "{n} kills", { n: kills }))}">💀${kills}</span>` : "";
    const gone = fightGoneAt(f, s);
    return `<li data-base="${esc(nm)}"${gone != null ? ` data-gone="${gone}"` : ""}><div class="fhead"><span class="blink" tabindex="0" role="button" data-base="${esc(nm)}">${esc(nm)}</span>${own}${cap}${flag}</div>` +
      `<div class="track fbar" aria-hidden="true">${seg}</div>${spw}` +
      `<div class="fnum" title="${esc(tr("or.f.players", "~{n} players", { n: tot }))}">${nums || "·"}<span class="note">${kl}</span></div>${scoreboard(f, nm)}</li>`;
  }).join("");
  const body = list.length ? `<ul class="fights">${rows}</ul>` : `<div class="note">${s.fights_live === false ? tr("or.f.off", "Live stream reconnecting: fights show up within a minute.") : tr("or.f.none", "No big fights right now.")}</div>`;
  // Owner 2026-10-30: no "Recent captures" list and no footer note here; the note is the heading's hover.
  return `<section class="card fightcard"><h2 data-sec="live-fights" title="${esc(tr("or.f.note", "Rough crowd: players seen fighting at each base in the last 5 min, from the game's live event stream. Not used in the odds yet."))}">${tr("or.h.fights", "⚔️ Live fights")}</h2>${body}</section>`;
}

/** One line for the Win chance details: stream population on the continent. */
export function popLiveLine(s) {
  const p = s && s.pop_live;
  if (!p) return "";
  const tot = FACS.reduce((t, f) => t + (p[f] || 0), 0);
  if (!tot) return "";
  return `<div class="note">${tr("or.popLive", "Live stream: {list} seen fighting in the last 5 min.", { list: FACS.map((f) => `<span class="${f}">${f} ${p[f] || 0}</span>`).join(" · ") })}</div>`;
}
