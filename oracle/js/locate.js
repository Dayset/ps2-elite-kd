// 📍 Locate one character (owner 2026-11-12, hidden in the Oracle page's ⓘ About).
// The field asks GET /locate?name= on the Worker, which answers from the same live event
// stream as ⚔️ Live fights: a player doing nothing has no position. Exact = capture,
// defence or vehicle kill at the base; near = placed by one Death hop from someone placed
// exactly. Nothing is stored; the answer is one lookup at a time.
import { get } from "./api.js?v=20261018-scrub2";
import { esc } from "./state.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";
import { highlightBase } from "./map.js?v=20261102-conduit1";

export const LOCATE_NAME_RE = /^[A-Za-z0-9]{3,32}$/;
export const WORLD_NAMES = { 1: "Osprey", 10: "Wainwright", 40: "SolTech", 1000: "Genudine", 2000: "Ceres" };
const PLAT = { pc: "PC", us: "PlayStation US", eu: "PlayStation EU" };

const agoTxt = (s) => s == null || !Number.isFinite(+s) ? ""
  : +s < 60 ? tr("or.locate.agoS", "{n} s", { n: Math.max(0, Math.round(+s)) })
  : +s < 3600 ? tr("or.locate.agoM", "{n} min", { n: Math.round(+s / 60) })
  : tr("or.locate.agoH", "{n} h", { n: Math.round(+s / 3600) });

const head = (r) => {
  const fac = r.faction ? `<span class="${esc(r.faction)}">${esc(r.faction)}</span>` : "";
  const w = r.world != null ? (WORLD_NAMES[r.world] || `#${r.world}`) : "";
  const bits = [`<b>${esc(r.name || "?")}</b>`, fac, PLAT[r.platform] || "", w].filter(Boolean).join(" · ");
  return bits;
};

/** One lookup's answer as HTML (pure: no DOM, no fetch). */
export function formatLocate(r, t = tr) {
  if (!r || typeof r !== "object") return esc(t("or.locate.failed", "Couldn't look that up right now."));
  if (r.error === "invalid_name") return esc(t("or.locate.invalid", "That doesn't look like a character name (3–32 letters and digits)."));
  if (r.error === "unknown_name") return esc(t("or.locate.unknown", "No character with that name on PC or PlayStation."));
  if (r.error === "census_error") return esc(t("or.locate.census", "Census didn't answer — try again in a minute."));
  if (r.error === "rate_limited") return esc(t("or.locate.ratelimited", "Too many lookups — wait a bit and try again."));
  if (r.error) return esc(t("or.locate.failed", "Couldn't look that up right now."));
  const h = head(r);
  const unavail = r.stream == null ? ` <span class="note">${esc(t("or.locate.unavail", "Live positions are unavailable right now."))}</span>` : "";
  const down = r.stream === false ? ` <span class="note">${esc(t("or.locate.streamDown", "The live stream is down, so positions may be stale."))}</span>` : "";
  const loc = r.loc;
  if (!loc) {
    const state = r.online === false
      ? esc(t("or.locate.offline", "offline — nothing to place"))
      : esc(t("or.locate.noPos", "no position: nothing seen in the last hour"));
    return `${h} — ${state}.${unavail}${down}`;
  }
  const zone = loc.zn || (loc.z != null ? `#${loc.z}` : "");
  if (!loc.on) {
    const ago = agoTxt(loc.ago);
    return `${h} — ${esc(t("or.locate.loggedOut", "logged out"))}${ago ? ` ${ago} ${esc(t("or.locate.agoWord", "ago"))}` : ""}${zone ? ` · ${esc(t("or.locate.wasOn", "was on {zone}", { zone }))}` : ""}.${unavail}${down}`;
  }
  const how = loc.how === "exact"
    ? esc(t("or.locate.exact", "exact — capture, defence or vehicle kill there"))
    : esc(t("or.locate.near", "near — placed from a nearby fight"));
  const placed = loc.fago != null ? ` · ${esc(t("or.locate.placedAgo", "placed {ago} ago", { ago: agoTxt(loc.fago) }))}` : "";
  const seen = loc.ago != null && loc.f == null ? ` · ${esc(t("or.locate.seenAgo", "last event {ago} ago", { ago: agoTxt(loc.ago) }))}` : "";
  if (loc.f && loc.fn) {
    const base = `<span class="blink" tabindex="0" role="button" data-base="${esc(loc.fn)}">${esc(loc.fn)}</span>`;
    return `${h} — ${t("or.locate.at", "at {base} on {zone}", { base, zone })} · ${how}${placed}.${unavail}${down}`;
  }
  return `${h} — ${esc(t("or.locate.onZone", "on {zone} — no base fixed yet", { zone: zone || "?" }))} · ${how}${seen}.${unavail}${down}`;
}

/** Wire the field in ⓘ About (once; the footer is static, render() never rewrites it). */
export function initLocate() {
  const box = document.getElementById("locateBox");
  if (!box || box.dataset.init) return;
  box.dataset.init = "1";
  const form = document.getElementById("locateForm");
  const input = document.getElementById("locateName");
  const btn = document.getElementById("locateBtn");
  const out = document.getElementById("locateOut");
  if (!form || !input || !btn || !out) return;
  // Base names in the answer highlight the map, like the ⚔️ Live fights rows do.
  out.addEventListener("mouseover", (e) => { const b = e.target && e.target.closest ? e.target.closest(".blink[data-base]") : null; if (b) highlightBase(b.dataset.base); });
  out.addEventListener("mouseout", (e) => { const b = e.target && e.target.closest ? e.target.closest(".blink[data-base]") : null; if (b) highlightBase(null); });
  out.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest(".blink[data-base]") : null;
    if (!b) return;
    e.preventDefault();
    highlightBase(b.dataset.base);
    const m = document.getElementById("map");
    if (m) { const rc = m.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) m.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim().replace(/^\[[^\]]*\]\s*/, "");
    if (!LOCATE_NAME_RE.test(name)) { out.textContent = tr("or.locate.invalid", "That doesn't look like a character name (3–32 letters and digits)."); return; }
    btn.disabled = true;
    out.textContent = tr("or.locate.looking", "Looking…");
    try {
      const r = await get("/locate?name=" + encodeURIComponent(name));
      out.innerHTML = formatLocate(r);
    } catch {
      out.textContent = tr("or.locate.failed", "Couldn't look that up right now.");
    } finally { btn.disabled = false; }
  });
}
