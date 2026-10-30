/**
 * 🏴 Capture tags on 🎥 LIVE (owner 2026-10-30): the latest base captures on the tracked
 * player's server and the outfit that led each one (cache Worker GET /live/captures, built
 * from the game's live event stream). Server-wide on purpose — never tied to where the
 * tracked player is. Outfit tags only; shown, not used anywhere else.
 * 🚐 Each capture also shows the spawn points each side had at that base (forward-spawns.mjs).
 */
import { spawnLine } from "./forward-spawns.mjs?v=20261030-sp3";
export const CAPS_API = "https://ps2-elite-kd-cache.dayset.workers.dev/live/captures";
export const CAPS_POLL_MS = 60e3;
export const CAPS_LIVE_SHOWN = 3;
export const CAPS_LIVE_WINDOW_S = 30 * 60;
export const CAPS_LIVE_FRESH_S = 120;
export const PC_CAP_WORLDS = ["1", "10", "40"];
const ZONE = { 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FACS = new Set(["VS", "NC", "TR"]);

export function capsUrl(world, nowS = Math.floor(Date.now() / 1000)) {
  if (!PC_CAP_WORLDS.includes(String(world))) return null;
  return `${CAPS_API}?world=${world}&since=${nowS - CAPS_LIVE_WINDOW_S}`;
}

/** One capture → its line (HTML). tr = the i18n t(key, fallback, vars). */
export function capsLineLive(c, tr, nowS = Math.floor(Date.now() / 1000)) {
  const tag = (t) => (t ? `[${t}]` : tr("or.cap.noTag", "(outfit without a tag)"));
  const base = esc(c.fn || `#${c.f}`) + (ZONE[c.z] ? ` <span class="lc-zone">${ZONE[c.z]}</span>` : "");
  const fac = FACS.has(c.fac) ? ` <span class="lc-fac ${c.fac.toLowerCase()}">${c.fac}</span>` : "";
  const main = c.lead && c.oid
    ? tr("or.cap.by", "🏴 Captured by {tag} · {p}%", { tag: `<b>${esc(tag(c.tag))}</b>`, p: Math.round(+c.share || 0) })
    : tr("or.cap.noLead", "🏴 Captured · no clear lead");
  const cred = c.co && !(c.lead && c.same) ? ` <span class="lc-cred">${tr("or.cap.credit", "· officially credited: {tag}", { tag: esc(tag(c.cr)) })}</span>` : "";
  const fresh = nowS - c.t < CAPS_LIVE_FRESH_S ? " lc-new" : "";
  const sp = c.sp ? spawnLine(c.sp, tr, { own: c.old, att: c.fac }) : "";
  return `<div class="lc-row${fresh}">${base}${fac} · ${main}${cred}${sp ? `<div class="lc-sp">${sp}</div>` : ""}</div>`;
}

/** The whole strip (empty string when there is nothing to show). */
export function capsStrip(caps, tr, nowS = Math.floor(Date.now() / 1000)) {
  const list = (Array.isArray(caps) ? caps : []).filter((c) => c && Number.isFinite(+c.t)).sort((a, b) => b.t - a.t).slice(0, CAPS_LIVE_SHOWN);
  if (!list.length) return "";
  const tip = esc(tr("or.cap.tip", "Outfit with the biggest share of this capture: half the players on the point, half the point-capture XP. Under 50% = no clear lead. Shown only, not used in the odds."));
  return `<div class="lc-head" title="${tip}">${tr("live.capsHead", "🏴 Latest captures on this server")}</div>${list.map((c) => capsLineLive(c, tr, nowS)).join("")}`;
}
