/**
 * 🆓 Available outfit names (outfit-names.html): a live checker plus the curated
 * list from data/outfit-names.json (scripts/verify-outfit-names.mjs).
 *
 * Availability is PC-wide (outfit-names.mjs): a name taken anywhere on PC is
 * taken everywhere, so the checker asks Census `outfit?name_lower=` /
 * `outfit?alias_lower=` with no server filter. Faction and Server on a row are
 * the suggestion's fit, not a separate availability — and both columns sort,
 * the same as Faction / Server on outfits.html (click a header to sort).
 *
 * Pacing: one Census call at a time, ~1.1 s apart, so "Check all live" stays
 * under the polite 60/min pace. A failed lookup never reports "available":
 * it reports unknown and leaves the row as it was.
 */
import { t as tr, ready, currentLang } from "./i18n.mjs";
import {
  readNameRows, sortNames, filterNames,
  normalizeName, validName, validTag,
  nameLookupUrl, tagLookupUrl, parseLookup,
  localTaken, isNameTakenLocal, isTagTakenLocal,
  OUTFIT_CENSUS_BASE,
} from "./outfit-names.mjs?v=20261114-on1";
import { readOutfitRows } from "./outfit-stats.mjs?v=20261101-of1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261020-wide1";
import { FACTION_LABEL, FACTION_COLOR } from "./faction-rating.mjs?v=20261031-fr1";
import { SERVER_LABEL } from "./server-rating.mjs?v=20261031-sr1";
import { WORLD_NAMES } from "./outfit-tags.mjs?v=20261101-osrv1";
import { censusBase } from "./census-fetch.mjs?v=20261010-sav1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const GAP_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Columns: key, i18n key, English, sort key (null = not sortable), first sort direction. */
const COLS = [
  { id: "num", cls: "rk-num", k: "on.thNum", en: "#", sort: null },
  { id: "name", cls: "rk-name", k: "on.thOutfit", en: "Outfit", sort: "name", dir: "asc", tip: ["on.thOutfitTip", "Outfit tag and name. Sort A–Z by name."] },
  { id: "fac", k: "on.thFaction", en: "Faction", sort: "fac", dir: "asc", tip: ["on.thFactionTip", "The faction the name is themed for. Sort to group one faction together."] },
  { id: "srv", k: "on.thServer", en: "Server", sort: "srv", dir: "asc", tip: ["on.thServerTip", "The server the name is suggested for. Sort to group one server together."] },
  { id: "tag", k: "on.thTag", en: "Tag", sort: "tag", dir: "asc", tip: ["on.thTagTip", "Suggested tag, 1–4 letters or digits. Sort A–Z by tag."] },
  { id: "status", k: "on.thStatus", en: "Status", sort: null, tip: ["on.thStatusTip", "Checked when the list was built, or when you re-checked it. Re-check before you create the outfit."] },
];

let rows = []; // { name, tag, fac, srv, state } — state: { kind: "verified"|"free"|"taken"|"failed", when?, detail? }
let takenLocal = { names: new Set(), tags: new Set() };
let verifiedAt = null;
let sortKey = "name", sortDir = "asc";
let filter = "", facFilter = "all", srvFilter = "all";
let checkAllStop = false;
let checkingAll = false;

const lang = () => currentLang();
const int = (v) => (Number.isFinite(+v) ? (+v).toLocaleString(lang()) : "—");

/** "[00] Recursion (303 members, Osprey)"; world unknown → no server part. */
function holderLabel(r) {
  const full = `${r.tag ? `[${r.tag}] ` : ""}${r.name}`.trim();
  const server = (r.world && WORLD_NAMES[+r.world]) || "";
  const members = r.members ? ` · ${int(r.members)} ${tr("on.members", "members")}` : "";
  return `${full}${server ? ` (${server})` : ""}${members}`;
}

