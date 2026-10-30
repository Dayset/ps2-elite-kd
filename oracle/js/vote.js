/**
 * Voting panel (self-mounting ES module). Vote on the alert winner with
 * BonusCheques, a meme currency with no cash value. Talks to the ps2-oracle Worker:
 *   GET  /vote/quote?key=   odds for every amount (no sign-in needed)
 *   GET  /vote/me           balance, votes, daily BonusCheque availability (Bearer token)
 *   POST /vote/place        {key, outcome, amount, seen_pct, vote_id}  one vote per faction per alert (#82)
 *   POST /vote/bonus        +25 once per UTC day
 *   GET  /vote/leaderboard
 * When signed in and no live alert is selected: a compact "My votes" card from /vote/me.
 * Listens for:  "oracle:alert" {detail: alert|null}   (selected alert changed / refreshed)
 *               "oracle:auth"  {detail: character|null} (signed in / out)
 * Renders into <section id="voteSlot">. Uses localStorage "ps2oracle_token".
 * #82 (PC + phone signed in as one character): the server decides every vote and bonus at call time. This panel
 * refetches every 30 s, when the tab comes back into view or gets focus, after every vote / bonus call and after
 * any 409, and takes the balance a refusal carries at once. Factions already backed on the alert show ✓.
 */
