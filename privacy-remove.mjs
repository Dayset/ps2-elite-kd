/**
 * 🚫 Self-service removal on privacy.html (#61). The player proves the character
 * is theirs with the oracle's logout-only sign-in (PC, Genudine or Ceres), then
 * removes it from PS2 Elite or shows it again. The bots apply it on their next
 * run (scripts/sync-removals.mjs → opt-out.json → purge-removed.mjs).
 * Token lives in sessionStorage only (gone when the tab closes).
 */
import { t as tr, ready, apply } from "./i18n.mjs";

const API = new URLSearchParams(location.search).get("api") || "https://ps2-oracle.dayset.workers.dev";
const TOKEN = "ps2-elite-kd-removal-token";
const SERVER = { pc: "PC", us: "PlayStation · Genudine", eu: "PlayStation · Ceres" };
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function call(path, method = "GET", body) {
  const tok = ss.get(TOKEN);
  const r = await fetch(API + path, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let box = null;
let timer = null;
let view = () => {};
const stop = () => { clearInterval(timer); timer = null; };
const show = (fn) => { view = fn; box.innerHTML = fn(); wire(); };
let wire = () => {};

function errorText(code) {
  return ({
    invalid_name: tr("rm.errName", "That doesn't look like a character name."),
    character_not_found: tr("rm.errNotFound", "No character with that name on this server."),
    too_many_attempts: tr("rm.errTooMany", "Too many attempts. Try again in 10 minutes."),
    census_unavailable: tr("rm.errCensus", "Daybreak's servers are not answering right now. Try again shortly."),
  })[code] || tr("rm.errGeneric", "Something went wrong. Try again.");
}

function startView(err = "") {
  stop();
  wire = () => {
    const go = async () => {
      const name = box.querySelector("#rmName").value.trim();
      const platform = box.querySelector("#rmPlatform").value;
      const btn = box.querySelector("#rmGo");
      btn.disabled = true;
      try {
        const r = await call("/auth/start", "POST", { name, platform });
        if (r.status !== 200) return show(() => startHtml(errorText(r.body.error), name, platform));
        acceptView(r.body.id, r.body.character, r.body.accept_after_s);
      } catch {
        show(() => startHtml(tr("rm.errNet", "The sign-in service is not reachable. Try again later."), name, platform));
      }
    };
    box.querySelector("#rmGo").onclick = go;
    box.querySelector("#rmName").onkeydown = (e) => { if (e.key === "Enter") go(); };
  };
  show(() => startHtml(err));
}

function startHtml(err = "", name = "", platform = "pc") {
  const opt = (v, label) => `<option value="${v}"${v === platform ? " selected" : ""}>${esc(label)}</option>`;
  return `<p>${esc(tr("rm.intro", "Prove the character is yours: log in to PlanetSide 2 with it, then log out once while we watch Daybreak's public event stream. No password, nothing to install."))}</p>
    <div class="rm-row">
      <select id="rmPlatform" aria-label="${esc(tr("rm.platform", "Platform"))}">${opt("pc", "PC")}${opt("us", "PlayStation · Genudine")}${opt("eu", "PlayStation · Ceres")}</select>
      <input id="rmName" placeholder="${esc(tr("rm.name", "Character name"))}" aria-label="${esc(tr("rm.name", "Character name"))}" autocomplete="off" maxlength="40" value="${esc(name)}" />
      <button class="rm-btn" id="rmGo">${esc(tr("rm.go", "Prove it's mine"))}</button>
    </div>
    ${err ? `<p class="rm-err">${esc(err)}</p>` : ""}`;
}

function acceptView(id, ch, wait) {
  stop();
  let left = wait;
  const html = () => `<p><b>${esc(ch.name)}</b> · ${esc(SERVER[ch.platform] || "PC")}</p>
    ${ch.online === false ? `<p class="rm-err">${esc(tr("rm.offline", "Daybreak shows this character offline. Log in with it first, then press the button."))}</p>` : ""}
    <p>${esc(tr("rm.accept", "When the button unlocks, press it, then log out in the game (ESC → Logout) within 60 seconds."))}</p>
    <button class="rm-btn" id="rmAccept"${left > 0 ? " disabled" : ""}>⏰ ${esc(tr("rm.ready", "I'm logged in, start"))}${left > 0 ? ` (${left})` : ""}</button>
    <p class="rm-err" id="rmErr"></p>`;
  wire = () => {
    box.querySelector("#rmAccept").onclick = async () => {
      box.querySelector("#rmAccept").disabled = true;
      const r = await call("/auth/accept", "POST", { id }).catch(() => ({ status: 0, body: {} }));
      if (r.status === 200) return watchView(id, r.body.window_s || 60);
      box.querySelector("#rmErr").textContent = r.status === 425 ? tr("rm.wait", "Wait a few more seconds.") : tr("rm.gone", "This attempt expired. Start again.");
      if (r.status === 425) box.querySelector("#rmAccept").disabled = false;
    };
  };
  show(html);
  timer = setInterval(() => {
    left--;
    if (left <= 0) stop();
    show(html);
  }, 1000);
}

function watchView(id, total) {
  stop();
  let leftS = total;
  const html = () => `<p><b>${esc(tr("rm.logoutNow", "Log out now: ESC → Logout"))}</b></p>
    <p class="rm-dim">${esc(tr("rm.watching", "Watching for your logout…"))} ⏰ ${leftS}s</p>`;
  wire = () => {}; // this step has no buttons
  show(html);
  const poll = async () => {
    const r = await call(`/auth/check?id=${encodeURIComponent(id)}`).catch(() => null);
    if (!r) return;
    if (r.status !== 200) { stop(); return startView(tr("rm.gone", "This attempt expired. Start again.")); }
    if (r.body.left_s != null) { leftS = r.body.left_s; show(html); }
    if (r.body.status === "passed") {
      stop();
      const c = await call("/auth/complete", "POST", { id }).catch(() => ({ status: 0 }));
      if (c.status !== 200) return startView(tr("rm.errGeneric", "Something went wrong. Try again."));
      ss.set(TOKEN, c.body.token);
      return meView();
    }
    if (r.body.status === "expired") {
      stop();
      startView(tr("rm.noLogout", "We didn't see that character log out within 60 seconds. Make sure you're logged in with it, then try again."));
    }
  };
  timer = setInterval(poll, 2000);
  poll();
}

async function meView(msg = "") {
  stop();
  const r = await call("/privacy/me").catch(() => ({ status: 0 }));
  if (r.status !== 200) { ss.set(TOKEN, null); return startView(r.status === 401 ? "" : tr("rm.errNet", "The sign-in service is not reachable. Try again later.")); }
  const { character: ch, status } = r.body;
  const removed = status === "removed";
  wire = () => {
    box.querySelector("#rmAct").onclick = async () => {
      box.querySelector("#rmAct").disabled = true;
      const a = await call(removed ? "/privacy/restore" : "/privacy/remove", "POST", {}).catch(() => ({ status: 0 }));
      meView(a.status === 200
        ? (removed ? tr("rm.doneShown", "Done. Your character can appear again from the next refresh.") : tr("rm.doneRemoved", "Done. The next bot run (usually within an hour) deletes our copy and hides the character everywhere on the site."))
        : tr("rm.errGeneric", "Something went wrong. Try again."));
    };
    box.querySelector("#rmOut").onclick = () => { ss.set(TOKEN, null); startView(); };
  };
  show(() => `<p class="rm-ok">✓ ${esc(tr("rm.verified", "Verified:"))} <b>${esc(ch.name)}</b> · ${esc(SERVER[ch.platform] || "PC")}</p>
    <p>${esc(removed ? tr("rm.isRemoved", "This character is removed from PS2 Elite.") : tr("rm.isShown", "This character is shown on PS2 Elite."))}</p>
    <div class="rm-row"><button class="rm-btn${removed ? "" : " rm-danger"}" id="rmAct">${esc(removed ? tr("rm.restore", "Show it again") : tr("rm.remove", "Remove it from PS2 Elite"))}</button>
    <button class="rm-link" id="rmOut">${esc(tr("rm.other", "Use another character"))}</button></div>
    ${msg ? `<p class="rm-dim">${esc(msg)}</p>` : ""}`);
}

export async function initRemoval(el) {
  box = el;
  if (!box) return;
  await ready.catch(() => {});
  window.addEventListener("ps2-lang", () => { box.innerHTML = view(); wire(); apply(box); });
  if (ss.get(TOKEN)) meView();
  else startView();
}

if (typeof document !== "undefined") initRemoval(document.getElementById("rmBox"));