async function censusLookup(url) {
  // One attempt on the site's registered ID, then one on Daybreak's casual ID:
  // the registered ID can go quiet under load (seen 2026-11-14: it stopped
  // answering this machine after the ~400 verification calls, while s:example
  // answered in 0.5 s). A failed lookup still never reports "available" —
  // checkLive only calls this through parseLookup, and unknown stays unknown.
  const bases = [null, censusBase("example")];
  let lastErr = null;
  for (const base of bases) {
    const u = base ? url.replace(OUTFIT_CENSUS_BASE, base) : url;
    try {
      const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (r.status === 429) throw Object.assign(new Error("429"), { rateLimited: true });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const parsed = parseLookup(await r.json());
      if (parsed.taken === null) throw new Error("Census error");
      return parsed;
    } catch (e) {
      if (e && e.rateLimited) throw e;
      lastErr = e;
      await sleep(800);
    }
  }
  throw lastErr || new Error("Census unavailable");
}

/** Live verdict for one name + optional tag: { name, tag } each { verdict: "free"|"taken"|"unknown", rows }. */
async function checkLive(name, tag) {
  const out = {};
  const n = await censusLookup(nameLookupUrl(OUTFIT_CENSUS_BASE, name));
  out.name = n.taken === null ? { verdict: "unknown", rows: [] } : { verdict: n.taken ? "taken" : "free", rows: n.rows };
  if (tag) {
    await sleep(GAP_MS);
    const t = await censusLookup(tagLookupUrl(OUTFIT_CENSUS_BASE, tag));
    out.tag = t.taken === null ? { verdict: "unknown", rows: [] } : { verdict: t.taken ? "taken" : "free", rows: t.rows };
  }
  return out;
}

function headHtml() {
  return "<tr>" + COLS.map((c) => {
    const label = esc(tr(c.k, c.en));
    const tip = c.tip ? ` title="${esc(tr(c.tip[0], c.tip[1]))}"` : "";
    if (!c.sort) return `<th class="${c.cls || ""}" scope="col"${tip}>${label}</th>`;
    const on = sortKey === c.sort;
    const ind = on ? (sortDir === "desc" ? "▼" : "▲") : (c.dir === "desc" ? "▼" : "▲");
    const aria = on ? (sortDir === "desc" ? "descending" : "ascending") : "none";
    return `<th class="${c.cls ? c.cls + " " : ""}sortable${on ? " sorted" : ""}" scope="col" data-sort="${c.sort}" aria-sort="${aria}" tabindex="0"${tip}>${label}<span class="sort-ind${on ? " active" : ""}" aria-hidden="true">${ind}</span></th>`;
  }).join("") + "</tr>";
}

function statusHtml(r) {
  const s = r.state || { kind: "verified" };
  if (s.kind === "checking") return `<span>${esc(tr("on.rechecking", "Checking…"))}</span>`;
  if (s.kind === "taken") return `<span>${esc(tr("on.takenNow", "❌ Taken now: {outfit}", { outfit: s.detail || "" }))}</span><button type="button" class="on-recheck" data-recheck="${esc(r.name)}">${esc(tr("on.recheck", "Re-check"))}</button>`;
  if (s.kind === "failed") return `<span>${esc(tr("on.checkFailed", "⚠️ Check failed — try again"))}</span><button type="button" class="on-recheck" data-recheck="${esc(r.name)}">${esc(tr("on.recheck", "Re-check"))}</button>`;
  if (s.kind === "free") {
    const when = new Date().toLocaleDateString(lang(), { year: "numeric", month: "short", day: "numeric" });
    return `<span>${esc(tr("on.verified", "✅ Available · checked {when}", { when }))}</span><button type="button" class="on-recheck" data-recheck="${esc(r.name)}">${esc(tr("on.recheck", "Re-check"))}</button>`;
  }
  const when = verifiedAt ? new Date(verifiedAt).toLocaleDateString(lang(), { year: "numeric", month: "short", day: "numeric" }) : "—";
  return `<span>${esc(tr("on.verified", "✅ Available · checked {when}", { when }))}</span><button type="button" class="on-recheck" data-recheck="${esc(r.name)}">${esc(tr("on.recheck", "Re-check"))}</button>`;
}

