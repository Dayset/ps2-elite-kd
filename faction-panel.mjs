/**
 * 🏳️ Faction rating section on the main page (t795u) + the NC / TR / VS / NS name-box alias.
 * Reads data/factions.json (scripts/build-ranks.mjs, faction-rating.mjs). PC only (PS has no faction data yet).
 * Static bars (no animation, owner rule for the main site), charts first, the small table last.
 */
import { t as tr } from "./i18n.mjs";
import { escapeHtml } from "./app-util.mjs?v=20261027-z79";
import { glideTo } from "./jump-btns.mjs?v=20261020-i18n2";
import { fetchJsonRetry } from "./server-panel.mjs?v=20261031-sr2";
import { FACTIONS, FACTION_LABEL, FACTION_COLOR, FACTION_TOP_N, leader } from "./faction-rating.mjs?v=20261031-fr1";

const URL_ = "./data/factions.json";
let dataP = null;
/** factions.json, fetched once per page (null on error or in the PlayStation room). */
export function loadFactions() {
  // t801u: same retry as servers.json; a failure is not kept, so the next use tries again
  if (!dataP) dataP = fetchJsonRetry(URL_).then((d) => { if (!d) dataP = null; return d; });
  return dataP;
}

const fin = Number.isFinite;
const n0 = (x) => (fin(x) ? Math.round(x).toLocaleString() : "—");
const pct = (x) => (fin(x) ? Math.round(x * 100) + "%" : "—");
const fx = (x, d) => (fin(x) ? x.toFixed(d) : "—");
const chip = (f) => `<span class="fr-chip" style="--fc:${FACTION_COLOR[f]}">${FACTION_LABEL[f]}</span>`;

/** One bar chart: rows = [{ f, v, label }]; bars scale to the largest value. */
function bars(title, sub, rows, hi) {
  const max = Math.max(...rows.map((r) => (fin(r.v) ? r.v : 0)), 1e-9);
  const body = rows.map((r) => {
    const w = fin(r.v) && r.v > 0 ? Math.max(1, Math.round((r.v / max) * 100)) : 0;
    return `<div class="fr-row${r.f === hi ? " fr-hi" : ""}">${chip(r.f)}<span class="fr-track"><span class="fr-bar" style="width:${w}%;background:${FACTION_COLOR[r.f]}"></span></span><span class="fr-val">${escapeHtml(r.label)}</span></div>`;
  }).join("");
  return `<figure class="fr-chart"><figcaption><b>${escapeHtml(title)}</b>${sub ? ` <span class="fr-sub">${escapeHtml(sub)}</span>` : ""}</figcaption>${body}</figure>`;
}

