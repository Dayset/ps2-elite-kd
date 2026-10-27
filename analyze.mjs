/**
 * The Analyze controller: one run per 🔍 Analyze (progress, cancel, fresh data, kept graphs on failure), keeping the
 * graph in step with the name chips, and the Analyze controls' events (#69: moved out of app.js unchanged).
 */
import { t as tr } from "./i18n.mjs";
import { slugKey, namesEqualIgnoreCase, namesSetKey, isAbortError, makeAbortError, escapeHtml } from "./app-util.mjs?v=20261027-z79";
import { recentGesture, sfx } from "./sfx.mjs?v=20261026-sfx2";
import { shouldShowGraphReady, loadEach, summarizeFailures } from "./analyze-run.mjs?v=20261023-priv1";
import { mountNameSuggest } from "./name-suggest.mjs?v=20261024-br1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: activeRun, analyzeSeq, cacheGet, cachePut, cacheSelTimer, CENSUS, CENSUS_BASES, censusNotesHtml, clearChartUi, clearGraphReadyHint, clearLimitHint, clearNameFailures, collapseSharedCache, commitFragment, currentNamesInField, DATA, DEFAULT_PLACEHOLDER_NAME, drawChart, els, failedNames, fetching, findSharedEntry, forgetLastComparison, getNameFailure, graphSyncTimer, IS_PS, isListFull, isLiveMode, isNameFetched, isReloadNavigation, lastAnalyzedNames, lastLoadedNames, lastPlayerByKey, limitNoteFaded, LIVE_MODE, loadOne, loadRankings, markFresh, markRequested, nameLimit, nameTokens, players, popChartSection, renderCacheChips, renderNameTokens, resetYZoom, restoreScrollAfterReload, saveLastComparison, scheduleCacheSelection, setChartIdle, setChartSkeleton, setNameTokens, setProgress, setStatus, showGraphReadyHint, showIdleChart, showLimitHint, showLimitNote, skippedWarningHtml, sourceLabel, suggestSharedCache, syncNamesPlaceholder, syncUrlNames, uniqueSavedName, updateCacheSelection, updateFreshEta, userMovedPage.
 */
