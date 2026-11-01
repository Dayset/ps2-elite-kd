/**
 * 🌐 Server rating section on the main page (t798u / t799u) + the server-name alias ("osprey", "wainwright"; in the
 * PlayStation room "genudine", "ceres"). Reads data/servers.json or data-ps/servers.json (scripts/build-ranks.mjs,
 * server-rating.mjs). Same look as the 🏳️ Faction section (faction-panel.mjs): static bars, charts first, table last.
 */
import { t as tr } from "./i18n.mjs";
import { escapeHtml } from "./app-util.mjs?v=20261027-z79";
import { glideTo } from "./jump-btns.mjs?v=20261020-i18n2";
import { SERVER_LABEL, SERVER_COLOR, SERVER_TOP_N, serverLeader } from "./server-rating.mjs?v=20261031-sr1";

/**
 * t801u / t803u: one failed load (a 404 still cached at the edge right after a deploy, a dropped connection) used to
 * be kept for the whole visit, so the alias added nobody and the section stayed empty until a reload. Now a failure
 * is never kept, and the second try skips every cached copy.
 */
export async function fetchJsonRetry(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const u = i ? url + (url.includes("?") ? "&" : "?") + "r=" + Date.now() : url;
      const r = await fetch(u, { cache: i ? "reload" : "no-cache" });
      if (r && r.ok) { const d = await r.json(); if (d && typeof d === "object") return d; }
    } catch (e) { /* try again */ }
  }
  return null;
}

const dataP = {};
/** servers.json for the room: kept once loaded; a failure (null) is not kept, so the next use tries again. */
export function loadServers(isPs = false) {
  const url = isPs ? "./data-ps/servers.json" : "./data/servers.json";
  if (!dataP[url]) dataP[url] = fetchJsonRetry(url).then((d) => { if (!d) delete dataP[url]; return d; });
  return dataP[url];
}

const fin = Number.isFinite;
const n0 = (x) => (fin(x) ? Math.round(x).toLocaleString() : "—");
const pct = (x) => (fin(x) ? Math.round(x * 100) + "%" : "—");
const fx = (x, d) => (fin(x) ? x.toFixed(d) : "—");
const label = (s) => SERVER_LABEL[s] || String(s);
const chip = (s) => `<span class="fr-chip sr-chip" style="--fc:${SERVER_COLOR[s] || "#888"}">${escapeHtml(label(s))}</span>`;

function bars(title, sub, rows, hi) {
  const max = Math.max(...rows.map((r) => (fin(r.v) ? r.v : 0)), 1e-9);
  const body = rows.map((r) => {
    const w = fin(r.v) && r.v > 0 ? Math.max(1, Math.round((r.v / max) * 100)) : 0;
    return `<div class="fr-row${r.s === hi ? " fr-hi" : ""}">${chip(r.s)}<span class="fr-track"><span class="fr-bar" style="width:${w}%;background:${SERVER_COLOR[r.s] || "#888"}"></span></span><span class="fr-val">${escapeHtml(r.label)}</span></div>`;
  }).join("");
  return `<figure class="fr-chart"><figcaption><b>${escapeHtml(title)}</b>${sub ? ` <span class="fr-sub">${escapeHtml(sub)}</span>` : ""}</figcaption>${body}</figure>`;
}

