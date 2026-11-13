/**
 * 🛡️ Outfits page (#90, outfits.html): one row per outfit from data/outfits.json (scripts/build-outfits.mjs):
 * tag + name, faction, server, members known of total, median and top 10% avg ⚔️ iVi. PC room only for now;
 * ?room=ps shows a note. Default sort: median, high first; Median, Top 10% avg, Members and Outfit sort on click.
 * Shared table look: .ranks-table (zebra, pinned header and # / name, sort indicators, centered numbers).
 */
import { t as tr, ready, currentLang } from "./i18n.mjs";
import { readOutfitRows, sortOutfits } from "./outfit-stats.mjs?v=20261101-of1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261020-wide1";
import { FACTION_LABEL, FACTION_COLOR } from "./faction-rating.mjs?v=20261031-fr1";
import { SERVER_LABEL } from "./server-rating.mjs?v=20261031-sr1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Columns: key, i18n key, English, sort key (null = not sortable), first sort direction. */
const COLS = [
  { id: "num", cls: "rk-num", k: "of.thNum", en: "#", sort: null },
  { id: "name", cls: "rk-name", k: "of.thOutfit", en: "Outfit", sort: "tag", dir: "asc", tip: ["of.thOutfitTip", "Outfit tag and name. Sort A–Z by tag."] },
  { id: "fac", k: "of.thFaction", en: "Faction", sort: null },
  { id: "srv", k: "of.thServer", en: "Server", sort: null },
  { id: "members", k: "of.thMembers", en: "Members", sort: "members", dir: "desc", tip: ["of.thMembersTip", "Known of total: members with a ⚔️ iVi in our rankings, of all members in Census. The fewer are known, the rougher the estimate."] },
  { id: "med", k: "of.thMedian", en: "Median ⚔️ iVi", sort: "med", dir: "desc", tip: ["of.thMedianTip", "Estimated median ⚔️ iVi: the middle known member (even count: mean of the two middle ones)."] },
  { id: "top", k: "of.thTop", en: "Top 10% avg", sort: "top", dir: "desc", tip: ["of.thTopTip", "Estimated mean ⚔️ iVi of the best 10% of known members (at least one)."] },
];

let rows = [];
let sortKey = "med", sortDir = "desc";
let filter = "";

const lang = () => currentLang();
const n0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString(lang()) : "—");
const int = (v) => (Number.isFinite(+v) ? (+v).toLocaleString(lang()) : "—");

function headHtml() {
  return "<tr>" + COLS.map((c) => {
    const label = esc(tr(c.k, c.en));
    const tip = c.tip ? ` title="${esc(tr(c.tip[0], c.tip[1]))}"` : "";
    if (!c.sort) return `<th class="${c.cls || ""}" scope="col"${tip}>${label}</th>`;
    const on = sortKey === c.sort;
    const ind = on ? (sortDir === "desc" ? "▼" : "▲") : "▼";
    const aria = on ? (sortDir === "desc" ? "descending" : "ascending") : "none";
    return `<th class="${c.cls ? c.cls + " " : ""}sortable${on ? " sorted" : ""}" scope="col" data-sort="${c.sort}" aria-sort="${aria}" tabindex="0"${tip}>${label}<span class="sort-ind${on ? " active" : ""}" aria-hidden="true">${ind}</span></th>`;
  }).join("") + "</tr>";
}

function rowHtml(r, i) {
  const tag = r.tag ? `[${r.tag}] ` : "";
  const full = tag + (r.name || "");
  const name = /^\d+$/.test(String(r.id))
    ? `<a href="https://wt.honu.pw/o/${esc(r.id)}" target="_blank" rel="noopener noreferrer" title="${esc(tr("of.honuTip", "{outfit} on Honu", { outfit: full }))}"><span class="nm">${esc(full)}</span></a>`
    : `<span class="nm" title="${esc(full)}">${esc(full)}</span>`;
  const fac = r.fac && FACTION_LABEL[r.fac] ? `<span class="of-fac" style="color:${FACTION_COLOR[r.fac]}">${esc(FACTION_LABEL[r.fac])}</span>` : "—";
  const srv = r.srv ? esc(SERVER_LABEL[r.srv] || r.srv) : "—";
  const pct = r.total ? Math.round((100 * r.known) / r.total) : null;
  const memTip = tr("of.membersTip", "{k} of {t} members have a ⚔️ iVi in our rankings ({p}%)", { k: int(r.known), t: int(r.total), p: pct == null ? "—" : pct.toLocaleString(lang()) });
  const members = `<span title="${esc(memTip)}">${esc(tr("of.knownOf", "{k} of {t}", { k: int(r.known), t: int(r.total) }))}</span>`;
  return `<tr><td class="rk-num">${(i + 1).toLocaleString(lang())}</td><td class="rk-name">${name}</td><td>${fac}</td><td>${srv}</td><td>${members}</td><td>${n0(r.med)}</td><td>${n0(r.top)}</td></tr>`;
}

