/**
 * 🗂️ Tracker data tabs (owner 2026-10-28: "We should make tabs for those older data in
 * one row. Each tab will open the table."): ONE row of buttons over the
 * ⚔️ Latest 100 kills & deaths, 🏆 Auraxium weapons and 📊 Census / Fisu / Honu style
 * panels. Each panel stays a <details> (its module keeps loading on "toggle"); the
 * summaries are hidden by CSS; the tab shows a short name (otab.*) + the panel's count, and the
 * panel's full translated title is the hover.
 *  - one open at a time; clicking the open tab closes it; all closed on load;
 *  - a tab shows only while its panel is on the page (kill feed / weapons: one player);
 *  - instant switch (no animation). DOM-only, no network.
 */
import { t as tr } from "./i18n.mjs";

const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Panel selectors in tab order (the Census one is re-rendered by stats-table.mjs). */
export const OLD_TAB_PANELS = Object.freeze([
  { id: "pub", sel: "#statsPublic > details.stats-public", key: "otab.pub", label: "📊 Stats" },
  { id: "kf", sel: "#killFeedSection", key: "otab.kf", label: "⚔️ Last 100" },
  { id: "scr", sel: "#scrimsSection", key: "otab.scr", label: "🥊 Scrims" }, // 🥊 PlayStation room only
  { id: "duel", sel: "#duelsSection", key: "otab.duel", label: "🤺 Duels" }, // one player vs the crowd, or two head-to-head
  { id: "wp", sel: "#weaponsSection", key: "otab.wp", label: "🏆 Auraxium" },
]);

export function mountOldTabs(host) {
  if (!host || host._oldTabs) return host && host._oldTabs;
  const row = host.querySelector(".old-tabs");
  if (!row) return null;
  row.setAttribute("aria-label", tr("otab.aria", "Tracker data"));
  const btns = OLD_TAB_PANELS.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `old-tab old-tab-${p.id}`;
    b.dataset.tab = p.id;
    b.hidden = true;
    row.appendChild(b);
    return b;
  });
  const panelOf = (i) => host.querySelector(OLD_TAB_PANELS[i].sel);
  const labelOf = (d) => {
    const s = d && d.querySelector(":scope > summary");
    return s ? s.textContent.replace(/\s+/g, " ").trim() : "";
  };
  let syncing = false;
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      let any = false;
      OLD_TAB_PANELS.forEach((p, i) => {
        const d = panelOf(i), b = btns[i];
        const on = !!d && !d.hidden;
        if (b.hidden === on) b.hidden = !on;
        if (!on) return;
        any = true;
        // Short tab names (owner 2026-10-28: one row on phones); the panel's full title is the hover.
        const cnt = d.querySelector(":scope > summary .rk-table-count");
        const n = cnt ? cnt.textContent.trim() : "";
        const label = tr(p.key, p.label);
        // Icon + text apart: when the labels don't fit one row (phones, 5 tabs), only the open tab keeps its text.
        const sp = label.indexOf(" ");
        const ico = sp > 0 ? label.slice(0, sp) : "", txt = sp > 0 ? label.slice(sp + 1) : label;
        const html = `${ico ? `<span class="old-tab-ico">${esc(ico)}</span> ` : ""}<span class="old-tab-txt">${esc(txt)}</span>${n ? ` <span class="old-tab-n">${esc(n.replace(/[()]/g, ""))}</span>` : ""}`;
        if (b.getAttribute("aria-label") !== label) b.setAttribute("aria-label", label);
        if (b.innerHTML !== html) b.innerHTML = html;
        const full = labelOf(d);
        if (full && b.title !== full) b.title = full;
        const open = d.open ? "true" : "false";
        if (b.getAttribute("aria-expanded") !== open) b.setAttribute("aria-expanded", open);
        if (!d.id) d.id = `oldTabPanel-${p.id}`;
        if (b.getAttribute("aria-controls") !== d.id) b.setAttribute("aria-controls", d.id);
      });
      if (row.hidden === any) row.hidden = !any;
      fit();
    } finally { syncing = false; }
  }
  /** Tight mode (owner 2026-10-28: one row on phones): icons only, except the open tab, when a full label would be cut. */
  function fit() {
    if (row.hidden || typeof row.getBoundingClientRect !== "function") return;
    row.classList.remove("is-tight");
    const cut = btns.some((b) => !b.hidden && b.scrollWidth > b.clientWidth + 1);
    if (cut) row.classList.add("is-tight");
  }
  if (typeof window !== "undefined") window.addEventListener("resize", () => { if (!syncing) fit(); }, { passive: true });
  row.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button.old-tab");
    if (!b) return;
    const i = btns.indexOf(b);
    const d = panelOf(i);
    if (!d) return;
    const opening = !d.open;
    OLD_TAB_PANELS.forEach((_, j) => { const o = panelOf(j); if (o && j !== i && o.open) o.open = false; });
    d.open = opening;
    sync();
  });
  // Panels change on their own (hidden for 2+ names, Census table re-rendered, counts, language).
  new MutationObserver(sync).observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["open", "hidden"] });
  sync();
  host._oldTabs = { sync };
  return host._oldTabs;
}
