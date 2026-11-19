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
/** Hide the per-vote "Check this vote" buttons (owner 2026-11-18): remembered on-device. */
const HIDE_CHECK_KEY = "ps2oracle_hide_vcheck";
const hideCheckStored = () => { try { return localStorage.getItem(HIDE_CHECK_KEY) === "1"; } catch { return false; } };
const saveHideCheck = (v) => { try { localStorage.setItem(HIDE_CHECK_KEY, v ? "1" : "0"); } catch { /* private mode */ } };
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
  </ul></details>
  <p class="note"><a href="../vote-check.html">${tr("or.v.check", "🔐 How to check a vote")}</a> — ${tr("or.v.checkNote", "votes are sealed daily and stamped into Bitcoin, so a vote can't be changed later.")}</p>`;

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
  return ({ odds_changed: tr("or.e.moved", "The win chances moved; check the new ones and try again."), closed: tr("or.e.closed", "Voting just closed."),
    own_faction_only: tr("or.e.own", "You can vote only for your own faction."), odds_stale: tr("or.e.stale", "Win chances are refreshing; try again in a minute."), decided: tr("or.e.decided", "That outcome is already decided."),
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

/** Marker for a history row: the signed-in player's votes on that alert ("" when none). */
export function myVoteMark(votes, key) {
  const mine = (votes || []).filter((v) => v.key === key);
  if (!mine.length) return "";
  const one = (v) => `<span class="myvote"><span class="${esc(v.outcome)}">${esc(v.outcome)}</span> ${esc(STATUS[v.status] || v.status)}</span>`;
  return `🗳️ ${mine.map(one).join(" ")}`;
}

/**
 * One-tap vote check (owner 2026-11-15): the fingerprint (hash) and salt for
 * each vote already come back with /vote/me (v.commits, oracle-worker/src/
 * votelog.js). The browser re-derives the hash from the vote's own details
 * and salt — the same rule the Worker commits with — then walks the stored
 * Merkle path to the day's seal. Nothing is sent anywhere: the check runs
 * entirely in the voter's browser.
 *   placed values:  [id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts]
 *   settled values: [id, status, reward, settled_ts]   (same salt as placed)
 * Statuses: ok (details match + path reaches the seal), not-rooted (details
 * match, the day is sealed overnight), in-seal-only (the fingerprint is in
 * the sealed record but the Worker reply predates cid/settled_ts, so the
 * details could not be re-derived), mismatch (details or path don't fit),
 * no-commit / no-crypto.
 */
const _enc = new TextEncoder();
const _hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const _sha256hex = async (s) => _hexOf(await crypto.subtle.digest("SHA-256", _enc.encode(s)));
export const voteCommitHash = (kind, values, salt) => _sha256hex(`votelog/1|${kind}|${salt}|${JSON.stringify(values)}`);
const _pairHash = (a, b) => _sha256hex(a + b);
export const placedVoteValues = (v) => [v.id, v.cid, v.key, v.outcome, v.amount, v.fee, v.net, v.potential, v.pct, v.progress, v.placed_ts];
export const settledVoteValues = (v) => [v.id, v.status, v.reward, v.settled_ts];
async function _walkToRoot(leaf, path) {
  let acc = leaf;
  for (const s of path || []) acc = s.side === "left" ? await _pairHash(s.h, acc) : await _pairHash(acc, s.h);
  return acc;
}
export async function verifyVoteCheck(v) {
  const commits = (v && v.commits) || null;
  if (!commits || !commits.placed) return { status: "no-commit", kinds: [] };
  if (typeof crypto === "undefined" || !crypto.subtle) return { status: "no-crypto", kinds: [] };
  const kinds = [];
  for (const kind of ["placed", "settled"]) {
    const c = commits[kind];
    if (!c) continue;
    const values = kind === "placed" ? placedVoteValues(v) : settledVoteValues(v);
    const missing = values.some((x) => x === undefined || x === null);
    let recomputed = null, match = null;
    if (!missing) { recomputed = await voteCommitHash(kind, values, c.salt); match = recomputed === c.hash; }
    let rootOk = null;
    if (c.root && Array.isArray(c.path)) rootOk = (await _walkToRoot(c.hash, c.path)) === c.root;
    kinds.push({ kind, values, salt: c.salt, hash: c.hash, recomputed, match, rootOk, day: c.day, root: c.root,
      ots_status: c.ots_status, btc_height: c.btc_height, btc_time: c.btc_time, btc_block: c.btc_block, path: c.path });
  }
  let status;
  if (kinds.some((k) => k.match === false || k.rootOk === false)) status = "mismatch";
  else if (!kinds.some((k) => k.rootOk === true)) status = "not-rooted";
  else if (!kinds.some((k) => k.match === true)) status = "in-seal-only";
  else status = "ok";
  return { status, kinds };
}

/** Check results by vote id, so a re-render (30 s refresh, live card) keeps them. */
const checked = new Map();

/** The check panel for one vote: fingerprint(s), salt, day, verdict, copy. */
export function voteCheckHtml(v, result) {
  const r = result || { status: "checking", kinds: [] };
  if (r.status === "checking") return `<div class="vc-dim">${tr("or.v.checking", "Checking…")}</div>`;
  if (r.status === "no-commit") return `<div class="vc-dim">${tr("or.v.noSeal", "🔐 Fingerprint not ready yet.")}</div>`;
  if (r.status === "no-crypto") return `<div class="vc-bad">${tr("or.v.noCrypto", "This browser can't run the check (it needs a secure page).")}</div>`;
  const k = r.kinds[0] || {};
  // Link only when the block hash is present: a confirmed height without a
  // hash (stale Worker reply) shows as plain text, never /block/undefined.
  const btc = (kk) => (kk.btc_height && kk.btc_block ? ` · <a href="https://mempool.space/block/${esc(kk.btc_block)}" target="_blank" rel="noopener noreferrer">${tr("or.v.btcBlock", "Bitcoin block {n}", { n: kk.btc_height })}</a>`
    : kk.btc_height ? ` · ${tr("or.v.btcBlock", "Bitcoin block {n}", { n: kk.btc_height })}`
    : kk.ots_status === "pending" ? ` · ${tr("or.v.btcPending", "submitted to Bitcoin, confirmation pending")}` : "");
  const banner = r.status === "ok" ? `<div class="vc-ok">${tr("or.v.checkOk", "✅ Matches the sealed record for {d}.", { d: k.day })}${btc(k)}</div>`
    : r.status === "not-rooted" ? `<div class="vc-ok">${tr("or.v.checkNotRooted", "✅ Fingerprint matches what was recorded. Day {d} is sealed overnight — check back tomorrow for the Bitcoin block.", { d: k.day })}</div>`
    : r.status === "in-seal-only" ? `<div class="vc-ok">${tr("or.v.checkInSeal", "✅ This fingerprint is in the sealed record for {d}.", { d: k.day })}${btc(k)}</div><div class="vc-dim">${tr("or.v.checkInSealNote", "The detail check needs a fresh reply from the oracle — try again shortly.")}</div>`
    : `<div class="vc-bad">${tr("or.v.checkBad", "❌ Does not match the sealed record. If nothing changed since sealing, tell us on the Oracle page.")}</div>`;
  const kindRow = (kk) => `<div>${kk.kind === "placed" ? tr("or.v.fpPlaced", "Fingerprint when placed") : tr("or.v.fpSettled", "Fingerprint when settled")}: <code>${esc(kk.hash)}</code> ${kk.match === true ? "✅" : kk.match === false ? "❌" : ""}${kk.rootOk === false ? " ❌" : ""}</div>`;
  return `${r.kinds.map(kindRow).join("")}
    <div>${tr("or.v.salt", "Secret number (salt)")}: <code>${esc(k.salt)}</code></div>
    <div class="vc-dim">${tr("or.v.saltNote", "Keep the salt private — anyone with it can check this vote. Don't post it publicly.")}</div>
    ${banner}
    <div><button type="button" class="vcheck-btn" data-vcopy="${esc(v.id)}">${tr("or.v.copyRecord", "📋 Copy record")}</button> <span class="vc-dim">${tr("or.v.copyNote", "Paste it into “Check a vote record” on the vote-check page.")}</span></div>`;
}

/** Tell the dashboard (history rows) the signed-in player's votes changed. Fires only on change, so the 30 s refresh doesn't re-render history for nothing. */
let lastVotesJson = null;
function emitVotes() {
  const j = JSON.stringify(wallet && wallet.votes ? wallet.votes : null);
  if (j === lastVotesJson) return;
  lastVotesJson = j;
  if (typeof dispatchEvent !== "undefined") dispatchEvent(new CustomEvent("oracle:votes", { detail: wallet }));
}

/**
 * Every vote of the signed-in player (newest first, up to 50 from /vote/me): when it was
 * placed (local time) and how far into the alert, the alert, the faction, what was put in,
 * the oracle odds at that moment, what comes back if right, and the result (owner 2026-10-24).
 */
export function voteListHtml(votes, hide = hideCheckStored()) {
  const vs = votes || [];
  if (!vs.length) return `<div class="note">${tr("or.v.none", "No votes yet.")}</div>`;
  const when = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const res = (v) => (v.status === "open" ? `<span class="mvst open">${tr("or.v.open", "open · {n} if right", { n: pts(v.potential) })}</span>`
    : v.status === "won" ? `<span class="mvst won">${STATUS.won} · +${pts((v.reward || 0) - v.amount)}</span>`
    : v.status === "lost" ? `<span class="mvst lost">${STATUS.lost} · −${pts(v.amount)}</span>`
    : `<span class="mvst void">${STATUS.void}</span>`);
  // Two short lines per vote, no table (phones), plus a one-tap seal check per vote.
  // The toggle sits above the list (inside the <details>, never inside its
  // <summary>, so ticking it can't collapse the section); it hides only the
  // check buttons (data-vcheck), never the "Copy record" button (data-vcopy).
  return `<div class="vlist${hide ? " hide-vcheck" : ""}"><label class="vcheck-hide"><input type="checkbox" data-vcheck-hide${hide ? " checked" : ""}> ${tr("or.v.hideCheck", "Hide vote-check buttons")}</label>${vs.map((v) => `<div class="vrow ${esc(v.status)}">
    <div><b>${esc(when(v.placed_ts))}</b> · ${esc(alertName(v.key))} <span class="note">${tr("or.v.into", "{p}% into the alert", { p: Math.round((v.progress || 0) * 100) })}</span></div>
    <div><span class="${esc(v.outcome)}">${esc(v.outcome)}</span> ${pts(v.amount)} <span class="note">${tr("or.v.at", "at {p}%", { p: esc(v.pct) })}</span> · ${res(v)}</div>
    <div>${v.commits && v.commits.placed ? `<button type="button" class="vcheck-btn" data-vcheck="${esc(v.id)}">${tr("or.v.checkBtn", "🔐 Check this vote")}</button><div class="vcheck">${checked.has(v.id) ? voteCheckHtml(v, checked.get(v.id)) : ""}</div>` : `<span class="note">${tr("or.v.noSeal", "🔐 Fingerprint not ready yet.")}</span>`}</div></div>`).join("")}</div>`;
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
    if (!me) { wallet = null; emitVotes(); slot().innerHTML = voteIdleHtml(); return; }
    try { wallet = await fetchMyVotes(); emitVotes(); } catch { wallet = null; }
    if (alert && alert.status === "live") return;   // switched while loading
    slot().innerHTML = myVotesHtml(wallet);
    return;
  }
  try {
    const [q, w] = await Promise.all([call(`/vote/quote?key=${encodeURIComponent(alert.key)}`), me ? call("/vote/me") : Promise.resolve(null)]);
    quotes = q.body;
    wallet = w && w.status === 200 ? w.body : null;
    emitVotes();
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
    el.innerHTML = `<div class="card vote idle">${head}<div class="note">${q && q.reason === "closed" ? tr("or.v.closedLast", "Voting closed for this alert (last 5%).") : q && q.reason === "data_suspect" ? tr("or.v.paused", "Voting paused: Census map data looks broken right now. It reopens when the map is healthy again.") : tr("or.v.opensFresh", "Voting opens when fresh win chances are available.")}</div>${DISCLAIMER}</div>`;
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
  // Duration mark (owner 2026-11-14): full-time 90-min alerts pay full rewards,
  // shorter/longer ones scale the profit ×dur/90. Shown before any pick is made.
  const fmtMult = (m) => String(Math.round((m || 1) * 100) / 100);
  const durText = q && q.dur ? (q.dur === 90 ? tr("or.v.full", "⏱️ FULL-TIME 90-min alert: full rewards")
    : tr("or.v.durMult", "{n}-min alert: rewards ×{m}", { n: q.dur, m: fmtMult(q.reward_mult) })) : "";
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
    ${durText ? `<div class="note">${durText}</div>` : ""}
    ${sel ? `<div class="note">${tr("or.v.quote", "{n} back if {f} wins · your win chance {p}% (oracle {o}%)", { n: `<b>${pts(sel.reward)}</b>`, f: pick, p: (sel.odds * 100).toFixed(1), o: sel.pct })}${feeNote(pick)}</div>` : ""}
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
.vcheck-btn { background: var(--panel2); border: 1px solid var(--border); border-radius: 0; color: var(--text); font: inherit; font-size: 13px; padding: 6px 10px; min-height: 36px; cursor: pointer; margin-top: 6px; }
.vcheck-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.vcheck-hide { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); cursor: pointer; margin: 2px 0 6px; }
.vcheck-hide input { accent-color: var(--accent); margin: 0; }
.vlist.hide-vcheck button[data-vcheck] { display: none; }
.vcheck { margin-top: 6px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.vcheck code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; word-break: break-all; }
.vcheck .vc-ok { color: var(--ok); font-weight: 600; }
.vcheck .vc-bad { color: var(--err); font-weight: 600; }
.vcheck .vc-dim { color: var(--dim); }
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
  // One delegated listener for the per-vote seal check: it survives the
  // innerHTML re-renders, and keeps the "All my votes" <details> open.
  if (slotEl) slotEl.addEventListener("click", async (e) => {
    const rerender = (wasOpen) => {
      if (!slot()) return;
      render();
      const d = slot().querySelector("details.mylist");
      if (d && wasOpen) d.open = true;
    };
    const copyBtn = e.target.closest ? e.target.closest("[data-vcopy]") : null;
    if (copyBtn) {
      const vote = (wallet && wallet.votes || []).find((x) => x.id === copyBtn.dataset.vcopy);
      const res = vote && checked.get(vote.id);
      const kind = res && res.kinds.find((kk) => kk.kind === "settled") ? "settled" : "placed";
      const kk = res && res.kinds.find((x) => x.kind === kind);
      if (!vote || !kk) return;
      const record = JSON.stringify({ kind, values: kk.values, salt: kk.salt, hash: kk.hash, path: kk.path, root: kk.root });
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(record);
        else throw new Error("no clipboard");
        copyBtn.textContent = tr("or.v.copied", "Copied ✓");
      } catch { copyBtn.textContent = tr("or.v.copyFail", "Copy failed — select the text above."); }
      return;
    }
    const btn = e.target.closest ? e.target.closest("[data-vcheck]") : null;
    if (!btn) return;
    const vote = (wallet && wallet.votes || []).find((x) => x.id === btn.dataset.vcheck);
    if (!vote || checked.get(vote.id)?.status === "checking") return;
    const wasOpen = slotEl.querySelector("details.mylist")?.open;
    checked.set(vote.id, { status: "checking", kinds: [] });
    rerender(wasOpen);
    checked.set(vote.id, await verifyVoteCheck(vote));
    rerender(wasOpen);
  });
  // Hide/show the per-vote seal-check buttons: instant, no re-render (which
  // would collapse the <details>), remembered on-device for the next render.
  if (slotEl) slotEl.addEventListener("change", (e) => {
    const t = e.target.closest ? e.target.closest("[data-vcheck-hide]") : null;
    if (!t) return;
    saveHideCheck(t.checked);
    const list = t.closest(".vlist");
    if (list) list.classList.toggle("hide-vcheck", t.checked);
  });
  setInterval(refresh, 30000);
  // #82: switching from the PC to the phone (or back) shows what the other device did, right away.
  const soon = () => { if (Date.now() - lastRefresh > 2000) refresh(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) soon(); });
  addEventListener("focus", soon);
}
mount();
