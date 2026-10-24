// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
// Sign-in dialog (logout-only verification).
import { S, esc, $ } from "./state.js?v=20261018-scrub2";
import { authCall, store, TOKEN_KEY, PENDING_KEY } from "./api.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";

function renderWho() {
  dispatchEvent(new CustomEvent("oracle:auth", { detail: S.me || null }));
  $("who").innerHTML = S.me
    ? `<span>${tr("or.a.signedAs", "Signed in as {n}", { n: `<b class="${esc(S.me.faction || "")}">${esc(S.me.name)}</b>` })}</span><button class="link" id="signOut">${tr("or.a.signOut", "Sign out")}</button>`
    : `<button class="btn" id="signIn">${tr("or.a.signIn", "Sign in")}</button>`;
  if (S.me) $("signOut").onclick = async () => { await authCall("/auth/logout", "POST", {}); store.set("localStorage", TOKEN_KEY, null); S.me = null; renderWho(); };
  else $("signIn").onclick = () => openAuth();
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
  loadMe().then(resumePending);
}
