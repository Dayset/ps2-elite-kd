// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, COLOR, esc, $, stars, mins, bar, pct1, det, info, wide, syncDetails, PHONE_MQ } from "./state.js?v=20261018-scrub2";
import { get, names } from "./api.js?v=20261018-scrub2";
import { drawMap, highlightBase, recolorMap } from "./map.js?v=20261026-heat1";
import { chart, chartHover } from "./chart.js?v=20261024-i18n1";
import { lockCard, lockTick } from "./lock.js?v=20261024-i18n1";
import { commander, commanderIdle } from "./commander.js?v=20261026-heat1";
import { modeFocus, ownerLookup, heatLookup, pickMode, MODE_KEY, pickHeat, HEAT_KEY } from "./sticky.js?v=20261026-heat1";
import { nextPoll } from "./poll.js?v=20261026-mode1";
import { voiceToggle, voiceTick, bindVoiceMenu } from "./voice.js?v=20261026-pulse1";
import { reportPanel } from "./players.js?v=20261024-i18n1";
import { benchPanel, initResults, refreshHistory, renderHist } from "./results.js?v=20261024-i18n1";
import { initAuth } from "./auth.js?v=20261024-i18n1";
import { enhance, onSectionExpand, refreshSummary } from "./collapse.js?v=20261026-pulse1";
import { t as tr, ready } from "../../i18n.mjs";
await ready;   // #73: the language file is in before anything renders
document.title = tr("or.title", "PS2MapOracle — live PlanetSide 2 alert odds");

// Shareable links: keep ?alert=<key> in the address bar (other params such as ?api= stay).
function setUrlAlert(key) {
  const q = new URLSearchParams(location.search);
  if (key) q.set("alert", key); else q.delete("alert");
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
}

/** #67: an alert held because Census's ended scores were broken (they add up far below 100 %). */
function heldBroken(a) { return a.status === "unresolved" && (a.flags || []).some((f) => f.startsWith("final_corrupt")); }

function statusLabel(a, now) {
  if (heldBroken(a)) return tr("or.st.held", "held: Census data broken");
  if (a.status === "live") return tr("or.st.live", "{m} / {d} min", { m: mins(now - a.start_ts), d: a.dur });
  if (a.status === "settling") return tr("or.st.settling", "settling…");
  if (a.status === "sudden_death") return tr("or.st.sd", "sudden death");
  if (a.status === "settled") return tr("or.st.won", "🏆 won by {f}", { f: a.winner });
  return a.status;
}
/** Status badge text (#73). */
function badgeLabel(st) {
  return ({ live: tr("or.badge.live", "live"), settling: tr("or.badge.settling", "settling"), sudden_death: tr("or.st.sd", "sudden death"),
    settled: tr("or.badge.settled", "settled"), unresolved: tr("or.badge.unresolved", "unresolved") })[st] || st.replace("_", " ");
}
const minLeft = (n) => tr("or.minLeft", "{n} min left", { n });