function visibleRows() {
  const q = filter.trim().toLowerCase();
  const list = sortOutfits(rows, sortKey, sortDir);
  if (!q) return list;
  return list.filter((r) => String(r.tag).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
}

function render({ keepCol = false } = {}) {
  const wrap = $("ofScroll");
  const prevLeft = wrap ? wrap.scrollLeft : 0;
  $("ofHead").innerHTML = headHtml();
  const list = visibleRows();
  $("ofBody").innerHTML = list.length
    ? list.map(rowHtml).join("")
    : `<tr><td colspan="${COLS.length}" class="of-empty">${esc(tr("of.noMatch", "No outfit matches."))}</td></tr>`;
  $("ofCount").textContent = tr("of.count", "{n} outfits", { n: list.length.toLocaleString(lang()) });
  if (keepCol) keepSortedColumnVisible(wrap, $("ofHead").querySelector("th.sorted"), prevLeft);
}

function onSort(th) {
  const key = th && th.getAttribute("data-sort");
  if (!key) return;
  if (sortKey === key) sortDir = sortDir === "desc" ? "asc" : "desc";
  else { sortKey = key; sortDir = (COLS.find((c) => c.sort === key) || {}).dir || "desc"; }
  render({ keepCol: true });
}

/** Header pinned to the window top while the page scrolls past the box (same as Rankings, t496u). */
function pinHeader() {
  let queued = false, last = -1;
  const pin = () => {
    queued = false;
    const wrap = $("ofScroll"), table = $("ofTable");
    if (!wrap || !table) return;
    const r = wrap.getBoundingClientRect();
    const headH = $("ofHead").getBoundingClientRect().height;
    let off = 0;
    // Portal nav (.site-nav) sticks at the window top: pin below it, not under it.
    const navEl = document.querySelector(".site-nav");
    const navH = navEl ? Math.ceil(navEl.getBoundingClientRect().height) : 0;
    if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top + navH, Math.max(0, wrap.clientHeight - headH));
    off = Math.round(off);
    if (off !== last) { last = off; table.style.setProperty("--rk-head-top", off + "px"); }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(pin); } };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue, { passive: true });
  queue();
}

function status(html, cls = "st-dim") {
  const el = $("ofStatus");
  el.className = cls;
  el.innerHTML = html;
}

async function main() {
  await ready;
  const room = (() => { try { return new URLSearchParams(location.search).get("room"); } catch { return null; } })();
  if (room === "ps") {
    $("ofTableBox").hidden = true;
    status(esc(tr("of.psLater", "PlayStation outfits come later: this list is PC only for now.")) + ` <a href="outfits.html">${esc(tr("of.pcLink", "See the PC outfits"))}</a>`);
    return;
  }
  let json;
  try {
    const r = await fetch("data/outfits.json?t=" + Date.now(), { cache: "no-store" });
    if (r.status === 404) throw Object.assign(new Error("404"), { notYet: true });
    if (!r.ok) throw new Error("HTTP " + r.status);
    json = await r.json();
  } catch (e) {
    $("ofTableBox").hidden = true;
    status(esc(e && e.notYet ? tr("of.notYet", "The outfit list is being built. Check back tomorrow.") : tr("of.loadFail", "Couldn’t load the outfit list ({err}).", { err: e && e.message })), e && e.notYet ? "st-dim" : "st-err");
    return;
  }
  rows = readOutfitRows(json);
  const when = json.updatedAt ? new Date(json.updatedAt).toLocaleDateString(lang(), { year: "numeric", month: "short", day: "numeric" }) : "—";
  status(esc(tr("of.meta", "Updated {when} · {listed} outfits with at least {floor} known members · {inOutfits} of {ranked} ranked players are in an outfit", {
    when, listed: int(rows.length), floor: int(json.floor ?? 5), inOutfits: int(json.inOutfits), ranked: int(json.ranked),
  })));
  $("ofHead").addEventListener("click", (e) => onSort(e.target.closest("th[data-sort]")));
  $("ofHead").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = e.target.closest("th[data-sort]");
    if (th) { e.preventDefault(); onSort(th); }
  });
  $("ofFilter").addEventListener("input", (e) => { filter = e.target.value || ""; render(); });
  render();
  pinHeader();
}

main();
