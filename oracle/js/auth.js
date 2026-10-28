// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
// Sign-in dialog (logout-only verification).
import { S, esc, $ } from "./state.js?v=20261018-scrub2";
import { authCall, store, TOKEN_KEY, PENDING_KEY } from "./api.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";
import { linkCodeFromHash, hashWithoutLink, qrSvg } from "./link.js?v=20261028-qr1";

// #82: opened from a PC's one-time QR link (oracle/#link=<code>): take the code and clear it from the address bar
// at once (it is evaluated when main.js imports this module, before anything renders or rewrites the URL).
const LINK_CODE = typeof location !== "undefined" ? linkCodeFromHash(location.hash) : "";
if (LINK_CODE) history.replaceState(null, "", location.pathname + location.search + hashWithoutLink(location.hash));

function renderWho() {
  dispatchEvent(new CustomEvent("oracle:auth", { detail: S.me || null }));
  $("who").innerHTML = S.me
    ? `<span>${tr("or.a.signedAs", "Signed in as {n}", { n: `<b class="${esc(S.me.faction || "")}">${esc(S.me.name)}</b>` })}</span><button class="link" id="linkPhone">${tr("or.l.btn", "📱 Phone")}</button><button class="link" id="signOut">${tr("or.a.signOut", "Sign out")}</button>`
    : `<button class="btn" id="signIn">${tr("or.a.signIn", "Sign in")}</button>`;
  if (S.me) {
    // #82: signs out this device only; the other devices stay signed in.
    $("signOut").onclick = async () => { await authCall("/auth/logout", "POST", {}).catch(() => null); store.set("localStorage", TOKEN_KEY, null); S.me = null; renderWho(); };
    $("linkPhone").onclick = () => openLink();
  } else $("signIn").onclick = () => openAuth();
}
async function loadMe() {
  if (!store.get("localStorage", TOKEN_KEY)) { S.me = null; renderWho(); return; }
  try {
    const r = await authCall("/auth/me");
    if (r.status === 200) S.me = r.body.character;
    else if (r.status === 401) { store.set("localStorage", TOKEN_KEY, null); S.me = null; }
  } catch { /* offline: keep the token, try again later */ }
  renderWho();
}
const stopTimer = () => { clearInterval(S.authTimer); S.authTimer = null; };
function authView(html) { $("authBody").innerHTML = html; }
function openAuth() {
  stopTimer();
  authView(`<h3>${tr("or.a.verify", "Verify your character")}</h3>
    <div class="note">${tr("or.a.why", "Proves you own the character using the game itself: you log out once while we watch the public Census event stream. No password, nothing installed. Voting is tied to a real character so it stays fair: riggers or cheaters aren't welcome.")}</div>
    <ol><li>${tr("or.a.s1", "Log into PlanetSide 2 with the character.")}</li><li>${tr("or.a.s2", "Enter its name and press Register.")}</li><li>${tr("or.a.s3", "Press ACCEPT when it unlocks, then log out in game (ESC → Logout) within 60 seconds.")}</li></ol>
    <input id="authName" placeholder="${tr("or.a.name", "Character name")}" autocomplete="off" maxlength="40">
    <div class="row2"><button class="btn" id="authGo">${tr("or.a.register", "Register")}</button></div><div class="err" id="authErr"></div>`);
  const go = async () => {
    const name = $("authName").value.trim();
    $("authErr").textContent = "";
    $("authGo").disabled = true;
    try {
      const r = await authCall("/auth/start", "POST", { name });
      if (r.status !== 200) {
        $("authErr").textContent = ({ invalid_name: tr("or.a.eName", "That doesn't look like a character name."), character_not_found: tr("or.a.eNotFound", "No character with that name on Census."),
          too_many_attempts: tr("or.a.eMany", "Too many attempts. Try again in 10 minutes."), census_unavailable: tr("or.a.eCensus", "Census is not answering right now. Try again shortly.") })[r.body.error] || tr("or.a.eOther", "Something went wrong.");
        $("authGo").disabled = false; return;
      }
      store.set("sessionStorage", PENDING_KEY, r.body.id);
      acceptStep(r.body.id, r.body.character, r.body.accept_after_s);
    } catch { $("authErr").textContent = tr("or.a.eReach", "The oracle is not reachable."); $("authGo").disabled = false; }
  };
  $("authGo").onclick = go;
  $("authName").onkeydown = (e) => { if (e.key === "Enter") go(); };
  if (!$("auth").open) $("auth").showModal();
  $("authName").focus();
}
function acceptStep(id, ch, wait) {
  stopTimer();
  authView(`<h3><span class="${esc(ch.faction || "")}">${esc(ch.name)}</span></h3>
    ${ch.online === false ? `<div class="err">${tr("or.a.offline", "Census shows this character offline. Log in first, then press ACCEPT.")}</div>` : ""}
    <div class="note">${tr("or.a.accept", "When ACCEPT unlocks, press it and then log out in game: <b>ESC → Logout</b>. You have 60 seconds.")}</div>
    <div class="row2"><button class="btn big" id="authAccept" disabled>⏰ ACCEPT (<span id="authWait">${wait}</span>)</button></div><div class="err" id="authErr"></div>`);
  let left = wait;
  S.authTimer = setInterval(() => {
    left--;
    if (left > 0) { $("authWait").textContent = left; return; }
    stopTimer();
    $("authAccept").disabled = false;
    $("authAccept").textContent = "⏰ ACCEPT";
  }, 1000);
  $("authAccept").onclick = async () => {
    $("authAccept").disabled = true;
    const r = await authCall("/auth/accept", "POST", { id });
    if (r.status === 425) { $("authErr").textContent = tr("or.a.wait", "Wait {n}s.", { n: r.body.wait_s }); $("authAccept").disabled = false; return; }
    if (r.status !== 200) { $("authErr").textContent = r.body.error === "unknown_challenge" ? tr("or.a.expired", "This attempt expired. Start again.") : tr("or.a.noWindow", "Could not start the window."); return; }
    watchStep(id, r.body.window_s);
  };
}
function watchStep(id, total) {
  stopTimer();
  authView(`<h3>${tr("or.a.logoutNow", "Log out now")}</h3><div class="note">${tr("or.a.watching", "In PlanetSide 2: <b>ESC → Logout</b>. Watching the Census stream…")}</div>
    <div class="count">⏰ <span id="authLeft">${total}s</span></div><div class="bar"><span id="authBar" style="width:100%"></span></div><div class="err" id="authErr"></div>`);
  const poll = async () => {
    let r;
    try { r = await authCall(`/auth/check?id=${encodeURIComponent(id)}`); } catch { return; }
    if (r.status !== 200) { stopTimer(); store.set("sessionStorage", PENDING_KEY, null); authView(`<h3>${tr("or.a.gone", "That attempt is gone")}</h3><div class="row2"><button class="btn" id="authAgain">${tr("or.a.again", "Start again")}</button></div>`); $("authAgain").onclick = openAuth; return; }
    const b = r.body;
    if (b.left_s != null) { $("authLeft").textContent = `${b.left_s}s`; $("authBar").style.width = `${(100 * b.left_s) / total}%`; }
    if (b.status === "passed") {
      stopTimer();
      const c = await authCall("/auth/complete", "POST", { id });
      store.set("sessionStorage", PENDING_KEY, null);
      if (c.status === 200) {
        store.set("localStorage", TOKEN_KEY, c.body.token);
        S.me = c.body.character; renderWho();
        authView(`<h3 class="ok">${tr("or.a.verified", "Verified ✓")}</h3><div class="note">${tr("or.a.here", "Signed in as {n} on this browser. Verifying on another device signs this one out.", { n: `<b class="${esc(S.me.faction || "")}">${esc(S.me.name)}</b>` })}</div><div class="row2"><button class="btn" id="authClose">${tr("or.a.done", "Done")}</button></div>`);
        $("authClose").onclick = () => $("auth").close();
      } else authView(`<h3>${tr("or.a.almost", "Almost")}</h3><div class="err">${tr("or.a.notFinished", "The logout was seen but the sign-in could not be finished. Start again.")}</div><div class="row2"><button class="btn" id="authAgain">${tr("or.a.again", "Start again")}</button></div>`), ($("authAgain").onclick = openAuth);
    } else if (b.status === "expired") {
      stopTimer(); store.set("sessionStorage", PENDING_KEY, null);
      authView(`<h3>${tr("or.a.noLogout", "No logout seen")}</h3><div class="note">${tr("or.a.noLogoutWhy", "We didn't see that character log out within 60 seconds. Make sure you're logged in with it, then try again.")}</div><div class="row2"><button class="btn" id="authAgain">${tr("or.a.tryAgain", "Try again")}</button></div>`);
      $("authAgain").onclick = openAuth;
    }
  };
  S.authTimer = setInterval(poll, 2000);
  poll();
}
/** #82: sign out every device of this character (this one too). */
async function signOutAll() {
  stopTimer();
  await authCall("/auth/logout", "POST", { all: true }).catch(() => null);
  store.set("localStorage", TOKEN_KEY, null); S.me = null; renderWho();
  authView(`<h3>${tr("or.l.allDone", "Signed out on all devices")}</h3><div class="note">${tr("or.l.allDoneWhy", "Every device that was signed in as this character is signed out, this one too. Sign in again with the in-game logout.")}</div><div class="row2"><button class="btn" id="authClose">${tr("or.a.done", "Done")}</button></div>`);
  $("authClose").onclick = () => $("auth").close();
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
/**
 * #82: the PC shows a one-time QR code; the phone that scans it is signed in as the same character
 * (no second in-game logout). 3 minutes, works once; the dialog follows the server until the phone is in.
 */
async function openLink() {
  stopTimer();
  const title = `<h3>${tr("or.l.title", "Sign in on your phone")}</h3>`;
  authView(`${title}<div class="note">${tr("or.l.making", "Making a one-time code…")}</div>`);
  if (!$("auth").open) $("auth").showModal();
  let r = null;
  try { r = await authCall("/auth/link", "POST", {}); } catch { /* shown below */ }
  if (!r || r.status !== 200) {
    if (r && r.status === 401) { store.set("localStorage", TOKEN_KEY, null); S.me = null; renderWho(); }
    authView(`${title}<div class="err">${r && r.body.error === "too_many_links" ? tr("or.l.tooMany", "Too many codes. Try again in 10 minutes.") : tr("or.l.failed", "Couldn't make a code right now.")}</div>`);
    return;
  }
  const { url, id, expires_in_s: ttl } = r.body;
  const n = `<b class="${esc((S.me && S.me.faction) || "")}">${esc((S.me && S.me.name) || "")}</b>`;
  authView(`${title}<div class="note">${tr("or.l.how", "Scan this with your phone's camera. It signs the phone in as {n}, no second logout. The code works once, for 3 minutes.", { n })}</div>
    <div class="qr">${qrSvg(url, tr("or.l.qrTitle", "One-time sign-in code"))}</div>
    <div class="note" id="linkState">${tr("or.l.waiting", "Waiting for your phone…")} <b id="linkLeft">${mmss(ttl)}</b></div>
    <div class="row2"><button class="link" id="linkAll">${tr("or.l.all", "Sign out all devices")}</button></div>`);
  $("linkAll").onclick = signOutAll;
  let left = ttl, ticks = 0;
  const poll = async () => {
    left = Math.max(0, left - 1);
    const el = $("linkLeft"); if (el) el.textContent = mmss(left);
    if (++ticks % 2 && left > 0) return; // ask the server every 2 s
    let st = null;
    try { st = await authCall(`/auth/link/status?id=${encodeURIComponent(id)}`); } catch { return; }
    if (!$("auth").open || !$("linkState")) { stopTimer(); return; }
    if (st.status === 401) { stopTimer(); store.set("localStorage", TOKEN_KEY, null); S.me = null; renderWho(); $("auth").close(); return; }
    if (st.status !== 200) return;
    if (st.body.status === "linked") {
      stopTimer();
      authView(`<h3 class="ok">${tr("or.l.linked", "Phone signed in ✓")}</h3><div class="note">${tr("or.l.linkedWhy", "Signed in on {d} devices. Signing out on one keeps the others; a new in-game verification signs out all of them.", { d: st.body.devices })}</div>
        <div class="row2"><button class="btn" id="authClose">${tr("or.a.done", "Done")}</button><button class="link" id="linkAll">${tr("or.l.all", "Sign out all devices")}</button></div>`);
      $("authClose").onclick = () => $("auth").close();
      $("linkAll").onclick = signOutAll;
    } else if (st.body.status === "expired" || left <= 0) {
      stopTimer();
      authView(`${title}<div class="note">${tr("or.l.expired", "The code expired.")}</div><div class="row2"><button class="btn" id="linkNew">${tr("or.l.new", "New code")}</button></div>`);
      $("linkNew").onclick = openLink;
    } else if (st.body.left_s != null) left = st.body.left_s;
  };
  S.authTimer = setInterval(poll, 1000);
}
/** #82: this browser opened a one-time link: claim it; on success this device is signed in as that character. */
async function claimLink(code) {
  let r = null;
  try { r = await authCall("/auth/link/claim", "POST", { code }); } catch { /* shown below */ }
  if (r && r.status === 200) {
    // A different session on this browser signs out first (server side too), then the new token is kept.
    if (store.get("localStorage", TOKEN_KEY)) await authCall("/auth/logout", "POST", {}).catch(() => null);
    store.set("localStorage", TOKEN_KEY, r.body.token);
    S.me = r.body.character; renderWho();
    authView(`<h3 class="ok">${tr("or.a.verified", "Verified ✓")}</h3><div class="note">${tr("or.l.here", "Signed in as {n} on this device. The device that showed the code stays signed in.", { n: `<b class="${esc(S.me.faction || "")}">${esc(S.me.name)}</b>` })}</div><div class="row2"><button class="btn" id="authClose">${tr("or.a.done", "Done")}</button></div>`);
  } else {
    await loadMe(); // keep whatever this browser had
    authView(`<h3>${tr("or.l.bad", "This sign-in link doesn't work")}</h3><div class="note">${r ? tr("or.l.badWhy", "It expired or was already used. On your PC, press 📱 Phone next to your name for a new QR code.") : tr("or.a.eReach", "The oracle is not reachable.")}</div><div class="row2"><button class="btn" id="authClose">${tr("or.a.done", "Done")}</button></div>`);
  }
  $("authClose").onclick = () => $("auth").close();
  if (!$("auth").open) $("auth").showModal();
}
async function resumePending() {
  const id = store.get("sessionStorage", PENDING_KEY);
  if (!id || S.me) return;
  const r = await authCall(`/auth/check?id=${encodeURIComponent(id)}`).catch(() => null);
  if (!r || r.status !== 200 || !["accepted", "passed"].includes(r.body.status)) { store.set("sessionStorage", PENDING_KEY, null); return; }
  $("auth").showModal();
  watchStep(id, 60);
}
export function initAuth() {
  const dlg = $("auth");
  let opener = null;
  dlg.addEventListener("close", () => { stopTimer(); if (opener && opener.isConnected) opener.focus(); opener = null; });
  // Accessibility (#18): Esc closes, Tab stays inside the dialog, focus returns to the opener.
  new MutationObserver(() => { if (dlg.open && !opener) opener = document.activeElement; }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); dlg.close(); return; }
    if (e.key !== "Tab") return;
    const f = [...dlg.querySelectorAll("button, input, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (LINK_CODE) claimLink(LINK_CODE); else loadMe().then(resumePending);
}
