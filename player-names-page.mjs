/**
 * 🪪 Player name checker (player-names.html): a live Census check for one
 * character name, on PC or on PlayStation.
 *
 * Availability is per namespace (player-names.mjs): PC names are unique
 * PC-wide, so one lookup answers for PC; PlayStation checks Genudine and
 * Ceres separately, because a name can exist on both — even twice on one
 * server. A failed lookup never reports "available": it reports unknown.
 *
 * Pacing: one Census call at a time, ~400 ms between the two PS servers, and
 * the registered ID falls back to Daybreak's casual ID once (the registered
 * ID can go quiet under load — seen 2026-11-14 on the outfit checker).
 */
import { t as tr, ready, currentLang } from "./i18n.mjs";
import {
  normalizePlayerName, validPlayerName,
  playerLookupUrl, parsePlayerLookup,
  holderLabel, holdersLabel, variantNames,
  checkTargets, exampleBaseFor,
} from "./player-names.mjs?v=20261114-pn1";
import { censusBase } from "./census-fetch.mjs?v=20261010-sav1";
import { parseRoom } from "./rooms.mjs?v=20261022-ps1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const GAP_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lang = () => currentLang();

async function censusLookup(url, targetBase) {
  // One attempt on the site's registered ID, then one on Daybreak's casual ID.
  const bases = [targetBase, exampleBaseFor(targetBase)];
  let lastErr = null;
  for (const base of bases) {
    const u = base === targetBase ? url : url.replace(targetBase, base);
    try {
      const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (r.status === 429) throw Object.assign(new Error("429"), { rateLimited: true });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const parsed = parsePlayerLookup(await r.json());
      if (parsed.taken === null) throw new Error("Census error");
      return parsed;
    } catch (e) {
      if (e && e.rateLimited) throw e;
      lastErr = e;
      await sleep(800);
    }
  }
  throw lastErr || new Error("Census unavailable");
}

/** Stats page for a taken name: the rankings page, in the checked room. */
function statsHref(name, room) {
  const q = `names=${encodeURIComponent(name)}`;
  return room === "ps" ? `index.html?room=ps&${q}` : `index.html?${q}`;
}

function copyText(text, btn) {
  const done = () => { if (btn) btn.textContent = tr("pn.copied", "Copied “{name}”.", { name: text }); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  } catch { done(); }
}

async function onCheck() {
  const name = $("pnName").value.trim();
  const room = $("pnRoom").value === "ps" ? "ps" : "pc";
  const box = $("pnResult"), btn = $("pnCheckBtn");
  if (!validPlayerName(name)) {
    box.className = "pn-result st-err";
    box.textContent = tr("pn.nameInvalid", "Character names are 3–32 letters and digits, no spaces.");
    return;
  }
  btn.disabled = true;
  box.className = "pn-result st-dim";
  box.textContent = tr("pn.checking", "Checking Census…");
  const targets = checkTargets(room);
  const results = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (i > 0) await sleep(GAP_MS);
      let verdict = "unknown", rows = [];
      try {
        const p = await censusLookup(playerLookupUrl(t.base, name), t.base);
        verdict = p.taken ? "taken" : "free";
        rows = p.rows;
      } catch (e) {
        if (e && e.rateLimited) throw e;
        verdict = "unknown";
      }
      results.push({ target: t, verdict, rows });
    }
  } catch {
    box.className = "pn-result st-err";
    box.textContent = tr("pn.unknownSrv", "⚠️ Couldn’t check “{name}” — Census didn’t answer. Try again in a minute.", { name, server: targets[0].label });
    btn.disabled = false;
    return;
  }
  const lines = [];
  const anyFree = results.some((r) => r.verdict === "free");
  const allTaken = results.length > 0 && results.every((r) => r.verdict === "taken");
  for (const r of results) {
    const server = r.target.label;
    if (r.verdict === "taken") {
      const holder = holdersLabel(r.rows);
      let line = esc(tr("pn.takenSrv", "❌ “{name}” is taken on {server}: {holder}.", { name, server, holder: holder || name }));
      line += ` <a href="${esc(statsHref(name, room))}">${esc(tr("pn.viewStats", "View their stats"))}</a>`;
      lines.push(`<div>${line}</div>`);
    } else if (r.verdict === "free") {
      lines.push(`<div>${esc(tr("pn.freeSrv", "✅ “{name}” is available on {server}.", { name, server }))}</div>`);
    } else {
      lines.push(`<div>${esc(tr("pn.unknownSrv", "⚠️ Couldn’t check “{name}” on {server} — Census didn’t answer. Try again in a minute.", { name, server }))}</div>`);
    }
  }
  box.className = "pn-result " + (allTaken ? "st-err" : "st-dim");
  box.innerHTML = lines.join("");
  if (anyFree) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pn-copy";
    b.textContent = tr("pn.copy", "Copy");
    b.addEventListener("click", () => copyText(name, b));
    box.appendChild(b);
  }
  if (allTaken) {
    // Variations of the taken name, each one click away from its own check.
    const variants = variantNames(name);
    if (variants.length) {
      const wrap = document.createElement("div");
      wrap.className = "pn-variants";
      const label = document.createElement("span");
      label.textContent = tr("pn.variants", "Try a variation:");
      wrap.appendChild(label);
      for (const v of variants) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pn-variant";
        b.textContent = v;
        b.addEventListener("click", () => { $("pnName").value = v; onCheck(); });
        wrap.appendChild(b);
      }
      box.appendChild(wrap);
    }
  }
  btn.disabled = false;
}

async function main() {
  await ready;
  try {
    const room = parseRoom(typeof location !== "undefined" ? location.search : "");
    $("pnRoom").value = room;
  } catch {}
  $("pnCheckBtn").addEventListener("click", onCheck);
  $("pnName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCheck(); } });
  // Keep the name input honest: the game allows letters and digits only.
  $("pnName").addEventListener("input", (e) => {
    const v = e.target.value;
    if (v && !/^[A-Za-z0-9]*$/.test(v)) e.target.value = v.replace(/[^A-Za-z0-9]/g, "");
  });
}

main();
