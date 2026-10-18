// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, COLOR, esc, $, stars, mins, bar, pct1, det, info, wide, syncDetails, PHONE_MQ } from "./state.js?v=20261018-scrub2";
import { get } from "./api.js?v=20261018-scrub2";
import { drawMap, highlightBase, recolorMap } from "./map.js?v=20261018-scrub2";
import { chart, chartHover } from "./chart.js?v=20261018-scrub2";
import { lockCard, lockTick } from "./lock.js?v=20261018-scrub2";
import { commander, commanderIdle } from "./commander.js?v=20261018-idle1";
import { reportPanel } from "./players.js?v=20261018-scrub2";
import { benchPanel, initResults, refreshHistory, renderHist } from "./results.js?v=20261018-scrub2";
import { initAuth } from "./auth.js?v=20261018-scrub2";
import { enhance, onSectionExpand, refreshSummary } from "./collapse.js?v=20261018-oracestyle4";

// Shareable links: keep ?alert=<key> in the address bar (other params such as ?api= stay).
function setUrlAlert(key) {
  const q = new URLSearchParams(location.search);
  if (key) q.set("alert", key); else q.delete("alert");
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
}

function statusLabel(a, now) {
  if (a.status === "live") return `${mins(now - a.start_ts)} / ${a.dur} min`;
  if (a.status === "settling") return "settling…";
  if (a.status === "sudden_death") return "sudden death";
  if (a.status === "settled") return `🏆 won by ${a.winner}`;
  return a.status;
}

function renderTabs(now) {
  if (!S.alerts.length) { $("tabs").innerHTML = ""; return; }
  $("tabs").innerHTML = S.alerts.map((a) => {
    const terr = (a.state && a.state.territory) || {};
    return `<button class="tab ${a.key === S.selected ? "on" : ""}" data-k="${esc(a.key)}">
      <b>${esc(a.world_name)} · ${esc(a.zone_name)}</b><small class="tl0">${esc(statusLabel(a, now))}</small><small class="tl">${esc(a.status === "live" ? `${mins(a.start_ts + a.dur * 60 - now)} min left` : statusLabel(a, now))}</small>
      <div class="bar">${bar(terr)}</div></button>`;
  }).join("");
  const on = $("tabs").querySelector(".tab.on");
  if (on && !wide()) { const t = $("tabs"); const l = on.offsetLeft - t.offsetLeft; if (l < t.scrollLeft || l + on.offsetWidth > t.scrollLeft + t.clientWidth) t.scrollLeft = l - 8; }
  $("tabs").querySelectorAll(".tab").forEach((b) => b.onclick = () => { S.selected = b.dataset.k; S.pinned = false; setUrlAlert(S.selected); render(now); loadTicks(); });
}

// ---- Timeline scrub: hover (PC) or tap/drag (phone) on "Win chance over time" replays the map
// and territory at that minute, from the Worker's per-minute map frames (kept 30 days).
const framesFor = {};
function loadFrames(key) {
  if (!framesFor[key]) framesFor[key] = get("/alert/frames?key=" + encodeURIComponent(key)).then((j) => {
    const acc = {}, out = [];
    for (const f of j.frames || []) { Object.assign(acc, f.set); out.push({ t: f.t, owners: { ...acc } }); }
    return out;
  }).catch(() => []);
  return framesFor[key];
}
function setTerritoryRows(terr) {
  for (const f of FACS) {
    const row = document.querySelector(`.row[data-terr="${f}"]`); if (!row || terr[f] == null) continue;
    const bar = row.querySelector(".track span"), v = row.querySelector(".v");
    if (bar) bar.style.width = `${terr[f]}%`;
    if (v) v.textContent = `${Math.round(terr[f])}%`;
  }
}
async function scrub(a, k, how) {
  const tag = $("replayTag");
  if (!k) {
    S.scrub = null; recolorMap(null);
    if (a.state && a.state.territory) setTerritoryRows(a.state.territory);
    if (tag) tag.hidden = true;
    return;
  }
  S.scrub = { key: a.key, tick: k, how };
  if (k.terr) setTerritoryRows(k.terr);
  const frames = await loadFrames(a.key);
  if (!S.scrub || S.scrub.tick !== k) return;                 // the pointer moved on while loading
  let fr = null;
  for (const f of frames) { if (f.t <= k.t + 0.5) fr = f; else break; }
  if (tag) {
    tag.hidden = false;
    tag.innerHTML = fr ? `⏪ Replay · minute ${Math.round(k.t)}${how !== "mouse" ? ' <button type="button" class="more" id="replayBack">Back to now</button>' : ""}`
      : "No map history for this moment (maps are kept 30 days).";
    const back = $("replayBack"); if (back) back.onclick = () => scrub(a, null);
  }
  recolorMap(fr ? fr.owners : null);
}