export function createAnalyze($) {
  function setFetching(on) {
    $.fetching = on;
    if ($.els.analyzeBtn) $.els.analyzeBtn.disabled = on;
    if ($.els.copyLinkBtn) $.els.copyLinkBtn.disabled = on;
    // Keep × always clickable so users can clear mid-fetch
    if ($.els.fetchFresh) { $.els.fetchFresh.disabled = on; $.updateFreshEta(); }
  }

  /**
   * ✕ / Esc in the progress popup: abort the whole analyze run now.
   * Previous graph (if any) is left untouched; nothing half-done is rendered.
   */
  function uncheckFetchFresh() {
    if ($.els.fetchFresh) { $.els.fetchFresh.checked = false; $.updateFreshEta(); }
  }

  function cancelAnalyze() {
    const run = $.activeRun;
    if (!run) return;
    $.activeRun = null;
    if (run.fresh) uncheckFetchFresh();
    try {
      run.controller.abort();
    } catch {
      /* ignore */
    }
    setFetching(false);
    $.setProgress(false);
    if (!$.players.length) {
      // No prior graph → back to idle (the section folds away).
      $.showIdleChart();
    }
    $.setStatus(`<span class="warn">${tr("msg.cancelled", "Fetch cancelled.")}</span>`, "warn cancelled");
  }

  function findLoadedPlayer(name) {
    const slug = slugKey(name);
    return $.players.find((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name));
  }

  async function analyzeNames(names, { forceFresh = false, quiet = false } = {}) {
    if ($.fetching) return;
    $.analyzeSeq += 1; // a fresh analysis pops the graph section open on draw
    const userRun = !quiet && recentGesture(); // t402u: no sounds for auto-restores
    const clean = names.map((n) => String(n).trim()).filter(Boolean);
    if (!clean.length) {
      $.clearChartUi();
      $.setStatus(`<span class="err">${tr("msg.needName", "Enter at least one character name (spaces or commas).")}</span>`, "err");
      return;
    }

    const fresh = forceFresh || !!($.els.fetchFresh && $.els.fetchFresh.checked);
    const sameSet =
      $.players.length > 0 &&
      $.lastAnalyzedNames.length > 0 &&
      namesSetKey(clean) === namesSetKey($.lastAnalyzedNames);

    // Same names already graphed (all loaded, none failed) + fresh unchecked
    // → hint, no re-run. Failed / not-yet-loaded chips always run again.
    // Quiet background syncs (live feed) never trigger the hint: the graph
    // already shows this set, so there is nothing to say.
    if (
      shouldShowGraphReady({
        sameSet,
        fresh,
        names: clean,
        isLoaded: (n) => !!findLoadedPlayer(n),
        isFailed: (n) => !!$.getNameFailure(n),
      })
    ) {
      if (quiet) return;
      $.collapseSharedCache();
      // Re-render chips so force-collapsed state sticks if a render follows
      $.renderCacheChips();
      $.showGraphReadyHint();
      $.popChartSection($.players); // "ready" must be visible: un-fold if folded
      scrollToResults();
      return;
    }

    if (!quiet) $.collapseSharedCache();
    // Every Analyze retries previously failed names: back to pending.
    if ($.clearNameFailures(clean)) {
      $.renderNameTokens();
      $.renderCacheChips();
    }
    $.clearGraphReadyHint();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const run = {
      controller: controller || { abort() { this.signal.aborted = true; }, signal: { aborted: false } },
      signal: null,
      fresh,
    };
    run.signal = run.controller.signal;
    $.activeRun = run;
    const signal = run.signal;
    /** True once this run was cancelled (or superseded) — stop touching UI. */
    const cancelled = () => signal.aborted || $.activeRun !== run;
    setFetching(true);
    if (!quiet) {
      $.setProgress(true, {
        title: tr("progress.title", "Analyzing…"),
        done: 0,
        total: clean.length,
      });
      // Only when something has to come from Census: saved copies are instant, and the
      // line flashing in and out pushed the table and graph down and up (2026-10-19).
      if (fresh || !clean.every(isSavedName)) {
        $.setStatus(clean.length > 1 ? tr("msg.analyzingN", "Analyzing {n} players…", { n: clean.length }) : tr("msg.analyzing1", "Analyzing 1 player…"));
        $.setChartSkeleton(true); // graph-shaped stand-in while Census answers
      }
    }

    // ETA plan: which names will need a live Census fetch (vs cached / in memory).
    const etaPlan = clean.map((n) => fresh || !$.isNameFetched(n));
    let result = { loaded: [], failed: [], cancelled: false };
    try {
      result = await loadEach(
        clean,
        async (name) => {
          // Reuse in-memory player when names changed but this one is still present
          // t351u: keyed by the typed name (tagged displays like "[ReSt] X" too).
          const existing = graphedPlayerFor(name);
          if (!fresh && existing) {
            if (!existing.cacheFallback) return existing;
            const { cacheFallback: _drop, ...plain } = existing; // old note, not news
            return plain;
          }
          let p;
          try {
            p = await $.loadOne(name, { fresh, run });
          } catch (e) {
            // Never lose a player that is already graphed: keep that copy.
            if (existing && !isAbortError(e) && !cancelled() && !(e && e.kind === "removed")) return { ...existing, cacheFallback: "kept" };
            throw e;
          }
          if (cancelled()) throw makeAbortError();
          // Only fully loaded live players reach the cache (failures, partial
          // results and cached fallbacks never do).
          if (!p.partialSkipped && !p.cacheFallback) $.cachePut(name, p);
          // Saved copies load in a blink: no flash of "Loaded X…" (it pushed the page down and up).
          if (!quiet && !/^(shared:|local)/.test(String(p.source || ""))) $.setStatus(
            tr("msg.loadedVia", "Loaded <strong>{name}</strong> <span class=\"src\">via {src}</span>…", { name: escapeHtml(p.display), src: escapeHtml($.sourceLabel(p.source)) })
          );
          return p;
        },
        {
          isCancelled: cancelled,
          onStart: (name, idx, total) => {
            if (quiet) return;
            $.setProgress(true, { title: tr("progress.title", "Analyzing…"), done: idx, total, name, plan: etaPlan });
          },
          // Success or failure, the name counts as done so the bar/ETA advance.
          onDone: (name, idx, total) => {
            if (cancelled() || quiet) return;
            $.setProgress(true, {
              title: idx + 1 >= total ? tr("progress.finishing", "Finishing…") : tr("progress.title", "Analyzing…"),
              done: idx + 1,
              total,
              name,
            });
          },
        }
      );
    } finally {
      // "Fetch fresh" is one-shot: untick after any run that used it
      // (success, partial, all-failed or cancelled).
      if (fresh) uncheckFetchFresh();
      // A cancelled run already reset the UI in cancelAnalyze(); a newer run may
      // own the modal now, so only the still-active run cleans up here.
      if ($.activeRun === run) {
        $.activeRun = null;
        setFetching(false);
        $.setProgress(false);
      }
    }

    // Cancelled: keep previous graph as-is; lastAnalyzedNames unchanged.
    if (result.cancelled || signal.aborted) { $.setChartSkeleton(false); return; }

    // t351u: chips removed while this run was loading must not come back.
    const nowKeys = new Set($.currentNamesInField().map(slugKey));
    const keepNow = (x) => nowKeys.has(slugKey(x.name));
    result.loaded = result.loaded.filter(keepNow);
    result.failed = result.failed.filter(keepNow);
    const cleanNow = clean.filter((n) => nowKeys.has(slugKey(n)));

    for (const ok of result.loaded) $.failedNames.delete(slugKey(ok.name));
    for (const f of result.failed) {
      const key = slugKey(f.name);
      if (key) $.failedNames.set(key, { name: f.name, kind: f.kind, reason: f.reason });
    }
    if (result.failed.length && typeof console !== "undefined") {
      console.warn(
        "[ps2-elite-kd] skipped names:",
        result.failed.map((f) => `${f.name}: ${f.message}`)
      );
    }

    const summary = summarizeFailures(result.failed, result.loaded.length);

    if (!result.loaded.length) {
      if (!cleanNow.length) {
        // Every name was removed mid-run: same as removing them all.
        syncGraphToInput();
        return;
      }
      // Nothing usable: keep the previous graph if there is one, else idle.
      $.setChartSkeleton(false);
      const hadGraph = $.players.length > 0;
      if (!hadGraph) $.clearChartUi();
      $.renderNameTokens();
      $.renderCacheChips();
      $.setStatus(
        $.skippedWarningHtml(summary, {
          extra: hadGraph ? tr("msg.prevKept", "Previous graph kept.") : "",
          fresh,
        }),
        "warn skipped all-failed"
      );
      if (userRun) sfx("fail", { force: true });
      return;
    }

    const successNames = result.loaded.map((x) => x.name);
    $.players = result.loaded.map((x) => x.player);
    // Attempted set (incl. skipped names) so a repeat press shows the
    // "graph is ready" hint instead of refetching the same bad name.
    // t328u: a different set of graphed players (one added / removed) → back to
    // Auto zoom so the axes refit; same set (Fetch fresh re-run) keeps manual zoom.
    if (namesSetKey(successNames) !== namesSetKey($.lastLoadedNames)) $.resetYZoom({ redraw: false });
    $.lastAnalyzedNames = cleanNow.slice();
    $.lastLoadedNames = successNames.slice();
    $.lastPlayerByKey = new Map(result.loaded.map((x) => [slugKey(x.name), x.player]));
    $.drawChart($.players);
    setTimeout($.loadRankings, 300); // t356u: Rankings after the graph
    // Recent / share link only ever carry names that actually loaded.
    $.saveLastComparison(successNames);
    $.syncUrlNames(successNames); // refresh re-opens exactly this comparison
    $.renderNameTokens();
    $.renderCacheChips();
    // 🎥 live.html batches its own /add calls (live.mjs, #33); the graph re-runs don't post.
    if (!$.isLiveMode()) $.suggestSharedCache(result.loaded); // fire-and-forget, never awaited
    $.markRequested(result.loaded); // fire-and-forget: analyzed cached players get extra XP detail
    if (fresh) $.markFresh(result.loaded); // fire-and-forget: shared copy catches up (names only)

    const notes = $.censusNotesHtml(result.loaded);
    if (summary) {
      $.setStatus($.skippedWarningHtml(summary, { fresh }) + notes, "warn skipped");
    } else {
      $.setStatus(notes, notes ? "warn census-note" : "");
    }
    if (userRun) {
      if (summary) sfx("fail", { force: true });
      else sfx(fresh ? "fresh" : "chime", { force: true });
    }
    // Results are in: glide the input/header up out of view.
    if (!quiet && location.hash === "#rankings" && !$.userMovedPage) {
      const sec = document.getElementById("rankings");
      if (sec) requestAnimationFrame(() => sec.scrollIntoView({ block: "start" }));
    } else if (!quiet) scrollToResults();
    // Chips added while loading: bring them in too (cached → no button press).
    scheduleGraphSync();
  }

  /** The player graphed last run for this typed name (slug match, tag-insensitive). */
  function graphedPlayerFor(name) {
    if (!$.players.length) return null;
    const key = slugKey(name);
    return (key && $.lastPlayerByKey.get(key)) || findLoadedPlayer(name) || null;
  }

  /** Chip change → keep graph / tables / URL / Rankings in step (t351u). */
  let graphSyncStart = false;

  function scheduleGraphSync({ start = false } = {}) {
    clearTimeout($.graphSyncTimer);
    graphSyncStart = graphSyncStart || start;
    $.graphSyncTimer = setTimeout(() => {
      const st = graphSyncStart;
      graphSyncStart = false;
      syncGraphToInput({ start: st });
    }, 0);
  }

  /**
   * t351u: the graph always shows exactly the chips. Removing a chip redraws
   * right away from players already in memory (no fetch, no reload); adding a
   * name that is saved (shared or browser cache) loads it quietly. A name that
   * would need a live Census fetch waits for 🔍 Analyze. Only acts once a graph
   * exists; never while a run is loading (that run re-checks the chips at the end).
   */
  function syncGraphToInput({ start = false } = {}) {
    // start: a ✅ pick in the Rankings table may draw the first graph too.
    if ($.fetching || $.activeRun) return;
    const names = $.nameTokens.slice();
    // 2026-10-19: the FIRST graph also draws by itself when every typed name is
    // saved (shared file or this browser): typing cached names one by one never
    // has to wait for 🔍 Analyze. A name needing a live Census fetch still does.
    if (!$.players.length && !start && !(names.length && names.every(isSavedName))) return;
    if (!names.length) {
      $.clearChartUi();
      $.syncUrlNames([]);
      $.forgetLastComparison();
      return;
    }
    if (namesSetKey(names) === namesSetKey($.lastLoadedNames) && names.every((n) => graphedPlayerFor(n))) return;
    const have = names.map((n) => graphedPlayerFor(n));
    if (have.every(Boolean)) {
      const keys = names.map(slugKey);
      // A redraw that only REMOVES names never opens the section (owner
      // 2026-10-22: deleting names from the field must not spring it open);
      // one that adds a name still pops it like an analysis does.
      const prevKeys = new Set($.lastLoadedNames.map(slugKey));
      const hasNew = names.some((n) => !prevKeys.has(slugKey(n)));
      if (namesSetKey(names) !== namesSetKey($.lastLoadedNames)) $.resetYZoom({ redraw: false });
      $.players = have;
      $.lastAnalyzedNames = names.slice();
      $.lastLoadedNames = names.slice();
      $.lastPlayerByKey = new Map(keys.map((k, i) => [k, have[i]]));
      $.drawChart($.players, { pop: hasNew });
      $.saveLastComparison(names);
      $.syncUrlNames(names);
      $.renderNameTokens();
      $.renderCacheChips();
      $.clearGraphReadyHint();
      return;
    }
    const missing = names.filter((n, i) => !have[i]);
    if (missing.every(isSavedName)) {
      if (!$.players.length) $.setChartIdle(false);
      analyzeNames(names, { quiet: true });
    }
  }

  /** Saved copy available (shared data/ file or this browser) and not marked failed: no live fetch needed. */
  function isSavedName(n) {
    return !$.getNameFailure(n) && !!($.findSharedEntry(n) || $.cacheGet(n));
  }

  /**
   * After a successful Analyze (or the repeat "graph is ready" path): smoothly
   * scroll so the start of the results sits ~10px below the top of the viewport.
   * Target = the status line when it carries a message (skipped-names warning /
   * "graph is ready"), which sits directly above the stats; otherwise the stats
   * panel (📊 Public section). Waits two frames so layout has settled; instant
   * when the user prefers reduced motion.
   */
  function scrollToResults() {
    if (typeof window === "undefined" || !window.scrollTo) return;
    const raf = window.requestAnimationFrame
      ? (fn) => window.requestAnimationFrame(fn)
      : (fn) => setTimeout(fn, 16);
    raf(() =>
      raf(() => {
        const statusMsg = $.els.status && $.els.status.textContent.trim();
        const target = statusMsg ? $.els.status : $.els.stats;
        if (!target || !target.getBoundingClientRect) return;
        const reduce =
          !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const top = Math.max(
          0,
          Math.round(target.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0) - 10)
        );
        // Short pages (few names on a phone) can't scroll the stats to the top:
        // pad the bottom just enough so the header can slide fully out of view.
        const body = document.body;
        if (body) {
          body.style.paddingBottom = "";
          const docH = document.documentElement.scrollHeight;
          const short = top + window.innerHeight - docH;
          if (short > 0) {
            const base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
            body.style.paddingBottom = Math.ceil(base + short) + "px";
          }
        }
        window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      })
    );
  }

  /** The 🔍 Analyze action (button, shared-link auto-run). */
  function runAnalyzeFromUi() {
    $.collapseSharedCache();
    const { rejected } = $.commitFragment({ clearInput: true });
    if (rejected.length) {
      // Field is full and extra text is waiting: warn instead of eating it or
      // showing "graph is ready".
      $.showLimitHint();
      return Promise.resolve();
    }
    let names = $.currentNamesInField();
    if (!names.length) {
      if (!$.DEFAULT_PLACEHOLDER_NAME) return Promise.resolve(); // ranks-lite not loaded yet
      // Empty field → the default name (a random top-tier player) as a chip
      $.setNameTokens([$.DEFAULT_PLACEHOLDER_NAME]);
      names = [$.DEFAULT_PLACEHOLDER_NAME];
    }
    return analyzeNames(names);
  }

  async function autoRunFromLink(startup) {
    if (!startup || startup.reason !== "url" || !startup.names.length) return;
    if ($.fetching || $.activeRun || $.players.length) return;
    if ($.els.fetchFresh) { $.els.fetchFresh.checked = false; $.updateFreshEta(); }
    const overLimit = startup.names.length > $.nameLimit();
    // t379u: a refresh just puts the same graph back — quietly (no "Analyzing…"
    // pop-up, no jump to the results; the browser keeps your scroll position).
    // Only when every name is saved (shared file / this browser); a name that
    // needs a live Census fetch still gets the normal run with its progress.
    const names = $.currentNamesInField();
    if ($.isReloadNavigation() && names.length && names.every((n) => !$.getNameFailure(n) && ($.findSharedEntry(n) || $.cacheGet(n)))) {
      await analyzeNames(names, { quiet: true });
      $.restoreScrollAfterReload();
      return;
    }
    await runAnalyzeFromUi();
    if (overLimit && $.els.status && !String($.els.status.textContent || "").trim()) $.showLimitHint();
  }

  /** The Analyze controls' listeners; app.js calls this once, where they used to be registered. */
  function wireAnalyzeEvents() {
    // "↻ Try again" in Census busy/down messages: re-run with live data.
    if ($.els.status) {
      $.els.status.addEventListener("click", (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest(".census-retry-btn") : null;
        if (!btn || $.fetching) return;
        const names = $.currentNamesInField();
        if (!names.length) return;
        $.clearNameFailures(names);
        $.renderNameTokens();
        analyzeNames(names, { forceFresh: !!btn.textContent.includes("live") });
      });
    }

    if ($.els.fetchFresh) $.els.fetchFresh.addEventListener("change", $.updateFreshEta);

    if ($.els.analyzeBtn) {
      $.els.analyzeBtn.addEventListener("click", () => {
        sfx("boop");
        runAnalyzeFromUi();
      });
    }

    if ($.els.namesInput) {
      // Dayset 2026-10-19: the field is disabled when the list is full, so
      // taps on the locked box itself re-show the lock note (it never shows
      // on a plain refresh — see syncLimitLock). Taps on a name chip don't
      // count: that click is removing the name, which unlocks anyway.
      const lockBox = document.getElementById("namesBox") || $.els.namesInput.parentElement;
      if (lockBox) {
        lockBox.addEventListener("pointerdown", (e) => {
          if (e.target && e.target.closest && e.target.closest(".name-token")) return;
          if ($.isListFull() && !$.LIVE_MODE && $.els.namesLimitNote && $.els.namesLimitNote.hidden) {
            $.limitNoteFaded = false;
            $.showLimitNote();
          }
        });
      }
      // Name suggestions after 4 characters (cached players + Census, most recently active first).
      mountNameSuggest({
        input: $.els.namesInput,
        anchor: document.getElementById("namesBox") || $.els.namesInput.parentElement,
        censusBase: $.IS_PS ? $.CENSUS_BASES : $.CENSUS,
        ranksUrl: `${$.DATA}ranks.json`,
        currentNames: () => $.nameTokens.slice(),
      });
      $.els.namesInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const { rejected } = $.commitFragment({ clearInput: true });
          if (rejected.length) return; // limit hint shown, typed text kept
          if (!$.fetching && $.els.analyzeBtn) $.els.analyzeBtn.click();
          return;
        }
        if (e.key === "Backspace" && !$.els.namesInput.value && $.nameTokens.length) {
          e.preventDefault();
          const popped = $.nameTokens.pop();
          $.clearNameFailures([popped]);
          $.renderNameTokens();
          $.renderCacheChips();
          scheduleGraphSync();
        }
      });

      let autoCommitTimer = 0;
      $.els.namesInput.addEventListener("input", () => {
        $.clearGraphReadyHint();
        const val = $.els.namesInput.value;
        // A complete saved name typed without a space/Enter: lock it in after a short pause.
        clearTimeout(autoCommitTimer);
        if (val.trim() && !/[\s,;]/.test(val.trim()) && $.nameTokens.length < $.nameLimit()) {
          autoCommitTimer = setTimeout(() => {
            const now = String($.els.namesInput.value || "");
            if (now === val && document.activeElement === $.els.namesInput && $.uniqueSavedName(now.trim())) $.commitFragment({ clearInput: true });
          }, 1100);
        }
        // Completed token(s) when text ends with a separator. A space right after an
        // outfit tag ("[XYZ] ") is not one: the name comes next (issue #35, t348u).
        const tagPending = /(^|[\s,;])\[[^\]]*\]\s+$/.test(val);
        if (/[\s,;]$/.test(val) && !tagPending) {
          $.commitFragment({ clearInput: true });
        } else if (val.trim() && $.nameTokens.length >= $.nameLimit()) {
          // Typing an 11th name: say so right away (text is kept).
          $.showLimitHint();
        } else if (!val.trim()) {
          $.clearLimitHint();
        }
        $.syncNamesPlaceholder();
        // t343u: no rebuild per key — chip highlights / ETA / 🏆 link follow after a short pause.
        $.scheduleCacheSelection();
      });

      $.els.namesInput.addEventListener("blur", () => {
        // Do not auto-commit on blur — only separator / Analyze / Enter
        clearTimeout($.cacheSelTimer);
        $.updateCacheSelection();
      });

      $.els.namesInput.addEventListener("paste", () => {
        // Bulk paste: lock every complete token parseNames finds (keeps [TAG] Name intact)
        requestAnimationFrame(() => {
          const val = $.els.namesInput.value;
          if (!/[,;\s]/.test(val)) {
            $.syncNamesPlaceholder();
            $.renderCacheChips();
            return;
          }
          $.commitFragment({ clearInput: true }); // overflow names stay in the field
          $.syncNamesPlaceholder();
          $.renderCacheChips();
        });
      });
    }

    if ($.els.namesBox) {
      $.els.namesBox.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#clearNamesBtn, .clear-names")) return;
        const main = $.els.namesBox.querySelector(".names-box-main");
        if (
          e.target === $.els.namesBox ||
          e.target === $.els.nameTokensEl ||
          e.target === main ||
          (main && main.contains(e.target) && e.target.tagName !== "BUTTON")
        ) {
          if ($.els.namesInput) $.els.namesInput.focus();
        }
      });
    }

    if ($.els.progressCancel) {
      $.els.progressCancel.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelAnalyze();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      if (!$.activeRun || !$.els.progress || $.els.progress.hidden) return;
      e.preventDefault();
      cancelAnalyze();
    });
  }

  return { setFetching, uncheckFetchFresh, cancelAnalyze, findLoadedPlayer, analyzeNames, graphedPlayerFor, scheduleGraphSync, syncGraphToInput, isSavedName, scrollToResults, runAnalyzeFromUi, autoRunFromLink, wireAnalyzeEvents };
}