function rowHtml(r, i) {
  const tag = r.tag ? `[${r.tag}] ` : "";
  const full = tag + (r.name || "");
  const fac = r.fac && FACTION_LABEL[r.fac] ? `<span class="of-fac" style="color:${FACTION_COLOR[r.fac]}">${esc(FACTION_LABEL[r.fac])}</span>` : "—";
  const srv = r.srv ? esc(SERVER_LABEL[r.srv] || r.srv) : "—";
  return `<tr><td class="rk-num">${(i + 1).toLocaleString(lang())}</td><td class="rk-name"><span class="nm">${esc(full)}</span></td><td>${fac}</td><td>${srv}</td><td>${esc(r.tag || "—")}</td><td class="on-status-cell">${statusHtml(r)}</td></tr>`;
}

function visibleRows() {
  const list = sortNames(rows, sortKey, sortDir);
  return filterNames(list, { q: filter, fac: facFilter, srv: srvFilter });
}

function render({ keepCol = false } = {}) {
  const wrap = $("onScroll");
  const prevLeft = wrap ? wrap.scrollLeft : 0;
  $("onHead").innerHTML = headHtml();
  const list = visibleRows();
  $("onBody").innerHTML = list.length
    ? list.map(rowHtml).join("")
    : `<tr><td colspan="${COLS.length}" class="of-empty">${esc(tr("on.noMatch", "No outfit name matches."))}</td></tr>`;
  $("onCount").textContent = tr("on.count", "{n} names", { n: list.length.toLocaleString(lang()) });
  if (keepCol) keepSortedColumnVisible(wrap, $("onHead").querySelector("th.sorted"), prevLeft);
}

function onSort(th) {
  const key = th && th.getAttribute("data-sort");
  if (!key) return;
  if (sortKey === key) sortDir = sortDir === "desc" ? "asc" : "desc";
  else { sortKey = key; sortDir = (COLS.find((c) => c.sort === key) || {}).dir || "asc"; }
  render({ keepCol: true });
}

/** Header pinned to the window top while the page scrolls past the box (same as Rankings / Outfits). */
function pinHeader() {
  let queued = false, last = -1;
  const pin = () => {
    queued = false;
    const wrap = $("onScroll"), table = $("onTable");
    if (!wrap || !table) return;
    const r = wrap.getBoundingClientRect();
    const headH = $("onHead").getBoundingClientRect().height;
    let off = 0;
    if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top, Math.max(0, wrap.clientHeight - headH));
    off = Math.round(off);
    if (off !== last) { last = off; table.style.setProperty("--rk-head-top", off + "px"); }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(pin); } };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue, { passive: true });
  queue();
}

function status(html, cls = "st-dim") {
  const el = $("onStatus");
  el.className = cls;
  el.innerHTML = html;
}

function copyText(text, btn) {
  const done = () => { if (btn) btn.textContent = tr("on.copied", "Copied “{full}”.", { full: text }); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  } catch { done(); }
}