async function loadTicks() {
  if (!S.selected) return;
  const key = S.selected;
  try {
    const j = await get("/alert?key=" + encodeURIComponent(key));
    if (key !== S.selected) return;
    S.ticksFor = key; S.ticks = j.ticks || []; S.outliers = j.outliers || null; S.benchFor = j.bench || null;
    S.extra = j.alert && j.alert.key === key ? j.alert : null;
    render(Math.floor(Date.now() / 1000));
  } catch (e) {
    // Unknown key from a link: fall back to the live view.
    if (key === S.selected && S.pinned && !S.alerts.find((x) => x.key === key)) { S.pinned = false; S.extra = null; S.selected = S.alerts.length ? S.alerts[0].key : null; setUrlAlert(S.selected); render(Math.floor(Date.now() / 1000)); if (S.selected) loadTicks(); }
  }
}

function openAlert(key) {
  if (!key) return;
  S.selected = key; S.pinned = true;
  if (!(S.extra && S.extra.key === key)) S.extra = null;
  setUrlAlert(key);
  render(Math.floor(Date.now() / 1000));
  loadTicks();
  $("main").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function backToLive() {
  S.pinned = false; S.extra = null;
  S.selected = S.alerts.length ? S.alerts[0].key : null;
  setUrlAlert(S.selected);
  render(Math.floor(Date.now() / 1000));
  if (S.selected) loadTicks();
}


function announceAlert(a) {
  const sig = a ? `${a.key}|${a.status}|${a.state ? a.state.ts : ""}` : "";
  if (sig === S.lastAlertEvt) return;
  S.lastAlertEvt = sig;
  dispatchEvent(new CustomEvent("oracle:alert", { detail: a || null }));
}
const voteNode = document.getElementById("voteSlot");
function render(now) {
  renderTabs(now);
  render2(now);
  const h = $("voteHere");
  if (h) h.replaceWith(voteNode); else $("main").after(voteNode);
  syncDetails($("main"));
  enhance(document);
  announceAlert(S.alerts.find((x) => x.key === S.selected) || null);
}
function render2(now) {
  const liveA = S.alerts.find((x) => x.key === S.selected);
  const a = liveA || (S.pinned && S.extra && S.extra.key === S.selected ? S.extra : null);
  if (!a && S.pinned && S.selected) { $("main").innerHTML = `<div class="empty">Loading alert…</div>`; return; }
  if (!a) {
    $("mini").innerHTML = ""; miniSync();
    $("main").innerHTML = `<div class="empty">No territory alerts running on Osprey, Wainwright or SolTech right now. Live odds appear here the minute one starts.</div>`;
    return;
  }
  const s = a.state;
  const win = s ? s.win : null;
  const lead = s && s.leader;
  const left = a.status === "live" ? `${mins(a.start_ts + a.dur * 60 - now)} min left` : statusLabel(a, now);
  const oddsHtml = win ? FACS.map((f) => `<div class="fac ${f} ${f === lead ? "lead" : ""}"><div class="l">${f}</div><div class="n">${pct1(win[f].pct)}%</div><div class="stars">${stars(win[f].pct)}</div></div>`).join("") : `<div class="note">${a.status === "live" ? "Waiting for the first map snapshot…" : "No live odds were recorded for this alert."}</div>`;
  const rows = s ? FACS.map((f) => `<div class="row" data-terr="${f}"><span class="lbl ${f}">${f} territory</span><div class="track"><span style="width:${s.territory[f]}%;background:${COLOR[f]}"></span></div><span class="v">${Math.round(s.territory[f])}%</span></div>`).join("") +
    FACS.map((f) => {
      const base = s.territory[f] || 0, m = s.momentum[f];
      const rel = base >= 1 ? (100 * m / base) : m;
      return `<div class="row"><span class="lbl ${f}">${f} 15-min</span><span class="note">${rel > 0.05 ? "▲" : rel < -0.05 ? "▼" : "·"}</span><span class="v">${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%</span></div>`;
    }).join("") : "";
  const popTot = s && s.pop ? FACS.reduce((t, f) => t + (s.pop[f] || 0), 0) : 0;
  const popRows = popTot ? FACS.map((f) => `<div class="row"><span class="lbl ${f}">${f} players</span><div class="track"><span style="width:${(100 * s.pop[f] / popTot).toFixed(1)}%;background:${COLOR[f]}"></span></div><span class="v">${s.pop[f]}</span></div>`).join("") : "";
  // Phone: stars + 15-min momentum as one secondary line under the three tiles.
  const oddLine = win && s ? `<div class="oddline">${FACS.map((f) => { const base = s.territory[f] || 0, m = s.momentum[f]; const rel = base >= 1 ? (100 * m / base) : m;
    return `<span class="${f}">${f}</span> <span class="stars">${stars(win[f].pct) || "·"}</span> <span class="note">${rel > 0.05 ? "▲" : rel < -0.05 ? "▼" : "·"}${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%</span>`; }).join(" · ")}</div>` : "";
  const popAdj = s && s.win_popadj ? `<div class="second">With population weighting: ${FACS.map((f) => `<span class="${f}">${f} ${pct1(s.win_popadj[f].pct)}%</span>`).join(" · ")} <span class="note">(experimental, fades out by minute 60)</span></div>` : "";
  const kindNote = a.kind === "meltdown" ? `<div class="note">Unstable Meltdown: only the live part of the continent counts${s && s.zone ? ` (${s.zone.active} bases, ${s.zone.share}% of the map)` : ""}. Territory shares are of that zone; odds are kept cautious until more Meltdowns are scored.</div>` : "";
  const calls = s && s.calls && s.calls.length ? `<ul class="calls">${s.calls.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";
  const second = s && s.second ? `<div class="second">🥈 Second place: ${Object.entries(s.second.odds).map(([f, p]) => `<span class="${f}">${f} ${pct1(p)}%</span>`).join(" · ")} ${s.second.locked ? "(locked)" : ""}</div>` : "";
  const voided = (a.flags || []).includes("votes_void");
  const result = a.status === "settled" ? `<div class="second">${a.final ? `Census final: ${FACS.map((f) => `<span class="${f}">${f} ${(+a.final[f]).toFixed(1)}</span>`).join(" · ")}` : "Census sent no final scores; decided from our last map snapshot"} — <b class="${a.winner}">${a.winner}</b> wins${a.basis === "sudden_death" ? " (sudden death)" : ""}</div>${voided ? `<div class="note" style="color:var(--warn)">Census map data was broken at the end and disagreed with the result, so every vote on this alert was given back.</div>` : ""}` : "";
  const suspectNote = s && s.suspect && s.suspect.length ? `<div class="note" style="color:var(--warn)">Census map data looks broken right now (${esc(s.suspect.map((x) => x.startsWith("neutral_heavy") ? `only ${x.split(":")[1]}% of bases owned` : x === "map_frozen" ? "map frozen while captures continue" : "no fresh map").join(", "))}). Odds may be wrong and voting is paused.</div>` : "";
  $("main").innerHTML = `
    <div class="title"><b>${esc(a.world_name)} · ${esc(a.zone_name)}${a.kind === "meltdown" ? " Meltdown" : ""}</b><span class="badge ${a.status}">${esc(a.status.replace("_", " "))}</span><span class="note">${esc(left)} · ${a.dur}-min alert</span>${liveA ? "" : `<button type="button" class="more backlive" id="backLive">← Back to live</button>`}</div>
    <div class="grid">
      <section class="card map"><h2>Map</h2><div id="replayTag" class="replaytag" hidden></div><div id="map"></div></section>
      <div class="side">
      <section class="card win"><h2>Win chance</h2>${kindNote}${suspectNote}<div class="odds" aria-live="polite" aria-atomic="true">${oddsHtml}</div>${oddLine}${result}${second}${rows || popRows ? det("wdet", "Details", `${popAdj}<div class="rows">${rows}${popRows}</div>${popTot ? `<div class="note">Population: Honu (wt.honu.pw), ${popTot} on continent${s.pop_ns ? ` + ${s.pop_ns} NSO` : ""}.</div>` : ""}`, "wdet keep") : ""}${calls}</section>
      <div id="voteHere"></div><div id="lockHere"></div>
      </div>
    </div>
    <section class="card chart" style="margin-top:14px"><h2>Win chance over time</h2><div id="chart"><div class="sk sk-chart" aria-label="Loading"></div></div></section>
    ${a.status === "live" ? commander(a.commander || (s && s.commander), a.commander_ts, now, lead) : `${commanderIdle()}${reportPanel(a)}`}
    ${benchPanel(a)}`;
  if ($("backLive")) $("backLive").onclick = backToLive;
  $("main").querySelectorAll("li[data-base]").forEach((li) => { li.onmouseenter = () => highlightBase(li.dataset.base); li.onmouseleave = () => highlightBase(null); });
  $("main").querySelectorAll("[data-cf]").forEach((b) => b.onclick = () => { S.cmdFac = b.dataset.cf; render(Math.floor(Date.now() / 1000)); });
  $("mini").innerHTML = `<b>${esc(a.world_name)} · ${esc(a.zone_name)}</b>${win ? `<span>${FACS.map((f) => `<span class="${f}">${f} ${pct1(win[f].pct)}%</span>`).join(" ")}</span>` : ""}`;
  miniSync();
  if (S.ticksFor === a.key) { const c = $("chart"); c.innerHTML = chart(S.ticks, a.dur, c.clientWidth); chartHover(c, S.ticks, a.dur, (k, how) => scrub(a, k, how)); }
  if (S.scrub && S.scrub.key === a.key) scrub(a, S.scrub.tick, S.scrub.how);
  const lh = $("lockHere");
  if (lh) lh.innerHTML = a.status === "live"
    ? `<section class="card lock">${lockCard(a, now)}</section>`
    : `<section class="card lock idle"><h2>⏱ Live timer</h2><div class="locktimer">--:--</div><div class="note">No live alert — the countdown starts when the next one begins.</div></section>`;
  drawMap(a);
}

// Error banner (#18): Worker unreachable or /health stale; cleared on the next good poll.
function banner(text, cls = "") {
  const b = $("banner");
  b.hidden = !text; b.className = "banner " + cls; b.textContent = text ? "⚠ " + text : "";
}
// Page title shows the leading live alert's win % (#18).
const BASE_TITLE = document.title;
function pageTitle() {
  const a = S.alerts.find((x) => x.status === "live" && x.state && x.state.win);
  if (!a) { document.title = BASE_TITLE; return; }
  const f = FACS.reduce((m, x) => (+a.state.win[x].pct > +a.state.win[m].pct ? x : m), "VS");
  document.title = `${f} ${pct1(a.state.win[f].pct)}% · ${a.world_name} ${a.zone_name} — PS2MapOracle`;
}

async function refreshLive() {
  const now = Math.floor(Date.now() / 1000);
  try {
    const [live, health] = await Promise.all([get("/live"), get("/health").catch(() => null)]);
    S.alerts = (live.alerts || []).sort((x, y) => (x.status === "live" ? 0 : 1) - (y.status === "live" ? 0 : 1) || y.start_ts - x.start_ts);
    if (!S.alerts.find((x) => x.key === S.selected) && !S.pinned) { S.selected = S.alerts.length ? S.alerts[0].key : null; if (S.selected) setUrlAlert(S.selected); }
    const ok = health && health.ok && health.last_ok_age_s !== null && health.last_ok_age_s < 300;
    $("dot").className = "dot " + (ok ? "ok" : "bad");
    $("statusText").textContent = ok ? `live · updated ${health.last_cycle_age_s}s ago` : "data delayed";
    banner(ok ? "" : `Live data is ${health && health.last_ok_age_s != null ? Math.round(health.last_ok_age_s / 60) + " min" : "a while"} old — retrying…`, "warn");
    pageTitle();
    render(now);
    if (S.selected && S.ticksFor !== S.selected) loadTicks();
  } catch (e) {
    $("dot").className = "dot bad";
    $("statusText").textContent = "oracle unreachable";
    banner("The oracle backend is not reachable — retrying…");
    if (!S.alerts.length) $("main").innerHTML = '<div class="empty">The oracle backend is not reachable right now.</div>';
  }
}

// Phone: sticky mini-header (alert name + three win %) once the title scrolls away.
function miniSync() {
  const t = $("main").querySelector(".title"), m = $("mini");
  m.classList.toggle("show", !wide() && !!t && !!m.innerHTML && t.getBoundingClientRect().bottom < 0);
}
addEventListener("scroll", miniSync, { passive: true });
// Remember which collapsibles the user opened on the phone, so 30-s re-renders keep them.
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.d && (!wide() || d.classList.contains("info") || d.classList.contains("keep"))) S.open[d.dataset.d] = d.open; }, true);
PHONE_MQ.addEventListener("change", () => { syncDetails(); render(Math.floor(Date.now() / 1000)); renderHist(); });
syncDetails();

// Collapsible sections: vote.js renders its own card, so re-enhance when it changes.
new MutationObserver(() => enhance(voteNode)).observe(voteNode, { childList: true });
// Re-measure on expand: the map and chart are drawn for the width they had.
onSectionExpand((id) => { if (id === "map" || id === "win-chance-over-time") render(Math.floor(Date.now() / 1000)); });
enhance(document);

S.hooks.openAlert = openAlert;
initResults();
initAuth();

refreshLive(); refreshHistory();
setInterval(refreshLive, 30000);
setInterval(() => { lockTick(); const c = document.querySelector("#lockHere .card"); if (c) refreshSummary(c); }, 1000); // ⏱ live countdown ticks every second, no re-render
setInterval(loadTicks, 60000);
setInterval(refreshHistory, 120000);
