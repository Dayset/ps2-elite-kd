/**
 * The saved-players chips under the name field: shared cache and this browser's copies, A–Z jump bar, groups, picked
 * state (#66: moved out of app.js unchanged).
 */
import { t as tr } from "./i18n.mjs";
import { alphabetJumpLetters, groupByCharName, compareByCharName } from "./analyze-run.mjs?v=20261023-priv1";
import { sectionJumpState, glideTo, scrollBehavior, mountJumpButtons } from "./jump-btns.mjs?v=20261020-i18n2";
import { slugKey } from "./app-util.mjs?v=20261026-psb1";
import { isPenalizedPadder } from "./padding.mjs?v=20261023-short1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: cacheSelTimer, currentNamesInField, els, listCachedNames, nameSpan, poopHtml, sharedCacheWantOpen, sharedIndex, toggleNameInField, updateFreshEta.
 */
export function createCacheChips($) {
  /** Shared-cache letter blocks the user opened / closed (letter → open), kept across re-renders. */
  const cacheLetterOpen = new Map();

  /** Shared-cache "# A B … Z" jump bar; letters without names are disabled. */
  function makeAlphaBar(present, list) {
    const nav = document.createElement("nav");
    nav.className = "alpha-bar";
    nav.setAttribute("aria-label", tr("nav.jumpAria", "Jump to letter"));
    for (const { letter, enabled } of alphabetJumpLetters(present)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "alpha-btn";
      b.textContent = letter;
      if (!enabled) {
        b.disabled = true;
        b.title = tr("nav.noNamesUnder", "No names under {letter}", { letter });
      } else {
        b.title = tr("nav.jumpTo", "Jump to {target}", { target: letter === "#" ? tr("nav.digitsSymbols", "digits / symbols") : letter });
        b.setAttribute("aria-label", b.title);
        b.addEventListener("click", () => jumpToCacheLetter(letter, list, nav));
      }
      nav.appendChild(b);
    }
    return nav;
  }

  function jumpToCacheLetter(letter, list, bar) {
    const sep = [...list.querySelectorAll(".chip-sep")].find((el) => el.getAttribute("data-letter") === letter);
    if (!sep) return;
    const block = sep.closest("details.chip-group");
    if (block && !block.open) block.open = true; // jump opens the letter's block
    // Land the [X] header just below the sticky jump bar.
    const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
    const top = window.scrollY + sep.getBoundingClientRect().top - offset;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }

  /* ⬆ / ⬇ quick jumps for the shared-cache A–Z names list: shown while the
   * open list is on screen and the user has scrolled into it (~1 screen down);
   * ⬆ = list top (its alphabet bar), ⬇ = end of the list. */
  let cacheJump = null;

  function sharedCacheParts() {
    const d = $.els.cacheChips && $.els.cacheChips.querySelector("details.cache-shared");
    const list = d && d.querySelector(".cache-shared-chips");
    return d && list ? { details: d, list } : null;
  }

  function cacheJumpState() {
    const p = sharedCacheParts();
    if (!p || !p.details.open) return { top: false, bottom: false };
    const r = p.list.getBoundingClientRect();
    return sectionJumpState({
      open: true,
      listTop: r.top,
      listBottom: r.bottom,
      viewport: window.innerHeight || 800,
      pageY: window.scrollY || document.documentElement.scrollTop || 0,
    });
  }

  function cacheJumpTo(end) {
    const p = sharedCacheParts();
    if (!p) return;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const vh = window.innerHeight || 800;
    const maxY = Math.max(0, document.documentElement.scrollHeight - vh);
    const target = end
      ? y + p.list.getBoundingClientRect().bottom - vh + 24 // last names just above the screen bottom
      : y + p.details.getBoundingClientRect().top - 8; // summary + sticky alphabet bar at the top
    glideTo(null, Math.round(Math.min(maxY, Math.max(0, target))), scrollBehavior());
  }

  function syncCacheJump() {
    if (typeof document === "undefined" || !$.els.cacheChips) return;
    if (!cacheJump) {
      cacheJump = mountJumpButtons({
        state: cacheJumpState,
        jump: cacheJumpTo,
        ids: { top: "cacheJumpTop", bottom: "cacheJumpBottom" },
        topLabel: tr("cache.top", "Top of the shared cache list"),
        bottomLabel: tr("cache.end", "End of the shared cache list"),
        groupLabel: tr("cache.quickJump", "Shared cache quick jump"),
      });
    }
    cacheJump.sync();
  }

  /**
   * t343u: typing used to rebuild + re-sort the whole 3,000-name shared list on
   * every key (~130 ms PC, ~550 ms phone). Now: the sorted letter groups are
   * memoized (re-sorted only when the shared list changes), "is this chip
   * picked?" is a Set lookup, and keystrokes only update chip classes in place
   * after a short pause (updateCacheSelection, debounced).
   */
  let cacheGroupsMemo = null;

  function sharedGroups(shared) {
    const sig = shared.length + "|" + ($.sharedIndex.players ? $.sharedIndex.players.length : 0) + "|" + (shared[0] ? shared[0].key + shared[0].savedAt : "") + "|" + ($.sharedIndex.updatedAt || "");
    if (cacheGroupsMemo && cacheGroupsMemo.sig === sig) return cacheGroupsMemo;
    for (const it of shared) it.k = slugKey(it.name);
    const groups = groupByCharName(shared);
    cacheGroupsMemo = { sig, groups, byLetter: new Map(groups.map((g) => [g.letter, g])) };
    return cacheGroupsMemo;
  }

  /** Lookup set for the names in the field (same rule as namesMatch: lower-case or slug). */
  function selectionKeys(inField) {
    const set = new Set();
    for (const n of inField) {
      set.add("l:" + String(n).trim().toLowerCase());
      const k = slugKey(n);
      if (k) set.add("k:" + k);
    }
    return set;
  }

  function isSelected(sel, item) {
    if (sel.has("l:" + String(item.name).trim().toLowerCase())) return true;
    const k = item.k != null ? item.k : (item.k = slugKey(item.name));
    return !!k && sel.has("k:" + k);
  }

  function chipTitle(item, selected) {
    const when = item.savedAt ? new Date(item.savedAt).toLocaleDateString() : "";
    const src = item.source === "shared" ? tr("cache.shared", "Shared cache") : tr("cache.browser", "Browser cache");
    return tr("chip.title", "{src}{when} — {verb} {name}", { src, when: when ? ` · ${when}` : "", verb: selected ? tr("chip.remove", "remove") : tr("chip.add", "add"), name: item.name });
  }

  function setChipSelected(btn, item, selected) {
    if (btn.classList.contains("selected") === selected) return; // unchanged: no DOM write
    btn.classList.toggle("active", selected);
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    btn.title = chipTitle(item, selected);
  }

  function setGroupPicked(block, sep, group, picked) {
    if (+(block.dataset.picked || 0) === picked) return;
    block.dataset.picked = String(picked);
    block.classList.toggle("has-picked", picked > 0);
    const what = group.letter === "#" ? tr("nav.digitsSymbols", "digits / symbols") : group.letter;
    const pickedPart = picked ? tr("cache.groupPicked", ", {n} picked", { n: picked }) : "";
    sep.title = group.items.length === 1
      ? tr("cache.groupTitleOne", "1 name under {what}{picked}", { what, picked: pickedPart })
      : tr("cache.groupTitle", "{n} names under {what}{picked}", { n: group.items.length, what, picked: pickedPart });
    let tag = sep.querySelector(".chip-group-picked");
    if (picked) {
      if (!tag) { tag = document.createElement("span"); tag.className = "chip-group-picked"; sep.appendChild(tag); }
      tag.textContent = ` · ✅ ${picked}`;
    } else if (tag) tag.remove();
  }

  /** In-place selection refresh (no rebuild): chip classes, letter counts, ETA, 🏆 link. */
  function updateCacheSelection() {
    $.updateFreshEta();
    if (!$.els.cacheChips) return;
    const sel = selectionKeys($.currentNamesInField());
    for (const btn of $.els.cacheChips.querySelectorAll("button.chip")) {
      if (btn._item) setChipSelected(btn, btn._item, isSelected(sel, btn._item));
    }
    const memo = cacheGroupsMemo;
    if (!memo) return;
    for (const block of $.els.cacheChips.querySelectorAll("details.chip-group")) {
      const g = memo.byLetter.get(block.getAttribute("data-letter"));
      if (!g) continue;
      let picked = 0;
      for (const it of g.items) if (isSelected(sel, it)) picked++;
      setGroupPicked(block, block.querySelector("summary.chip-sep"), g, picked);
      // Same as a full render: a block holding a picked name opens unless the user chose otherwise.
      if (picked && !block.open && !cacheLetterOpen.has(g.letter)) { block._auto = true; block.open = true; }
    }
  }

  const CACHE_SEL_DEBOUNCE_MS = 200;

  function scheduleCacheSelection() {
    clearTimeout($.cacheSelTimer);
    $.cacheSelTimer = setTimeout(updateCacheSelection, CACHE_SEL_DEBOUNCE_MS);
  }

  /** t360u: 💾 browser-only names: "1" / "0" once the user toggled it. */
  const LS_BROWSER_CACHE_OPEN = "ps2-elite-kd-browser-cache-open";

  const BROWSER_CACHE_OPEN_MAX = 6;

  function browserCacheOpen(n) {
    let v = null;
    try { v = localStorage.getItem(LS_BROWSER_CACHE_OPEN); } catch {}
    return v === "1" ? true : v === "0" ? false : n <= BROWSER_CACHE_OPEN_MAX;
  }

  function renderCacheChips() {
    clearTimeout($.cacheSelTimer);
    $.updateFreshEta();
    if (!$.els.cacheChips) return;
    const cached = $.listCachedNames();
    const inField = $.currentNamesInField();
    const sel = selectionKeys(inField);
    $.els.cacheChips.innerHTML = "";
    if (!cached.length) { syncCacheJump(); return; }

    function sortAlpha(items) {
      // By character name only — a leading "[TAG] " doesn't affect order.
      return [...items].sort((a, b) => compareByCharName(a.name, b.name));
    }

    function makeChip(item, sel = selectionKeys($.currentNamesInField())) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      if (item.source === "shared") btn.classList.add("shared");
      const selected = isSelected(sel, item);
      if (selected) btn.classList.add("active", "selected");
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
      btn.appendChild($.nameSpan(item.name, { title: false }));
      if (isPenalizedPadder(item.name)) btn.insertAdjacentHTML("beforeend", $.poopHtml());
      btn.title = chipTitle(item, selected);
      btn._item = item;
      btn.addEventListener("click", () => $.toggleNameInField(item.name, btn));
      return btn;
    }

    const shared = cached.filter((c) => c.source === "shared");
    let sharedHiddenSkip = false;
    const browser = sortAlpha(cached.filter((c) => c.source !== "shared"));

    if (shared.length) {
      const details = document.createElement("details");
      details.className = "cache-shared";
      // Collapsed by default; preserve user open preference across re-renders
      // (e.g. chip click). Analyze forces closed via sharedCacheWantOpen = false.
      if ($.sharedCacheWantOpen) details.open = true;
      details.addEventListener("toggle", () => {
        $.sharedCacheWantOpen = details.open;
        syncCacheJump(); // hide ⬆/⬇ when collapsed
      });
      const summary = document.createElement("summary");
      summary.textContent = tr("cache.sharedSummary", "📦 Shared cache ({n})", { n: shared.length });
      details.appendChild(summary);
      // t376u: the section is hidden by CSS (code kept): don't build its
      // letter blocks / chips (hundreds of nodes on every name change).
      $.els.cacheChips.appendChild(details);
      if (getComputedStyle(details).display === "none") sharedHiddenSkip = true;
    }
    if (shared.length && !sharedHiddenSkip) {
      const details = $.els.cacheChips.querySelector("details.cache-shared");
      const inner = document.createElement("div");
      inner.className = "cache-shared-chips";
      inner.setAttribute("aria-label", tr("cache.sharedAria", "Shared cached character names"));
      // Letter separators: [#] (digits/symbols) first, then [A], [B], …
      const groups = sharedGroups(shared).groups;
      // t305u: each letter is a collapsible block, closed by default, summary
      // "[A] 123" (+ "· ✅ 2" when names in it are picked). Blocks holding a
      // picked name start open; a user's own open/close wins across re-renders.
      for (const group of groups) {
        let picked = 0;
        for (const item of group.items) if (isSelected(sel, item)) picked++;
        const block = document.createElement("details");
        block.className = "chip-group";
        block.setAttribute("data-letter", group.letter);
        if (picked) block.classList.add("has-picked");
        block.dataset.picked = String(picked);
        const want = cacheLetterOpen.has(group.letter) ? cacheLetterOpen.get(group.letter) : picked > 0;
        if (want) block.open = true;
        const sep = document.createElement("summary");
        sep.className = "chip-sep";
        sep.setAttribute("data-letter", group.letter);
        const what = group.letter === "#" ? tr("nav.digitsSymbols", "digits / symbols") : group.letter;
        const pickedPart = picked ? tr("cache.groupPicked", ", {n} picked", { n: picked }) : "";
        sep.title = group.items.length === 1
          ? tr("cache.groupTitleOne", "1 name under {what}{picked}", { what, picked: pickedPart })
          : tr("cache.groupTitle", "{n} names under {what}{picked}", { n: group.items.length, what, picked: pickedPart });
        sep.textContent = `[${group.letter}] ${group.items.length}`;
        if (picked) {
          const tag = document.createElement("span");
          tag.className = "chip-group-picked";
          tag.textContent = ` · ✅ ${picked}`;
          sep.appendChild(tag);
        }
        block.appendChild(sep);
        const chips = document.createElement("div");
        chips.className = "chip-group-chips";
        // Build chips lazily on first open (1,700+ names → fewer nodes up front).
        const fill = () => {
          if (chips.childElementCount) return;
          // Selection as of now (the block may open long after this render).
          const now = block.open && fillSel ? fillSel : selectionKeys($.currentNamesInField());
          for (const item of group.items) chips.appendChild(makeChip(item, now));
        };
        let fillSel = sel;
        if (block.open) fill();
        fillSel = null;
        block.addEventListener("toggle", () => {
          if (block.open) fill();
          if (block._auto) { block._auto = false; syncCacheJump(); return; } // opened for a picked name, not by the user
          cacheLetterOpen.set(group.letter, block.open);
          syncCacheJump();
        });
        block.appendChild(chips);
        inner.appendChild(block);
      }
      // Alphabet jump bar (# A … Z): sticky at the top of the open list.
      details.appendChild(makeAlphaBar(groups.map((g) => g.letter), inner));
      details.appendChild(inner);
    }
    syncCacheJump();

    // t360u: names saved only in this browser → a 💾 toggle (no title text).
    // Hidden when there are none; open by default for a few names, folded for
    // many; the user's own open / close is remembered.
    if (browser.length) {
      const details = document.createElement("details");
      details.className = "cache-browser";
      details.open = browserCacheOpen(browser.length);
      const summary = document.createElement("summary");
      // Remember only the user's own taps (setting .open also fires "toggle").
      summary.addEventListener("click", () => setTimeout(() => {
        try { localStorage.setItem(LS_BROWSER_CACHE_OPEN, details.open ? "1" : "0"); } catch {}
      }, 0));
      const what = browser.length === 1
        ? tr("cache.browserSavedOne", "1 name saved only in this browser")
        : tr("cache.browserSaved", "{n} names saved only in this browser", { n: browser.length });
      summary.title = tr("cache.browserTitle", "💾 {what} (tap to show / hide)", { what });
      summary.setAttribute("aria-label", tr("cache.browserAria", "💾 {what}", { what }));
      summary.textContent = "💾";
      details.appendChild(summary);
      const inner = document.createElement("div");
      inner.className = "cache-browser-chips";
      inner.setAttribute("aria-label", tr("cache.browserNamesAria", "Names saved in this browser"));
      for (const item of browser) inner.appendChild(makeChip(item, sel));
      details.appendChild(inner);
      $.els.cacheChips.appendChild(details);
    }
  }
  return { makeAlphaBar, jumpToCacheLetter, sharedCacheParts, cacheJumpState, cacheJumpTo, syncCacheJump, sharedGroups, selectionKeys, isSelected, chipTitle, setChipSelected, setGroupPicked, updateCacheSelection, scheduleCacheSelection, browserCacheOpen, renderCacheChips };
}
