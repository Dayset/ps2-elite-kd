/**
 * Voting panel (self-mounting ES module). Vote on the alert winner with
 * BonusCheques, a meme currency with no cash value. Talks to the ps2-oracle Worker:
 *   GET  /vote/quote?key=   odds for every amount (no sign-in needed)
 *   GET  /vote/me           balance, votes, daily BonusCheque availability (Bearer token)
 *   POST /vote/place        {key, outcome, amount, seen_pct}
 *   POST /vote/bonus        +25 once per UTC day
 *   GET  /vote/leaderboard
 * When signed in and no live alert is selected: a compact "My votes" card from /vote/me.
 * Listens for:  "oracle:alert" {detail: alert|null}   (selected alert changed / refreshed)
 *               "oracle:auth"  {detail: character|null} (signed in / out)
 * Renders into <section id="voteSlot">. Uses localStorage "ps2oracle_token".
 */
const API = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("api") || "https://ps2-oracle.dayset.workers.dev";
const FACS = ["VS", "NC", "TR"];
const AMOUNTS = [25, 50, 100, 200];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = () => { try { return localStorage.getItem("ps2oracle_token"); } catch { return null; } };
const pts = (x) => (Math.round(x * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Grayed placeholder between alerts so users see voting exists. */
const voteIdleHtml = () => `<div class="card vote idle"><h2>🎲 Vote for the winner</h2><div class="note">No live alert — voting opens when the next one starts.</div>${DISCLAIMER}</div>`;

/** Shown on every voting card: short line + expandable fair-play rules. */
export const DISCLAIMER = `<details class="fair"><summary>BonusCheques are a meme currency: no cash value, nothing is ever paid out. <b>Fair play rules</b></summary>
  <ul>
    <li>BonusCheques can't be bought, sold, traded or cashed out, and you can't win anything of value. Everyone starts with 1,000; you get +25 a day, and a little more if you run dry.</li>
    <li>Voting is here to get you into the game: back your faction, then log in and help it win.</li>
    <li>You can vote only for your own faction, so nobody gains from throwing a fight.</li>
    <li>Signing in needs an in-game logout of your character. That proves the character is yours; we never ask for a password or email. We keep your character, a sign-in token, your BonusCheques and votes (<a href="../privacy.html">privacy</a>).</li>
    <li>Fair play only. Riggers, alert throwers and cheaters aren't welcome, and their votes and leaderboard spots can be removed.</li>
  </ul></details>`;

let alert = null, me = null, wallet = null, quotes = null, pick = null, amount = 50, busy = false, msg = "";

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
const STATUS = { won: "right", lost: "wrong", void: "given back" };

/** Compact card: balance, net gain, last 10 settled votes (one line each). */
export function myVotesHtml(w) {
  if (!w) return "";
  const settled = (w.votes || []).filter((v) => v.status && v.status !== "open").slice(0, 10);
  const rows = settled.map((v) => `<div class="mvrow ${esc(v.status)}"><span class="mvname">${esc(alertName(v.key))}</span>
      <span class="${esc(v.outcome)}">${esc(v.outcome)}</span> <span class="mvnum">${pts(v.amount)} → ${pts(v.reward || 0)}</span>
      <span class="mvst">${esc(STATUS[v.status] || v.status)}</span></div>`).join("");
  return `<div class="card vote myvotescard"><h2>🗳️ My votes</h2>
    <div class="votebar"><span>BonusCheques <b>${pts(w.balance)}</b></span><span>Net <b class="${w.gain > 0 ? "won" : w.gain < 0 ? "lost" : ""}">${signed(w.gain || 0)}</b></span></div>
    ${rows ? `<div class="mvrows">${rows}</div>` : `<div class="note">No finished votes yet. Votes are counted when their alert ends.</div>`}
    ${DISCLAIMER}
  </div>`;
}
export async function fetchMyVotes() {
  const r = await call("/vote/me");
  return r.status === 200 ? r.body : null;
}

async function refresh() {
  if (!slot()) return;
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
  const head = `<h2>🎲 Vote for the winner</h2>`;
  if (!q || !q.open) {
    el.innerHTML = `<div class="card vote idle">${head}<div class="note">${q && q.reason === "closed" ? "Voting closed for this alert (last 5%)." : q && q.reason === "data_suspect" ? "Voting paused: Census map data looks broken right now. It reopens when the map is healthy again." : "Voting opens when fresh odds are available."}</div>${DISCLAIMER}</div>`;
    return;
  }
  const facBtn = (f) => {
    const off = q.quotes[f] == null || (ownOnly && f !== own);
    return `<button class="facpick ${f} ${pick === f ? "on" : ""}" data-f="${f}" ${off ? "disabled" : ""} aria-pressed="${pick === f}">
      <b>${f}</b><span>${q.pcts[f]}%</span></button>`;
  };
  const sel = pick && q.quotes[pick] && q.quotes[pick][amount];
  const feeNote = (f) => (q.fee_rate[f] ? ` · late fee ${Math.round(q.fee_rate[f] * 100)}%` : "");
  let action;
  if (!me) action = `<button class="btn" id="voteSignIn">Sign in with your character to vote</button>`;
  else if (!wallet) action = `<div class="note">Loading your BonusCheques…</div>`;
  else action = `<button class="btn big" id="votePlace" ${!sel || busy || wallet.balance < amount ? "disabled" : ""}>
      ${sel ? `Vote ${pick} with ${amount}` : "Pick a faction"}</button>`;
  const mine = wallet ? wallet.votes.filter((v) => v.key === alert.key) : [];
  el.innerHTML = `<div class="card vote">${head}
    ${wallet ? `<div class="votebar"><span>BonusCheques <b>${pts(wallet.balance)}</b></span>${wallet.bonus_available ? `<button class="link" id="voteBonus">🧻 Claim today's BonusCheque (+25)</button>` : ""}</div>` : ""}
    <div class="facrow">${FACS.map(facBtn).join("")}</div>
    ${ownOnly ? `<div class="note">You fly ${esc(own)}: vote for your faction, then go help it win.</div>` : ""}
    <div class="amounts">${AMOUNTS.map((s) => `<button class="amount ${s === amount ? "on" : ""}" data-s="${s}" aria-pressed="${s === amount}">${s}</button>`).join("")}</div>
    ${sel ? `<div class="note"><b>${pts(sel.reward)}</b> back if ${pick} wins · your odds ${(sel.odds * 100).toFixed(1)}% (oracle ${sel.pct}%)${feeNote(pick)}</div>` : ""}
    <div class="row2">${action}</div>
    ${msg ? `<div class="note votemsg">${esc(msg)}</div>` : ""}
    ${mine.length ? `<div class="myvotes"><div class="note">🎫 Your votes on this alert</div>${mine.map((v) => `<div class="myvote"><span class="${v.outcome}">${v.outcome}</span> ${pts(v.amount)} → ${pts(v.potential)} <span class="note">at ${v.pct}%</span></div>`).join("")}</div>` : ""}
    <details class="lb"><summary>🏆 Top forecasters</summary><div id="voteLb" class="note">Loading…</div></details>
    ${DISCLAIMER}
  </div>`;
  el.querySelectorAll(".facpick").forEach((b) => (b.onclick = () => { pick = b.dataset.f; msg = ""; render(); }));
  el.querySelectorAll(".amount").forEach((b) => (b.onclick = () => { amount = +b.dataset.s; msg = ""; render(); }));
  const si = el.querySelector("#voteSignIn");
  if (si) si.onclick = () => document.getElementById("signIn") && document.getElementById("signIn").click();
  const bonus = el.querySelector("#voteBonus");
  if (bonus) bonus.onclick = async () => { const r = await call("/vote/bonus", "POST", {}); msg = r.status === 200 ? "+25 BonusCheques added." : "Already claimed today."; refresh(); };
  const place = el.querySelector("#votePlace");
  if (place) place.onclick = async () => {
    busy = true; render();
    const r = await call("/vote/place", "POST", { key: alert.key, outcome: pick, amount, seen_pct: q.pcts[pick] });
    busy = false;
    msg = r.status === 200 ? `Voted ${pick} with ${amount}: ${pts(r.body.vote.reward)} back if ${pick} wins. Now go help them!`
      : ({ odds_changed: "The odds moved; check the new odds and try again.", insufficient_balance: "Not enough BonusCheques.", closed: "Voting just closed.",
        own_faction_only: "You can vote only for your own faction.", odds_stale: "Odds are refreshing; try again in a minute.", decided: "That outcome is already decided.",
        data_suspect: "Voting is paused while Census map data looks broken." })[r.body.error] || "Couldn't record the vote.";
    refresh();
  };
  const lb = el.querySelector("details.lb");
  lb.ontoggle = async () => {
    if (!lb.open) return;
    const r = await call("/vote/leaderboard");
    const rows = (r.body.leaders || []).slice(0, 10);
    lb.querySelector("#voteLb").innerHTML = rows.length ? rows.map((x, i) => `<div class="myvote">${i + 1}. <span class="${esc(x.faction || "")}">${esc(x.name)}</span> ${signed(x.gain)} <span class="note">(${x.votes} votes)</span></div>`).join("") : "No finished votes yet.";
  };
}

const css = `
.vote { margin-top: 14px; }
.votebar { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 10px; flex-wrap: wrap; }
.facrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.facpick { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 6px; font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 56px; }
.facpick.VS { color: var(--vs); } .facpick.NC { color: var(--nc); } .facpick.TR { color: var(--tr); }
.facpick b { font-size: 13px; letter-spacing: .08em; } .facpick span { color: var(--text); font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.facpick.on { border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; background: #181b22; }
.facpick:focus-visible, .amount:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.facpick:disabled { opacity: .35; cursor: default; }
.amounts { display: flex; gap: 8px; margin: 12px 0 6px; flex-wrap: wrap; }
.amount { flex: 1; min-width: 56px; min-height: 44px; background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
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
}
mount();
