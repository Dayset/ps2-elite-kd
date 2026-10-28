/**
 * 🗂️ Tracker data tabs (owner 2026-10-28: "We should make tabs for those older data in
 * one row. Each tab will open the table."): ONE row of buttons over the
 * ⚔️ Latest 100 kills & deaths, 🏆 Auraxium weapons and 📊 Census / Fisu / Honu style
 * panels. Each panel stays a <details> (its module keeps loading on "toggle"); the
 * summaries are hidden by CSS and their translated text becomes the tab label.
 *  - one open at a time; clicking the open tab closes it; all closed on load;
 *  - a tab shows only while its panel is on the page (kill feed / weapons: one player);
 *  - instant switch (no animation). DOM-only, no network.
 */
import { t as tr } from "./i18n.mjs";

/** Panel selectors in tab order (the Census one is re-rendered by stats-table.mjs). */
export const OLD_TAB_PANELS = Object.freeze([
  { id: "pub", sel: "#statsPublic > details.stats-public" },
  { id: "kf", sel: "#killFeedSection" },
  { id: "scr", sel: "#scrimsSection" }, // 🥊 PlayStation room only
  { id: "wp", sel: "#weaponsSection" },
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
        const label = labelOf(d);
        if (label && b.textContent !== label) b.textContent = label;
        const open = d.open ? "true" : "false";
        if (b.getAttribute("aria-expanded") !== open) b.setAttribute("aria-expanded", open);
        if (!d.id) d.id = `oldTabPanel-${p.id}`;
        if (b.getAttribute("aria-controls") !== d.id) b.setAttribute("aria-controls", d.id);
      });
      if (row.hidden === any) row.hidden = !any;
    } finally { syncing = false; }
  }
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
