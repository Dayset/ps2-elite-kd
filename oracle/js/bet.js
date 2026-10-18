/**
 * Betting panel (self-mounting ES module). Talks to the ps2-oracle Worker:
 *   GET  /bet/quote?key=   LMSR quotes for every stake (no sign-in needed)
 *   GET  /bet/me           balance, bets, BonusCheque availability (Bearer token)
 *   POST /bet/place        {key, outcome, stake, seen_pct}
 *   POST /bet/bonus        +25 once per UTC day
 *   GET  /bet/leaderboard
 * When signed in and no live alert is selected: a compact "My bets" card (#20) from /bet/me.
 * Listens for:  "oracle:alert" {detail: alert|null}   (selected alert changed / refreshed)
 *               "oracle:auth"  {detail: character|null} (signed in / out)
 * Renders into <section id="betSlot">. Uses localStorage "ps2oracle_token".
 */
const API = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("api") || "https://ps2-oracle.dayset.workers.dev";
const FACS = ["VS", "NC", "TR"];
const STAKES = [25, 50, 100, 200];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = () => { try { return localStorage.getItem("ps2oracle_token"); } catch { return null; } };
const pts = (x) => (Math.round(x * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

let alert = null, me = null, wallet = null, quotes = null, pick = null, stake = 50, busy = false, msg = "";

async function call(path, method = "GET", body) {
  const t = token();
  const r = await fetch(API + path, { method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const slotEl = typeof document !== "undefined" ? document.getElementById("betSlot") : null;
const slot = () => slotEl;

// "My bets" (#20): alert key "world-zone-instance" -> "Server · Continent".
const WORLD_NAMES = { 1: "Osprey", 10: "Wainwright", 25: "Briggs", 40: "SolTech" };
const ZONE_NAMES = { 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur" };
export function alertName(key) {
  const [w, z] = String(key || "").split("-").map(Number);
  return `${WORLD_NAMES[w] || "World " + w} · ${ZONE_NAMES[z & 0xffff] || "Zone " + z}`;
}
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pts(Math.abs(x))}`;
/** Compact card: balance, total profit, last 10 settled bets (one line each). */
export function myBetsHtml(w) {
  if (!w) return "";
  const settled = (w.bets || []).filter((b) => b.status && b.status !== "open").slice(0, 10);
  const rows = settled.map((b) => `<div class="mbrow ${esc(b.status)}"><span class="mbname">${esc(alertName(b.key))}</span>
      <span class="${esc(b.outcome)}">${esc(b.outcome)}</span> <span class="mbnum">${pts(b.stake)} → ${pts(b.payout || 0)}</span>
      <span class="mbst">${esc(b.status)}</span></div>`).join("");
  return `<div class="card bet mybetscard"><h2>My bets</h2>
    <div class="betbar"><span>Balance <b>${pts(w.balance)}</b></span><span>Total profit <b class="${w.profit > 0 ? "won" : w.profit < 0 ? "lost" : ""}">${signed(w.profit || 0)}</b></span></div>
    ${rows ? `<div class="mbrows">${rows}</div>` : `<div class="note">No settled bets yet. Bets settle when their alert ends.</div>`}
  </div>`;
}
export async function fetchMyBets() {
  const r = await call("/bet/me");
  return r.status === 200 ? r.body : null;
}

async function refresh() {
  if (!slot()) return;
  if (!alert || alert.status !== "live") {
    if (!me) { slot().innerHTML = ""; return; }
    try { wallet = await fetchMyBets(); } catch { wallet = null; }
    if (alert && alert.status === "live") return;   // switched while loading
    slot().innerHTML = myBetsHtml(wallet);
    return;
  }
  try {
    const [q, w] = await Promise.all([call(`/bet/quote?key=${encodeURIComponent(alert.key)}`), me ? call("/bet/me") : Promise.resolve(null)]);
    quotes = q.body;
    wallet = w && w.status === 200 ? w.body : null;
    if (w && w.status === 401) wallet = null;
  } catch { quotes = null; }
  render();
}

function render() {
  const el = slot();
  if (!el || !alert || alert.status !== "live") { if (el) el.innerHTML = me ? myBetsHtml(wallet) : ""; return; }
  const q = quotes;
  const own = wallet && wallet.own_faction;
  const ownOnly = q && q.own_faction_only && FACS.includes(own);
  if (pick && ownOnly && pick !== own) pick = null;
  if (!pick && ownOnly) pick = own;
  const head = `<h2>Bet on the winner</h2>`;
  if (!q || !q.open) {
    el.innerHTML = `<div class="card bet">${head}<div class="note">${q && q.reason === "closed" ? "Betting closed for this alert (last 5%)." : "Betting opens when fresh odds are available."}</div></div>`;
    return;
  }
  const facBtn = (f) => {
    const off = q.quotes[f] == null || (ownOnly && f !== own);
    return `<button class="facpick ${f} ${pick === f ? "on" : ""}" data-f="${f}" ${off ? "disabled" : ""} aria-pressed="${pick === f}">
      <b>${f}</b><span>${q.pcts[f]}%</span></button>`;
  };
  const sel = pick && q.quotes[pick] && q.quotes[pick][stake];
  const feeNote = (f) => (q.fee_rate[f] ? ` · fee ${Math.round(q.fee_rate[f] * 100)}%` : "");
  let action;
  if (!me) action = `<button class="btn" id="betSignIn">Sign in to bet</button>`;
  else if (!wallet) action = `<div class="note">Loading your wallet…</div>`;
  else action = `<button class="btn big" id="betPlace" ${!sel || busy || wallet.balance < stake ? "disabled" : ""}>
      ${sel ? `Bet ${stake} on ${pick} → pays ${pts(sel.payout)}` : "Pick a faction"}</button>`;
  const mine = wallet ? wallet.bets.filter((b) => b.key === alert.key) : [];
  el.innerHTML = `<div class="card bet">${head}
    ${wallet ? `<div class="betbar"><span>Balance <b>${pts(wallet.balance)}</b></span>${wallet.bonus_available ? `<button class="link" id="betBonus">Cash today's BonusCheque (+25)</button>` : ""}</div>` : ""}
    <div class="facrow">${FACS.map(facBtn).join("")}</div>
    ${ownOnly ? `<div class="note">You fly ${esc(own)}: you can back your own faction.</div>` : ""}
    <div class="stakes">${STAKES.map((s) => `<button class="stake ${s === stake ? "on" : ""}" data-s="${s}" aria-pressed="${s === stake}">${s}</button>`).join("")}</div>
    ${sel ? `<div class="note">Average price ${(sel.avg_price * 100).toFixed(1)}% vs oracle ${sel.pct}%${feeNote(pick)}.</div>` : ""}
    <div class="row2">${action}</div>
    ${msg ? `<div class="note betmsg">${esc(msg)}</div>` : ""}
    ${mine.length ? `<div class="mybets"><div class="note">Your bets on this alert</div>${mine.map((b) => `<div class="mybet"><span class="${b.outcome}">${b.outcome}</span> ${pts(b.stake)} → ${pts(b.shares)} <span class="note">at ${b.pct}%</span></div>`).join("")}</div>` : ""}
    <details class="lb"><summary>Leaderboard</summary><div id="betLb" class="note">Loading…</div></details>
    <div class="note">Points are virtual: never bought, never cashed out. Prices follow the oracle; you profit only by knowing better.</div>
  </div>`;
  el.querySelectorAll(".facpick").forEach((b) => (b.onclick = () => { pick = b.dataset.f; msg = ""; render(); }));
  el.querySelectorAll(".stake").forEach((b) => (b.onclick = () => { stake = +b.dataset.s; msg = ""; render(); }));
  const si = el.querySelector("#betSignIn");
  if (si) si.onclick = () => document.getElementById("signIn") && document.getElementById("signIn").click();
  const bonus = el.querySelector("#betBonus");
  if (bonus) bonus.onclick = async () => { const r = await call("/bet/bonus", "POST", {}); msg = r.status === 200 ? "+25 added." : "Already claimed today."; refresh(); };
  const place = el.querySelector("#betPlace");
  if (place) place.onclick = async () => {
    busy = true; render();
    const r = await call("/bet/place", "POST", { key: alert.key, outcome: pick, stake, seen_pct: q.pcts[pick] });
    busy = false;
    msg = r.status === 200 ? `Placed: ${stake} on ${pick}, pays ${pts(r.body.bet.payout)} if ${pick} wins.`
      : ({ odds_changed: "The odds moved; check the new price and try again.", insufficient_balance: "Not enough points.", closed: "Betting just closed.",
        own_faction_only: "You can back only your own faction.", odds_stale: "Odds are refreshing; try again in a minute.", decided: "That outcome is already decided." })[r.body.error] || "Couldn't place the bet.";
    refresh();
  };
  const lb = el.querySelector("details.lb");
  lb.ontoggle = async () => {
    if (!lb.open) return;
    const r = await call("/bet/leaderboard");
    const rows = (r.body.leaders || []).slice(0, 10);
    lb.querySelector("#betLb").innerHTML = rows.length ? rows.map((x, i) => `<div class="mybet">${i + 1}. <span class="${esc(x.faction || "")}">${esc(x.name)}</span> ${x.profit >= 0 ? "+" : ""}${pts(x.profit)} <span class="note">(${x.bets} bets)</span></div>`).join("") : "No settled bets yet.";
  };
}

const css = `
.bet { margin-top: 14px; }
.betbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 10px; flex-wrap: wrap; }
.facrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.facpick { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 6px; font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 56px; }
.facpick.VS { color: var(--vs); } .facpick.NC { color: var(--nc); } .facpick.TR { color: var(--tr); }
.facpick b { font-size: 13px; letter-spacing: .08em; } .facpick span { color: var(--text); } .facpick span { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.facpick.on { border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; background: #181b22; }
.facpick:focus-visible, .stake:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.facpick:disabled { opacity: .35; cursor: default; }
.stakes { display: flex; gap: 8px; margin: 12px 0 6px; flex-wrap: wrap; }
.stake { flex: 1; min-width: 56px; min-height: 44px; background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
.stake.on { border-color: var(--accent); background: #1a2230; }
.bet .row2 { margin-top: 10px; } .bet .btn.big { width: 100%; }
.betmsg { color: var(--accent); margin-top: 8px; }
.mybets { margin-top: 10px; } .mybet { font-size: 13px; padding: 3px 0; font-variant-numeric: tabular-nums; }
.bet details { margin-top: 10px; font-size: 13px; } .bet summary { cursor: pointer; color: var(--muted); }
.mbrows { display: flex; flex-direction: column; }
.mbrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 6px 0; border-bottom: 1px solid #1e222a; font-size: 14px; font-variant-numeric: tabular-nums; min-width: 0; }
.mbrow .mbname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbrow .mbst { font-weight: 600; min-width: 3.2em; text-align: right; }
.mbrow.won .mbst, .mybetscard b.won { color: var(--ok); } .mbrow.lost .mbst, .mybetscard b.lost { color: var(--err); } .mbrow.void .mbst { color: var(--dim); }
`;

function mount() {
  if (typeof document === "undefined") return;   // imported by a Node test
  if (!document.getElementById("betCss")) {
    const s = document.createElement("style"); s.id = "betCss"; s.textContent = css; document.head.appendChild(s);
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