async function onCheck() {
  const name = $("onName").value.trim();
  const tag = $("onTag").value.trim().replace(/^\[|\]$/g, "");
  const fac = $("onFac").value, srv = $("onSrv").value;
  const box = $("onResult"), btn = $("onCheckBtn");
  if (!validName(name)) {
    box.className = "on-result st-err";
    box.textContent = tr("on.nameInvalid", "Outfit names are 1–32 letters, digits and spaces.");
    return;
  }
  if (!validTag(tag)) {
    box.className = "on-result st-err";
    box.textContent = tr("on.tagInvalid", "Tags are 1–4 letters or digits.");
    return;
  }
  btn.disabled = true;
  box.className = "on-result st-dim";
  box.textContent = tr("on.checking", "Checking Census…");
  const full = `${tag ? `[${tag}] ` : ""}${name}`;
  try {
    // Instant local verdict first (a listed outfit with this normalised name/tag
    // is definitely taken); Census still names the holder.
    const localName = isNameTakenLocal(name, takenLocal);
    const localTag = tag ? isTagTakenLocal(tag, takenLocal) : false;
    const live = await checkLive(name, tag || "");
    const bits = [];
    const nV = localName ? "taken" : live.name.verdict;
    if (nV === "taken") {
      const holder = live.name.rows[0] ? holderLabel(live.name.rows[0]) : "";
      bits.push(esc(tr("on.nameTaken", "❌ “{name}” is taken: {outfit}.", { name, outfit: holder || full })));
    } else if (nV === "free") bits.push(esc(tr("on.nameFree", "✅ “{name}” is available on PC.", { name })));
    else bits.push(esc(tr("on.nameUnknown", "⚠️ Couldn’t check “{name}” — Census didn’t answer. Try again in a minute.", { name })));
    if (tag) {
      const tV = localTag ? "taken" : live.tag.verdict;
      if (tV === "taken") {
        const holder = live.tag.rows[0] ? holderLabel(live.tag.rows[0]) : "";
        bits.push(esc(tr("on.tagTaken", "❌ Tag [{tag}] is taken: {outfit}.", { tag, outfit: holder || full })));
      } else if (tV === "free") bits.push(esc(tr("on.tagFree", "✅ Tag [{tag}] is available on PC.", { tag })));
      else bits.push(esc(tr("on.tagUnknown", "⚠️ Couldn’t check tag [{tag}] — Census didn’t answer. Try again in a minute.", { tag })));
    }
    const free = nV === "free" && (!tag || live.tag.verdict === "free");
    box.className = "on-result " + (free ? "st-dim" : (nV === "taken" || (tag && live.tag.verdict === "taken") ? "st-err" : "st-dim"));
    box.innerHTML = bits.join(" ");
    if (free) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "on-copy";
      b.textContent = tr("on.copy", "Copy");
      b.addEventListener("click", () => copyText(full, b));
      box.appendChild(b);
    }
    // Keep the checked name in the list's memory: an available name with its
    // chosen faction/server joins the table (state: free, just checked).
    if (free && !rows.some((r) => normalizeName(r.name) === normalizeName(name))) {
      rows.push({ name, tag, fac, srv, state: { kind: "free" } });
      render();
    }
  } catch (e) {
    box.className = "on-result st-err";
    box.textContent = e && e.rateLimited
      ? tr("on.nameUnknown", "⚠️ Couldn’t check “{name}” — Census didn’t answer. Try again in a minute.", { name })
      : tr("on.nameUnknown", "⚠️ Couldn’t check “{name}” — Census didn’t answer. Try again in a minute.", { name });
  } finally {
    btn.disabled = false;
  }
}

async function recheckRow(name) {
  const r = rows.find((x) => x.name === name);
  if (!r || (r.state && r.state.kind === "checking")) return;
  r.state = { kind: "checking" };
  render();
  try {
    const live = await checkLive(r.name, r.tag || "");
    if (live.name.verdict === "taken") {
      r.state = { kind: "taken", detail: live.name.rows[0] ? holderLabel(live.name.rows[0]) : "" };
    } else if (live.name.verdict === "free" && (!r.tag || live.tag.verdict !== "taken")) {
      r.state = { kind: "free" };
    } else if (live.name.verdict === "free" && live.tag.verdict === "taken") {
      r.state = { kind: "taken", detail: tr("on.tagTaken", "❌ Tag [{tag}] is taken: {outfit}.", { tag: r.tag, outfit: live.tag.rows[0] ? holderLabel(live.tag.rows[0]) : "" }) };
    } else {
      r.state = { kind: "failed" };
    }
  } catch {
    r.state = { kind: "failed" };
  }
  render();
}