function renderTabs(now) {
  if (!S.alerts.length) { $("tabs").innerHTML = ""; return; }
  $("tabs").innerHTML = S.alerts.map((a) => {
    const terr = (a.state && a.state.territory) || {};
    return `<button class="tab ${a.key === S.selected ? "on" : ""}" data-k="${esc(a.key)}">
      <b>${esc(a.world_name)} · ${esc(a.zone_name)}</b><small class="tl0">${esc(statusLabel(a, now))}</small><small class="tl">${esc(a.status === "live" ? minLeft(mins(a.start_ts + a.dur * 60 - now)) : statusLabel(a, now))}</small>
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
    tag.innerHTML = fr ? `${tr("or.replay", "⏪ Replay · minute {n}", { n: Math.round(k.t) })}${how !== "mouse" ? ` <button type="button" class="more" id="replayBack">${tr("or.backNow", "Back to now")}</button>` : ""}`
      : tr("or.noFrames", "No map history for this moment (maps are kept 30 days).");
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
  if (!a && S.pinned && S.selected) { $("main").innerHTML = `<div class="empty">${tr("or.loadingAlert", "Loading alert…")}</div>`; return; }
  if (!a) {
    $("mini").innerHTML = ""; miniSync();
    $("main").innerHTML = `<div class="empty">${tr("or.noAlerts", "No territory alerts running on Osprey, Wainwright or SolTech right now. Live odds appear here the minute one starts.")}</div>`;
    return;
  }
  const s = a.state;
  const win = s ? s.win : null;
  const lead = s && s.leader;
  const left = a.status === "live" ? minLeft(mins(a.start_ts + a.dur * 60 - now)) : statusLabel(a, now);
  const oddsHtml = win ? FACS.map((f) => `<div class="fac ${f} ${f === lead ? "lead" : ""}"><div class="l">${f}</div><div class="n">${pct1(win[f].pct)}%</div><div class="stars">${stars(win[f].pct)}</div></div>`).join("") : `<div class="note">${a.status === "live" ? tr("or.waitSnap", "Waiting for the first map snapshot…") : tr("or.noOdds", "No live odds were recorded for this alert.")}</div>`;
  const rows = s ? FACS.map((f) => `<div class="row" data-terr="${f}"><span class="lbl ${f}">${tr("or.terr", "{f} territory", { f })}</span><div class="track"><span style="width:${s.territory[f]}%;background:${COLOR[f]}"></span></div><span class="v">${Math.round(s.territory[f])}%</span></div>`).join("") +
    FACS.map((f) => {
      const base = s.territory[f] || 0, m = s.momentum[f];
      const rel = base >= 1 ? (100 * m / base) : m;
      return `<div class="row"><span class="lbl ${f}">${tr("or.mom", "{f} 15-min", { f })}</span><span class="note">${rel > 0.05 ? "▲" : rel < -0.05 ? "▼" : "·"}</span><span class="v">${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%</span></div>`;
    }).join("") : "";
  const popTot = s && s.pop ? FACS.reduce((t, f) => t + (s.pop[f] || 0), 0) : 0;
  const popRows = popTot ? FACS.map((f) => `<div class="row"><span class="lbl ${f}">${tr("or.facPlayers", "{f} players", { f })}</span><div class="track"><span style="width:${(100 * s.pop[f] / popTot).toFixed(1)}%;background:${COLOR[f]}"></span></div><span class="v">${s.pop[f]}</span></div>`).join("") : "";
  // Phone: stars + 15-min momentum as one secondary line under the three tiles.
  const oddLine = win && s ? `<div class="oddline">${FACS.map((f) => { const base = s.territory[f] || 0, m = s.momentum[f]; const rel = base >= 1 ? (100 * m / base) : m;
    return `<span class="${f}">${f}</span> <span class="stars">${stars(win[f].pct) || "·"}</span> <span class="note">${rel > 0.05 ? "▲" : rel < -0.05 ? "▼" : "·"}${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%</span>`; }).join(" · ")}</div>` : "";
  const popAdj = s && s.win_popadj ? `<div class="second">${tr("or.popW", "With population weighting:")} ${FACS.map((f) => `<span class="${f}">${f} ${pct1(s.win_popadj[f].pct)}%</span>`).join(" · ")} <span class="note">${tr("or.popWnote", "(experimental, fades out by minute 60)")}</span></div>` : "";
  const kindNote = a.kind === "meltdown" ? `<div class="note">${tr("or.melt", "Unstable Meltdown: only the live part of the continent counts{zone}. Territory shares are of that zone; odds are kept cautious until more Meltdowns are scored.", { zone: s && s.zone ? tr("or.meltZone", " ({n} bases, {p}% of the map)", { n: s.zone.active, p: s.zone.share }) : "" })}</div>` : "";
  const calls = s && s.calls && s.calls.length ? `<ul class="calls">${s.calls.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";
  const second = s && s.second ? `<div class="second">${tr("or.second", "🥈 Second place:")} ${Object.entries(s.second.odds).map(([f, p]) => `<span class="${f}">${f} ${pct1(p)}%</span>`).join(" · ")} ${s.second.locked ? tr("or.locked", "(locked)") : ""}</div>` : "";
  const voided = (a.flags || []).includes("votes_void");
  const brokenSum = heldBroken(a) ? ((a.flags || []).find((f) => f.startsWith("final_corrupt")) || "").split(":")[1] : null;
  const result = heldBroken(a) ? `<div class="note" style="color:var(--warn)">${tr("or.brokenEnd", "Census sent broken end scores (they add up to {p}%), so there is no result for this alert and every vote on it was given back.", { p: esc(brokenSum) })}</div>` : a.status === "settled" ? `<div class="second">${a.final ? `${tr("or.final", "Census final:")} ${FACS.map((f) => `<span class="${f}">${f} ${(+a.final[f]).toFixed(1)}</span>`).join(" · ")}` : tr("or.noFinal", "Census sent no final scores; decided from our last map snapshot")} — ${tr("or.wins", "{f} wins", { f: `<b class="${a.winner}">${a.winner}</b>` })}${a.basis === "sudden_death" ? tr("or.sdParen", " (sudden death)") : ""}</div>${voided ? `<div class="note" style="color:var(--warn)">${tr("or.voided", "Census map data was broken at the end and disagreed with the result, so every vote on this alert was given back.")}</div>` : ""}` : "";
  // Cut-off bases don't score in the game; from 80 % of the alert the odds count them for nobody.
  const cutList = s && Array.isArray(s.cut) ? s.cut : [];
  const cutNote = cutList.length && a.status === "live" ? `<div class="note">${tr("or.cut", "✂️ Cut off, not scoring:")} ${FACS.map((f) => { const n = cutList.filter((c) => c.fac === f); return n.length ? `<span class="${f}">${f} ${n.length}</span> (${esc(n.slice(0, 3).map((c) => c.name).join(", "))}${n.length > 3 ? ` +${n.length - 3}` : ""})` : ""; }).filter(Boolean).join(" · ")}${s.cut_aware ? tr("or.cutAware", " · counted in the odds") : ""}</div>` : "";
  const suspectNote = s && s.suspect && s.suspect.length ? `<div class="note" style="color:var(--warn)">${tr("or.suspect", "Census map data looks broken right now ({why}). Odds may be wrong and voting is paused.", { why: esc(s.suspect.map((x) => x.startsWith("neutral_heavy") ? tr("or.susNeutral", "only {p}% of bases owned", { p: x.split(":")[1] }) : x === "map_frozen" ? tr("or.susFrozen", "map frozen while captures continue") : tr("or.susStale", "no fresh map")).join(", ")) })}</div>` : "";
  const cmdView = a.status === "live" ? withMode(a, a.commander || (s && s.commander)) : null;
  $("main").innerHTML = `
    <div class="title"><b>${esc(a.world_name)} · ${esc(a.zone_name)}${a.kind === "meltdown" ? " Meltdown" : ""}</b><span class="badge ${a.status}">${esc(badgeLabel(a.status))}</span><span class="note">${esc(left)} · ${tr("or.durAlert", "{n}-min alert", { n: a.dur })}</span>${liveA ? "" : `<button type="button" class="more backlive" id="backLive">${tr("or.backLive", "← Back to live")}</button>`}</div>
    <div class="grid">
      <section class="card map"><h2 data-sec="map">${tr("or.h.map", "Map")}</h2><div id="replayTag" class="replaytag" hidden></div><div id="map"></div></section>
      <div class="side">
      <section class="card win"><h2 data-sec="win-chance">${tr("or.h.win", "Win chance")}</h2>${kindNote}${suspectNote}${cutNote}<div class="odds" aria-live="polite" aria-atomic="true">${oddsHtml}</div>${oddLine}${result}${second}${rows || popRows ? det("wdet", tr("or.details", "Details"), `${popAdj}<div class="rows">${rows}${popRows}</div>${popTot ? `<div class="note">${tr("or.pop", "Population: Honu (wt.honu.pw), {n} on continent{nso}.", { n: popTot, nso: s.pop_ns ? tr("or.popNso", " + {n} NSO", { n: s.pop_ns }) : "" })}</div>` : ""}`, "wdet keep") : ""}${calls}</section>
      <div id="voteHere"></div><div id="lockHere"></div>
      </div>
    </div>
    <section class="card chart" style="margin-top:14px"><h2 data-sec="win-chance-over-time">${tr("or.h.chart", "Win chance over time")}</h2><div id="chart"><div class="sk sk-chart" aria-label="${tr("or.loading", "Loading")}"></div></div></section>
    ${a.status === "live" ? commander(cmdView, a.commander_ts, now, lead, cmdMode, heatOn) : `${commanderIdle()}${reportPanel(a)}`}
    ${benchPanel(a)}`;
  if ($("backLive")) $("backLive").onclick = backToLive;
  $("main").querySelectorAll("li[data-base]").forEach((li) => { li.onmouseenter = () => highlightBase(li.dataset.base); li.onmouseleave = () => highlightBase(null); });
  // Base names in the Commander are links: hover highlights, tap / Enter highlights and brings the map into view.
  $("main").querySelectorAll(".blink[data-base]").forEach((el) => {
    const li = el.closest("li[data-base]");
    el.onmouseenter = () => highlightBase(el.dataset.base);
    el.onmouseleave = () => highlightBase(li ? li.dataset.base : null);
    const go = (e) => { e.preventDefault(); e.stopPropagation(); highlightBase(el.dataset.base); const m = $("map"); if (m) { const rc = m.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) m.scrollIntoView({ behavior: "smooth", block: "center" }); } };
    el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") go(e); };
  });
  $("main").querySelectorAll("[data-cf]").forEach((b) => b.onclick = () => { S.cmdFac = b.dataset.cf; render(Math.floor(Date.now() / 1000)); });
  // 🔊 Commander voice (#65): speaks the followed faction's top order when it changes.
  const cmdNow = cmdView;
  $("main").querySelectorAll("[data-cmode]").forEach((b) => b.onclick = () => { cmdMode = pickMode(b.dataset.cmode); try { localStorage.setItem(MODE_KEY, cmdMode); } catch {} render(Math.floor(Date.now() / 1000)); });
  $("main").querySelectorAll("[data-heat]").forEach((b) => b.onclick = () => { heatOn = !heatOn; try { localStorage.setItem(HEAT_KEY, heatOn ? "1" : "0"); } catch {} render(Math.floor(Date.now() / 1000)); });
  $("main").querySelectorAll("[data-voice]").forEach((b) => b.onclick = () => { voiceToggle(b.dataset.voice, cmdNow && cmdNow.focus, s, cmdNow && cmdNow.pockets); render(Math.floor(Date.now() / 1000)); });
  if (cmdNow) voiceTick(cmdNow.focus, undefined, false, undefined, s, cmdNow.pockets); // s: territory + 15-min change for the gap ending (owner t652u)
  bindVoiceMenu($("main")); // ⚙️ voice list (owner t650u), replaces the always-visible dropdown
  $("mini").innerHTML = `<b>${esc(a.world_name)} · ${esc(a.zone_name)}</b>${win ? `<span>${FACS.map((f) => `<span class="${f}">${f} ${pct1(win[f].pct)}%</span>`).join(" ")}</span>` : ""}`;
  miniSync();
  if (S.ticksFor === a.key) { const c = $("chart"); c.innerHTML = chart(S.ticks, a.dur, c.clientWidth); chartHover(c, S.ticks, a.dur, (k, how) => scrub(a, k, how)); }
  if (S.scrub && S.scrub.key === a.key) scrub(a, S.scrub.tick, S.scrub.how);
  const lh = $("lockHere");
  if (lh) lh.innerHTML = a.status === "live"
    ? `<section class="card lock">${lockCard(a, now)}</section>`
    : `<section class="card lock idle"><h2 data-sec="live-timer">${tr("or.h.timer", "⏱ Live timer")}</h2><div class="locktimer">--:--</div><div class="note">${tr("or.timerIdle", "No live alert — the countdown starts when the next one begins.")}</div></section>`;
  drawMap(a);
}

// Commander mode (owner t665u): "solo" (default) keeps an order until it is done; "big" shows the
// Worker's 3-min-ahead plan. Both use the same /live payload: no extra requests.
let cmdMode = "solo";
try { cmdMode = pickMode(localStorage.getItem(MODE_KEY)); } catch {}
let heatOn = false;          // 🔥 Heat toggle (owner t692u), remembered on this device
try { heatOn = pickHeat(localStorage.getItem(HEAT_KEY)); } catch {}
const soloMem = {};          // per alert key: sticky state, stepped once per commander update
const regionsOf = {};        // zone -> regions file (static asset, loaded once)
function withMode(a, c) {
  if (!c || !c.focus) return c;
  if (!(a.zone in regionsOf)) { regionsOf[a.zone] = null; names(a.zone).then((r) => { regionsOf[a.zone] = r || {}; }).catch(() => {}); }
  const mem = soloMem[a.key] || (soloMem[a.key] = {});
  const focus = modeFocus(c, cmdMode, mem, { ts: a.commander_ts || 0, ownerOf: ownerLookup(a.state && a.state.owners, regionsOf[a.zone]), heatOf: heatLookup(c) }, heatOn);
  return { ...c, focus };
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

// Fetch timing (owner t665u): right after the Worker's next cycle lands (poll.js), one request
// each time; the status line comes from the /live cycle hint, so /health is only asked when an
// older Worker sends no hint.
let pollTimer = null, pollPrevTs = null, pollRetries = 0, lastFetchS = 0;
function schedule(delayS) { clearTimeout(pollTimer); pollTimer = setTimeout(refreshLive, Math.max(1, delayS) * 1000); }
async function refreshLive() {
  const now = Math.floor(Date.now() / 1000);
  lastFetchS = now;
  try {
    const live = await get("/live");
    const cy = live.cycle || null;
    const health = cy ? { ok: cy.age_s < 180, last_ok_age_s: cy.ok_age_s, last_cycle_age_s: cy.age_s } : await get("/health").catch(() => null);
    S.alerts = (live.alerts || []).sort((x, y) => (x.status === "live" ? 0 : 1) - (y.status === "live" ? 0 : 1) || y.start_ts - x.start_ts);
    if (!S.alerts.find((x) => x.key === S.selected) && !S.pinned) { S.selected = S.alerts.length ? S.alerts[0].key : null; if (S.selected) setUrlAlert(S.selected); }
    const ok = health && health.ok && health.last_ok_age_s !== null && health.last_ok_age_s < 300;
    $("dot").className = "dot " + (ok ? "ok" : "bad");
    $("statusText").textContent = ok ? tr("or.updated", "live · updated {n}s ago", { n: health.last_cycle_age_s }) : tr("or.delayed", "data delayed");
    banner(ok ? "" : health && health.last_ok_age_s != null ? tr("or.staleMin", "Live data is {n} min old — retrying…", { n: Math.round(health.last_ok_age_s / 60) }) : tr("or.stale", "Live data is a while old — retrying…"), "warn");
    pageTitle();
    render(now);
    if (S.selected && S.ticksFor !== S.selected) loadTicks();
    const np = nextPoll(cy, pollPrevTs, pollRetries, Math.floor(Date.now() / 1000), S.alerts.some((x) => x.status === "live"));
    if (np.complete && cy) pollPrevTs = cy.ts;
    pollRetries = np.retries;
    schedule(np.delayS);
  } catch (e) {
    $("dot").className = "dot bad";
    $("statusText").textContent = tr("or.unreach", "oracle unreachable");
    banner(tr("or.unreachBanner", "The oracle backend is not reachable — retrying…"));
    if (!S.alerts.length) $("main").innerHTML = `<div class="empty">${tr("or.unreachMain", "The oracle backend is not reachable right now.")}</div>`;
    schedule(30);
  }
}
// Back on the tab after a while (timers sleep in background tabs): catch up once.
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() / 1000 - lastFetchS > 70) refreshLive(); });

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
document.addEventListener("oracle-voices", () => S.hooks.rerender && S.hooks.rerender());
S.hooks.rerender = () => render(Math.floor(Date.now() / 1000));   // map faction switch
initResults();
initAuth();

refreshLive(); refreshHistory();
setInterval(() => { lockTick(); const c = document.querySelector("#lockHere .card"); if (c) refreshSummary(c); }, 1000); // ⏱ live countdown ticks every second, no re-render
setInterval(loadTicks, 60000);
setInterval(refreshHistory, 120000);