/** Section HTML from servers.json (pure: tests call it). hi = server to highlight (alias). */
export function serverHtml(d, hi = null) {
  if (!d || !d.stats || !Array.isArray(d.servers) || !d.servers.length) return `<p class="fr-note">${escapeHtml(tr("srv.none", "No server data yet."))}</p>`;
  const S = d.stats, L = d.servers;
  const best = serverLeader(d, (x, s) => x.stats[s].medIvi);
  const lead = best ? `<p class="fr-lead">${escapeHtml(tr("srv.lead", "Strongest server: {s}, median ⚔️ iVi {v}; {p} of its players are in the top 10%.", { s: label(best), v: n0(S[best].medIvi), p: pct(S[best].topRate) }))}</p>` : "";
  const charts = [
    bars(tr("fr.chIvi", "Median ⚔️ iVi"), tr("srv.chIviSub", "half of the server's players are above"), L.map((s) => ({ s, v: S[s].medIvi, label: n0(S[s].medIvi) })), hi),
    bars(tr("fr.chTop", "In the top 10%"), tr("srv.chTopSub", "share of the server's own players"), L.map((s) => ({ s, v: S[s].topRate, label: `${pct(S[s].topRate)} · ${tr("fr.top100", "top 100: {n}", { n: S[s].top100 })}` })), hi),
    bars(tr("srv.chP90", "Top 10% starts at"), tr("srv.chP90Sub", "⚔️ iVi of the server's 90th percentile"), L.map((s) => ({ s, v: S[s].p90Ivi, label: n0(S[s].p90Ivi) })), hi),
    bars(tr("fr.chPlayers", "Players"), tr("fr.chPlayersSub", "rated players in the cache"), L.map((s) => ({ s, v: S[s].n, label: n0(S[s].n) })), hi),
  ].join("");
  const head = [tr("srv.thServer", "Server"), tr("fr.thPlayers", "Players"), tr("fr.thMed", "Median ⚔️ iVi"), tr("fr.thMean", "Average ⚔️ iVi"), tr("fr.thKd", "Median K/D"), tr("fr.thKpm", "Median KPM"), tr("fr.thHours", "Median hours"), ""];
  const rows = L.map((s) => {
    const x = S[s];
    const btn = `<button type="button" class="fr-load sr-load mini-btn" data-server="${escapeHtml(s)}" title="${escapeHtml(tr("srv.loadTip", "Put this server's top {n} players in the name box", { n: SERVER_TOP_N }))}">${escapeHtml(tr("fr.load", "Top {n}", { n: SERVER_TOP_N }))}</button>`;
    return `<tr${s === hi ? ' class="fr-hi"' : ""}><td>${chip(s)}</td><td>${n0(x.n)}</td><td>${n0(x.medIvi)}</td><td>${n0(x.meanIvi)}</td><td>${fx(x.medKd, 2)}</td><td>${fx(x.medKpm, 2)}</td><td>${n0(x.medH)}</td><td>${btn}</td></tr>`;
  }).join("");
  const table = `<div class="fr-table-wrap"><table class="fr-table"><thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const other = (d.left && d.left.noServer) || 0;
  const note = d.ps
    ? tr("srv.notePs", "Server = the character's own (Genudine = PS4 US, Ceres = PS4 EU). OOR players and confirmed padders are left out ({left} padders).", { left: (d.left && d.left.padders) || 0 })
    : tr("srv.note", "Server = the character's home world from Census. Connery and Emerald players count as Osprey, Miller and Cobalt as Wainwright (merged servers). OOR players and confirmed padders are left out ({left} padders); {other} players on other worlds (Jaeger, SolTech) too.", { left: (d.left && d.left.padders) || 0, other });
  const tip = tr("srv.aliasTip", "Tip: type {names} in the name box to load that server's top {n} players.", { names: L.map(label).join(" / "), n: SERVER_TOP_N });
  return `${lead}<div class="fr-charts">${charts}</div>${table}<p class="fr-note">${escapeHtml(note)}</p><p class="fr-note">${escapeHtml(tip)}</p>`;
}

/** The instant jump up to the name box (t797u, shared with the 🏳️ buttons). */
function toNames() {
  const box = typeof document !== "undefined" && document.getElementById("namesBox");
  if (!box || !box.getBoundingClientRect) return;
  glideTo(null, Math.max(0, Math.round(box.getBoundingClientRect().top + (window.scrollY || 0) - 10)), "auto");
}

/** Wire #serverSection: fills on first open; "Top 50" buttons add players like the alias, then jump to the names. */
export function initServerPanel({ isPs = false, addServers = null } = {}) {
  const sec = typeof document !== "undefined" && document.getElementById("serverSection");
  if (!sec) return null;
  sec.hidden = false;
  const body = document.getElementById("serverBody");
  let hi = null, drawn = false;
  const draw = () => loadServers(isPs).then((d) => {
    if (!body) return;
    body.innerHTML = serverHtml(d, hi);
    drawn = !!d; // t803u: no data yet → the next open tries again
    const at = document.getElementById("serverUpdated");
    if (at && d && d.updatedAt) at.textContent = new Date(d.updatedAt).toLocaleDateString();
  });
  if (typeof window !== "undefined") window.addEventListener("ps2-lang", () => { if (drawn) draw(); });
  sec.addEventListener("toggle", () => { if (sec.open && !drawn) draw(); });
  if (sec.open) draw();
  sec.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".sr-load");
    if (!b || !addServers) return;
    toNames();
    Promise.resolve(addServers([b.dataset.server])).then(toNames, toNames);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.sr-jump");
    if (a) sec.open = true;
  });
  function show(s) { hi = s; sec.open = true; draw(); }
  return { show, draw };
}

/** The alias: add a server's top players as outfit-style chips (same cap as outfits and factions; saved players). */
export async function addServerPlayers(servers, $) {
  const out = [];
  for (const s of servers) {
    const name = label(s);
    if ($.outfitRoom() <= 0) { $.note(escapeHtml(tr("fr.capFull", "The list already holds {max} outfit or faction players, the most it takes. Remove some to add {f}.", { f: name, max: SERVER_TOP_N })), "warn"); out.push({ added: 0 }); continue; }
    $.note(escapeHtml(tr("fr.looking", "⏳ Loading the top {f} players…", { f: name })));
    const d = await loadServers($.isPs);
    const list = d && d.top && d.top[s];
    if (!list || !list.length) { $.note(escapeHtml(tr("srv.noData", "No server data yet. Try again later.")), "err"); out.push({ added: 0 }); continue; }
    let added = 0, noRoom = 0;
    for (const n of list) {
      if ($.outfitRoom() <= 0) { noRoom++; continue; }
      if ($.addNameToField(n, { quiet: true, outfit: true })) added++;
    }
    if ($.show) $.show(s);
    const jump = `<a class="fr-jump sr-jump" href="#serverSection">${escapeHtml(tr("srv.jump", "See the server rating ↓"))}</a>`;
    const msg = added
      ? tr("fr.added", "{f}: added {added} of its top {n} players (best ⚔️ iVi, active first). Press Analyze to compare them.", { f: name, added, n: list.length })
      : tr("fr.allIn", "{f}: its top players are already in the list.", { f: name });
    $.note(`${escapeHtml(msg)}${noRoom ? " " + escapeHtml(tr("outfit.noRoom", "{n} more not added: a list takes at most {max} outfit players, to keep loading quick and polite to Daybreak's servers.", { n: noRoom, max: SERVER_TOP_N })) : ""} ${jump}`, added ? "ok" : "warn");
    out.push({ added, noRoom });
  }
  return out;
}