/** Section HTML from factions.json (pure: tests call it). hi = faction to highlight (alias). */
export function factionHtml(d, hi = null) {
  if (!d || !d.factions) return `<p class="fr-note">${escapeHtml(tr("fr.none", "No faction data yet."))}</p>`;
  const F = d.factions; // t804u: the alt-family part is gone from the section (owner)
  const best = leader(F, (x, f) => x[f].medIvi);
  const lead = [
    tr("fr.leadAll", "Strongest overall: {f}, median ⚔️ iVi {v}; {p} of its players are in the top 10%.", { f: FACTION_LABEL[best], v: n0(F[best].medIvi), p: pct(F[best].topRate) }),
  ].filter(Boolean).map((s) => `<p class="fr-lead">${escapeHtml(s)}</p>`).join("");
  const charts = [
    bars(tr("fr.chIvi", "Median ⚔️ iVi"), tr("fr.chIviSub", "half of the faction's players are above"), FACTIONS.map((f) => ({ f, v: F[f].medIvi, label: n0(F[f].medIvi) })), hi),
    bars(tr("fr.chTop", "In the top 10%"), tr("fr.chTopSub", "share of the faction's own players"), FACTIONS.map((f) => ({ f, v: F[f].topRate, label: `${pct(F[f].topRate)} · ${tr("fr.top100", "top 100: {n}", { n: F[f].top100 })}` })), hi),
    bars(tr("fr.chPlayers", "Players"), tr("fr.chPlayersSub", "rated players in the cache"), FACTIONS.map((f) => ({ f, v: F[f].n, label: n0(F[f].n) })), hi),
  ].join("");
  const head = [tr("fr.thFaction", "Faction"), tr("fr.thPlayers", "Players"), tr("fr.thMed", "Median ⚔️ iVi"), tr("fr.thMean", "Average ⚔️ iVi"), tr("fr.thKd", "Median K/D"), tr("fr.thKpm", "Median KPM"), tr("fr.thHours", "Median hours"), ""];
  const rows = FACTIONS.map((f) => {
    const x = F[f];
    const btn = `<button type="button" class="fr-load mini-btn" data-faction="${f}" title="${escapeHtml(tr("fr.loadTip", "Put this faction's top {n} players in the name box", { n: FACTION_TOP_N }))}">${escapeHtml(tr("fr.load", "Top {n}", { n: FACTION_TOP_N }))}</button>`;
    return `<tr${f === hi ? ' class="fr-hi"' : ""}><td>${chip(f)}</td><td>${n0(x.n)}</td><td>${n0(x.medIvi)}</td><td>${n0(x.meanIvi)}</td><td>${fx(x.medKd, 2)}</td><td>${fx(x.medKpm, 2)}</td><td>${n0(x.medH)}</td><td>${btn}</td></tr>`;
  }).join("");
  const table = `<div class="fr-table-wrap"><table class="fr-table"><thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const note = tr("fr.note", "NS = Nanite Systems (NSO). Faction = the character's own. OOR players and confirmed padders are left out ({left} padders).", { left: (d.left && d.left.padders) || 0 });
  const tip = tr("fr.aliasTip", "Tip: type NC, TR, VS or NS in the name box to load that faction's top {n} players.", { n: FACTION_TOP_N });
  return `${lead}<div class="fr-charts">${charts}</div>${table}<p class="fr-note">${escapeHtml(note)}</p><p class="fr-note">${escapeHtml(tip)}</p>`;
}

/**
 * Wire the section (#factionSection): fills on first open, "Top 50" buttons add players like the alias.
 * $ = { addFactions(f) } from the name field. Hidden in the PlayStation room.
 */
export function initFactionPanel({ isPs = false, addFactions = null } = {}) {
  const sec = typeof document !== "undefined" && document.getElementById("factionSection");
  if (!sec) return null;
  if (isPs) { sec.hidden = true; return null; }
  sec.hidden = false;
  const body = document.getElementById("factionBody");
  let hi = null, drawn = false;
  const draw = () => loadFactions().then((d) => {
    if (!body) return;
    body.innerHTML = factionHtml(d, hi);
    drawn = !!d; // no data yet → the next open tries again
    const at = document.getElementById("factionUpdated");
    if (at && d && d.updatedAt) at.textContent = new Date(d.updatedAt).toLocaleDateString();
  });
  if (typeof window !== "undefined") window.addEventListener("ps2-lang", () => { if (drawn) draw(); });
  sec.addEventListener("toggle", () => { if (sec.open && !drawn) draw(); });
  if (sec.open) draw();
  sec.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".fr-load");
    if (!b || !addFactions) return;
    // t797u: jump (instant, no glide on the main site) up to the name box so the new chips are in view.
    const toNames = () => {
      const box = document.getElementById("namesBox");
      if (!box || !box.getBoundingClientRect) return;
      glideTo(null, Math.max(0, Math.round(box.getBoundingClientRect().top + (window.scrollY || 0) - 10)), "auto");
    };
    toNames();
    Promise.resolve(addFactions([b.dataset.faction])).then(toNames, toNames);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.fr-jump");
    if (a) sec.open = true; // the anchor jumps (instant, no smooth scroll)
  });
  /** Open the section on one faction (the alias). */
  function show(f) {
    hi = f;
    sec.open = true;
    draw();
  }
  return { show, draw };
}

/**
 * The alias: add a faction's top players as outfit-style chips (the outfit cap, OUTFIT_MAX_NAMES = 50; they are all
 * saved players, so no Census call). $ = { addNameToField, outfitRoom, note, isPs, show }.
 */
export async function addFactionPlayers(factions, $) {
  const out = [];
  for (const f of factions) {
    const label = FACTION_LABEL[f] || String(f).toUpperCase();
    if ($.isPs) { $.note(escapeHtml(tr("fr.psOnly", "Faction lists ({f}) are PC only for now.", { f: label })), "warn"); out.push({ added: 0 }); continue; }
    if ($.outfitRoom() <= 0) { $.note(escapeHtml(tr("fr.capFull", "The list already holds {max} outfit or faction players, the most it takes. Remove some to add {f}.", { f: label, max: FACTION_TOP_N })), "warn"); out.push({ added: 0 }); continue; }
    $.note(escapeHtml(tr("fr.looking", "⏳ Loading the top {f} players…", { f: label })));
    const d = await loadFactions();
    const list = d && d.top && d.top[f];
    if (!list || !list.length) { $.note(escapeHtml(tr("fr.noData", "No faction data yet. Try again later.")), "err"); out.push({ added: 0 }); continue; }
    let added = 0, noRoom = 0;
    for (const n of list) {
      if ($.outfitRoom() <= 0) { noRoom++; continue; }
      if ($.addNameToField(n, { quiet: true, outfit: true })) added++;
    }
    if ($.show) $.show(f);
    const jump = `<a class="fr-jump" href="#factionSection">${escapeHtml(tr("fr.jump", "See the faction rating ↓"))}</a>`;
    const msg = added
      ? tr("fr.added", "{f}: added {added} of its top {n} players (best ⚔️ iVi, active first). Press Analyze to compare them.", { f: label, added, n: list.length })
      : tr("fr.allIn", "{f}: its top players are already in the list.", { f: label });
    $.note(`${escapeHtml(msg)}${noRoom ? " " + escapeHtml(tr("outfit.noRoom", "{n} more not added: a list takes at most {max} outfit players, to keep loading quick and polite to Daybreak's servers.", { n: noRoom, max: FACTION_TOP_N })) : ""} ${jump}`, added ? "ok" : "warn");
    out.push({ added, noRoom });
  }
  return out;
}
