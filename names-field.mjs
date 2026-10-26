/**
 * The name field: name chips, the 6-name limit (note, toast, lock), 🎲 random players, failed-name chips with retry
 * (#66: moved out of app.js unchanged).
 */
import { sfx } from "./sfx.mjs?v=20261026-sfx1";
import { t as tr } from "./i18n.mjs";
import { slugKey, namesEqualIgnoreCase, bareName, parseNames } from "./app-util.mjs?v=20261024-split1";
import { forgetFailures } from "./analyze-run.mjs?v=20261023-priv1";
import { isPenalizedPadder } from "./padding.mjs?v=20261023-short1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: DEFAULT_PLACEHOLDER_NAME, LIMIT_HINT_HTML, LIVE_MODE, MAX_NAMES, cacheGet, clearGraphReadyHint, els, failedNames, fetching, findSharedEntry, graphReadyHintTimer, isListFull, isSavedName, lastLoadedNames, limitLockReady, limitNoteFaded, loadRankVals, nameLimit, nameSpan, nameTokens, persistPendingNames, players, poopHtml, rankVals, rankingsSync, renderCacheChips, runAnalyzeFromUi, scheduleGraphSync, setChartIdle, setStatus, tokenLabel, topTierFloorAdjs.
 */
export function createNamesField($) {
  /** Warn (status line) that the field is full; replaces any "graph is ready" hint. */
  function showLimitHint() {
    sfx("bonk");
    if ($.graphReadyHintTimer) {
      clearTimeout($.graphReadyHintTimer);
      $.graphReadyHintTimer = 0;
    }
    $.setStatus($.LIMIT_HINT_HTML, "warn limit-hint");
  }

  /* Limit toast: one reusable fixed-position popup (no layout shift, no stacking). */
  let limitToastEl = null;

  let limitToastTimer = 0;

  function hideLimitToast() {
    if (limitToastTimer) {
      clearTimeout(limitToastTimer);
      limitToastTimer = 0;
    }
    if (limitToastEl) limitToastEl.hidden = true;
  }

  /**
   * Show "N players limit reached" next to `anchor` (above it, or below when
   * there's no room), clamped to the viewport; bottom-centre if no anchor.
   * Auto-hides after 2.5 s, on tap, or on scroll; repeat calls restart it.
   */
  function showLimitToast(anchor, html) {
    sfx("bonk");
    if (typeof document === "undefined") return;
    if (!limitToastEl) {
      limitToastEl = document.createElement("div");
      limitToastEl.id = "limitToast";
      limitToastEl.className = "limit-toast";
      limitToastEl.setAttribute("role", "alert");
      limitToastEl.addEventListener("click", hideLimitToast);
      document.body.appendChild(limitToastEl);
      window.addEventListener("scroll", () => { if (limitToastEl && !limitToastEl.hidden) hideLimitToast(); }, { passive: true });
      window.addEventListener("resize", () => { if (limitToastEl && !limitToastEl.hidden) hideLimitToast(); });
    }
    limitToastEl.innerHTML =
      html || `<strong>${tr("msg.limitToast", "Limit of {n} names reached", { n: $.MAX_NAMES })}</strong><span class="limit-toast-sub">${tr("msg.limitToastSub", "remove a name to add more")}</span>`;
    const el = limitToastEl;
    if (limitToastTimer) clearTimeout(limitToastTimer);
    el.hidden = false;
    el.classList.remove("limit-toast-pop");
    el.classList.remove("limit-toast-docked");
    el.style.left = "0px";
    el.style.top = "0px";
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const r = anchor && anchor.isConnected && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const gap = 8;
    if (r && r.bottom > 0 && r.top < vh) {
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(gap, Math.min(left, vw - tw - gap));
      let top = r.top - th - gap;
      if (top < gap) top = r.bottom + gap;
      top = Math.max(gap, Math.min(top, vh - th - gap));
      el.style.left = Math.round(left) + "px";
      el.style.top = Math.round(top) + "px";
    } else {
      el.classList.add("limit-toast-docked"); // bottom-centre via CSS
      el.style.left = "";
      el.style.top = "";
    }
    void el.offsetWidth; // restart the pop animation
    el.classList.add("limit-toast-pop");
    limitToastTimer = setTimeout(hideLimitToast, 2500);
  }

  /** Drop the limit warning (only if it is what the status line shows). */
  function clearLimitHint() {
    if ($.els.status && $.els.status.classList.contains("limit-hint")) $.setStatus("");
    hideLimitToast();
  }

  /** Clear name chips + trailing input text only; leave localStorage cache intact. */
  function clearNamesFromInput() {
    $.nameTokens = [];
    if ($.els.namesInput) $.els.namesInput.value = "";
    renderNameTokens();
    $.renderCacheChips();
  }

  function getNameFailure(name) {
    const key = slugKey(name);
    return key ? $.failedNames.get(key) || null : null;
  }

  function isNameFetched(name) {
    if (getNameFailure(name)) return false;
    if ($.findSharedEntry(name)) return true;
    if ($.cacheGet(name)) return true;
    const slug = slugKey(name);
    if ($.players.some((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name))) {
      return true;
    }
    // lastAnalyzedNames also holds names that were attempted but skipped, so
    // only count it when the last run actually graphed one under that name.
    if (
      $.players.length &&
      $.lastLoadedNames.some((n) => namesEqualIgnoreCase(n, name) || slugKey(n) === slug)
    ) {
      return true;
    }
    return false;
  }

  /** Replace the chips (URL / last comparison / ShloDog). Keeps the first 10; warns if more. */
  function setNameTokens(names) {
    const seen = new Set();
    $.nameTokens = [];
    let overflow = 0;
    for (const raw of names || []) {
      const clean = bareName(String(raw).trim());
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if ($.nameTokens.length >= $.nameLimit()) {
        overflow++;
        continue;
      }
      $.nameTokens.push(clean);
    }
    if ($.els.namesInput) $.els.namesInput.value = "";
    renderNameTokens();
    $.renderCacheChips();
    if (overflow) showLimitHint();
    return overflow;
  }

  /** Clear failed state for names so their chips show pending again. */
  function clearNameFailures(names) {
    return forgetFailures($.failedNames, names, slugKey);
  }

  /**
   * Add one name as a chip. Returns false (and shows "N players limit reached")
   * when the field is already full, so callers can keep the text instead of eating it.
   */
  function addNameToField(name) {
    const clean = bareName(String(name).trim());
    if (!clean) return true;
    if ($.nameTokens.some((n) => namesEqualIgnoreCase(n, clean))) {
      // Re-adding / re-typing a name always resets its failed state (retryable).
      clearNameFailures([clean]);
      renderNameTokens();
      $.renderCacheChips();
      return true;
    }
    if ($.nameTokens.length >= $.nameLimit()) {
      showLimitHint();
      return false;
    }
    clearNameFailures([clean]);
    $.nameTokens.push(clean);
    renderNameTokens();
    $.renderCacheChips();
    $.scheduleGraphSync(); // t351u: a saved name joins the graph without Analyze
    return true;
  }

  /** Case-insensitive or slug-equal (ignores [TAG] / punctuation). */
  function namesMatch(a, b) {
    if (namesEqualIgnoreCase(a, b)) return true;
    const ka = slugKey(a);
    return !!ka && ka === slugKey(b);
  }

  async function rollDice(mode = "range") {
    const btn = mode === "low" ? $.els.diceLowBtn : mode === "high" ? $.els.diceHighBtn : $.els.diceBtn;
    const say = (msg) => { if (btn) { btn.title = msg; btn.setAttribute("aria-label", msg); } };
    // t376u: data still loading (slow link / very first second) → the button
    // pulses until it's ready; normally it was prefetched while idle.
    let busyTimer = 0;
    if (!$.rankVals && btn) busyTimer = setTimeout(() => { btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true"); }, 120);
    let vals;
    try {
      vals = await $.loadRankVals();
    } finally {
      clearTimeout(busyTimer);
      if (btn) { btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy"); }
    }
    if ($.nameTokens.length >= $.nameLimit()) { say(tr("msg.listFull", "The list is full ({n} names)", { n: $.MAX_NAMES })); return; }
    const used = new Set($.nameTokens.map((n) => slugKey(n)));
    const listVals = $.nameTokens.map((n) => vals.get(slugKey(n))).filter(Boolean).map((v) => v.adjs);
    if (mode === "range" && !listVals.length) {
      // 🎲 on an empty box: a random player from the top five ⚔️ iVi tiers
      // (🏆💎🥇🥈🥉 — adjusted iVi at/above the cached median), never the
      // lower half (Dayset 2026-10-22).
      const floor = await $.topTierFloorAdjs();
      const pool = [...vals.entries()].filter(([slug, v]) => !used.has(slug) && v.adjs >= floor);
      if (!pool.length) { say(tr("msg.noCached", "No cached players with iVi above 0")); return; }
      const [, pick] = pool[Math.floor(Math.random() * pool.length)];
      sfx("sparkle"); sfxChipQuietUntil = Date.now() + 400;
      addNameToField(pick.name);
      // First name in an empty field: unhide the chart right away and draw
      // the first graph from cache instead of waiting for Analyze.
      $.setChartIdle(false);
      $.scheduleGraphSync({ start: true });
      say(tr("msg.addedLoading", "Added {name} ({ivi} iVi) — loading graph…", { name: pick.name, ivi: Math.round(pick.adjs) }));
      return;
    }
    if (!listVals.length) { say(tr("msg.addNameIvi", "Add a name with an iVi first")); return; }
    const sorted = [...listVals].sort((a, b) => a - b);
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    let lo;
    let hi;
    if (mode === "low") { lo = median * 0.75; hi = median; }
    else if (mode === "high") { lo = median; hi = median * 1.25; }
    else { lo = sorted[0] * 0.75; hi = sorted[sorted.length - 1] * 1.25; }
    const pool = [...vals.entries()].filter(([slug, v]) => !used.has(slug) && v.adjs >= lo && v.adjs <= hi);
    if (!pool.length) { say(tr("msg.nobodyIn", "Nobody in {lo}–{hi}", { lo: Math.round(lo), hi: Math.round(hi) })); return; }
    const [, pick] = pool[Math.floor(Math.random() * pool.length)];
    addNameToField(pick.name);
    say(tr($.isSavedName(pick.name) ? "msg.addedRangeLoading" : "msg.addedRangePress", $.isSavedName(pick.name) ? "Added {name} ({ivi} in {lo}–{hi}) — loading graph…" : "Added {name} ({ivi} in {lo}–{hi}). Press Analyze to load.", { name: pick.name, ivi: Math.round(pick.adjs), lo: Math.round(lo), hi: Math.round(hi) }));
  }

  function toggleNameInField(name, anchor) {
    const clean = String(name).trim();
    if (!clean) return;
    const inTokens = $.nameTokens.some((n) => namesMatch(n, clean));
    let inFrag = false;
    if ($.els.namesInput && String($.els.namesInput.value || "").trim()) {
      const frag = parseNames($.els.namesInput.value);
      const kept = frag.filter((t) => !namesMatch(t, clean));
      if (kept.length !== frag.length) {
        inFrag = true;
        $.els.namesInput.value = kept.join(" ");
      }
    }
    if (inTokens || inFrag) {
      clearNameFailures($.nameTokens.filter((n) => namesMatch(n, clean)));
      $.nameTokens = $.nameTokens.filter((n) => !namesMatch(n, clean));
      renderNameTokens();
      $.renderCacheChips();
      $.scheduleGraphSync();
      return;
    }
    // Field full: the status line may be far off-screen from the cache list,
    // so also pop a toast right at the clicked chip.
    if (!addNameToField(clean)) showLimitToast(anchor);
  }

  function removeNameToken(name) {
    clearNameFailures([name]);
    $.nameTokens = $.nameTokens.filter((n) => !namesEqualIgnoreCase(n, name));
    renderNameTokens();
    $.renderCacheChips();
    $.scheduleGraphSync(); // t351u: graph + tables follow right away
  }

  /** Hide the placeholder name whenever chips or typed text occupy the field. */
  function syncNamesPlaceholder() {
    if (!$.els.namesInput) return;
    const hasChips = $.nameTokens.length > 0;
    const hasTyped = String($.els.namesInput.value || "").length > 0;
    $.els.namesInput.placeholder = hasChips || hasTyped ? "" : $.DEFAULT_PLACEHOLDER_NAME;
  }

  // t400u: at MAX_NAMES the 🎲 / < / > buttons lock (gray, aria-disabled but
  // still clickable so a click/tap explains why) and the analysis starts once.
  // < / > also lock on an empty field: they roll inside the iVi range of the
  // names in the box, so there is nothing to roll until the first name lands.
  // The name input itself locks too (disabled): with 6 names in the box
  // there is nothing left to type, and it re-enables as soon as a chip
  // is removed (every chip change re-runs this via renderNameTokens).
  let limitWasFull = false;

  // The lock note fades out 5 s after it appears, then compacts away
  // (hidden). Re-armed every time the note is (re)shown.
  let limitNoteFadeTimer = 0;

  function showLimitNote() {
    const note = $.els.namesLimitNote;
    if (!note) return;
    clearTimeout(limitNoteFadeTimer);
    note.hidden = false;
    note.classList.remove("is-fading");
    void note.offsetWidth; // restart the CSS transition if it was mid-fade
    // With reduced motion (e.g. Android "Remove animations") the CSS fade
    // can't run — hide outright after 5 s instead of fading.
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      limitNoteFadeTimer = setTimeout(() => { note.hidden = true; $.limitNoteFaded = true; }, 5000);
      return;
    }
    limitNoteFadeTimer = setTimeout(() => {
      note.classList.add("is-fading");
      limitNoteFadeTimer = setTimeout(() => { note.hidden = true; $.limitNoteFaded = true; }, 700);
    }, 5000);
  }

  function hideLimitNote() {
    clearTimeout(limitNoteFadeTimer);
    $.limitNoteFaded = false;
    const note = $.els.namesLimitNote;
    if (!note) return;
    note.hidden = true;
    note.classList.remove("is-fading");
  }

  function syncLimitLock() {
    const full = $.isListFull();
    const empty = $.nameTokens.length === 0;
    if (!full) $.limitNoteFaded = false; // a new full episode may show the note again
    if ($.els.namesInput) {
      $.els.namesInput.disabled = full || $.LIVE_MODE; // 🎥 live: field locked until Live is turned off
      if (full) $.els.namesInput.setAttribute("title", `List is full (${$.MAX_NAMES} names) — remove a name to add more`);
      else $.els.namesInput.removeAttribute("title");
    }
    // Visible why: a disabled field alone says nothing (and a title only
    // shows on mouse hover), so the box itself explains the lock — briefly:
    // the note fades after 5 s and compacts away.
    // Dayset 2026-10-19: the note only ever explains a lock the user just hit
    // in this session (adding the last name, or tapping the locked field).
    // A refresh that restores a full list never shows it.
    if ($.els.namesLimitNote) {
      const becameFull = full && !limitWasFull && $.limitLockReady && !$.LIVE_MODE;
      if (becameFull && $.els.namesLimitNote.hidden) showLimitNote();
      else if (!full && !$.els.namesLimitNote.hidden) hideLimitNote();
    }
    for (const b of [$.els.diceBtn, $.els.diceLowBtn, $.els.diceHighBtn]) {
      if (!b) continue;
      const lock = full || (empty && b !== $.els.diceBtn);
      b.classList.toggle("is-locked", lock);
      if (lock) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    }
    if (full && !limitWasFull && $.limitLockReady && !$.LIVE_MODE) setTimeout(() => { if ($.isListFull()) $.runAnalyzeFromUi(); }, 0);
    limitWasFull = full;
  }

  function lockedClick(btn) {
    if ($.isListFull()) { showLimitToast(btn); return true; }
    if ($.nameTokens.length === 0 && (btn === $.els.diceLowBtn || btn === $.els.diceHighBtn)) {
      showLimitToast(btn, `<strong>${tr("msg.addNameFirst", "Add a name first")}</strong><span class="limit-toast-sub">${tr("msg.addNameFirstSub", "🎲 roll or type one, then use &lt; / &gt;")}</span>`);
      return true;
    }
    return false;
  }

  let sfxChipCount = -1;

  let sfxChipQuietUntil = 0;

  function renderNameTokens() {
    // t402u: plink on a name added, plonk on removed (user gestures only).
    if (sfxChipCount >= 0 && Date.now() > sfxChipQuietUntil) {
      if ($.nameTokens.length > sfxChipCount) sfx("plink");
      else if ($.nameTokens.length < sfxChipCount) sfx("plonk");
    }
    sfxChipCount = $.nameTokens.length;
    queueMicrotask(syncLimitLock);
    $.clearGraphReadyHint();
    if ($.nameTokens.length < $.nameLimit()) clearLimitHint();
    $.persistPendingNames(); // every chip change goes through here
    // Debug battle panel reads the same names (no retyping).
    if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("ps2-names", { detail: $.nameTokens.slice() }));
    if (!$.els.nameTokensEl) return;
    $.els.nameTokensEl.innerHTML = "";
    $.nameTokens.forEach((name, idx) => {
      // Position number (1, 2, 3 …) so long lists are easy to count.
      const addNum = (el) => {
        const n = document.createElement("span");
        n.className = "name-token-num";
        n.textContent = `${idx + 1}.`;
        n.setAttribute("aria-hidden", "true");
        el.insertBefore(n, el.firstChild);
        return el;
      };
      const fail = getNameFailure(name);
      if (fail) {
        $.els.nameTokensEl.appendChild(addNum(makeFailedToken(name, fail)));
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-token " + (isNameFetched(name) ? "fetched" : "unfetched");
      const shown = $.tokenLabel(name);
      btn.appendChild($.nameSpan(shown, { title: false }));
      if (isPenalizedPadder(name)) btn.insertAdjacentHTML("beforeend", $.poopHtml());
      btn.setAttribute("aria-label", tr("names.remove", "Remove {name}", { name: shown }));
      btn.title = tr("names.remove", "Remove {name}", { name: shown });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeNameToken(name);
      });
      if ($.LIVE_MODE) {
        btn.classList.add(idx === 0 ? "live-lit" : "live-dim");
        btn.disabled = true;
        btn.title = idx === 0 ? `🎥 Live: ${name}` : `${name}: from the live feed`;
      }
      $.els.nameTokensEl.appendChild(addNum(btn));
    });
    syncNamesPlaceholder();
    $.rankingsSync();
  }

  /**
   * Failed chip: struck name is a retry button (clears failed state → pending,
   * then re-runs Analyze); the small × removes the name.
   */
  function makeFailedToken(name, fail) {
    const wrap = document.createElement("span");
    wrap.className = "name-token failed";
    wrap.setAttribute("role", "group");
    const transient =
      fail.kind === "network" || fail.kind === "timeout" || fail.kind === "bad-response";
    const why = transient ? "probably a network hiccup" : "check the spelling";
    const retryTip = `Couldn't fetch ${name} (${fail.reason}; ${why}) — click to retry`;
    wrap.title = retryTip;

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "name-token-retry";
    retry.title = retryTip;
    retry.setAttribute("aria-label", `Retry ${name} (couldn't fetch: ${fail.reason})`);
    const icon = document.createElement("span");
    icon.className = "name-token-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "↻";
    const label = document.createElement("span");
    label.className = "name-token-text nm";
    label.setAttribute("data-full", $.tokenLabel(name));
    label.textContent = $.tokenLabel(name);
    retry.append(icon, label);
    retry.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      retryFailedName(name);
    });

    const x = document.createElement("button");
    x.type = "button";
    x.className = "name-token-x";
    x.textContent = "×";
    x.title = tr("names.remove", "Remove {name}", { name });
    x.setAttribute("aria-label", tr("names.remove", "Remove {name}", { name }));
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeNameToken(name);
    });

    wrap.append(retry, x);
    return wrap;
  }

  /** Click on a failed chip: mark it pending again and re-run Analyze. */
  function retryFailedName(name) {
    clearNameFailures([name]);
    renderNameTokens();
    $.renderCacheChips();
    if (!$.fetching && $.els.analyzeBtn) $.els.analyzeBtn.click();
  }

  /** Commit trailing raw input into chips (separator flush or Analyze/Enter). */
  /**
   * Returns { tokens, rejected }: names that didn't fit (10-name cap) stay in the
   * text field and the limit hint is shown — nothing is silently dropped.
   */
  function commitFragment({ clearInput = true } = {}) {
    if (!$.els.namesInput) return { tokens: [], rejected: [] };
    const raw = $.els.namesInput.value;
    const tokens = parseNames(raw);
    const rejected = [];
    for (const t of tokens) if (!addNameToField(t)) rejected.push(t);
    if (clearInput) $.els.namesInput.value = rejected.join(" ");
    if (rejected.length) showLimitHint();
    syncNamesPlaceholder();
    return { tokens, rejected };
  }

  /**
   * Names for Analyze / share: locked chips + unfinished trailing text
   * if it parses as a complete name (no trailing separator required).
   */
  function currentNamesInField() {
    const out = $.nameTokens.slice();
    const frag = $.els.namesInput ? String($.els.namesInput.value || "").trim() : "";
    if (frag) {
      for (const t of parseNames(frag)) {
        if (!out.some((n) => namesEqualIgnoreCase(n, t))) out.push(t);
      }
    }
    return out.slice(0, $.nameLimit());
  }
  return { getNameFailure, isNameFetched, setNameTokens, clearNameFailures, addNameToField, namesMatch, rollDice, toggleNameInField, removeNameToken, syncNamesPlaceholder, showLimitNote, hideLimitNote, syncLimitLock, lockedClick, renderNameTokens, makeFailedToken, retryFailedName, commitFragment, currentNamesInField, clearNamesFromInput, showLimitHint, hideLimitToast, showLimitToast, clearLimitHint };
}