import { t as tr, ready } from "../../i18n.mjs";
await ready;   // #73: DISCLAIMER below is built once, in the page language
const API = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("api") || "https://ps2-oracle.dayset.workers.dev";
const FACS = ["VS", "NC", "TR"];
const AMOUNTS = [25, 50, 100, 200];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = () => { try { return localStorage.getItem("ps2oracle_token"); } catch { return null; } };
const pts = (x) => (Math.round(x * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Grayed placeholder between alerts so users see voting exists. */
const voteIdleHtml = () => `<div class="card vote idle"><h2 data-sec="vote-for-the-winner">${tr("or.h.vote", "🎲 Vote for the winner")}</h2><div class="note">${tr("or.voteIdle", "No live alert — voting opens when the next one starts.")}</div>${DISCLAIMER}</div>`;

/** Shown on every voting card: short line + expandable fair-play rules. */
export const DISCLAIMER = `<details class="fair"><summary>${tr("or.fair.sum", "BonusCheques are a meme currency: no cash value, nothing is ever paid out.")} <b>${tr("or.fair.rules", "Fair play rules")}</b></summary>
  <ul>
    <li>${tr("or.fair.1", "BonusCheques can't be bought, sold, traded or cashed out, and you can't win anything of value. Everyone starts with 1,000; you get +25 a day, and a little more if you run dry.")}</li>
    <li>${tr("or.fair.2", "Voting is here to get you into the game: back your faction, then log in and help it win.")}</li>
    <li>${tr("or.fair.3", "You can vote for any faction.")}</li>
    <li>${tr("or.fair.3b", "One vote per faction per alert, from any of your devices.")}</li>
    <li>${tr("or.fair.4", "Signing in needs an in-game logout of your character. That proves the character is yours; we never ask for a password or email. We keep your character, a sign-in token, your BonusCheques and votes ({privacy}).", { privacy: `<a href="../privacy.html">${tr("or.fair.privacy", "privacy")}</a>` })}</li>
    <li>${tr("or.fair.5", "Fair play only. Riggers, alert throwers and cheaters aren't welcome, and their votes and leaderboard spots can be removed.")}</li>
  </ul></details>`;

let alert = null, me = null, wallet = null, quotes = null, pick = null, amount = 50, busy = false, msg = "", lastRefresh = 0;

/** #82: a random id per vote click; a retry of the same click reuses it, so the vote lands once. */
const newVoteId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `v${Date.now()}${Math.random().toString(36).slice(2, 12)}`);
/** #82: factions this character already backed on the alert (one vote per faction per alert). */
export function votedFactions(w, key) {
  return new Set(((w && w.votes) || []).filter((v) => v.key === key).map((v) => v.outcome));
}
/** #82: what a refused vote says. The other device is the usual cause of the wallet-related ones. */
export function voteErrorText(err, body = {}) {
  const b = body || {};
  if (err === "already_voted") return tr("or.e.voted", "You already voted {f} on this alert (maybe from another device).", { f: (b.vote && b.vote.outcome) || "" });
  if (err === "insufficient_balance") return b.balance != null ? tr("or.e.fundsN", "Not enough BonusCheques: you have {n} (it may have changed on another device).", { n: pts(b.balance) }) : tr("or.e.funds", "Not enough BonusCheques.");
  if (err === "already_claimed_today") return tr("or.e.claimed", "Today's BonusCheque was already claimed (maybe on another device).");
  return ({ odds_changed: tr("or.e.moved", "The odds moved; check the new odds and try again."), closed: tr("or.e.closed", "Voting just closed."),
    own_faction_only: tr("or.e.own", "You can vote only for your own faction."), odds_stale: tr("or.e.stale", "Odds are refreshing; try again in a minute."), decided: tr("or.e.decided", "That outcome is already decided."),
    data_suspect: tr("or.e.suspect", "Voting is paused while Census map data looks broken."), not_signed_in: tr("or.e.signedOut", "This device was signed out. Sign in again to vote.") })[err] || tr("or.e.other", "Couldn't record the vote.");
}

async function call(path, method = "GET", body) {
  const t = token();
  const r = await fetch(API + path, { method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const slotEl = typeof document !== "undefined" ? document.getElementById("voteSlot") : null;
const slot = () => slotEl;

// Alert key "world-zone-instance" -> "Server · Continent".
const WORLD_NAMES = { 1: "Osprey", 10: "Wainwright", 25: "Briggs", 40: "SolTech" };
const ZONE_NAMES = { 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur" };
export function alertName(key) {
  const [w, z] = String(key || "").split("-").map(Number);
  return `${WORLD_NAMES[w] || "World " + w} · ${ZONE_NAMES[z & 0xffff] || "Zone " + z}`;
}
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pts(Math.abs(x))}`;
const STATUS = { won: tr("or.v.right", "right"), lost: tr("or.v.wrong", "wrong"), void: tr("or.v.back", "given back") };

/**
 * Every vote of the signed-in player (newest first, up to 50 from /vote/me): when it was
 * placed (local time) and how far into the alert, the alert, the faction, what was put in,
 * the oracle odds at that moment, what comes back if right, and the result (owner 2026-10-24).
 */
export function voteListHtml(votes) {
  const vs = votes || [];
  if (!vs.length) return `<div class="note">${tr("or.v.none", "No votes yet.")}</div>`;
  const when = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const res = (v) => (v.status === "open" ? `<span class="mvst open">${tr("or.v.open", "open · {n} if right", { n: pts(v.potential) })}</span>`
    : v.status === "won" ? `<span class="mvst won">${STATUS.won} · +${pts((v.reward || 0) - v.amount)}</span>`
    : v.status === "lost" ? `<span class="mvst lost">${STATUS.lost} · −${pts(v.amount)}</span>`
    : `<span class="mvst void">${STATUS.void}</span>`);
  // Two short lines per vote, no table (phones).
  return `<div class="vlist">${vs.map((v) => `<div class="vrow ${esc(v.status)}">
    <div><b>${esc(when(v.placed_ts))}</b> · ${esc(alertName(v.key))} <span class="note">${tr("or.v.into", "{p}% into the alert", { p: Math.round((v.progress || 0) * 100) })}</span></div>
    <div><span class="${esc(v.outcome)}">${esc(v.outcome)}</span> ${pts(v.amount)} <span class="note">${tr("or.v.at", "at {p}%", { p: esc(v.pct) })}</span> · ${res(v)}</div></div>`).join("")}</div>`;
}

/** Compact card: balance, net gain, last 10 settled votes (one line each). */
export function myVotesHtml(w) {
  if (!w) return "";
  const settled = (w.votes || []).filter((v) => v.status && v.status !== "open").slice(0, 10);
  const rows = settled.map((v) => `<div class="mvrow ${esc(v.status)}"><span class="mvname">${esc(alertName(v.key))}</span>
      <span class="${esc(v.outcome)}">${esc(v.outcome)}</span> <span class="mvnum">${pts(v.amount)} → ${pts(v.reward || 0)}</span>
      <span class="mvst">${esc(STATUS[v.status] || v.status)}</span></div>`).join("");
  return `<div class="card vote myvotescard"><h2 data-sec="my-votes">${tr("or.h.myVotes", "🗳️ My votes")}</h2>
    <div class="votebar"><span>BonusCheques <b>${pts(w.balance)}</b></span><span>${tr("or.v.net", "Net")} <b class="${w.gain > 0 ? "won" : w.gain < 0 ? "lost" : ""}">${signed(w.gain || 0)}</b></span></div>
    ${rows ? `<div class="mvrows">${rows}</div>` : `<div class="note">${tr("or.v.noneDone", "No finished votes yet. Votes are counted when their alert ends.")}</div>`}
    ${(w.votes || []).length ? `<details class="mylist"><summary>${tr("or.v.all", "🗳️ All my votes ({n})", { n: w.votes.length })}</summary>${voteListHtml(w.votes)}</details>` : ""}
    ${DISCLAIMER}
  </div>`;
}
export async function fetchMyVotes() {
  const r = await call("/vote/me");
  return r.status === 200 ? r.body : null;
}

async function refresh() {
  if (!slot()) return;
  lastRefresh = Date.now();
  if (!alert || alert.status !== "live") {
    if (!me) { slot().innerHTML = voteIdleHtml(); return; }
    try { wallet = await fetchMyVotes(); } catch { wallet = null; }
    if (alert && alert.status === "live") return;   // switched while loading
    slot().innerHTML = myVotesHtml(wallet);
    return;
  }
  try {
    const [q, w] = await Promise.all([call(`/vote/quote?key=${encodeURIComponent(alert.key)}`), me ? call("/vote/me") : Promise.resolve(null)]);
    quotes = q.body;
    wallet = w && w.status === 200 ? w.body : null;
  } catch { quotes = null; }
  render();
}

function render() {
  const el = slot();
  if (!el || !alert || alert.status !== "live") {
    // Between alerts: signed-in users see their vote history; everyone else
    // sees the panel grayed out so it's clear voting exists.
    if (el) el.innerHTML = me ? myVotesHtml(wallet) : voteIdleHtml();
    return;
  }
  const q = quotes;
  const own = wallet && wallet.own_faction;
  const ownOnly = q && q.own_faction_only && FACS.includes(own);
  if (pick && ownOnly && pick !== own) pick = null;
  if (!pick && ownOnly) pick = own;
  const head = `<h2 data-sec="vote-for-the-winner">${tr("or.h.vote", "🎲 Vote for the winner")}</h2>`;
  if (!q || !q.open) {
    el.innerHTML = `<div class="card vote idle">${head}<div class="note">${q && q.reason === "closed" ? tr("or.v.closedLast", "Voting closed for this alert (last 5%).") : q && q.reason === "data_suspect" ? tr("or.v.paused", "Voting paused: Census map data looks broken right now. It reopens when the map is healthy again.") : tr("or.v.opensFresh", "Voting opens when fresh odds are available.")}</div>${DISCLAIMER}</div>`;
    return;
  }
  const voted = votedFactions(wallet, alert.key);
  if (pick && voted.has(pick)) pick = null;
  const facBtn = (f) => {
    const off = q.quotes[f] == null || (ownOnly && f !== own) || voted.has(f);
    return `<button class="facpick ${f} ${pick === f ? "on" : ""}" data-f="${f}" ${off ? "disabled" : ""} aria-pressed="${pick === f}"${voted.has(f) ? ` title="${esc(tr("or.v.backed", "You already voted {f} on this alert", { f }))}"` : ""}>
      <b>${f}${voted.has(f) ? " ✓" : ""}</b><span>${q.pcts[f]}%</span></button>`;
  };
  const sel = pick && q.quotes[pick] && q.quotes[pick][amount];
  const feeNote = (f) => (q.fee_rate[f] ? tr("or.v.fee", " · late fee {p}%", { p: Math.round(q.fee_rate[f] * 100) }) : "");
  let action;
  if (!me) action = `<button class="btn" id="voteSignIn">${tr("or.v.signIn", "Sign in with your character to vote")}</button>`;
  else if (!wallet) action = `<div class="note">${tr("or.v.loadingBC", "Loading your BonusCheques…")}</div>`;
  else action = `<button class="btn big" id="votePlace" ${!sel || busy || wallet.balance < amount ? "disabled" : ""}>
      ${sel ? tr("or.v.voteBtn", "Vote {f} with {n}", { f: pick, n: amount }) : tr("or.v.pick", "Pick a faction")}</button>`;
  const mine = wallet ? wallet.votes.filter((v) => v.key === alert.key) : [];
  el.innerHTML = `<div class="card vote">${head}
    ${wallet ? `<div class="votebar"><span>BonusCheques <b>${pts(wallet.balance)}</b></span>${wallet.bonus_available ? `<button class="link" id="voteBonus">${tr("or.v.claim", "🧻 Claim today's BonusCheque (+25)")}</button>` : ""}</div>` : ""}
    <div class="facrow">${FACS.map(facBtn).join("")}</div>
    ${ownOnly ? `<div class="note">${tr("or.v.ownOnly", "You fly {f}: vote for your faction, then go help it win.", { f: esc(own) })}</div>` : ""}
    <div class="amounts">${AMOUNTS.map((s) => `<button class="amount ${s === amount ? "on" : ""}" data-s="${s}" aria-pressed="${s === amount}">${s}</button>`).join("")}</div>
    ${sel ? `<div class="note">${tr("or.v.quote", "{n} back if {f} wins · your odds {p}% (oracle {o}%)", { n: `<b>${pts(sel.reward)}</b>`, f: pick, p: (sel.odds * 100).toFixed(1), o: sel.pct })}${feeNote(pick)}</div>` : ""}
    <div class="row2">${action}</div>
    ${msg ? `<div class="note votemsg">${esc(msg)}</div>` : ""}
    ${mine.length ? `<div class="myvotes"><div class="note">${tr("or.v.mine", "🎫 Your votes on this alert")}</div>${mine.map((v) => `<div class="myvote"><span class="${v.outcome}">${v.outcome}</span> ${pts(v.amount)} → ${pts(v.potential)} <span class="note">${tr("or.v.at", "at {p}%", { p: v.pct })}</span></div>`).join("")}</div>` : ""}
    ${wallet && wallet.votes.length ? `<details class="mylist"><summary>${tr("or.v.all", "🗳️ All my votes ({n})", { n: wallet.votes.length })}</summary>${voteListHtml(wallet.votes)}</details>` : ""}
    <details class="lb"><summary>${tr("or.v.top", "🏆 Top forecasters")}</summary><div id="voteLb" class="note">${tr("or.loadingDots", "Loading…")}</div></details>
    ${DISCLAIMER}
  </div>`;
  el.querySelectorAll(".facpick").forEach((b) => (b.onclick = () => { pick = b.dataset.f; msg = ""; render(); }));
  el.querySelectorAll(".amount").forEach((b) => (b.onclick = () => { amount = +b.dataset.s; msg = ""; render(); }));
  const si = el.querySelector("#voteSignIn");
  if (si) si.onclick = () => document.getElementById("signIn") && document.getElementById("signIn").click();
  const bonus = el.querySelector("#voteBonus");
  if (bonus) bonus.onclick = async () => {
    let r = null;
    try { r = await call("/vote/bonus", "POST", {}); } catch { /* network */ }
    msg = !r ? tr("or.e.reach", "The oracle didn't answer. Try again.") : r.status === 200 ? tr("or.v.added", "+25 BonusCheques added.") : voteErrorText(r.body.error, r.body);
    if (r && r.body && r.body.balance != null && wallet) { wallet.balance = r.body.balance; wallet.bonus_available = r.status === 200 ? false : !!r.body.bonus_available; }
    refresh();
  };
  const place = el.querySelector("#votePlace");
  if (place) place.onclick = async () => {
    if (busy) return;
    busy = true; render();
    const f = pick, n = amount;
    const body = { key: alert.key, outcome: f, amount: n, seen_pct: q.pcts[f], vote_id: newVoteId() };
    let r = null;
    for (let i = 0; i < 2 && !r; i++) { try { r = await call("/vote/place", "POST", body); } catch { /* network: one retry with the same vote_id */ } }
    busy = false;
    if (r && r.body && r.body.balance != null && wallet) wallet.balance = r.body.balance; // the refusal's balance is the real one
    msg = !r ? tr("or.e.reach", "The oracle didn't answer. Try again.")
      : r.status === 200 ? tr("or.v.done", "Voted {f} with {n}: {r} back if {f} wins. Now go help them!", { f, n, r: pts(r.body.vote.potential != null ? r.body.vote.potential : r.body.vote.reward) })
      : voteErrorText(r.body.error, r.body);
    if (r && r.status === 401) { msg = voteErrorText("not_signed_in"); }
    refresh();
  };
  const lb = el.querySelector("details.lb");
  lb.ontoggle = async () => {
    if (!lb.open) return;
    const r = await call("/vote/leaderboard");
    const rows = (r.body.leaders || []).slice(0, 10);
    lb.querySelector("#voteLb").innerHTML = rows.length ? rows.map((x, i) => `<div class="myvote">${i + 1}. <span class="${esc(x.faction || "")}">${esc(x.name)}</span> ${signed(x.gain)} <span class="note">${tr("or.v.nVotes", "({n} votes)", { n: x.votes })}</span></div>`).join("") : tr("or.v.noneDone1", "No finished votes yet.");
  };
}

const css = `
.vote { margin-top: 14px; }
.votebar { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 10px; flex-wrap: wrap; }
.facrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.facpick { background: var(--panel2); border: 1px solid var(--border); border-radius: 0; padding: 10px 6px; font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 56px; }
.facpick.VS { color: var(--vs); } .facpick.NC { color: var(--nc); } .facpick.TR { color: var(--tr); }
.facpick b { font-size: 13px; letter-spacing: .08em; } .facpick span { color: var(--text); font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.facpick.on { border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; background: #181b22; }
.facpick:focus-visible, .amount:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.facpick:disabled { opacity: .35; cursor: default; }
.amounts { display: flex; gap: 8px; margin: 12px 0 6px; flex-wrap: wrap; }
.amount { flex: 1; min-width: 56px; min-height: 44px; background: var(--panel2); border: 1px solid var(--border); border-radius: 0; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
.amount.on { border-color: var(--accent); background: #1a2230; }
.vote .row2 { margin-top: 10px; } .vote .btn.big { width: 100%; }
.votemsg { color: var(--accent); margin-top: 8px; }
.myvotes { margin-top: 10px; } .myvote { font-size: 13px; padding: 3px 0; font-variant-numeric: tabular-nums; }
.vote details { margin-top: 10px; font-size: 13px; } .vote summary { cursor: pointer; color: var(--muted); }
.vote details.fair summary { color: var(--dim); font-size: 12px; line-height: 1.5; }
.vote details.fair summary b { color: var(--muted); font-weight: 600; }
.vote details.fair ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.mvrows { display: flex; flex-direction: column; }
.mvrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 6px 0; border-bottom: 1px solid #1e222a; font-size: 14px; font-variant-numeric: tabular-nums; min-width: 0; }
.mvrow .mvname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mvrow .mvst { font-weight: 600; min-width: 3.2em; text-align: right; }
.mvrow.won .mvst, .myvotescard b.won { color: var(--ok); } .mvrow.lost .mvst, .myvotescard b.lost { color: var(--err); } .mvrow.void .mvst { color: var(--dim); }
`;

function mount() {
  if (typeof document === "undefined") return;   // imported by a Node test
  if (!document.getElementById("voteCss")) {
    const s = document.createElement("style"); s.id = "voteCss"; s.textContent = css; document.head.appendChild(s);
  }
  addEventListener("oracle:alert", (e) => {
    const changed = !alert || !e.detail || alert.key !== e.detail.key;
    alert = e.detail || null;
    if (changed) { pick = null; msg = ""; }
    refresh();
  });
  addEventListener("oracle:auth", (e) => { me = e.detail || null; wallet = null; pick = null; refresh(); });
  setInterval(refresh, 30000);
  // #82: switching from the PC to the phone (or back) shows what the other device did, right away.
  const soon = () => { if (Date.now() - lastRefresh > 2000) refresh(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) soon(); });
  addEventListener("focus", soon);
}
mount();