async function checkAll() {
  const btn = $("onCheckAllBtn");
  if (checkingAll) { checkAllStop = true; return; }
  checkingAll = true;
  checkAllStop = false;
  btn.textContent = tr("on.checkAllStop", "Stop");
  let free = 0, taken = 0, failed = 0, stopped = false;
  // Names only: one call per row keeps the run near a minute for 60 rows.
  // Tags keep their build-time verdict; re-check a row for its tag.
  for (let i = 0; i < rows.length; i++) {
    if (checkAllStop) { stopped = true; break; }
    const r = rows[i];
    status(esc(tr("on.checkAllRunning", "Checking {i} of {n}…", { i: (i + 1).toLocaleString(lang()), n: rows.length.toLocaleString(lang()) })));
    try {
      const n = await censusLookup(nameLookupUrl(OUTFIT_CENSUS_BASE, r.name));
      if (n.taken === null) { r.state = { kind: "failed" }; failed++; }
      else if (n.taken) { r.state = { kind: "taken", detail: n.rows[0] ? holderLabel(n.rows[0]) : "" }; taken++; }
      else { r.state = { kind: "free" }; free++; }
    } catch (e) {
      if (e && e.rateLimited) { status(esc(tr("on.checkFailed", "⚠️ Check failed — try again")), "st-err"); stopped = true; break; }
      r.state = { kind: "failed" }; failed++;
    }
    render();
    if (i < rows.length - 1) await sleep(GAP_MS);
  }
  checkingAll = false;
  btn.textContent = tr("on.checkAll", "Check all live");
  if (!stopped) {
    status(esc(tr("on.checkAllDone", "Checked {n} names live: {free} still available, {taken} taken now.", { n: rows.length.toLocaleString(lang()), free: free.toLocaleString(lang()), taken: taken.toLocaleString(lang()) })) + (failed ? ` ${esc(tr("on.checkFailed", "⚠️ Check failed — try again"))} ×${failed}` : ""));
  }
}

async function main() {
  await ready;
  let json;
  try {
    const r = await fetch("data/outfit-names.json?t=" + Date.now(), { cache: "no-store" });
    if (r.status === 404) throw Object.assign(new Error("404"), { notYet: true });
    if (!r.ok) throw new Error("HTTP " + r.status);
    json = await r.json();
  } catch (e) {
    $("onTableBox").hidden = true;
    status(esc(e && e.notYet ? tr("on.notYet", "The name list is being built. Check back soon.") : tr("on.loadFail", "Couldn’t load the name list ({err}).", { err: e && e.message })), e && e.notYet ? "st-dim" : "st-err");
    return;
  }
  rows = readNameRows(json).map((r) => ({ ...r, state: { kind: "verified" } }));
  verifiedAt = json.verifiedAt || null;
  try {
    const r = await fetch("data/outfits.json?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) takenLocal = localTaken(readOutfitRows(await r.json()));
  } catch {}
  const perFac = {};
  for (const r of rows) perFac[r.fac] = (perFac[r.fac] || 0) + 1;
  const perFacTxt = Object.entries(perFac).map(([f, n]) => `${FACTION_LABEL[f] || f} ${n}`).join(" · ");
  status(esc(tr("on.meta", "List verified {when} · {n} names · {perFac}", {
    when: verifiedAt ? new Date(verifiedAt).toLocaleDateString(lang(), { year: "numeric", month: "short", day: "numeric" }) : "—",
    n: int(rows.length), perFac: perFacTxt,
  })));
  $("onHead").addEventListener("click", (e) => onSort(e.target.closest("th[data-sort]")));
  $("onHead").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = e.target.closest("th[data-sort]");
    if (th) { e.preventDefault(); onSort(th); }
  });
  $("onBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-recheck]");
    if (b && !b.disabled) recheckRow(b.getAttribute("data-recheck"));
  });
  $("onFilter").addEventListener("input", (e) => { filter = e.target.value || ""; render(); });
  $("onFacFilter").addEventListener("change", (e) => { facFilter = e.target.value || "all"; render(); });
  $("onSrvFilter").addEventListener("change", (e) => { srvFilter = e.target.value || "all"; render(); });
  $("onCheckBtn").addEventListener("click", onCheck);
  $("onName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCheck(); } });
  $("onTag").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCheck(); } });
  $("onCheckAllBtn").addEventListener("click", checkAll);
  render();
  pinHeader();
}

main();
