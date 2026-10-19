/**
 * PlanetSide 2 elite K/D comparison chart (vanilla JS + SVG).
 * Mirrors absolute_target_split / kpm_curve / rf_if / adjusted_ivi from ps2_elite_kd.py
 * Pure math lives in math.mjs (shared with Node tests).
 */
import { chartFontScale } from "./desk-scale.mjs?v=20261010-sav1";
import {
  X_MAX,
  EASY_MAX,
  HARD_MIN,
  INFLATION_KPM,
  RF_SOFT,
  SLOPE_FLOOR,
  SLOPE_EPS,
  isFiniteNum,
  pooled,
  kpmCurve,
  rfIf,
  adjustedIvi,
  sliceAt,
  combatOutput,
  projectedMech,
  curveSlope,
  slope2575,
  pressureVolume,
  resolveIvi,
  deathMixLite,
  yScale,
  applyYZoom,
  clampYZoom,
  Y_ZOOM_DEFAULT,
  xMaxForZoom,
  windowYValues,
  kpmBandCurve,
  bandReliability,
} from "./math.mjs?v=20261010-sav1";
import { bandGhost, cumulativeGhost } from "./ghost.mjs?v=20261010-sav1";
import GHOST_MODEL from "./data/ghost-model.mjs?v=20261010-sav1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261010-sav1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { INF_HINT, INF_PENDING_TIP, infTip } from "./infantry.mjs?v=20261019-inf1";
import { VEH_CUT_MARK, vehicleCutTip } from "./vehicle-cut.mjs?v=20261019-vcut1";
import { infantryKillsUrl, summarizeInfantryKills } from "./infantry.mjs?v=20261019-inf1";
import { isTouchUi, showHeadTip } from "./head-tip.mjs?v=20261015-tip1";
import { createWheelSwiper } from "./dist-cycle.mjs?v=20261017-cycle15";
import { slideSwap, attachDragCarousel } from "./chart-slide.mjs?v=20261017-drag3";
import { pickGraphForKeys } from "./graph-keys.mjs?v=20261017-graphkeys1";
import { entryFetchedAt, pickNewest, writeWithEviction } from "./cache-pick.mjs?v=20261010-sav1";
import {
  NameLoadError,
  classifyLoadError,
  isTransientKind,
  failureReason,
  censusQueryName,
  loadEach,
  summarizeFailures,
  compareByCharName,
  groupByCharName,
  alphabetJumpLetters,
  namesListKey,
  resolveStartupSelection,
  shouldShowGraphReady,
  forgetFailures,
  honuProfileUrl,
  columnRef,
  pctFromRef,
  fmtPctFromRef,
  pctTitle,
  estimateRemainingMs,
  nextEtaDeadline,
  formatEtaLeft,
  etaLearnLiveMs,
  freshEtaText,
  expectedNameMs,
} from "./analyze-run.mjs?v=20261010-sav1";
import {
  normalizePlayer as normalizePlayerShared,
  playerMetrics,
  MIN_FIGHTS_RULE,
  MIN_FIGHTS_TIP,
  THIN_METRICS,
  shownValue,
  isLegacySample,
  LEGACY_SAMPLE_MARK,
  LEGACY_SAMPLE_TIP,
  THIN_MARK,
  THIN_NOTE_HEAD,
  thinPlayerLine,
} from "./player-metrics.mjs?v=20261010-sav1";
/** "22 kills / 60 deaths" in the opponent sample (MIN_FIGHTS counts). */
function fightsText(r) {
  const k = r.sampleKills || 0;
  const d = r.sampleDeaths || 0;
  if (!k && !d) return "(no fights on record)";
  return `(${k} kill${k === 1 ? "" : "s"} / ${d} death${d === 1 ? "" : "s"})`;
}
/** Hover on a blanked cell: the reason plus this player's own counts. */
function thinCellTip(r) {
  return `${MIN_FIGHTS_TIP}. This sample: ${fightsText(r).replace(/[()]/g, "")}`;
}
import { markNote, statMark, confirmedPadderSlugs, isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261010-sav1";
// Account flairs (🪦 inactive, 👴🏽 veteran) from Census character.times: chart name list only.
import { accountTimes, flairsHtml, flairsFor } from "./flairs.mjs?v=20261010-sav1";
// Full-name popup for truncated .nm names (tap / long-press on touch); installs itself.
import "./name-peek.mjs?v=20261018-onl2";
import { sfx, recentGesture, mountSfxToggle } from "./sfx.mjs?v=20261017-sfxpreload";
import { mountNameSuggest } from "./name-suggest.mjs?v=20261016-sug1";
import { COLORS as PALETTE_DARK, LIGHT_COLORS as PALETTE_LIGHT } from "./palette.mjs?v=20261010-sav1";
// ⬆ / ⬇ floating quick jumps (same buttons as ranks.html).
import { mountJumpButtons, sectionJumpState, glideTo, scrollBehavior } from "./jump-btns.mjs?v=20261010-sav1";
// Live data: Daybreak Census only (batched, paced); Honu just for a rare history fallback.
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { dotSlot, refreshOnline } from "./online-status.mjs?v=20261018-onl1";
import {
  censusBase,
  censusRequest,
  defaultCensusRate,
  fetchPlayerCensus,
  limitConcurrency,
  tokenBucket,
  OPPONENT_TOP_N,
} from "./census-fetch.mjs?v=20261010-sav1";

  // Player palettes (dark + light theme) live in palette.mjs (shared with ranks.html).
  const COLORS = PALETTE_DARK;
  const LIGHT_COLORS = PALETTE_LIGHT;
  function isLightTheme() {
    return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  }
  /** Series colour for player i in the current theme (graph, legend, table names). */
  function seriesColor(i) {
    const pal = isLightTheme() ? LIGHT_COLORS : COLORS;
    return pal[i % pal.length];
  }
  const HONU = "https://wt.honu.pw/api/character/";
  const CENSUS = censusBase(CENSUS_SERVICE_ID);
  /** Client-side Census pacing (s:example allows 10 req/min per IP). Shared by every live fetch in this tab. */
  setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") refreshOnline(CENSUS, [els.stats, els.statsPublic]);
  }, 60_000);
  const censusBucket = tokenBucket(defaultCensusRate(CENSUS_SERVICE_ID));
  /** At most 2 Census requests in flight per tab (big killboards + batched stats). */
  const censusLimit = limitConcurrency(2);
  const DOT_R = 3;

  const LS_CACHE = "ps2-elite-kd-cache-v2";
  const LS_CACHE_OLD = "ps2-elite-kd-cache-v1";
  const LS_RECENT = "ps2-elite-kd-recent";
  const LS_LAST = "ps2-elite-kd-last";
  // Current name chips (analyzed or not) so a refresh keeps the selection.
  const LS_PENDING = "ps2-elite-kd-pending-names";
  const LS_THEME = "ps2-elite-kd-theme";
  /** 🖼️ PC page background image: "0" = off (hidden); anything else = on (default). */
  const LS_BG_IMAGE = "ps2-elite-kd-bg-image";
  /** "1" = show older debug columns in the Adjusted table (footer checkbox). */
  const LS_DEBUG_COLS = "ps2-elite-kd-debug-cols";
  /** "1" = hide adjusted-iVi ≤ 0 players from the Rankings table browse (footer checkbox). */
  const LS_HIDE_ZERO_IVI = "ps2-elite-kd-hide-zero-ivi";
  /** Chart view: "banded" (🎚️ Smooth, opt-in) or anything else = cumulative (default; 💀 K/D / 🎯 aim views). Stored values unchanged. */
  // v2: Smooth shipped 2026-10-08 and test taps left "banded" saved for some
  // people, so everyone restarts on Raw once; choices saved from now on stick.
  const LS_CHART_MODE = "ps2-elite-kd-chart-mode-v2";
  const LS_CHART_MODE_OLD = "ps2-elite-kd-chart-mode";
  /** 👻 ghost (predicted) lines: "1" = on (explicit choice); anything else = off (default). */
  const LS_GHOSTS = "ps2-elite-kd-ghosts";
  /** Legacy cross-tab fetch flag (old under-load banner); only wiped now. */
  const LS_FETCHING = "ps2-elite-kd:fetching";
  /** Remembered live-fetch time per name in this browser (ms, moving average) → first ETA guess. */
  const LS_ETA_LIVE = "ps2-elite-kd-eta-live-ms";
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const DEFAULT_NAMES = [];
  /** Empty-field Analyze default + names input placeholder. */
  const DEFAULT_PLACEHOLDER_NAME = "ShloDog";
  const SHARED_INDEX_URL = "data/index.json";
  /** Cloudflare Worker that queues names into the shared data/ cache. "" disables. */
  const WORKER_URL = "https://ps2-elite-kd-cache.dayset.workers.dev";
  /** Slugs already sent this page session (avoid re-posting on every Analyze). */
  const sharedAddSent = new Set();

  /** Catalog from data/index.json (shared Pages cache). */
  let sharedIndex = { updatedAt: null, players: [] };
  let sharedIndexLoaded = false;
  // Story-style player legends (data/descriptions/<first-char>.json, keyed by slug).
  // Shown on the name hover in ✨ Adjusted. Shards load lazily for the players
  // currently shown; index.json supplies the version param, so a new deploy
  // still picks up new text without a no-store full download.
  let playerDescs = {};
  let legendIndexLoad = null;
  let legendIndexVersion = null;
  const legendShardsLoaded = new Set();
  const legendShardsPending = new Map();
  function loadLegendIndex() {
    if (!legendIndexLoad) {
      legendIndexLoad = fetch("data/descriptions/index.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.updatedAt === "string") legendIndexVersion = d.updatedAt;
          return d;
        })
        .catch(() => null);
    }
    return legendIndexLoad;
  }
  function loadLegendShards(slugs) {
    const needed = new Set();
    for (const s of slugs || []) {
      const key = String(s || "").charAt(0).toLowerCase();
      if (key && !legendShardsLoaded.has(key) && !legendShardsPending.has(key)) needed.add(key);
    }
    if (!needed.size) return;
    const list = lastStatsList; // re-render only if this list is still current
    loadLegendIndex().then(() => {
      for (const key of needed) {
        const url = `data/descriptions/${key}.json` + (legendIndexVersion ? `?v=${encodeURIComponent(legendIndexVersion)}` : "");
        const p = fetch(url)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d && d.players) Object.assign(playerDescs, d.players);
            legendShardsLoaded.add(key);
            legendShardsPending.delete(key);
            if (lastStatsList === list && lastStatsList) renderStatsTable(lastStatsList);
          })
          .catch(() => {
            legendShardsPending.delete(key);
          });
        legendShardsPending.set(key, p);
      }
    });
  }
  /** Slugs confirmed as stat padders on review (data/reviewed.json "padding") → always "*". */
  let confirmedPadders = new Set();

  const VB = { w: 1000, h: 580 };
  /** SVG text multiplier for big desktop screens (desk-scale.mjs); 1 on mobile. */
  let chartFs = 1;
  const M = { t: 20, r: 56, b: 72, l: 56 };
  const PLOT = {
    x: M.l,
    y: M.t,
    w: VB.w - M.l - M.r,
    h: VB.h - M.t - M.b,
  };

  /** 🎥 live.html: same app, stripped down; live.mjs drives the names. */
  const LIVE_MODE = typeof document !== "undefined" && !!document.body && document.body.classList.contains("live-mode");
  const els = {
    liveBtn: document.getElementById("liveBtn"),
    themeToggle: document.getElementById("themeToggle"),
    bgToggleBtn: document.getElementById("bgToggleBtn"),
    wipeLocalBtn: document.getElementById("wipeLocalBtn"),
    namesBox: document.getElementById("namesBox"),
    nameTokensEl: document.getElementById("nameTokens"),
    namesInput: document.getElementById("namesInput") || document.getElementById("names"),
    namesLimitNote: document.getElementById("namesLimitNote"),
    analyzeBtn: document.getElementById("analyzeBtn") || document.getElementById("loadBtn"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    diceBtn: document.getElementById("diceBtn"),
    diceLowBtn: document.getElementById("diceLowBtn"),
    diceHighBtn: document.getElementById("diceHighBtn"),
    clearNamesBtn: document.getElementById("clearNamesBtn"),
    fetchFresh: document.getElementById("fetchFresh"),
    freshEta: document.getElementById("freshEta"),
    cacheChips: document.getElementById("cacheChips") || document.getElementById("recentChips"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    progressTitle: document.getElementById("progressTitle"),
    progressText: document.getElementById("progressText"),
    progressBar: document.getElementById("progressBar"),
    progressPct: document.getElementById("progressPct"),
    progressTiming: document.getElementById("progressTiming"),
    progressCancel: document.getElementById("progressCancel"),
    chart: document.getElementById("chart"),
    chartPlaceholder: document.getElementById("chartPlaceholder"),
    phAnalyzeBtn: document.getElementById("phAnalyzeBtn"),
    chartYZoom: document.getElementById("chartYZoom"),
    yZoomSlider: document.getElementById("yZoomSlider"),
    yZoomReset: document.getElementById("yZoomReset"),
    chartModeBar: document.getElementById("chartModeBar"),
    stats: document.getElementById("statsPanel"),
    statsPublic: document.getElementById("statsPublic"),
    vehiclesNote: document.getElementById("vehiclesNote"),
    debugColsToggle: document.getElementById("debugColsToggle"),
    hideZeroIviToggle: document.getElementById("hideZeroIviToggle"),
  };

  let players = [];
  let lastAnalyzedNames = [];
  /** Subset of lastAnalyzedNames that actually loaded (graphed) last run. */
  let lastLoadedNames = [];
  /** t351u: slugKey(input name) → graphed player from the last run (removal / re-Analyze reuse). */
  let lastPlayerByKey = new Map();
  let graphSyncTimer = 0;
  /** Preferred open state for shared-cache <details> (collapsed by default). */
  let sharedCacheWantOpen = false;
  /** Shared-cache letter blocks the user opened / closed (letter → open), kept across re-renders. */
  const cacheLetterOpen = new Map();
  /** Timer for graph-ready hint auto-dismiss. */
  let graphReadyHintTimer = 0;
  /** Y-axis zoom factor; 1 = auto-fit current data (default). */
  let yZoom = Y_ZOOM_DEFAULT;
  /** Last Y scale drawChart used (tests / console). */
  let lastChartScale = null;
  /** "cumulative" (default) | "banded"; persisted in localStorage only. */
  let chartMode = readChartMode();
  // Y-scale: "kd" (pace-adjusted K/D via 💀) or "ivi" (slider-anchored percentile).
  // Slider 100%→0.1%: Y = iVi × K/D(x)/K/D_p(slider). Representation only.
  // Default is K/D first, iVi second (Dayset 2026-10-17).
  let yScaleMode = "kd";
  let yScalePct = 50;
  let ghostsOn = readGhostsOn();
  let fetching = false;
  /** Active analyze run: { controller, signal } or null. */
  let activeRun = null;
  /** Progress modal timing for ETA (names completed). */
  let progressStartedAt = 0;
  let progressDoneCount = 0;
  let progressTotalCount = 0;
  /** plan[i] = name i expected to need a live fetch (vs cached). Set at run start. */
  let progressPlan = [];
  /** When the name currently loading started (ms epoch). */
  let progressCurrentStartedAt = 0;
  /** Measured per-name durations by kind (ETA uses their averages). */
  let progressLiveMs = [];
  let progressCachedMs = [];
  /** Absolute ETA deadline (ms epoch). Moves earlier while running; re-anchors when overdue. */
  let progressEtaDeadline = 0;
  let progressTickTimer = null;
  /** Visual bar % (creeps forward for hope; snaps up on real done/total). */
  let progressDisplayPct = 0;
  /** Locked name chips in the token input (order preserved). */
  let nameTokens = [];
  /** slug → { name, kind, reason } for names the last run(s) could not fetch. */
  const failedNames = new Map();
  /** Per-request timeouts so one hung Census/Honu call can't stall the run. */
  const CENSUS_TIMEOUT_MS = 20 * 1000;
  /** Census killboards of very active players are ~100k rows (several MB). */
  const CENSUS_BOARD_TIMEOUT_MS = 90 * 1000;
  const HONU_SIDE_TIMEOUT_MS = 30 * 1000;

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function setStatus(html, cls) {
    els.status.innerHTML = html || "";
    els.status.className = cls || "";
  }

  function collapseSharedCache() {
    sharedCacheWantOpen = false;
    const d = els.cacheChips && els.cacheChips.querySelector("details.cache-shared");
    if (d) d.open = false;
  }

  function clearGraphReadyHint() {
    if (graphReadyHintTimer) {
      clearTimeout(graphReadyHintTimer);
      graphReadyHintTimer = 0;
    }
    if (els.status && els.status.classList.contains("graph-ready")) {
      setStatus("");
    }
  }

  /* ---------- 10-name cap ---------- */
  const MAX_NAMES = 6;
  const LIMIT_HINT_HTML = `<span class="warn">${MAX_NAMES} players limit reached</span>`;

  /** Warn (status line) that the field is full; replaces any "graph is ready" hint. */
  function showLimitHint() {
    sfx("bonk");
    if (graphReadyHintTimer) {
      clearTimeout(graphReadyHintTimer);
      graphReadyHintTimer = 0;
    }
    setStatus(LIMIT_HINT_HTML, "warn limit-hint");
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
  function showLimitToast(anchor) {
    sfx("bonk");
    if (typeof document === "undefined") return;
    if (!limitToastEl) {
      limitToastEl = document.createElement("div");
      limitToastEl.id = "limitToast";
      limitToastEl.className = "limit-toast";
      limitToastEl.setAttribute("role", "alert");
      limitToastEl.innerHTML =
        `<strong>Limit of ${MAX_NAMES} names reached</strong><span class="limit-toast-sub">remove a name to add more</span>`;
      limitToastEl.addEventListener("click", hideLimitToast);
      document.body.appendChild(limitToastEl);
      window.addEventListener("scroll", () => { if (limitToastEl && !limitToastEl.hidden) hideLimitToast(); }, { passive: true });
      window.addEventListener("resize", () => { if (limitToastEl && !limitToastEl.hidden) hideLimitToast(); });
    }
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
    if (els.status && els.status.classList.contains("limit-hint")) setStatus("");
    hideLimitToast();
  }

  function showGraphReadyHint() {
    if (!els.status) return;
    if (graphReadyHintTimer) {
      clearTimeout(graphReadyHintTimer);
      graphReadyHintTimer = 0;
    }
    setStatus(
      '<div class="graph-ready-hint">' +
        "<div>Your Graph is ready.</div>" +
        "<div>Enter a new name to analyze.</div>" +
      "</div>",
      "graph-ready"
    );
    // Auto-fade after ~5s
    graphReadyHintTimer = setTimeout(() => {
      if (!els.status || !els.status.classList.contains("graph-ready")) return;
      els.status.classList.add("graph-ready-fade");
      graphReadyHintTimer = setTimeout(() => {
        graphReadyHintTimer = 0;
        if (els.status && els.status.classList.contains("graph-ready")) setStatus("");
      }, 450);
    }, 5000);
  }

  function formatClock(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  const avgMs = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  function readEtaLivePrior() {
    try {
      const v = Number(localStorage.getItem(LS_ETA_LIVE));
      return Number.isFinite(v) && v > 0 ? etaLearnLiveMs(0, v) : 0;
    } catch {
      return 0;
    }
  }
  let etaLivePriorMs = readEtaLivePrior();
  function learnEtaLive(ms) {
    etaLivePriorMs = etaLearnLiveMs(etaLivePriorMs, ms);
    try {
      if (etaLivePriorMs > 0) localStorage.setItem(LS_ETA_LIVE, String(etaLivePriorMs));
    } catch {
      /* private mode / quota */
    }
  }
  const etaKinds = () => ({
    liveAvgMs: avgMs(progressLiveMs),
    cachedAvgMs: avgMs(progressCachedMs),
    livePriorMs: etaLivePriorMs,
  });

  /** Recompute the ETA deadline from the plan + measured per-kind averages. */
  function updateEtaDeadline(now) {
    if (!progressStartedAt || progressTotalCount <= 0) return;
    const plan =
      progressPlan.length === progressTotalCount ? progressPlan : new Array(progressTotalCount).fill(true);
    const est = estimateRemainingMs({
      plan,
      done: progressDoneCount,
      currentElapsedMs: now - (progressCurrentStartedAt || progressStartedAt),
      ...etaKinds(),
    });
    progressEtaDeadline = nextEtaDeadline(progressEtaDeadline, now, est.totalMs);
  }

  function stopProgressTick() {
    if (progressTickTimer) {
      clearInterval(progressTickTimer);
      progressTickTimer = null;
    }
  }

  function applyProgressBar(pct) {
    progressDisplayPct = Math.max(0, Math.min(100, pct));
    if (els.progressBar) els.progressBar.style.width = `${progressDisplayPct}%`;
    if (els.progressPct) els.progressPct.textContent = `${Math.round(progressDisplayPct)}%`;
  }

  /** Random creep fills the current name's slice (not the whole bar) over about its expected time. */
  const PROGRESS_TICK_MS = 220;
  const FAKE_SEGMENT_MIN_MS = 1500;

  /** How long the current name's slice should take to fill: 1.3× its expected time (live Census ≈ 4 s). */
  function fakeSegmentMs() {
    const live = progressPlan.length === progressTotalCount ? progressPlan[progressDoneCount] !== false : true;
    return Math.max(FAKE_SEGMENT_MIN_MS, 1.3 * expectedNameMs(live, etaKinds()));
  }

  /**
   * Creep within the current done→done+1 slice over ~fakeSegmentMs().
   * E.g. 2 live names: 0–50% ~5s, then 50–100% ~5s. Snap on finish is in setProgress.
   */
  function creepProgressBar() {
    if (!progressStartedAt || progressDisplayPct >= 100) return;
    if (progressTotalCount <= 0) return;

    const floor = (progressDoneCount / progressTotalCount) * 100;
    const ceil = ((progressDoneCount + 1) / progressTotalCount) * 100;
    const segmentWidth = Math.max(0.0001, ceil - floor);

    // Average step so this slice alone fills in about the name's expected time.
    const ticksPerSegment = fakeSegmentMs() / PROGRESS_TICK_MS;
    const avgStep = segmentWidth / ticksPerSegment;

    // Random walk around avg: crawl, burst, near-pause — stay inside this slice.
    let factor = 0.25 + Math.random() * 1.5; // ~0.25×–1.75×
    if (Math.random() < 0.18) factor *= 1.6 + Math.random() * 1.4; // burst
    if (Math.random() < 0.12) factor *= 0.12; // near-pause
    const step = avgStep * factor;

    // Cap at ceil — next slice belongs to the next name until snap.
    const base = Math.max(progressDisplayPct, floor);
    const next = Math.min(ceil, base + step);
    applyProgressBar(Math.max(progressDisplayPct, next));
  }

  function renderProgressTiming() {
    if (!progressStartedAt) return;
    creepProgressBar();
    if (!els.progressTiming) return;
    const now = Date.now();
    const elapsed = now - progressStartedAt;
    const elapsedStr = `Elapsed ${formatClock(elapsed)}`;
    let remainStr = "";
    const left = progressTotalCount - progressDoneCount;
    if (progressTotalCount > 0 && left <= 0) {
      remainStr = "Almost done…";
    } else if (progressTotalCount > 0) {
      updateEtaDeadline(now);
      // Last name running past its estimate → "Almost done…" rather than a stuck "0s".
      remainStr = formatEtaLeft(progressEtaDeadline - now) || "Almost done…";
    }
    els.progressTiming.textContent = remainStr ? `${elapsedStr} · ${remainStr}` : elapsedStr;
  }

  function startProgressTick() {
    stopProgressTick();
    progressTickTimer = setInterval(renderProgressTiming, PROGRESS_TICK_MS);
  }

  /**
   * Show/hide the analyzing popup.
   * @param {boolean} show
   * @param {string|object} [info] plain text or { title, text, done, total, name }
   */
  function setProgress(show, info) {
    if (!els.progress) return;
    if (!show) {
      stopProgressTick();
      els.progress.hidden = true;
      els.progress.setAttribute("aria-hidden", "true");
      document.body.classList.remove("progress-open");
      progressStartedAt = 0;
      progressDoneCount = 0;
      progressTotalCount = 0;
      progressPlan = [];
      progressCurrentStartedAt = 0;
      progressLiveMs = [];
      progressCachedMs = [];
      progressEtaDeadline = 0;
      progressDisplayPct = 0;
      if (els.progressText) els.progressText.textContent = "";
      if (els.progressTitle) els.progressTitle.textContent = "Analyzing…";
      applyProgressBar(0);
      if (els.progressTiming) els.progressTiming.textContent = "";
      return;
    }

    const opts =
      typeof info === "string" || info == null
        ? { text: info || "Starting…" }
        : info;

    const total = Math.max(0, Number(opts.total) || 0);
    const done = Math.max(0, Math.min(total || Infinity, Number(opts.done) || 0));
    const name = opts.name ? String(opts.name) : "";

    const prevDone = progressDoneCount;
    const now = Date.now();
    const freshRun = !progressStartedAt;
    if (freshRun) {
      progressStartedAt = now;
      progressCurrentStartedAt = now;
      progressLiveMs = [];
      progressCachedMs = [];
      progressEtaDeadline = 0;
      progressDisplayPct = 0; // always start the bar at zero
    }
    if (Array.isArray(opts.plan)) progressPlan = opts.plan.slice();
    progressDoneCount = done;
    progressTotalCount = total;
    // A name finished: record its duration by kind (cached vs live) for the ETA.
    if (done > prevDone && done > 0) {
      for (let i = prevDone; i < done; i++) {
        const took = (now - (progressCurrentStartedAt || progressStartedAt)) / (done - prevDone);
        if (progressPlan[i] === false) progressCachedMs.push(took);
        else {
          progressLiveMs.push(took);
          learnEtaLive(took);
        }
      }
      progressCurrentStartedAt = now;
    }

    // Real progress floor: 0/2→0%, 1/2→50%, 2/2→100%. Bar never goes backwards.
    let floorPct = 0;
    if (total > 0) floorPct = (done / total) * 100;
    floorPct = Math.max(0, Math.min(100, floorPct));
    // Snap up to real done/total (e.g. 1 of 2 → 50%); creep may already be ahead.
    if (floorPct > progressDisplayPct) {
      progressDisplayPct = floorPct;
    }

    // Avoid duplicate "Fetching…" in title + body — title stays Analyzing/Finishing.
    let text = opts.text;
    if (!text) {
      if (total > 0) {
        text = name
          ? `${done}/${total} — ${name}`
          : `${done}/${total}`;
      } else {
        text = "Starting…";
      }
    }

    let title = opts.title;
    if (!title) {
      if (total > 0 && done >= total) title = "Finishing…";
      else title = "Analyzing…";
    }

    els.progress.hidden = false;
    els.progress.setAttribute("aria-hidden", "false");
    document.body.classList.add("progress-open");
    if (els.progressTitle) els.progressTitle.textContent = title;
    if (els.progressText) els.progressText.textContent = text;
    applyProgressBar(progressDisplayPct);
    renderProgressTiming();
    startProgressTick();
  }

  /* ---------- theme (dark / creamy light) ---------- */

  function getStoredTheme() {
    try {
      const t = localStorage.getItem(LS_THEME);
      return t === "light" || t === "dark" ? t : "dark";
    } catch {
      return "dark";
    }
  }

  function applyTheme(theme, { redraw = true } = {}) {
    const mode = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", mode);
    try {
      localStorage.setItem(LS_THEME, mode);
    } catch {
      /* private mode */
    }
    if (els.themeToggle) {
      if (mode === "light") {
        els.themeToggle.textContent = "🌙";
        els.themeToggle.title = "Switch to dark theme";
        els.themeToggle.setAttribute("aria-label", "Switch to dark theme");
      } else {
        els.themeToggle.textContent = "☀️";
        els.themeToggle.title = "Switch to light theme";
        els.themeToggle.setAttribute("aria-label", "Switch to light theme");
      }
    }
    if (redraw && players.length) drawChart(players);
  }

  function toggleTheme() {
    const next = getStoredTheme() === "light" ? "dark" : "light";
    applyTheme(next);
  }

  /** 🖼️ PC page background image: on by default, toggleable, remembered. */
  function getStoredBgImage() {
    try {
      return localStorage.getItem(LS_BG_IMAGE) !== "0";
    } catch {
      return true;
    }
  }

  function applyBgImage(on) {
    document.documentElement.classList.toggle("no-bg-image", !on);
    try {
      localStorage.setItem(LS_BG_IMAGE, on ? "1" : "0");
    } catch {
      /* private mode */
    }
    if (els.bgToggleBtn) {
      els.bgToggleBtn.classList.toggle("off", !on);
      const label = on ? "Background image on — click to hide" : "Background image off — click to show";
      els.bgToggleBtn.title = label;
      els.bgToggleBtn.setAttribute("aria-label", label);
    }
  }

  function toggleBgImage() {
    applyBgImage(!getStoredBgImage());
  }

  /** Chart chrome colors for current theme (series colours: seriesColor()). */
  function chartTheme() {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    if (light) {
      return {
        bg: "#e8e1d4",
        grid: "#d0c8ba",
        text: "#1c1914",
        muted: "#6e675c",
        border: "#c9bfb0",
        dash: "#6e675c",
        markerStroke: "#e8e1d4",
        bandOpacity: 0.12,
      };
    }
    return {
      bg: "#14161a",
      grid: "#2a2e36",
      text: "#f2f0ea",
      muted: "#8a8882",
      border: "#2a2e36",
      dash: "#e0ddd6",
      markerStroke: "#0b0c0e",
      bandOpacity: 0.06,
    };
  }


  function fmtNum(v, digits) {
    if (!isFiniteNum(v)) return "—";
    return Number(v).toFixed(digits);
  }

  /* math: imported from ./math.mjs */

  /** Shared with build-log.html (player-metrics.mjs) so numbers always match. */
  function normalizePlayer(raw) {
    return normalizePlayerShared(raw);
  }

  function trimForCache(p) {
    return {
      display: p.display,
      cid: p.cid,
      global_kd: p.global_kd,
      global_kpm: p.global_kpm,
      own_kpm: p.own_kpm,
      acc: p.acc,
      hsr: p.hsr,
      ivi: p.ivi,
      // Original sample (farm victims included): normalizePlayer re-applies the filter.
      rows: p.rawRows || p.rows,
      curve: (p.rawCurve || p.curve).map((pt) => ({
        kpm: pt.kpm,
        kd: isFiniteNum(pt.kd) ? pt.kd : null,
        kills: pt.kills,
        deaths: pt.deaths,
        n: pt.n,
      })),
      top: p.top,
      honu: p.honu,
      times: p.times || null,
      // 🪖 / 🚜 just the kill split the Infantry column and the ‡ cut need (infantry.mjs v2).
      infantry: p.infantry && p.infantry.v >= 2
        ? { v: p.infantry.v, kills: p.infantry.kills, footKills: p.infantry.footKills, maxKills: p.infantry.maxKills, vehKills: p.infantry.vehKills, otherKills: p.infantry.otherKills }
        : null,
    };
  }

  function slugKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/^\[.*?\]\s*/, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  /** Spaces or commas (also ; / newlines). Preserves optional [TAG] prefix. */
  function parseNames(text) {
    const s = String(text || "").trim();
    if (!s) return [];
    const tokens = [];
    const re = /(?:\[[^\]]*\]\s*)?[^\s,;]+/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const t = m[0].trim();
      if (t) tokens.push(t);
    }
    // No cap here: callers enforce MAX_NAMES so overflow is reported, not dropped.
    return tokens;
  }

  function namesEqualIgnoreCase(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  /** Order-insensitive slug key for same-set / skip-refetch compare. */
  function namesSetKey(names) {
    return names
      .map((n) => slugKey(n))
      .filter(Boolean)
      .sort()
      .join("\0");
  }

  /* ---------- shared data/ cache (GitHub Pages / Actions) ---------- */

  async function loadSharedIndex() {
    try {
      const data = await fetchJson(SHARED_INDEX_URL);
      let players = [];
      if (Array.isArray(data.players)) {
        players = data.players;
      } else if (Array.isArray(data.demos)) {
        // legacy index shape
        players = data.demos.map((d) => ({
          name: d.name,
          file: d.file && String(d.file).startsWith("players/")
            ? d.file
            : `players/${d.file || ""}`,
          slug: slugKey(d.name),
          savedAt: d.savedAt || 0,
          aliases: d.aliases || [],
        }));
      }
      sharedIndex = {
        updatedAt: data.updatedAt || null,
        players: players.filter((p) => p && p.name),
      };
    } catch {
      sharedIndex = { updatedAt: null, players: [] };
    }
    try {
      confirmedPadders = confirmedPadderSlugs(await fetchJson("data/reviewed.json"));
    } catch {
      /* keep the last set (missing file = nobody confirmed) */
    }
    sharedIndexLoaded = true;
    return sharedIndex;
  }

  /* t376u: name → shared entry lookup, rebuilt only when sharedIndex is
   * replaced. findSharedEntry ran a full scan (12k players, a regex slug per
   * name) for every chip on every chip change, which made 🎲 / < / > lag. */
  let sharedLookup = { src: null, byKey: new Map(), byLower: new Map() };
  function sharedLookupTable() {
    const list = sharedIndex.players || [];
    if (sharedLookup.src === list) return sharedLookup;
    const byKey = new Map();
    const byLower = new Map();
    const put = (m, k, p) => { if (k && !m.has(k)) m.set(k, p); };
    for (const p of list) {
      if (!p) continue;
      put(byKey, p.slug, p);
      put(byKey, slugKey(p.name), p);
      put(byLower, String(p.name || "").trim().toLowerCase(), p);
      for (const a of p.aliases || []) {
        put(byLower, String(a).toLowerCase(), p);
        put(byKey, slugKey(a), p);
      }
    }
    sharedLookup = { src: list, byKey, byLower };
    return sharedLookup;
  }

  function findSharedEntry(name) {
    const key = slugKey(name);
    const lower = String(name || "").trim().toLowerCase();
    const t = sharedLookupTable();
    return (key && t.byKey.get(key)) || t.byLower.get(lower) || null;
  }

  function listSharedNames() {
    return (sharedIndex.players || [])
      .filter((p) => p && p.name)
      .map((p) => ({
        key: p.slug || slugKey(p.name),
        name: p.name,
        savedAt: +p.savedAt || 0,
        source: "shared",
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  /* ---------- localStorage helpers ---------- */


  function readJsonLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJsonLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function getCacheStore() {
    const obj = readJsonLS(LS_CACHE, {});
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }

  function pruneCache(store) {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player || !entry.savedAt || now - entry.savedAt > CACHE_TTL_MS) {
        delete store[key];
        changed = true;
      }
    }
    return changed;
  }

  function getCache() {
    const store = getCacheStore();
    if (pruneCache(store)) writeJsonLS(LS_CACHE, store);
    return store;
  }

  function cacheGet(name) {
    const key = slugKey(name);
    const store = getCache();
    const entry = store[key];
    if (!entry || !entry.player || !entry.savedAt) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry;
  }

  function cachePut(name, player) {
    const key = slugKey(name);
    if (!key) return;
    const store = getCacheStore();
    const now = Date.now();
    const live = String(player.source || "").startsWith("live:");
    store[key] = {
      name: String(name).trim(),
      savedAt: now,
      // When the DATA was fetched (t300u: newest copy wins on reload). Unknown
      // for an undated shared file → 1, so it never beats a dated copy.
      fetchedAt: +player.fetchedAt > 0 ? +player.fetchedAt : live ? now : 1,
      player: trimForCache(player),
    };
    pruneCache(store);
    // Quota full (200-opponent copies are bigger): drop the oldest, keep this one.
    writeWithEviction(store, key, (st) => writeJsonLS(LS_CACHE, st));
    renderNameTokens();
    renderCacheChips();
  }

  function listCachedNames() {
    const byKey = new Map();
    for (const item of listSharedNames()) {
      byKey.set(item.key, item);
    }
    const store = getCache();
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player) continue;
      if (byKey.has(key)) continue; // shared wins for chip identity
      byKey.set(key, {
        key,
        name: entry.name || entry.player.display || key,
        savedAt: entry.savedAt || 0,
        source: "browser",
      });
    }
    return [...byKey.values()].sort((a, b) => b.savedAt - a.savedAt);
  }

  /**
   * Keep ?names= in the address bar equal to the current comparison (replaceState,
   * no reload, other query params kept) so a refresh always shows what's on screen.
   */
  function syncUrlNames(names) {
    if (LIVE_MODE) return; // live.html keeps ?names=<target>
    try {
      const url = new URL(window.location.href);
      const param = (names || []).map((n) => String(n).trim()).filter(Boolean).join(",");
      if (param) url.searchParams.set("names", param);
      else url.searchParams.delete("names");
      const next = url.toString();
      if (next !== window.location.href && window.history && window.history.replaceState) {
        window.history.replaceState(window.history.state, "", next);
      }
    } catch {
      /* file:// or locked-down history: nothing to sync */
    }
  }

  /** Forget the restorable "last comparison" (used by × clear and 🗑️ wipe). */
  function forgetLastComparison() {
    try {
      localStorage.removeItem(LS_LAST);
    } catch {
      /* ignore */
    }
  }

  function saveLastComparison(names) {
    if (LIVE_MODE) return;
    writeJsonLS(LS_LAST, names.map((n) => String(n).trim()).filter(Boolean));
  }

  function getLastComparison() {
    const list = readJsonLS(LS_LAST, null);
    if (!Array.isArray(list) || !list.length) return null;
    return list.filter((s) => typeof s === "string" && s.trim());
  }

  /*
   * Keep the field's chips across a refresh: saved on every change (incl. an
   * empty list after × / 🗑️, so a cleared field stays cleared). `base` = the
   * ?names= in the address bar at save time, so edits made on top of an
   * analyzed (URL-synced) comparison come back after its auto-run.
   * Off until startup has restored the field (no clobbering while loading).
   */
  let persistNamesOn = false;
  function persistPendingNames() {
    if (!persistNamesOn || LIVE_MODE) return;
    writeJsonLS(LS_PENDING, { names: nameTokens.slice(0, MAX_NAMES), base: namesListKey(namesFromQuery() || []) });
  }
  function getPendingNames() {
    const v = readJsonLS(LS_PENDING, null);
    return v && typeof v === "object" && Array.isArray(v.names) ? v : null;
  }

  /** Clear name chips + trailing input text only; leave localStorage cache intact. */
  function clearNamesFromInput() {
    nameTokens = [];
    if (els.namesInput) els.namesInput.value = "";
    renderNameTokens();
    renderCacheChips();
  }

  const LS_KEY_PREFIX = "ps2-elite-kd";

  /** Remove every localStorage / sessionStorage key for this app. */
  function wipeAppStorageKeys() {
    const stores = [];
    try {
      stores.push(localStorage);
    } catch {
      /* private mode */
    }
    try {
      stores.push(sessionStorage);
    } catch {
      /* private mode */
    }
    for (const store of stores) {
      const keys = [];
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(LS_KEY_PREFIX)) keys.push(k);
        }
      } catch {
        continue;
      }
      for (const k of keys) {
        try {
          store.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
    // Explicit known keys (covers odd separators like ":")
    for (const k of [
      LS_CACHE,
      LS_CACHE_OLD,
      LS_RECENT,
      LS_LAST,
      LS_PENDING,
      LS_THEME,
      LS_FETCHING,
    ]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  /** Clear any ps2-elite-kd cookies on this path (usually none). */
  function wipeAppCookies() {
    try {
      const raw = document.cookie || "";
      if (!raw) return;
      const parts = raw.split(";");
      for (const part of parts) {
        const name = part.split("=")[0].trim();
        if (!name || !name.startsWith(LS_KEY_PREFIX)) continue;
        const expire = "Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = `${name}=;expires=${expire};path=/`;
        document.cookie = `${name}=;expires=${expire};path=/ps2-elite-kd`;
        document.cookie = `${name}=;expires=${expire};path=/ps2-elite-kd/`;
      }
    } catch {
      /* ignore */
    }
  }

  /** Confirm, wipe all local app data, reset chips / results / theme. */
  function wipeAllLocalAppData() {
    const ok = window.confirm(
      "Clear all local data for this app?\n\n" +
        "This removes browser cache, theme preference, fetch flags, and last comparison on this device. Shared server cache (data/) is not affected."
    );
    if (!ok) return;

    wipeAppStorageKeys();
    wipeAppCookies();
    // Keep the "show older debug stats" choice (not mentioned in the confirm text).
    if (showDebugCols) {
      try {
        localStorage.setItem(LS_DEBUG_COLS, "1");
      } catch {
        /* ignore */
      }
    }
    // ?names= in the address bar would bring the names straight back on refresh.
    syncUrlNames([]);

    // In-memory UI reset
    nameTokens = [];
    if (els.namesInput) els.namesInput.value = "";
    if (els.fetchFresh) { els.fetchFresh.checked = false; updateFreshEta(); }
    players = [];
    lastAnalyzedNames = [];
    lastLoadedNames = [];
    failedNames.clear();
    clearChartUi(); // idle chart + drops the auto-scroll bottom padding
    renderNameTokens();
    renderCacheChips();
    // Default theme after wipe (persists fresh dark preference)
    applyTheme("dark", { redraw: false });
    // Background image back on after wipe (its stored "0" is cleared too)
    applyBgImage(true);
    setStatus('<span class="ok">Local app data cleared.</span>', "ok");
  }

  /* ---------- tokenized name input / chips / last link ---------- */

  function getNameFailure(name) {
    const key = slugKey(name);
    return key ? failedNames.get(key) || null : null;
  }

  function isNameFetched(name) {
    if (getNameFailure(name)) return false;
    if (findSharedEntry(name)) return true;
    if (cacheGet(name)) return true;
    const slug = slugKey(name);
    if (players.some((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name))) {
      return true;
    }
    // lastAnalyzedNames also holds names that were attempted but skipped, so
    // only count it when the last run actually graphed one under that name.
    if (
      players.length &&
      lastLoadedNames.some((n) => namesEqualIgnoreCase(n, name) || slugKey(n) === slug)
    ) {
      return true;
    }
    return false;
  }

  /** Replace the chips (URL / last comparison / ShloDog). Keeps the first 10; warns if more. */
  function setNameTokens(names) {
    const seen = new Set();
    nameTokens = [];
    let overflow = 0;
    for (const raw of names || []) {
      const clean = String(raw).trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (nameTokens.length >= MAX_NAMES) {
        overflow++;
        continue;
      }
      nameTokens.push(clean);
    }
    if (els.namesInput) els.namesInput.value = "";
    renderNameTokens();
    renderCacheChips();
    if (overflow) showLimitHint();
    return overflow;
  }

  /** Clear failed state for names so their chips show pending again. */
  function clearNameFailures(names) {
    return forgetFailures(failedNames, names, slugKey);
  }

  /**
   * Add one name as a chip. Returns false (and shows "N players limit reached")
   * when the field is already full, so callers can keep the text instead of eating it.
   */
  function addNameToField(name) {
    const clean = String(name).trim();
    if (!clean) return true;
    if (nameTokens.some((n) => namesEqualIgnoreCase(n, clean))) {
      // Re-adding / re-typing a name always resets its failed state (retryable).
      clearNameFailures([clean]);
      renderNameTokens();
      renderCacheChips();
      return true;
    }
    if (nameTokens.length >= MAX_NAMES) {
      showLimitHint();
      return false;
    }
    clearNameFailures([clean]);
    nameTokens.push(clean);
    renderNameTokens();
    renderCacheChips();
    scheduleGraphSync(); // t351u: a saved name joins the graph without Analyze
    return true;
  }

  /** Case-insensitive or slug-equal (ignores [TAG] / punctuation). */
  function namesMatch(a, b) {
    if (namesEqualIgnoreCase(a, b)) return true;
    const ka = slugKey(a);
    return !!ka && ka === slugKey(b);
  }

  /** Cache chip click: add if absent, remove (chip or trailing text) if present. */
  /* 🎲 Random player: ⚔️ iVi (adjusted) range of the names in the box, widened by 25% each side. */
  /* t376u: ONE ranks.json load (normal HTTP cache, revalidated) shared by 🎲
   * and the 🧱 / 🤝 pools. It used to be fetched twice here, once with
   * no-store + a timestamp, so the first 🎲 re-downloaded 3.4 MB. */
  let ranksPayloadLoad = null;
  function loadRanksPayload() {
    if (!ranksPayloadLoad) {
      ranksPayloadLoad = fetch("data/ranks.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d) => {
          if (!d || !Array.isArray(d.cols) || !Array.isArray(d.rows)) ranksPayloadLoad = null; // allow a retry
          return d;
        });
    }
    return ranksPayloadLoad;
  }
  let rankVals = null;
  async function loadRankVals() {
    if (rankVals) return rankVals;
    try {
      const d = await loadRanksPayload();
      if (!d) return new Map();
      const ci = d.cols.indexOf("adjs");
      const si = d.cols.indexOf("slug");
      rankVals = new Map(
        d.rows
          .filter((x) => isFiniteNum(x[ci]) && x[ci] > 0)
          .map((x) => [x[si], { name: x[0], adjs: x[ci] }])
      );
    } catch (e) {
      rankVals = new Map();
    }
    return rankVals;
  }

  async function rollDice(mode = "range") {
    const btn = mode === "low" ? els.diceLowBtn : mode === "high" ? els.diceHighBtn : els.diceBtn;
    const say = (msg) => { if (btn) { btn.title = msg; btn.setAttribute("aria-label", msg); } };
    // t376u: data still loading (slow link / very first second) → the button
    // pulses until it's ready; normally it was prefetched while idle.
    let busyTimer = 0;
    if (!rankVals && btn) busyTimer = setTimeout(() => { btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true"); }, 120);
    let vals;
    try {
      vals = await loadRankVals();
    } finally {
      clearTimeout(busyTimer);
      if (btn) { btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy"); }
    }
    if (nameTokens.length >= MAX_NAMES) { say(`The list is full (${MAX_NAMES} names)`); return; }
    const used = new Set(nameTokens.map((n) => slugKey(n)));
    const listVals = nameTokens.map((n) => vals.get(slugKey(n))).filter(Boolean).map((v) => v.adjs);
    if (mode === "range" && !listVals.length) {
      // 🎲 on an empty box: any cached player with ⚔️ iVi above 0.
      const pool = [...vals.entries()].filter(([slug]) => !used.has(slug));
      if (!pool.length) { say("No cached players with iVi above 0"); return; }
      const [, pick] = pool[Math.floor(Math.random() * pool.length)];
      sfx("sparkle"); sfxChipQuietUntil = Date.now() + 400;
      addNameToField(pick.name);
      say(`Added ${pick.name} (${Math.round(pick.adjs)} iVi). Press Analyze to load.`);
      return;
    }
    if (!listVals.length) { say("Add a name with an iVi first"); return; }
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
    if (!pool.length) { say(`Nobody in ${Math.round(lo)}–${Math.round(hi)}`); return; }
    const [, pick] = pool[Math.floor(Math.random() * pool.length)];
    addNameToField(pick.name);
    say(`Added ${pick.name} (${Math.round(pick.adjs)} in ${Math.round(lo)}–${Math.round(hi)}). Press Analyze to load.`);
  }

  function toggleNameInField(name, anchor) {
    const clean = String(name).trim();
    if (!clean) return;
    const inTokens = nameTokens.some((n) => namesMatch(n, clean));
    let inFrag = false;
    if (els.namesInput && String(els.namesInput.value || "").trim()) {
      const frag = parseNames(els.namesInput.value);
      const kept = frag.filter((t) => !namesMatch(t, clean));
      if (kept.length !== frag.length) {
        inFrag = true;
        els.namesInput.value = kept.join(" ");
      }
    }
    if (inTokens || inFrag) {
      clearNameFailures(nameTokens.filter((n) => namesMatch(n, clean)));
      nameTokens = nameTokens.filter((n) => !namesMatch(n, clean));
      renderNameTokens();
      renderCacheChips();
      scheduleGraphSync();
      return;
    }
    // Field full: the status line may be far off-screen from the cache list,
    // so also pop a toast right at the clicked chip.
    if (!addNameToField(clean)) showLimitToast(anchor);
  }

  function removeNameToken(name) {
    clearNameFailures([name]);
    nameTokens = nameTokens.filter((n) => !namesEqualIgnoreCase(n, name));
    renderNameTokens();
    renderCacheChips();
    scheduleGraphSync(); // t351u: graph + tables follow right away
  }

  /** Hide ShloDog placeholder whenever chips or typed text occupy the field. */
  function syncNamesPlaceholder() {
    if (!els.namesInput) return;
    const hasChips = nameTokens.length > 0;
    const hasTyped = String(els.namesInput.value || "").length > 0;
    els.namesInput.placeholder = hasChips || hasTyped ? "" : DEFAULT_PLACEHOLDER_NAME;
  }

  // t400u: at MAX_NAMES the 🎲 / < / > buttons lock (gray, aria-disabled but
  // still clickable so a click/tap explains why) and the analysis starts once.
  // The name input itself locks too (disabled): with 6 names in the box
  // there is nothing left to type, and it re-enables as soon as a chip
  // is removed (every chip change re-runs this via renderNameTokens).
  let limitWasFull = false;
  let limitLockReady = false; // false during startup (?names= / restore)
  const isListFull = () => nameTokens.length >= MAX_NAMES;
  function syncLimitLock() {
    const full = isListFull();
    if (els.namesInput) {
      els.namesInput.disabled = full || LIVE_MODE; // 🎥 live: field locked until Live is turned off
      if (full) els.namesInput.setAttribute("title", `List is full (${MAX_NAMES} names) — remove a name to add more`);
      else els.namesInput.removeAttribute("title");
    }
    // Visible why: a disabled field alone says nothing (and a title only
    // shows on mouse hover), so the box itself explains the lock.
    if (els.namesLimitNote) els.namesLimitNote.hidden = !full || LIVE_MODE;
    for (const b of [els.diceBtn, els.diceLowBtn, els.diceHighBtn]) {
      if (!b) continue;
      b.classList.toggle("is-locked", full);
      if (full) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    }
    if (full && !limitWasFull && limitLockReady && !LIVE_MODE) setTimeout(() => { if (isListFull()) runAnalyzeFromUi(); }, 0);
    limitWasFull = full;
  }
  function lockedClick(btn) {
    if (!isListFull()) return false;
    showLimitToast(btn);
    return true;
  }

  let sfxChipCount = -1;
  let sfxChipQuietUntil = 0;
  function renderNameTokens() {
    // t402u: plink on a name added, plonk on removed (user gestures only).
    if (sfxChipCount >= 0 && Date.now() > sfxChipQuietUntil) {
      if (nameTokens.length > sfxChipCount) sfx("plink");
      else if (nameTokens.length < sfxChipCount) sfx("plonk");
    }
    sfxChipCount = nameTokens.length;
    queueMicrotask(syncLimitLock);
    clearGraphReadyHint();
    if (nameTokens.length < MAX_NAMES) clearLimitHint();
    persistPendingNames(); // every chip change goes through here
    // Debug battle panel reads the same names (no retyping).
    if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("ps2-names", { detail: nameTokens.slice() }));
    if (!els.nameTokensEl) return;
    els.nameTokensEl.innerHTML = "";
    nameTokens.forEach((name, idx) => {
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
        els.nameTokensEl.appendChild(addNum(makeFailedToken(name, fail)));
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-token " + (isNameFetched(name) ? "fetched" : "unfetched");
      btn.appendChild(nameSpan(name, { title: false }));
      if (isPenalizedPadder(name)) btn.insertAdjacentHTML("beforeend", poopHtml());
      btn.setAttribute("aria-label", `Remove ${name}`);
      btn.title = `Remove ${name}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeNameToken(name);
      });
      if (LIVE_MODE) {
        btn.classList.add(idx === 0 ? "live-lit" : "live-dim");
        btn.disabled = true;
        btn.title = idx === 0 ? `🎥 Live: ${name}` : `${name}: from the live feed`;
      }
      els.nameTokensEl.appendChild(addNum(btn));
    });
    syncNamesPlaceholder();
    rankingsSync();
  }

  /*
   * t356u: Rankings live on this page (rankings.mjs, loaded lazily after the
   * graph so phones stay fast). The names box is the ONE selection: ✅ in the
   * table adds / removes chips here, and every chip change ticks the table,
   * marks the 📊 chart and refreshes the 🏅 positions.
   */
  let rankingsApi = null;
  let userMovedPage = false;
  if (typeof window !== "undefined") {
    for (const t of ["wheel", "touchmove", "keydown", "pointerdown"]) {
      window.addEventListener(t, () => { userMovedPage = true; }, { once: true, passive: true });
    }
  }
  let rankingsLoading = null;
  const rankingsHost = {
    loadRanks: () => loadRanksPayload(), // t376u: one shared ranks.json parse
    getNames: () => nameTokens.slice(),
    toggleName(name, anchor, add) {
      const has = nameTokens.some((n) => namesMatch(n, name));
      if (add === has) return;
      toggleNameInField(name, anchor);
      scheduleGraphSync({ start: true }); // a pick from the table graphs right away (saved data)
    },
  };
  /* t376u: the chips paint first; the Rankings table follows on the next
   * frame (it used to re-render synchronously inside every chip change). */
  let rankingsSyncQueued = false;
  function rankingsSync() {
    if (!rankingsApi || rankingsSyncQueued) return;
    rankingsSyncQueued = true;
    const run = () => { rankingsSyncQueued = false; if (rankingsApi) rankingsApi.syncPicks(); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
    else setTimeout(run, 0);
  }
  function loadRankings() {
    if (rankingsLoading || typeof document === "undefined" || !document.getElementById("rankings")) return rankingsLoading;
    rankingsLoading = import("./rankings.mjs?v=20261019-infemoji1")
      .then((m) => {
        rankingsApi = m.initRankings(rankingsHost);
        return rankingsApi.ready;
      })
      .then(() => {
        // Old ranks.html links land on #rankings: keep them there once the
        // content above (graph, tables) has settled, unless the user scrolled.
        if (location.hash === "#rankings" && !userMovedPage) {
          requestAnimationFrame(() => document.getElementById("rankings").scrollIntoView({ block: "start" }));
        }
      })
      .catch((e) => {
        console.warn("[ps2-elite-kd] rankings failed to load", e);
        const st = document.getElementById("ranksStatus");
        if (st) st.innerHTML = '<span class="err">Could not load the Rankings.</span>';
      });
    return rankingsLoading;
  }
  /** Start loading once the graph is up, the user scrolls near, or after a short idle. */
  function scheduleRankingsLoad() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const sec = document.getElementById("rankings");
    if (!sec) return;
    if (location.hash === "#rankings") { loadRankings(); return; }
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((ents) => {
        if (ents.some((e) => e.isIntersecting)) { io.disconnect(); loadRankings(); }
      }, { rootMargin: "900px 0px" });
      io.observe(sec);
    }
    const idle = () => setTimeout(loadRankings, 3500);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  }
  if (typeof window !== "undefined") window.__loadRankings = loadRankings;

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
    label.setAttribute("data-full", name);
    label.textContent = name;
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
    x.title = `Remove ${name}`;
    x.setAttribute("aria-label", `Remove ${name}`);
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
    renderCacheChips();
    if (!fetching && els.analyzeBtn) els.analyzeBtn.click();
  }

  /** Commit trailing raw input into chips (separator flush or Analyze/Enter). */
  /**
   * Returns { tokens, rejected }: names that didn't fit (10-name cap) stay in the
   * text field and the limit hint is shown — nothing is silently dropped.
   */
  function commitFragment({ clearInput = true } = {}) {
    if (!els.namesInput) return { tokens: [], rejected: [] };
    const raw = els.namesInput.value;
    const tokens = parseNames(raw);
    const rejected = [];
    for (const t of tokens) if (!addNameToField(t)) rejected.push(t);
    if (clearInput) els.namesInput.value = rejected.join(" ");
    if (rejected.length) showLimitHint();
    syncNamesPlaceholder();
    return { tokens, rejected };
  }

  /**
   * Names for Analyze / share: locked chips + unfinished trailing text
   * if it parses as a complete name (no trailing separator required).
   */
  function currentNamesInField() {
    const out = nameTokens.slice();
    const frag = els.namesInput ? String(els.namesInput.value || "").trim() : "";
    if (frag) {
      for (const t of parseNames(frag)) {
        if (!out.some((n) => namesEqualIgnoreCase(n, t))) out.push(t);
      }
    }
    return out.slice(0, MAX_NAMES);
  }

  /** Shared-cache "# A B … Z" jump bar; letters without names are disabled. */
  function makeAlphaBar(present, list) {
    const nav = document.createElement("nav");
    nav.className = "alpha-bar";
    nav.setAttribute("aria-label", "Jump to letter");
    for (const { letter, enabled } of alphabetJumpLetters(present)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "alpha-btn";
      b.textContent = letter;
      if (!enabled) {
        b.disabled = true;
        b.title = `No names under ${letter}`;
      } else {
        b.title = `Jump to ${letter === "#" ? "digits / symbols" : letter}`;
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
    const d = els.cacheChips && els.cacheChips.querySelector("details.cache-shared");
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
    if (typeof document === "undefined" || !els.cacheChips) return;
    if (!cacheJump) {
      cacheJump = mountJumpButtons({
        state: cacheJumpState,
        jump: cacheJumpTo,
        ids: { top: "cacheJumpTop", bottom: "cacheJumpBottom" },
        topLabel: "Top of the shared cache list",
        bottomLabel: "End of the shared cache list",
        groupLabel: "Shared cache quick jump",
      });
    }
    cacheJump.sync();
  }

  /** t306u: "~20 s for 3 names" next to Fetch fresh while it's ticked (hidden otherwise). */
  function updateFreshEta() {
    const el = els.freshEta;
    if (!el) return;
    const on = !!(els.fetchFresh && els.fetchFresh.checked && !els.fetchFresh.disabled);
    const text = on ? freshEtaText(currentNamesInField().length, etaLivePriorMs) : "";
    el.textContent = text;
    el.hidden = !text;
  }

  /**
   * t343u: typing used to rebuild + re-sort the whole 3,000-name shared list on
   * every key (~130 ms PC, ~550 ms phone). Now: the sorted letter groups are
   * memoized (re-sorted only when the shared list changes), "is this chip
   * picked?" is a Set lookup, and keystrokes only update chip classes in place
   * after a short pause (updateCacheSelection, debounced).
   */
  let cacheGroupsMemo = null; // { sig, groups, byLetter }
  function sharedGroups(shared) {
    const sig = shared.length + "|" + (sharedIndex.players ? sharedIndex.players.length : 0) + "|" + (shared[0] ? shared[0].key + shared[0].savedAt : "") + "|" + (sharedIndex.updatedAt || "");
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
    const src = item.source === "shared" ? "Shared cache" : "Browser cache";
    return `${src}${when ? ` · ${when}` : ""} — ${selected ? "remove" : "add"} ${item.name}`;
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
    const what = group.letter === "#" ? "digits / symbols" : group.letter;
    sep.title = `${group.items.length} name${group.items.length === 1 ? "" : "s"} under ${what}${picked ? `, ${picked} picked` : ""}`;
    let tag = sep.querySelector(".chip-group-picked");
    if (picked) {
      if (!tag) { tag = document.createElement("span"); tag.className = "chip-group-picked"; sep.appendChild(tag); }
      tag.textContent = ` · ✅ ${picked}`;
    } else if (tag) tag.remove();
  }

  /** In-place selection refresh (no rebuild): chip classes, letter counts, ETA, 🏆 link. */
  function updateCacheSelection() {
    updateFreshEta();
    if (!els.cacheChips) return;
    const sel = selectionKeys(currentNamesInField());
    for (const btn of els.cacheChips.querySelectorAll("button.chip")) {
      if (btn._item) setChipSelected(btn, btn._item, isSelected(sel, btn._item));
    }
    const memo = cacheGroupsMemo;
    if (!memo) return;
    for (const block of els.cacheChips.querySelectorAll("details.chip-group")) {
      const g = memo.byLetter.get(block.getAttribute("data-letter"));
      if (!g) continue;
      let picked = 0;
      for (const it of g.items) if (isSelected(sel, it)) picked++;
      setGroupPicked(block, block.querySelector("summary.chip-sep"), g, picked);
      // Same as a full render: a block holding a picked name opens unless the user chose otherwise.
      if (picked && !block.open && !cacheLetterOpen.has(g.letter)) { block._auto = true; block.open = true; }
    }
  }
  let cacheSelTimer = 0;
  const CACHE_SEL_DEBOUNCE_MS = 200;
  function scheduleCacheSelection() {
    clearTimeout(cacheSelTimer);
    cacheSelTimer = setTimeout(updateCacheSelection, CACHE_SEL_DEBOUNCE_MS);
  }

  /** t360u: 💾 browser-only names: "1" / "0" once the user toggled it. */
  const LS_BROWSER_CACHE_OPEN = "ps2-elite-kd-browser-cache-open";
  const BROWSER_CACHE_OPEN_MAX = 6; // up to this many names start open
  function browserCacheOpen(n) {
    let v = null;
    try { v = localStorage.getItem(LS_BROWSER_CACHE_OPEN); } catch {}
    return v === "1" ? true : v === "0" ? false : n <= BROWSER_CACHE_OPEN_MAX;
  }
  function renderCacheChips() {
    clearTimeout(cacheSelTimer);
    updateFreshEta();
    if (!els.cacheChips) return;
    const cached = listCachedNames();
    const inField = currentNamesInField();
    const sel = selectionKeys(inField);
    els.cacheChips.innerHTML = "";
    if (!cached.length) { syncCacheJump(); return; }

    function sortAlpha(items) {
      // By character name only — a leading "[TAG] " doesn't affect order.
      return [...items].sort((a, b) => compareByCharName(a.name, b.name));
    }

    function makeChip(item, sel = selectionKeys(currentNamesInField())) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      if (item.source === "shared") btn.classList.add("shared");
      const selected = isSelected(sel, item);
      if (selected) btn.classList.add("active", "selected");
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
      btn.appendChild(nameSpan(item.name, { title: false }));
      if (isPenalizedPadder(item.name)) btn.insertAdjacentHTML("beforeend", poopHtml());
      btn.title = chipTitle(item, selected);
      btn._item = item;
      btn.addEventListener("click", () => toggleNameInField(item.name, btn));
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
      if (sharedCacheWantOpen) details.open = true;
      details.addEventListener("toggle", () => {
        sharedCacheWantOpen = details.open;
        syncCacheJump(); // hide ⬆/⬇ when collapsed
      });
      const summary = document.createElement("summary");
      summary.textContent = `📦 Shared cache (${shared.length})`;
      details.appendChild(summary);
      // t376u: the section is hidden by CSS (code kept): don't build its
      // letter blocks / chips (hundreds of nodes on every name change).
      els.cacheChips.appendChild(details);
      if (getComputedStyle(details).display === "none") sharedHiddenSkip = true;
    }
    if (shared.length && !sharedHiddenSkip) {
      const details = els.cacheChips.querySelector("details.cache-shared");
      const inner = document.createElement("div");
      inner.className = "cache-shared-chips";
      inner.setAttribute("aria-label", "Shared cached character names");
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
        const what = group.letter === "#" ? "digits / symbols" : group.letter;
        sep.title = `${group.items.length} name${group.items.length === 1 ? "" : "s"} under ${what}${picked ? `, ${picked} picked` : ""}`;
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
          const now = block.open && fillSel ? fillSel : selectionKeys(currentNamesInField());
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
      const what = `${browser.length} name${browser.length === 1 ? "" : "s"} saved only in this browser`;
      summary.title = `💾 ${what} (tap to show / hide)`;
      summary.setAttribute("aria-label", `💾 ${what}`);
      summary.textContent = "💾";
      details.appendChild(summary);
      const inner = document.createElement("div");
      inner.className = "cache-browser-chips";
      inner.setAttribute("aria-label", "Names saved in this browser");
      for (const item of browser) inner.appendChild(makeChip(item, sel));
      details.appendChild(inner);
      els.cacheChips.appendChild(details);
    }
  }

  /* ---------- abort helpers ---------- */

  function makeAbortError() {
    try {
      return new DOMException("Fetch cancelled", "AbortError");
    } catch {
      const e = new Error("Fetch cancelled");
      e.name = "AbortError";
      return e;
    }
  }

  function isAbortError(e) {
    return !!(e && (e.name === "AbortError" || e.code === 20));
  }

  /** Throw AbortError if this run was cancelled. */
  function checkAborted(signal) {
    if (signal && signal.aborted) throw makeAbortError();
  }

  /* ---------- loaders ---------- */

  /**
   * GET JSON. `timeoutMs` aborts a hung request with a TimeoutError (never an
   * AbortError, so it counts as a per-name failure, not a user cancel).
   */
  async function fetchJson(url, signal, { timeoutMs = 0 } = {}) {
    checkAborted(signal);
    let useSignal = signal || null;
    let timer = 0;
    let timedOut = false;
    let onOuterAbort = null;
    if (timeoutMs > 0 && typeof AbortController !== "undefined") {
      const ctl = new AbortController();
      onOuterAbort = () => ctl.abort();
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onOuterAbort, { once: true });
      }
      timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, timeoutMs);
      useSignal = ctl.signal;
    }
    try {
      const res = await fetch(
        url,
        useSignal ? { cache: "no-cache", signal: useSignal } : { cache: "no-cache" }
      );
      if (!res.ok) {
        const err = new Error(`${res.status} ${res.statusText} for ${url}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      checkAborted(signal);
      return data;
    } catch (e) {
      checkAborted(signal); // user cancel always wins
      if (timedOut) {
        const t = new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
        t.name = "TimeoutError";
        throw t;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (onOuterAbort && signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onOuterAbort);
      }
    }
  }

  async function loadLocal(name, signal) {
    const key = slugKey(name);
    const shared = findSharedEntry(name);
    const candidates = [];
    if (shared && shared.file) {
      const rel = String(shared.file).replace(/^\.?\/?data\//, "");
      candidates.push(`data/${rel}`);
    }
    candidates.push(
      `data/players/${key}.json`,
      `data/${key}.json`,
      `data/${key}_top50.json`
    );
    const seen = new Set();
    const unique = [];
    for (const p of candidates) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      unique.push(p);
    }

    let lastErr;
    for (const path of unique) {
      try {
        const data = await fetchJson(path, signal);
        data._source = `shared:${path}`;
        const np = normalizePlayer(data);
        np.fetchedAt = +data.savedAt || (shared && +shared.savedAt) || 0;
        return np;
      } catch (e) {
        if (isAbortError(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error(`No shared data for ${name}`);
  }

  function loadFromCache(name) {
    const entry = cacheGet(name);
    if (!entry) throw new Error(`No cache for ${name}`);
    const np = normalizePlayer({
      _source: "cache:localStorage",
      player: entry.player,
    });
    np.fetchedAt = entryFetchedAt(entry);
    return np;
  }

  async function resolveCensus(name, signal) {
    const raw = censusQueryName(name); // "[TAG] Name" → "Name"
    if (!raw) throw new NameLoadError(`Census: empty name ${JSON.stringify(name)}`, "not-found");
    let url;
    if (/^\d{16,}$/.test(raw)) {
      url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
    } else {
      url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
    }
    let data;
    try {
      data = await censusJson(url, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new NameLoadError(e.message, e && e.kind === "census-busy" ? "census-busy" : "network");
    }
    if (!data || typeof data !== "object") {
      throw new NameLoadError(`Census: bad response for ${raw}`, "bad-response");
    }
    if (!Array.isArray(data.character_list) && (data.error || data.errorCode)) {
      throw new NameLoadError(`Census unavailable: ${data.error || data.errorCode}`, "network");
    }
    const chars = data.character_list || [];
    if (!chars.length || !chars[0] || !chars[0].character_id) {
      throw new NameLoadError(`Census: no character ${raw}`, "not-found");
    }
    return chars[0];
  }

  /**
   * One paced Census GET (census-fetch.mjs censusRequest): per-request
   * timeout, exponential backoff + jitter on network errors / 5xx / 429 /
   * Census "busy" answers, at most 2 in flight. While retrying, the status
   * line says so; when Census stays down it throws CensusError
   * (kind "census-busy") and the caller falls back to cached data.
   */
  function censusJson(url, signal) {
    const big = url.includes("characters_event_grouped");
    return censusLimit(() =>
      censusRequest(url, {
        signal,
        bucket: censusBucket,
        retries: 4,
        timeoutMs: big ? CENSUS_BOARD_TIMEOUT_MS : CENSUS_TIMEOUT_MS,
        expectData: big || url.includes("character?name.first_lower="),
        baseMs: 1500,
        capMs: 20000,
        onRetry: ({ attempt, retries }) => {
          if (signal && signal.aborted) return;
          setStatus(
            `<span class="warn">⏳ Daybreak Census is busy, retrying… (${attempt}/${retries})</span>`,
            "warn census-retry"
          );
        },
      })
    );
  }

  /** Honu fallback ONLY for lifetime history Census lacks (no stat_history). */
  async function honuHistoryFallback(c, signal) {
    try {
      const h = await fetchJson(`${HONU}${c.character_id}/history_stats`, signal, { timeoutMs: HONU_SIDE_TIMEOUT_MS });
      if (!Array.isArray(h) || !h.length) return;
      const pick = (t) => {
        const r = h.find((x) => x && x.type === t);
        return r ? String(r.allTime || 0) : "0";
      };
      c.stats = { ...(c.stats || {}), stat_history: ["kills", "deaths", "time"].map((t) => ({ stat_name: t, all_time: pick(t) })) };
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
  }

  function hist(c, stat) {
    for (const row of ((c.stats || {}).stat_history) || []) {
      if (row.stat_name === stat) return +row.all_time || 0;
    }
    return 0;
  }

  /** Live load (Census); `run` carries the analyze run's abort signal. */
  async function loadLive(name, run) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    return loadLiveInner(name, signal);
  }

  async function loadLiveInner(name, signal) {
    const c = await resolveCensus(name, signal);
    const cid = c.character_id;
    if (!["kills", "deaths", "time"].every((t) => (((c.stats || {}).stat_history) || []).some((x) => x && x.stat_name === t))) {
      await honuHistoryFallback(c, signal);
    }
    const outfit = c.outfit || {};
    const gk = hist(c, "kills"), gd = hist(c, "deaths"), gt = hist(c, "time");
    const gkd = gd ? gk / gd : gk;
    const gkpm = gt ? gk / (gt / 60) : 0;
    const tag = outfit.alias ? `[${outfit.alias}] ` : "";
    const display = `${tag}${(c.name && c.name.first) || censusQueryName(name)}`;

    let r;
    try {
      r = await fetchPlayerCensus(cid, {
        base: CENSUS,
        topN: OPPONENT_TOP_N,
        getJson: (u) => censusJson(u, signal),
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (e && e.name === "CensusError") throw new NameLoadError(e.message, "census-busy");
      throw e;
    }
    checkAborted(signal);
    if (!r.board.length) throw new NameLoadError(`Census: empty killboard for ${cid}`, "no-data");
    if (r.ownFailed && !r.rows.length) {
      throw new NameLoadError(`Census is busy or down (stats for ${display})`, "census-busy");
    }
    const own = r.own || { kpm: 0, acc: 0, hsr: 0, ivi: 0 };
    const rows = r.rows;
    // 🪖 / 🚜 lifetime kill split (one kills-only Census call), so a fresh copy keeps the
    // Infantry value and the ‡ vehicle / MAX cut; falls back to the shared copy's split.
    let infantry = null;
    try {
      const j = await censusJson(infantryKillsUrl(CENSUS, [cid]), signal);
      infantry = summarizeInfantryKills((j && j.characters_weapon_stat_by_faction_list) || []);
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
    if (!infantry) {
      try { const sh = await loadLocal(name, signal); infantry = (sh && sh.infantry) || null; } catch (e) { if (isAbortError(e)) throw e; }
    }

    const np = normalizePlayer({
      _source: "live:census",
      player: {
        display,
        cid,
        global_kd: gkd,
        global_kpm: gkpm,
        own_kpm: own.kpm || gkpm,
        acc: own.acc,
        hsr: own.hsr,
        ivi: own.ivi,
        rows,
        curve: kpmCurve(rows),
        top: OPPONENT_TOP_N,
        honu: `https://wt.honu.pw/c/${cid}/killboard`,
        // Already in the character answer (no extra call): flairs.mjs.
        times: accountTimes(c),
        ...(infantry ? { infantry } : {}),
      },
    });
    np.fetchedAt = Date.now();
    // Graceful partial result: opponents Census couldn't return are left out.
    if (r.skipped || r.ownFailed) np.partialSkipped = r.skipped + (r.ownFailed ? 1 : 0);
    return np;
  }

  /** Newest stored copy (shared file vs browser cache), or null. */
  async function loadStoredNewest(name, signal, errors) {
    let sharedP = null;
    let localP = null;
    try {
      sharedP = await loadLocal(name, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      errors.push(`shared: ${e.message}`);
    }
    checkAborted(signal);
    try {
      localP = loadFromCache(name);
    } catch (e) {
      errors.push(`cache: ${e.message}`);
    }
    const pick = pickNewest([
      sharedP && { player: sharedP, fetchedAt: sharedP.fetchedAt, top: sharedP.top, kind: "shared" },
      localP && { player: localP, fetchedAt: localP.fetchedAt, top: localP.top, kind: "local" },
    ]);
    return pick ? pick.player : null;
  }

  /**
   * Default: the newest of shared data/ and browser localStorage (t300u:
   * a "Fetch fresh" result must survive F5 — an older shared file never
   * overrides it; cache-pick.mjs) → live when neither has the player.
   * Fresh: live only (cached copy only when Census is busy/down).
   */
  async function loadOne(name, { fresh = false, run = null } = {}) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    if (fresh) {
      try {
        return await loadLive(name, run);
      } catch (e) {
        if (isAbortError(e)) throw e;
        // Census busy/down: prefer the cached copy over failing the name.
        // t351u: any live failure keeps a saved copy (shared / browser) instead
        // of dropping a player that was already on the graph.
        const transient = isTransientKind(classifyLoadError(e));
        const cached = await loadStoredNewest(name, signal, []);
        if (cached) return { ...cached, cacheFallback: transient ? true : "kept" };
        throw new NameLoadError(
          `Live fetch failed for ${JSON.stringify(name)}: ${e.message}`,
          classifyLoadError(e)
        );
      }
    }
    const errors = [];
    const stored = await loadStoredNewest(name, signal, errors);
    if (stored) return stored;
    let liveErr = null;
    try {
      return await loadLive(name, run);
    } catch (e) {
      if (isAbortError(e)) throw e;
      liveErr = e;
      errors.push(`live: ${e.message}`);
    }
    // Shared/cache misses are expected; the live error says why the name failed.
    throw new NameLoadError(
      `Could not load ${JSON.stringify(name)}. ${errors.join(" · ")}`,
      classifyLoadError(liveErr)
    );
  }

  function reliability(pt) {
    const n = pt.n || 0;
    const d = pt.deaths || 0;
    if (d <= 0 || n <= 0) return 0;
    return Math.min(1, (n / 8) * 0.5 + (Math.min(d, 80) / 80) * 0.5);
  }

  /* yScale: imported from ./math.mjs */

  function readChartMode() {
    // Dayset 2026-10-13: always default to Raw, never remember Smooth
    try { localStorage.removeItem(LS_CHART_MODE); } catch {}
    try { localStorage.removeItem(LS_CHART_MODE_OLD); } catch {}
    return "cumulative";
  }

  function readGhostsOn() {
    try {
      // Old builds stored nothing for "on" (the old default) and "0" for off,
      // so only an explicit "1" (saved by this build) means on.
      return localStorage.getItem(LS_GHOSTS) === "1";
    } catch {
      return false;
    }
  }

  function syncYScaleUi() {
    const kdBtn = document.querySelector('[data-yscale="kd-btn"]');
    if (kdBtn) {
      const on = yScaleMode === "kd";
      kdBtn.classList.toggle("active", on);
      kdBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const ySlider = document.getElementById("yScaleSlider");
    if (ySlider) {
      ySlider.disabled = yScaleMode === "kd";
      if (document.activeElement !== ySlider) ySlider.value = yScalePct;
      const ySliderVal = document.getElementById("yScaleVal");
      if (ySliderVal) ySliderVal.textContent = yScalePct >= 10 ? yScalePct.toFixed(0) + "%" : yScalePct.toFixed(1) + "%";
    }
  }

  function syncSmoothBtn() {
    const b = document.querySelector('[data-mode="banded"]');
    if (b) b.hidden = !showDebugCols;
  }
  /** The 🎥 Live button hides behind the same "show older debug stats" box. */
  function syncLiveBtn() {
    if (els.liveBtn) els.liveBtn.hidden = !showDebugCols;
  }
  function syncChartModeUi() {
    if (!els.chartModeBar) return;
    syncSmoothBtn();
    for (const b of els.chartModeBar.querySelectorAll("[data-mode]")) {
      // Raw (📈) and KD (💀) are one choice: while 💀 is lit, Raw is not.
      const on = b.dataset.mode === chartMode && !(b.dataset.mode === "cumulative" && yScaleMode === "kd");
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const gb = els.chartModeBar.querySelector("[data-ghosts]");
    if (gb) {
      gb.classList.toggle("active", ghostsOn);
      gb.setAttribute("aria-pressed", ghostsOn ? "true" : "false");
    }
  }

  function setGhostsOn(on, { redraw = true } = {}) {
    ghostsOn = !!on;
    try {
      localStorage.setItem(LS_GHOSTS, ghostsOn ? "1" : "0");
    } catch {
      /* private mode: session-only */
    }
    syncChartModeUi();
  syncSmoothBtn();
    if (redraw && players.length) drawChart(players);
  }

  /** playerMetrics() per rows array (ghost style features). */
  const metricsCache = new WeakMap();
  function metricsFor(p) {
    const key = p && Array.isArray(p.rows) ? p.rows : null;
    if (!key) return playerMetrics(p);
    let m = metricsCache.get(key);
    if (!m) {
      m = playerMetrics(p);
      metricsCache.set(key, m);
    }
    return m;
  }

  /**
   * 👻 Ghost points for player p in the current mode (predicted from play
   * style, never replacing real data): [{ kpm, kd, lo, hi, ghost }] on the
   * chart grid; ghost = true where the dashed line should be drawn.
   */
  const ghostCache = new WeakMap();
  function ghostPointsFor(p, pts) {
    if (!ghostsOn || !p || !Array.isArray(p.rows) || !p.rows.length) return [];
    const key = p.rows;
    let byMode = ghostCache.get(key);
    if (!byMode) {
      byMode = {};
      ghostCache.set(key, byMode);
    }
    if (byMode[chartMode]) return byMode[chartMode];
    let out = [];
    try {
      const m = metricsFor(p);
      if (chartMode === "banded") {
        out = bandGhost(pts, p.rows, m, GHOST_MODEL);
      } else {
        const cg = cumulativeGhost(pts, p.rows, m, GHOST_MODEL);
        out = pts.map((pt) => {
          const g = pt.valid ? null : cg.get(Math.round(pt.kpm * 100) / 100);
          return g
            ? { kpm: pt.kpm, kd: g.kd, lo: g.lo, hi: g.hi, ghost: true }
            : { kpm: pt.kpm, kd: pt.kd, lo: pt.kd, hi: pt.kd, ghost: false };
        });
      }
    } catch {
      out = [];
    }
    byMode[chartMode] = out;
    return out;
  }

  function setChartMode(mode, { redraw = true } = {}) {
    const wasBanded = chartMode === "banded";
    chartMode = mode === "banded" ? "banded" : "cumulative";
    try {
      localStorage.setItem(LS_CHART_MODE, chartMode);
    } catch {
      /* private mode: session-only */
    }
    syncChartModeUi();
    // Dayset: wave auto-starts on Smooth, stops on Raw
    if (chartMode === "banded" && !wasBanded) {
      if (typeof startWave === "function") startWave();
    } else if (chartMode !== "banded" && wasBanded) {
      if (typeof stopWave === "function") stopWave();
    }
    if (redraw && players.length) drawChart(players);
  }

  /** Banded curves are derived from rows; memoised per rows array. */
  const bandCurveCache = new WeakMap();
  function bandCurveFor(p) {
    const rows = p && Array.isArray(p.rows) ? p.rows : null;
    if (!rows) return [];
    let c = bandCurveCache.get(rows);
    if (!c) {
      c = kpmBandCurve(rows);
      bandCurveCache.set(rows, c);
    }
    return c;
  }

  /**
   * Points to draw for player p in the current chart mode, each with
   * rel (line strength 0..1) and valid (drawable). Same X grid either way.
   */
  function chartPoints(p) {
    // Pace-adjusted K/D (Dayset 2026-10-13): quadratic penalty for low KPM.
    // factor = (own_kpm / 2.0)^2 capped [0, 1.0] — penalize only, never boost.
    // Raw K/D stays in tooltips; the line expresses skill.
    const _kpm = p.own_kpm || p.global_kpm;
    const _paceFactor = (_kpm > 0) ? Math.min(1.0, Math.pow(_kpm / 2.0, 2)) : 1;
    const _paceKd = (kd) => (isFiniteNum(kd) ? kd * _paceFactor : kd);
    let pts;
    if (chartMode === "banded") {
      pts = bandCurveFor(p)
        .filter((pt) => pt.kpm <= X_MAX + 1e-9)
        .map((pt) => {
          const rel = bandReliability(pt.events);
          return { ...pt, kd: _paceKd(pt.kd), rel, valid: rel > 0 && isFiniteNum(pt.kd) };
        });
    } else {
      pts = (p.curve || [])
        .filter((pt) => pt.kpm <= X_MAX + 1e-9)
        .map((pt) => ({
          ...pt,
          kd: _paceKd(pt.kd),
          rel: reliability(pt),
          valid: isFiniteNum(pt.kd) && pt.deaths > 0,
        }));
    }
    // Y-scale iVi mode: anchor the slider percentile to iVi.
    // Y = iVi × K/D(x) / K/D_p(slider), slider 100% (max) → 0.1% (min).
    if (yScaleMode === "ivi") {
      const ivi = p.ivi;
      if (isFiniteNum(ivi) && ivi > 0) {
        // Cache sorted K/D per player-curve (avoids re-sort every wave frame)
        let sorted = waveSortedCache.get(p);
        // Raw and Smooth curves can have the same length: key on the mode too.
        const cacheKey = `${chartMode}:${pts.length}`;
        if (!sorted || sorted._n !== cacheKey) {
          const validKds = pts.filter((pt) => pt.valid && isFiniteNum(pt.kd)).map((pt) => pt.kd);
          sorted = [...validKds].sort((a, b) => a - b);
          sorted._n = cacheKey;
          waveSortedCache.set(p, sorted);
        }
        if (sorted.length > 0) {
          const frac = Math.max(0.00001, Math.min(1, yScalePct / 100));
          // Smooth interpolation: continuous anchor, no discrete jumps
          const pos = frac * (sorted.length - 1);
          const i0 = Math.floor(pos);
          const i1 = Math.min(sorted.length - 1, i0 + 1);
          const t = pos - i0;
          // Cosine interpolation: smoother than linear, eases between points
          const tc = (1 - Math.cos(Math.PI * t)) / 2;
          const anchor = sorted[i0] * (1 - tc) + sorted[i1] * tc;
          if (anchor > 0) {
            const scale = ivi / anchor;
            pts = pts.map((pt) => ({ ...pt, kd: isFiniteNum(pt.kd) ? pt.kd * scale : pt.kd }));
          }
        }
      }
    }
    return pts;
  }

  /** Right edge of the visible X window (X_MAX unless zoomed into the left). */
  let viewXMax = X_MAX;
  function xToPx(x) {
    return PLOT.x + (x / viewXMax) * PLOT.w;
  }

  function makeYMapper(scale) {
    if (scale.log) {
      const logLo = Math.log10(scale.lo);
      const logHi = Math.log10(scale.hi);
      return (y) => {
        const t = (Math.log10(Math.max(y, scale.lo)) - logLo) / (logHi - logLo);
        return PLOT.y + PLOT.h * (1 - t);
      };
    }
    return (y) => {
      const t = (y - scale.lo) / (scale.hi - scale.lo || 1);
      return PLOT.y + PLOT.h * (1 - t);
    };
  }


  function zoomFromSlider(sliderVal) {
    return clampYZoom(Math.pow(2, +sliderVal || 0));
  }

  function sliderFromZoom(z) {
    const c = clampYZoom(z);
    return Math.log2(c);
  }

  function syncYZoomUi() {
    if (els.yZoomSlider) {
      const sv = sliderFromZoom(yZoom);
      if (Math.abs(+els.yZoomSlider.value - sv) > 0.001) {
        els.yZoomSlider.value = String(sv);
      }
    }
  }

  function setYZoom(z, { redraw = true } = {}) {
    yZoom = clampYZoom(z);
    syncYZoomUi();
    if (redraw && players.length) drawChart(players);
  }

  function resetYZoom({ redraw = true } = {}) {
    setYZoom(Y_ZOOM_DEFAULT, { redraw });
  }

  function setYZoomVisible(show) {
    if (!els.chartYZoom) return;
    if (show) els.chartYZoom.removeAttribute("hidden");
    else els.chartYZoom.setAttribute("hidden", "");
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  /**
   * Retained chart elements from the last full draw, so 🌊 wave frames can
   * move the existing lines / dots instead of rebuilding the SVG and the
   * stats table + legend (~60x a second). Null = next draw is a full draw.
   */
  let waveRig = null;
  function waveRigSig() {
    return `${chartMode}|${ghostsOn}|${yZoom}|${yScaleMode}|${isLightTheme()}|${currentChartFontScale()}`;
  }

  /** Y scale for the visible curves (shared by full draws and wave frames). */
  function chartYScale(validCurves, ghostY, yvals, zoomedLeft) {
    return zoomedLeft
      ? yScale(
          windowYValues(validCurves, viewXMax).concat(
            ghostY.filter((gp) => gp.kpm <= viewXMax + 1e-9).map((gp) => gp.kd)
          )
        ) // fit the left window
      : applyYZoom(yScale(yvals), yZoom);
  }

  /** Horizontal grid lines + right-hand tick labels for `scale`. */
  function drawYAxis(gLines, gText, scale, yToPx, th, fz) {
    const yTicks = scale.log ? niceLogTicks(scale.lo, scale.hi) : niceLinTicks(scale.lo, scale.hi, 6);
    for (const y of yTicks) {
      const line = ns("line");
      line.setAttribute("x1", PLOT.x);
      line.setAttribute("x2", PLOT.x + PLOT.w);
      line.setAttribute("y1", yToPx(y));
      line.setAttribute("y2", yToPx(y));
      gLines.appendChild(line);
      const t = ns("text");
      t.setAttribute("x", PLOT.x + PLOT.w + 8);
      t.setAttribute("y", yToPx(y) + 4);
      t.setAttribute("fill", th.text);
      t.setAttribute("font-size", fz(11));
      t.setAttribute("text-anchor", "start");
      t.textContent = formatTick(y, scale.log);
      gText.appendChild(t);
    }
  }

  /** Player number labels on the left edge, de-overlapped, with leader lines. */
  function drawChartLabels(g, labelAnchors, yToPx, fz) {
    labelAnchors.sort((a, b) => yToPx(a.y) - yToPx(b.y));
    const placed = [];
    for (const lab of labelAnchors) {
      let fy = yToPx(lab.y);
      for (const prev of placed) {
        if (Math.abs(fy - prev) < 16) fy = prev + 16;
      }
      fy = Math.min(PLOT.y + PLOT.h - 8, Math.max(PLOT.y + 10, fy));
      placed.push(fy);
      const num = ns("text");
      num.setAttribute("x", PLOT.x - 10);
      num.setAttribute("y", fy + 4);
      num.setAttribute("fill", lab.col);
      num.setAttribute("font-size", fz(14));
      num.setAttribute("font-weight", "800");
      num.setAttribute("text-anchor", "end");
      num.textContent = String(lab.i + 1) + lab.mark.mark + (lab.poop ? POOP_MARK : "");
      if (lab.mark.mark || lab.poop) {
        const t = ns("title");
        t.textContent = [lab.mark.mark ? `${lab.display}${lab.mark.mark}: ${lab.mark.tip}` : "", lab.poop ? `${lab.display} ${POOP_TIP}` : ""].filter(Boolean).join("\n");
        num.appendChild(t);
      }
      g.appendChild(num);
      const link = ns("line");
      link.setAttribute("x1", PLOT.x - 4);
      link.setAttribute("y1", fy);
      link.setAttribute("x2", xToPx(lab.x));
      link.setAttribute("y2", yToPx(lab.y));
      link.setAttribute("stroke", lab.col);
      link.setAttribute("stroke-width", "0.7");
      link.setAttribute("stroke-opacity", "0.7");
      g.appendChild(link);
    }
  }

  /** "M x,y L x,y …" for the faint full-curve path (banded: gaps break the line). */
  function faintPathD(faint, banded, yToPx) {
    let d = "";
    for (let j = 0; j < faint.length; j++) {
      const pt = faint[j];
      const gap = banded && j && Math.abs(faint[j - 1].kpm - pt.kpm) > 0.051;
      d += `${j ? " " : ""}${j && !gap ? "L" : "M"}${xToPx(pt.kpm).toFixed(2)},${yToPx(pt.kd).toFixed(2)}`;
    }
    return d;
  }

  /**
   * 🌊 Wave frame: same players / mode / zoom as the last full draw, only the
   * Y anchor moved. Moves the retained elements; returns false when a full
   * draw is needed instead.
   */
  function updateWaveFrame(list) {
    const rig = waveRig;
    if (!rig || rig.list !== list || rig.sig !== waveRigSig() || ghostsOn) return false;
    const ptsByPlayer = list.map((p) => chartPoints(p));
    const validCurves = ptsByPlayer.map((pts) => pts.filter((pt) => pt.valid));
    const yvals = [];
    for (const pts of validCurves) for (const pt of pts) yvals.push(pt.kd);
    const scale = chartYScale(validCurves, [], yvals, rig.zoomedLeft);
    lastChartScale = scale;
    const yToPx = makeYMapper(scale);

    rig.gYGrid.replaceChildren();
    rig.gYText.replaceChildren();
    drawYAxis(rig.gYGrid, rig.gYText, scale, yToPx, rig.th, rig.fz);

    const labelAnchors = [];
    rig.series.forEach((s, i) => {
      const pts = ptsByPlayer[i];
      if (pts.length !== s.n) return;
      if (s.path) s.path.setAttribute("d", faintPathD(validCurves[i], rig.banded, yToPx));
      for (const sg of s.segs) {
        sg.el.setAttribute("y1", yToPx(pts[sg.a].kd));
        sg.el.setAttribute("y2", yToPx(pts[sg.b].kd));
      }
      for (const m of s.marks) {
        const pt = pts[m.k];
        if (m.x) m.el.setAttribute("transform", `translate(${xToPx(pt.kpm)} ${yToPx(pt.kd)})`);
        else m.el.setAttribute("cy", yToPx(pt.kd));
      }
      if (s.anchor) {
        const a = pts[s.anchor.k];
        labelAnchors.push({ ...s.anchor, x: a.kpm, y: a.kd });
      }
    });
    rig.gLabels.replaceChildren();
    drawChartLabels(rig.gLabels, labelAnchors, yToPx, rig.fz);
    return true;
  }

  function drawChart(list, { waveFrame = false } = {}) {
    updateWaveRangeWarn(list);
    if (waveFrame && updateWaveFrame(list)) return;
    waveRig = null;
    const svg = els.chart;
    clearSvg(svg);
    setPlaceholderVisible(false);
    svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Elite K/D vs Enemy KPM");
    chartFs = currentChartFontScale();
    const fz = (n) => String(Math.round(n * chartFs * 10) / 10);

    const th = chartTheme();

    const bg = ns("rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", VB.w);
    bg.setAttribute("height", VB.h);
    bg.setAttribute("fill", th.bg);
    svg.appendChild(bg);

    // Zoom slider: above the middle zooms into the LEFT start of the graph
    // (X shrinks fast from the right, X min stays 0) and Y re-fits to what is
    // visible; at/below the middle X is full and Y uses the old fit / zoom-out.
    const zoomedLeft = yZoom > 1 + 1e-9;
    viewXMax = zoomedLeft ? xMaxForZoom(yZoom) : X_MAX;

    const bands = [
      { x0: 0, x1: EASY_MAX, fill: "#6a8f6a", opacity: th.bandOpacity },
      { x0: EASY_MAX, x1: HARD_MIN, fill: "#8a8a6a", opacity: th.bandOpacity * 0.75 },
      { x0: HARD_MIN, x1: X_MAX, fill: "#8a6a6a", opacity: th.bandOpacity },
    ];
    for (const b of bands) {
      if (b.x0 >= viewXMax) continue;
      const x1 = Math.min(b.x1, viewXMax);
      const r = ns("rect");
      r.setAttribute("x", xToPx(b.x0));
      r.setAttribute("y", PLOT.y);
      r.setAttribute("width", xToPx(x1) - xToPx(b.x0));
      r.setAttribute("height", PLOT.h);
      r.setAttribute("fill", b.fill);
      r.setAttribute("fill-opacity", b.opacity);
      svg.appendChild(r);
    }

    const banded = chartMode === "banded";
    const ptsByPlayer = list.map((p) => chartPoints(p));
    const validCurves = ptsByPlayer.map((pts) => pts.filter((pt) => pt.valid));
    const ghostsByPlayer = list.map((p, i) => ghostPointsFor(p, ptsByPlayer[i]));
    const yvals = [];
    for (const pts of validCurves) for (const pt of pts) yvals.push(pt.kd);
    // Ghost centres may widen Y a little (so dashed lines stay visible) but
    // never more than 1.5× the real max: predictions must not set the scale.
    const realMax = yvals.length ? Math.max(...yvals) : 0;
    const ghostY = [];
    ghostsByPlayer.forEach((gs, i) => {
      for (const gp of gs) {
        if (gp.ghost && isFiniteNum(gp.kd) && gp.kd <= realMax * 1.5) {
          yvals.push(gp.kd);
          ghostY.push({ i, kpm: gp.kpm, kd: gp.kd, deaths: 1 });
        }
      }
    });
    const scale = chartYScale(validCurves, ghostY, yvals, zoomedLeft);
    lastChartScale = scale;
    const yToPx = makeYMapper(scale);
    const xTicks = zoomedLeft ? niceLinTicks(0, viewXMax, 5) : [0, 0.5, 1.0, 1.5, 2.0];
    const xTickDigits = zoomedLeft && xTicks.length > 1 && xTicks[1] - xTicks[0] < 0.1 ? 2 : 1;

    const gGrid = ns("g");
    gGrid.setAttribute("stroke", th.grid);
    gGrid.setAttribute("stroke-width", "0.8");
    for (const x of xTicks) {
      const line = ns("line");
      line.setAttribute("x1", xToPx(x));
      line.setAttribute("x2", xToPx(x));
      line.setAttribute("y1", PLOT.y);
      line.setAttribute("y2", PLOT.y + PLOT.h);
      gGrid.appendChild(line);
    }
    svg.appendChild(gGrid);
    // Y grid lines in their own group (same look, same layer) so wave frames
    // can redraw just these; their tick labels go in gYText further down.
    const gYGrid = ns("g");
    gYGrid.setAttribute("stroke", th.grid);
    gYGrid.setAttribute("stroke-width", "0.8");
    svg.appendChild(gYGrid);
    const gYText = ns("g");
    drawYAxis(gYGrid, gYText, scale, yToPx, th, fz);

    for (const xv of [EASY_MAX, HARD_MIN]) {
      if (xv >= viewXMax) continue;
      const line = ns("line");
      line.setAttribute("x1", xToPx(xv));
      line.setAttribute("x2", xToPx(xv));
      line.setAttribute("y1", PLOT.y);
      line.setAttribute("y2", PLOT.y + PLOT.h);
      line.setAttribute("stroke", th.dash);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "5 4");
      line.setAttribute("stroke-opacity", "0.4");
      svg.appendChild(line);
    }

    const border = ns("rect");
    border.setAttribute("x", PLOT.x);
    border.setAttribute("y", PLOT.y);
    border.setAttribute("width", PLOT.w);
    border.setAttribute("height", PLOT.h);
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", th.border);
    border.setAttribute("stroke-width", "1");
    svg.appendChild(border);

    const clip = ns("clipPath");
    clip.setAttribute("id", "plot-clip");
    const clipRect = ns("rect");
    clipRect.setAttribute("x", PLOT.x);
    clipRect.setAttribute("y", PLOT.y);
    clipRect.setAttribute("width", PLOT.w);
    clipRect.setAttribute("height", PLOT.h);
    clip.appendChild(clipRect);
    const defs = ns("defs");
    defs.appendChild(clip);
    svg.appendChild(defs);

    const ylab = ns("text");
    ylab.setAttribute("x", PLOT.x + PLOT.w + 44);
    ylab.setAttribute("y", PLOT.y + PLOT.h / 2);
    ylab.setAttribute("fill", th.text);
    ylab.setAttribute("font-size", fz(12));
    ylab.setAttribute("text-anchor", "middle");
    ylab.setAttribute("transform", `rotate(90 ${PLOT.x + PLOT.w + 44} ${PLOT.y + PLOT.h / 2})`);
    // t378u/t381u: 🎯 aim mode rescales each curve to its player's iVi; say so on the axis.
    ylab.textContent = banded ? "K/D vs enemies near this KPM" : yScaleMode === "ivi" ? "Aim score (public IvI)" : "Kills per death";
    svg.appendChild(ylab);

    for (const x of xTicks) {
      const t = ns("text");
      t.setAttribute("x", xToPx(x));
      t.setAttribute("y", PLOT.y + PLOT.h + 14 + 4 * chartFs);
      t.setAttribute("fill", th.text);
      t.setAttribute("font-size", fz(11));
      t.setAttribute("text-anchor", "middle");
      t.textContent = x.toFixed(xTickDigits);
      svg.appendChild(t);
    }
    svg.appendChild(gYText);

    // Short axis labels only (no farm % clutter)
    const capY = PLOT.y + PLOT.h + 30 + 10 * chartFs;
    addText(svg, PLOT.x, capY, "🐣 Easy", th.muted, 10, "start");
    if (zoomedLeft) {
      addText(svg, PLOT.x + PLOT.w, capY, `🔍 0–${viewXMax.toFixed(2)}`, th.muted, 10, "end");
    } else {
      addText(svg, PLOT.x + PLOT.w, capY, "🥵 Hard", th.muted, 10, "end");
    }
    // Dayset 2026-10-13: 0.75/1.50 threshold numbers removed

    const seriesG = ns("g");
    seriesG.setAttribute("clip-path", "url(#plot-clip)");
    svg.appendChild(seriesG);

    const labelAnchors = [];
    const lightLines = isLightTheme();
    let drewGhost = false;
    const rigSeries = [];
    list.forEach((p, i) => {
      const col = seriesColor(i);
      const pts = ptsByPlayer[i];
      if (drawGhostRuns(seriesG, ghostsByPlayer[i], col, yToPx, p.display, th)) drewGhost = true;
      const rs = { n: pts.length, path: null, segs: [], marks: [], anchor: null };
      rigSeries.push(rs);

      const faint = pts.filter((pt) => pt.valid);
      if (faint.length >= 2) {
        const path = ns("path");
        rs.path = path;
        // Banded: hidden (too few fights) stretches break the line instead of bridging.
        path.setAttribute("d", faintPathD(faint, banded, yToPx));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", col);
        path.setAttribute("stroke-width", lightLines ? "0.9" : "0.7");
        path.setAttribute("stroke-opacity", lightLines ? "0.3" : "0.2");
        seriesG.appendChild(path);
      }

      for (let a = 0; a < pts.length - 1; a++) {
        const A = pts[a], B = pts[a + 1];
        if (!A.valid || !B.valid) continue;
        const r = Math.min(A.rel, B.rel);
        const seg = ns("line");
        seg.setAttribute("x1", xToPx(A.kpm));
        seg.setAttribute("y1", yToPx(A.kd));
        seg.setAttribute("x2", xToPx(B.kpm));
        seg.setAttribute("y2", yToPx(B.kd));
        seg.setAttribute("stroke", col);
        // Light theme: a little thicker and less transparent so lines don't wash out on cream.
        seg.setAttribute("stroke-width", (lightLines ? 0.7 + 1.5 * r : 0.5 + 1.3 * r).toFixed(2));
        seg.setAttribute("stroke-opacity", (lightLines ? 0.5 + 0.5 * r : 0.3 + 0.7 * r).toFixed(2));
        seg.setAttribute("stroke-linecap", "round");
        seriesG.appendChild(seg);
        rs.segs.push({ el: seg, a, b: a + 1 });
      }

      // Fixed small markers (no √deaths sizing)
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k];
        if (!pt.valid) continue;
        if (pt.rel < 0.35) {
          // ✕ drawn around 0,0 and placed by transform, so a wave frame moves it with one attribute.
          const g = drawX(seriesG, 0, 0, DOT_R, col);
          g.setAttribute("transform", `translate(${xToPx(pt.kpm)} ${yToPx(pt.kd)})`);
          rs.marks.push({ el: g, k, x: true });
        } else {
          const c = ns("circle");
          c.setAttribute("cx", xToPx(pt.kpm));
          c.setAttribute("cy", yToPx(pt.kd));
          c.setAttribute("r", String(DOT_R));
          c.setAttribute("fill", col);
          c.setAttribute("fill-opacity", "0.92");
          c.setAttribute("stroke", th.markerStroke);
          c.setAttribute("stroke-width", "0.6");
          seriesG.appendChild(c);
          rs.marks.push({ el: c, k, x: false });
        }
      }

      // Label anchor: lowest-KPM valid point (prefer the easy end ≤ 0.25).
      let ak = -1;
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k];
        if (!pt.valid) continue;
        const easy = pt.kpm <= 0.25;
        const best = ak >= 0 ? pts[ak] : null;
        const bestEasy = best && best.kpm <= 0.25;
        if (!best || (easy && !bestEasy) || (easy === bestEasy && pt.kpm < best.kpm)) ak = k;
      }
      if (ak >= 0) {
        rs.anchor = { i, col, k: ak, display: p.display, mark: playerMark(p), poop: isPenalizedPadder(p.display) };
        labelAnchors.push({ ...rs.anchor, x: pts[ak].kpm, y: pts[ak].kd });
      }
    });

    const gLabels = ns("g");
    svg.appendChild(gLabels);
    drawChartLabels(gLabels, labelAnchors, yToPx, fz);

    waveRig = { list, sig: waveRigSig(), zoomedLeft, banded, th, fz, gYGrid, gYText, gLabels, series: rigSeries };

    renderStatsTable(list);
    setGhostCaption(ghostsOn, drewGhost);
  }

  /**
   * Dashed, low-opacity 👻 ghost runs (plus a faint ±1σ shade) wherever the
   * ghost flag is set; each run is extended one grid step into the real line
   * so the prediction visibly continues it. Returns true if anything drew.
   */
  function drawGhostRuns(g, gpts, col, yToPx, display, th) {
    if (!gpts || !gpts.length) return false;
    const pts = gpts
      .filter((gp) => isFiniteNum(gp.kd) && gp.kd > 0 && gp.kpm <= viewXMax + 0.051)
      .sort((a, b) => a.kpm - b.kpm);
    const runs = [];
    let cur = null;
    pts.forEach((gp, j) => {
      if (gp.ghost) {
        if (!cur) {
          cur = [];
          if (j > 0) cur.push(pts[j - 1]);
        }
        cur.push(gp);
      } else if (cur) {
        cur.push(gp);
        runs.push(cur);
        cur = null;
      }
    });
    if (cur) runs.push(cur);
    const light = isLightTheme();
    const tip = `${display}: 👻 predicted from play style, not real fights`;
    let drew = false;
    for (const run of runs) {
      if (run.length < 2) continue;
      const xs = run.map((gp) => xToPx(gp.kpm).toFixed(2));
      const band = ns("path");
      const up = run.map((gp, j) => `${j ? "L" : "M"}${xs[j]},${yToPx(isFiniteNum(gp.hi) ? gp.hi : gp.kd).toFixed(2)}`);
      const dn = run
        .map((gp, j) => `L${xs[j]},${yToPx(isFiniteNum(gp.lo) ? gp.lo : gp.kd).toFixed(2)}`)
        .reverse();
      band.setAttribute("d", up.concat(dn).join(" ") + " Z");
      band.setAttribute("fill", col);
      band.setAttribute("fill-opacity", light ? "0.07" : "0.045");
      band.setAttribute("stroke", "none");
      band.setAttribute("class", "ghost-band");
      g.appendChild(band);
      const line = ns("path");
      line.setAttribute("d", run.map((gp, j) => `${j ? "L" : "M"}${xs[j]},${yToPx(gp.kd).toFixed(2)}`).join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", col);
      line.setAttribute("stroke-width", light ? "1.6" : "1.4");
      line.setAttribute("stroke-opacity", light ? "0.7" : "0.55");
      line.setAttribute("stroke-dasharray", "6 4");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("class", "ghost-line");
      const t = ns("title");
      t.textContent = tip;
      line.appendChild(t);
      g.appendChild(line);
      drew = true;
    }
    return drew;
  }

  function drawX(svg, cx, cy, s, col) {
    const g = ns("g");
    g.setAttribute("stroke", col);
    g.setAttribute("stroke-width", "1.2");
    g.setAttribute("stroke-linecap", "round");
    const a = ns("line");
    a.setAttribute("x1", cx - s * 0.55);
    a.setAttribute("y1", cy - s * 0.55);
    a.setAttribute("x2", cx + s * 0.55);
    a.setAttribute("y2", cy + s * 0.55);
    const b = ns("line");
    b.setAttribute("x1", cx - s * 0.55);
    b.setAttribute("y1", cy + s * 0.55);
    b.setAttribute("x2", cx + s * 0.55);
    b.setAttribute("y2", cy - s * 0.55);
    g.appendChild(a);
    g.appendChild(b);
    svg.appendChild(g);
    return g;
  }

  function currentChartFontScale() {
    if (typeof window === "undefined" || !els.chart) return 1;
    const wrap = els.chart.closest(".chart-wrap");
    const w = (wrap && wrap.clientWidth) || els.chart.clientWidth || 0;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return chartFontScale(window.innerWidth, rootPx, w);
  }
  if (typeof window !== "undefined") {
    let deskResizeT = 0;
    window.addEventListener("resize", () => {
      clearTimeout(deskResizeT);
      deskResizeT = setTimeout(() => {
        if (players.length && currentChartFontScale() !== chartFs) drawChart(players);
      }, 150);
    });
  }

  function addText(svg, x, y, text, fill, size, anchor) {
    const t = ns("text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("fill", fill);
    t.setAttribute("font-size", String(Math.round(size * chartFs * 10) / 10));
    t.setAttribute("text-anchor", anchor);
    t.textContent = text;
    svg.appendChild(t);
    return t;
  }

  function niceLinTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const step = niceNum(span / (n - 1));
    const start = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let v = start; v <= hi + step * 0.01; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  function niceNum(range) {
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  function niceLogTicks(lo, hi) {
    const ticks = [];
    const start = Math.floor(Math.log10(lo));
    const end = Math.ceil(Math.log10(hi));
    for (let e = start; e <= end; e++) {
      const v = Math.pow(10, e);
      if (v >= lo * 0.99 && v <= hi * 1.01) ticks.push(v);
    }
    return ticks.length ? ticks : [lo, hi];
  }

  function formatTick(y, log) {
    if (log) {
      if (y >= 10) return y.toFixed(0);
      if (y >= 1) return y.toFixed(1);
      if (y >= 0.1) return y.toFixed(2);
      if (y >= 0.01) return y.toFixed(3);
      return y.toFixed(4);
    }
    const ay = Math.abs(y);
    if (ay >= 10) return y.toFixed(0);
    if (ay >= 1) return y.toFixed(1);
    if (ay >= 0.1) return y.toFixed(2);
    if (ay >= 0.01) return y.toFixed(3);
    if (ay > 0) return y.toFixed(4);
    return y.toFixed(1);
  }

  /* Per-table sort state: key "name" | col index, dir "asc"|"desc" */
  const statsSortState = {
    public: { key: "ivi", dir: "desc" },
    adjusted: { key: "adjs", dir: "desc" },
  };

  /* Older debug columns in the Adjusted table: hidden unless the footer box is ticked. */
  function readShowDebugCols() {
    try {
      return localStorage.getItem(LS_DEBUG_COLS) === "1";
    } catch (_) {
      return false;
    }
  }
  let showDebugCols = readShowDebugCols();
  /** Last list rendered into the stats tables (re-render when the debug box flips). */
  let lastStatsList = null;
  if (els.debugColsToggle) {
    els.debugColsToggle.checked = showDebugCols;
    els.debugColsToggle.addEventListener("change", () => {
      showDebugCols = !!els.debugColsToggle.checked;
      try {
        if (showDebugCols) localStorage.setItem(LS_DEBUG_COLS, "1");
        else localStorage.removeItem(LS_DEBUG_COLS);
      } catch (_) {
        /* private mode: keep the in-memory choice */
      }
      if (lastStatsList) renderStatsTable(lastStatsList);
      syncSmoothBtn();
      syncLiveBtn();
    });
  }
  syncLiveBtn();

  /* Hide adjusted-iVi ≤ 0 players from the Rankings table browse (footer box). */
  if (els.hideZeroIviToggle) {
    try { els.hideZeroIviToggle.checked = localStorage.getItem(LS_HIDE_ZERO_IVI) === "1"; } catch (_) { /* private mode */ }
    els.hideZeroIviToggle.addEventListener("change", () => {
      try {
        if (els.hideZeroIviToggle.checked) localStorage.setItem(LS_HIDE_ZERO_IVI, "1");
        else localStorage.removeItem(LS_HIDE_ZERO_IVI);
      } catch (_) {
        /* private mode: Rankings keeps its own in-memory choice */
      }
    });
  }

  /** "Why some cells show —" note: collapsed by default; remembered only while the page is open. */
  let thinNoteOpen = false;
  /** "What * † mean" note: same treatment as the thin note. */
  let markNotesOpen = false;
  /** 📊 Public section open/closed, kept across re-sorts / re-renders (t339u: sorting collapsed it). */
  let publicStatsOpen = false;
  // 🧱 Const percentile: population pool from the shared ranks.json (one fetch, cached).
  let consPool = null;
  let consPoolLoad = null;
  // 🤝 Assists per kill (t385u): shared value by slug + population pool from ranks.json.
  let apkBySlug = null;
  let apkPool = null;
  // 🪖 Infantry (% of lifetime kills with infantry weapons): value + MAX / vehicle % by slug, pool for the percentile.
  let infBySlug = null;
  let infPool = null;
  function loadConsPool() {
    if (consPoolLoad) return consPoolLoad;
    consPoolLoad = loadRanksPayload()
      .then((payload) => {
        const i = payload && Array.isArray(payload.cols) ? payload.cols.indexOf("cons") : -1;
        if (i < 0 || !Array.isArray(payload.rows)) return;
        consPool = payload.rows.map((row) => row[i]).filter(isFiniteNum).sort((a, b) => a - b);
        const ai = payload.cols.indexOf("apk");
        const si = payload.cols.indexOf("slug");
        if (ai >= 0 && si >= 0) {
          apkBySlug = new Map();
          for (const row of payload.rows) if (isFiniteNum(row[ai])) apkBySlug.set(row[si], row[ai]);
          apkPool = [...apkBySlug.values()].sort((a, b) => a - b);
        }
        const ii = payload.cols.indexOf("inf");
        if (ii >= 0 && si >= 0) {
          const mi = payload.cols.indexOf("infMax");
          const vi = payload.cols.indexOf("infVeh");
          infBySlug = new Map();
          for (const row of payload.rows) if (isFiniteNum(row[ii])) infBySlug.set(row[si], { inf: row[ii], max: mi >= 0 ? row[mi] : null, veh: vi >= 0 ? row[vi] : null });
          infPool = [...infBySlug.values()].map((e) => e.inf).sort((a, b) => a - b);
        }
        if (lastStatsList) renderStatsTable(lastStatsList);
      })
      .catch(() => {});
    return consPoolLoad;
  }

  function renderStatsTable(list) {
    loadConsPool();
    if (!els.stats) return;
    lastStatsList = list;
    syncVehiclesNote(list);
    loadLegendShards(list.map((e) => slugKey(e && e.display)).filter(Boolean));
    if (!list.length) {
      els.stats.innerHTML = "";
      if (els.statsPublic) els.statsPublic.innerHTML = "";
      return;
    }

    // Same per-player metrics as build-log.html red flags (player-metrics.mjs).
    const metrics = list.map((p) => playerMetrics(p));

    const publicCols = [
      { id: "kd", label: "KD", hint: "Overall kill/death ratio from Census / Honu.", fn: (r) => r.kd, digits: 2 },
      { id: "kpm", label: "KPM", hint: "Overall kills per minute.", fn: (r) => r.kpm, digits: 2 },
      { id: "ownKpm", label: "own KPM", hint: "Your own weapon pace (kills per minute with your weapons).", fn: (r) => r.ownKpm, digits: 2 },
      { id: "acc", label: "Acc %", hint: "Hit accuracy percentage.", fn: (r) => r.acc, digits: 1 },
      { id: "hsr", label: "HSR %", hint: "Headshot rate percentage.", fn: (r) => r.hsr, digits: 1 },
      { id: "ivi", label: "IvI", hint: "Infantry vs Infantry score from Census / Honu.", fn: (r) => r.ivi, digits: 0 },
    ];

    // Column order is fixed (sort only reorders rows). Visible by default:
    const adjVisibleCols = [
      { id: "adjs", label: "⚔️ iVi", hint: "Overall rating from how you do against the ~200 players you fight most, worth more the stronger they are, with a bonus for fast killing and a cut for slow, safe play.", fn: (r) => r.adjs, digits: 0, floorZero: true },
      { id: "act", label: "🏃 Activity", hint: "How much winning combat you put out: your K/D against the players you fight most, multiplied by how fast you kill.", fn: (r) => r.act, digits: 2 },
      { id: "pvs", label: "🦁 Brave", hint: "Activity that keeps up as enemies get stronger: high when you stay productive even against the fastest-killing players you meet.", fn: (r) => r.pvs, digits: 2 },
      { id: "rf", label: "🛡️ Resist", hint: "How well you stand up to strong players: your K/D against the players you fight most, scaled up by how fast those players kill.", fn: (r) => r.rf, digits: 2 },
      { id: "cons", label: "⚡ Const", hint: "How much of your K/D you keep against the strongest third of your opponents compared with the weakest third, as a percentile of all tracked players.", fn: (r) => r.cons, digits: 2, pctileCell: true },
      { id: "apk", label: "🤝 Assists", hint: "Assists per kill in recent Honu sessions: how often you help damage enemies that teammates finish, for each kill of your own. Shown from 100 session kills.", fn: (r) => (apkBySlug && r.p ? apkBySlug.get(slugKey(r.p.display)) : undefined), digits: 2, apkCell: true },
      { id: "rkd", label: "☠️ K/D", hint: "Kills ÷ deaths against the ~200 players you fight most, so it reflects real matchups rather than your whole lifetime.", fn: (r) => r.rkd, digits: 3 },
      { id: "inf", label: "🪖 Infantry", hint: INF_HINT, fn: (r) => { const e = infBySlug && r.p ? infBySlug.get(slugKey(r.p.display)) : undefined; return e ? e.inf : undefined; }, digits: 1, infCell: true },
    ];
    // Older debug columns: appended only when "show older debug stats" (footer) is ticked.
    const adjDebugCols = [
      { id: "mech", label: "⚙️ Mech%", hint: "Estimated share of your fights that are vehicle or mech play, projected from 🛡️ Resist rather than measured from shooting.", fn: (r) => r.mech, digits: 1 },
      { id: "adj", label: "🎯🎈 ivi", hint: "Opposition-weighted IvI before the kill-speed adjustment: public IvI adjusted by 🛡️ Resist so soft-farm padding is tempered. The 🎈 is a reminder that this score is still inflated (slow, safe play is not penalised here — see ⚔️ iVi).", fn: (r) => r.adj, digits: 0 },
      { id: "ekpm", label: "eKPM", hint: "Average enemy weapon KPM faced (how hard the opposition shoots).", fn: (r) => r.ekpm, digits: 2 },
      { id: "own", label: "own KPM", hint: "Your weapon pace used on the elite K/D curve and for the ⚔️ iVi speed adjustment.", fn: (r) => r.own, digits: 2 },
      { id: "coi", label: "📊 COI", hint: "Combat Output Index derived from 🛡️ Resist.", fn: (r) => r.coi, digits: 2 },
      { id: "slope", label: "📉 Slope", hint: "Overall graph angle: death-weighted K/D vs enemy KPM across the full curve — negative means K/D falls as opposition hardens (feeds 🦁 Brave).", fn: (r) => r.slope, digits: 2 },
      // t345u: 🎈 Inflation rarely shows anything meaningful → older stats only.
      { id: "inflation", label: "🎈 Inflation", hint: "Global KD ÷ KD at ≥0.5 enemy KPM — how much soft opposition inflates your KD (avg planetman ~0.35).", fn: (r) => r.inflation, digits: 2, pctDir: "low", pctRefFloor: 1.0 },
    ];
    // Opponent-sample metrics: "—" below MIN_FIGHTS (player-metrics.mjs), so they
    // also drop out of sorting and the % column references.
    for (const c of adjVisibleCols.concat(adjDebugCols)) {
      if (!THIN_METRICS.includes(c.id) || c.thinTip) continue;
      c.thinTip = true;
      c.fn = (r) => shownValue(r, c.id);
    }
    const adjCols = showDebugCols ? adjVisibleCols.concat(adjDebugCols) : adjVisibleCols;
    // Sorting by a hidden debug column falls back to the default (⚔️ iVi high→low).
    if (statsSortState.adjusted.key !== "name" && !adjCols.some((c) => c.id === statsSortState.adjusted.key)) {
      statsSortState.adjusted.key = "adjs";
      statsSortState.adjusted.dir = "desc";
    }

    function sortRows(rows, cols, state) {
      const key = state.key;
      const dir = state.dir === "asc" ? 1 : -1;
      const sorted = rows.slice();
      sorted.sort((a, b) => {
        if (key === "name") {
          // Character name only: "[TAG] " and marks/flairs ignored, natural, case-insensitive.
          return compareByCharName(a.p.display, b.p.display) * (state.dir === "asc" ? 1 : -1);
        }
        // Numeric: default desc means higher first when dir==="desc"
        const col = cols.find((c) => c.id === key);
        const getter = col ? col.fn : (r) => r.adjs;
        const av = getter(a);
        const bv = getter(b);
        const aOk = isFiniteNum(av);
        const bOk = isFiniteNum(bv);
        if (aOk && bOk) {
          if (av === bv) return 0;
          return av < bv ? -dir : dir;
        }
        if (aOk) return -1;
        if (bOk) return 1;
        return 0;
      });
      return sorted;
    }

    function sortIndicator(active, dir) {
      if (!active) return `<span class="sort-ind" aria-hidden="true"></span>`;
      const arrow = dir === "asc" ? "▲" : "▼";
      return `<span class="sort-ind active" aria-hidden="true">${arrow}</span>`;
    }

    function metricHead(cols, tableId, state) {
      const nameActive = state.key === "name";
      const nameHint = "Player name — number matches the graph series color. Click to sort A–Z.";
      const nameTh =
        `<th class="stats-name sortable${nameActive ? " sorted" : ""}" ` +
        `data-table="${tableId}" data-sort="name" scope="col" role="columnheader" ` +
        `aria-sort="${nameActive ? (state.dir === "asc" ? "ascending" : "descending") : "none"}" ` +
        `title="${escapeHtml(nameHint)}">Player${sortIndicator(nameActive, state.dir)}</th>`;
      const rest = cols
        .map((c) => {
          const active = state.key === c.id;
          const aria = active
            ? state.dir === "asc"
              ? "ascending"
              : "descending"
            : "none";
          const tip = c.hint || c.label;
          return (
            `<th class="sortable${active ? " sorted" : ""}" ` +
            `data-table="${tableId}" data-sort="${escapeHtml(c.id)}" scope="col" ` +
            `role="columnheader" aria-sort="${aria}" ` +
            `title="${escapeHtml(tip)}">${escapeHtml(c.label)}` +
            `${sortIndicator(active, state.dir)}</th>`
          );
        })
        .join("");
      return nameTh + rest;
    }

    function playerRows(cols, ordered, { withDesc = false } = {}) {
      // Column references over every analysed player (not just the visible order).
      const colRefs = new Map(
        cols.map((c) => [
          c.id,
          columnRef(metrics.map((r) => c.fn(r)), c.pctDir || "high", { floor: c.pctRefFloor ?? null }),
        ])
      );
      return ordered
        .map((row) => {
          // Series index matches graph legend/color order (stable with list, not sort order)
          let i = list.indexOf(row.p);
          if (i < 0) {
            i = list.findIndex(
              (p) =>
                p === row.p ||
                (p &&
                  row.p &&
                  String(p.display || "").toLowerCase() ===
                    String(row.p.display || "").toLowerCase())
            );
          }
          if (i < 0) i = 0;
          const col = seriesColor(i);
          const vals = cols
            .map((c) => {
              const v = c.fn(row);
              // ⚡ ivi: below-zero values read as "0" (not rated); sort keeps true value so they stay lowest.
              // 🚜 ‡ vehicle / MAX cut on ⚔️ iVi (vehicle-cut.mjs): mark after the value, reason on hover.
              const vc = c.id === "adjs" && row.vehCut > 0 ? vehCutHtml(row.vehOnly * 100, row.maxShare * 100, row.vehCut * 100) : "";
              if (c.floorZero && isFiniteNum(v) && v < 0) {
                return `<td class="below-scale" title="Below the rating scale">0${vc}</td>`;
              }
              // Opponent-sample metrics below MIN_FIGHTS: "—" with the reason on hover.
              if (c.thinTip && row.thin && !isFiniteNum(v)) {
                return `<td class="thin-sample" title="${escapeHtml(thinCellTip(row))}">—</td>`;
              }
              // Small dimmed % = gap to the column reference (none on the reference cell):
              // "−28%" below the highest value, or "+35%" above the lowest for pctDir "low".
              const dir = c.pctDir || "high";
              const ref = colRefs.get(c.id);
              const p = pctFromRef(v, ref, dir);
              const pct =
                p == null
                  ? ""
                  : `<span class="pct" title="${escapeHtml(pctTitle(p, fmtNum(ref, c.digits), dir))}">` +
                    `${fmtPctFromRef(p, dir)}</span>`;
              // Below the floor (🎈 Inflation < 1.0): no %, just say why on hover.
              const floor = c.pctRefFloor;
              const tdTitle =
                p == null && floor != null && isFiniteNum(v) && v < floor
                  ? ` title="${escapeHtml(`Below ${fmtNum(floor, c.digits)} = no inflation`)}"`
                  : "";
              // 🧱 Const: main value is the population percentile ("19%"); the dimmed gap to the highest value still applies.
              // 🤝 Assists: plain number, percentile + meaning on hover, plus the dimmed % gap to the highest (t398u).
              if (c.apkCell) {
                if (!isFiniteNum(v)) return `<td title="Not enough recent sessions (needs 100 kills in Honu sessions)">—</td>`;
                const pl = apkPool ? percentileOf(apkPool, v) : null;
                const rel = pl == null ? "" : pl >= 50 ? ` — top ${Math.max(1, 100 - pl)}%` : ` — bottom ${Math.max(1, pl)}%`;
                return `<td title="${escapeHtml(`Assists per kill: ${fmtNum(v, 2)}${rel}. Helps damage enemies that teammates finish.`)}">${fmtNum(v, 2)}${pct}</td>`;
              }
              // 🪖 Infantry: plain "%" value, one colour; percentile + MAX / vehicle share on hover, dimmed % gap like 🤝.
              if (c.infCell) {
                if (!isFiniteNum(v)) return `<td title="${escapeHtml(INF_PENDING_TIP)}">—</td>`;
                const e = infBySlug && row.p ? infBySlug.get(slugKey(row.p.display)) : null;
                const pl = infPool ? percentileOf(infPool, v) : null;
                return `<td title="${escapeHtml(infTip(v, e && e.max, e && e.veh, pl))}">${fmtNum(v, 1)}%${pct}</td>`;
              }
              if (c.pctileCell) {
                const pctl = isFiniteNum(v) && consPool ? percentileOf(consPool, v) : null;
                const txt = pctl == null ? "—" : `${pctl}%`;
                return `<td title="Population percentile: higher than ${pctl ?? "—"}% of cached players">${txt}${pct}</td>`;
              }
              return `<td${tdTitle}>${fmtNum(v, c.digits)}${vc}${pct}</td>`;
            })
            .join("");
          const num = i + 1;
          return (
            `<tr><th scope="row" class="stats-name" style="color:${col}">` +
            dotSlot(row.p.cid) +
            `<span class="player-num" aria-label="Series ${num}">${num}.</span>` +
            `${nameSpanHtml(row.p.display, farmTitle(row.p) + (withDesc ? descTitle(row.p) : ""), withDesc ? descText(row.p) : "", honuProfileUrl(row.p.cid))}${padMarkHtml(row.p)}${legacySampleHtml(row.p)}</th>${vals}</tr>`
          );
        })
        .join("");
    }

    // One collapsed "⚠️" line under ✨ Adjusted (t283u): opens to the rule, then
    // one line per player without stats. Nothing on the names themselves.
    const thinRows = metrics.filter((r) => r.thin);
    const thinBlock = thinRows.length
      ? `<details class="stats-thin-note fold-note"${thinNoteOpen ? " open" : ""}>` +
        `<summary title="Why some cells show —" aria-label="Why some cells show —">${THIN_MARK}</summary>` +
        `<p>${escapeHtml(THIN_NOTE_HEAD)}` +
        thinRows.map((r) => `<br />${escapeHtml(thinPlayerLine(r.p.display, r.sampleKills, r.sampleDeaths))}`).join("") +
        `</p></details>`
      : "";

    // Mark notes (used to live in the chart legend, now removed): one collapsed
    // line explaining the * / † marks used in the table.
    const markLegends = [...new Set(metrics.map((r) => playerMark(r.p).legend).filter(Boolean))];
    if (metrics.some((r) => r.p && isPenalizedPadder(r.p.display))) markLegends.push(POOP_TIP); // 💩 "What * 💩 mean"
    const markNotesBlock = markLegends.length
      ? `<details class="fold-note mark-notes"${markNotesOpen ? " open" : ""}>` +
        `<summary>♿ What ${[...new Set(markLegends.map((t) => t.trim().split(/\s+/)[0]))].join(" ")} ${markLegends.length > 1 ? "mean" : "means"}</summary>` +
        markLegends.map((t) => `<div class="mark-note">${escapeHtml(t)}</div>`).join("") +
        `</details>`
      : "";

    const pubSorted = sortRows(metrics, publicCols, statsSortState.public);
    const adjSorted = sortRows(metrics, adjCols, statsSortState.adjusted);

    // 📊 Public lives in the footer (#statsPublic, folded);
    // ✨ Adjusted stays above it without a title line.
    const publicHtml = `
      <details class="stats-section stats-public"${publicStatsOpen ? " open" : ""}>
        <summary>📊 Public (Census / Honu)</summary>
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="public">
            <thead><tr>${metricHead(publicCols, "public", statsSortState.public)}</tr></thead>
            <tbody>${playerRows(publicCols, pubSorted)}</tbody>
          </table>
        </div>
      </details>`;
    if (els.statsPublic) els.statsPublic.innerHTML = publicHtml;
    els.stats.innerHTML = (els.statsPublic ? "" : publicHtml) + `
      <div class="stats-section stats-adjusted">
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="adjusted">
            <thead><tr>${metricHead(adjCols, "adjusted", statsSortState.adjusted)}</tr></thead>
            <tbody>${playerRows(adjCols, adjSorted, { withDesc: true })}</tbody>
          </table>
        </div>
        ${thinBlock}
        ${markNotesBlock}
      </div>
    `;

    // 🟢/🔴 online dots: paint from cache now, fetch stale ids from Census.
    refreshOnline(CENSUS, [els.stats, els.statsPublic]);
    // Keep the ⚠️ note open/closed across re-sorts (starts collapsed each page load).
    const thinDet = els.stats.querySelector("details.stats-thin-note");
    if (thinDet) thinDet.addEventListener("toggle", () => { thinNoteOpen = thinDet.open; });
    const markDet = els.stats.querySelector("details.mark-notes");
    if (markDet) markDet.addEventListener("toggle", () => { markNotesOpen = markDet.open; });
    const statsRoots = [els.stats, els.statsPublic].filter(Boolean);
    const inStats = (sel) => statsRoots.map((r) => r.querySelector(sel)).find(Boolean) || null;
    const pubDet = inStats("details.stats-public");
    if (pubDet) pubDet.addEventListener("toggle", () => { publicStatsOpen = pubDet.open; });

    statsRoots.flatMap((r) => [...r.querySelectorAll("th.sortable")]).forEach((th) => {
      th.addEventListener("click", (ev) => {
        // A header inside a <details> must never toggle it (t339u).
        ev.stopPropagation();
        const tableId = th.getAttribute("data-table");
        const key = th.getAttribute("data-sort");
        if (!tableId || !key || !statsSortState[tableId]) return;
        const state = statsSortState[tableId];
        if (state.key === key) {
          state.dir = state.dir === "asc" ? "desc" : "asc";
        } else {
          state.key = key;
          // Name defaults A→Z; numeric defaults high→low
          state.dir = key === "name" ? "asc" : "desc";
        }
        // t329u: the re-render resets the table's horizontal scroll; restore it
        // and keep the sorted column in view (no vertical page jump).
        const wrap = th.closest(".stats-table-wrap");
        const prevLeft = wrap ? wrap.scrollLeft : 0;
        renderStatsTable(list);
        const tbl = inStats(`table[data-stats-table="${tableId}"]`);
        const newTh = tbl && [...tbl.querySelectorAll("th.sortable")].find((h) => h.getAttribute("data-sort") === key);
        if (newTh) keepSortedColumnVisible(newTh.closest(".stats-table-wrap"), newTh, prevLeft);
        // Phones have no hover: show the column's description for 5 s after a tap.
        if (newTh && isTouchUi()) showHeadTip(newTh.getAttribute("title"), newTh);
      });
    });
  }

  /**
   * Caption next to 👻: always shown while ghosts are on (so the toggle never
   * looks dead). drawn = ghost segments exist in this mode for these players;
   * otherwise say there's nothing to predict and point at Smooth / Raw.
   */
  function setGhostCaption(on, drawn) {
    const cap = document.getElementById("ghostCaption");
    if (!cap) return;
    cap.hidden = true; // Dayset 2026-10-13: ghost hint removed entirely
    return;
    const text = cap.querySelector(".ghost-caption-text");
    const sw = cap.querySelector(".ghost-caption-swatch");
    if (sw) sw.hidden = !drawn;
    if (!text) return;
    if (drawn) {
      text.innerHTML = "dashed = predicted from play style,<br />not real fights";
    } else if (chartMode === "banded") {
      text.innerHTML = "Ghost on: no gaps to predict here<br />(every line has enough fights)";
    } else {
      text.innerHTML = "Ghost on: no gaps to predict here,<br />try 🎚️ Smooth";
    }
  }

  // Consistency: K/D retention in hard region (top third of X) vs easy region (bottom third).
  // 1.0 = perfectly consistent, near 0 = only farms easy enemies.
  function consistency(p) {
    try {
      const kpm = p.own_kpm || p.global_kpm;
      const pf = kpm > 0 ? Math.min(1.0, Math.pow(kpm / 2.0, 2)) : 1;
      const pts = (p.curve || [])
        .filter((pt) => isFiniteNum(pt.kd) && isFiniteNum(pt.kpm) && pt.deaths > 0)
        .map((pt) => ({ x: pt.kpm, kd: pt.kd * pf }))
        .filter((pt) => pt.kd > 0)
        .sort((a, b) => a.x - b.x);
      if (pts.length < 6) return 0;
      const n = pts.length;
      const lo = pts.slice(0, Math.floor(n / 3));
      const hi = pts.slice(Math.ceil((2 * n) / 3));
      const avg = (arr) => arr.reduce((s, pt) => s + pt.kd, 0) / arr.length;
      const loAvg = avg(lo), hiAvg = avg(hi);
      if (loAvg <= 0) return 0;
      return Math.max(0, Math.min(1, hiAvg / loAvg));
    } catch { return 0; }
  }

  // Wave swing area: total area (iVi units × KPM) swept by the full line over a wave cycle.
  // area = iVi * |1/anchor(0.2%) - 1/anchor(98.8%)| * ∫ KD(x) dx (trapezoidal)
  function waveSwing(p) {
    try {
      const ivi = p.ivi;
      if (!isFiniteNum(ivi) || ivi <= 0) return 0;
      const kpm = p.own_kpm || p.global_kpm;
      const pf = kpm > 0 ? Math.min(1.0, Math.pow(kpm / 2.0, 2)) : 1;
      const pts = (p.curve || [])
        .filter((pt) => isFiniteNum(pt.kd) && isFiniteNum(pt.kpm) && pt.deaths > 0)
        .map((pt) => ({ x: pt.kpm, kd: pt.kd * pf }))
        .filter((pt) => pt.kd > 0)
        .sort((a, b) => a.x - b.x);
      if (pts.length < 2) return 0;
      const kds = pts.map((pt) => pt.kd);
      const sorted = [...kds].sort((a, b) => a - b);
      const anchorAt = (pct) => {
        const frac = Math.max(0.00001, Math.min(1, pct / 100));
        const pos = frac * (sorted.length - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(sorted.length - 1, i0 + 1);
        const t = pos - i0;
        const tc = (1 - Math.cos(Math.PI * t)) / 2;
        return sorted[i0] * (1 - tc) + sorted[i1] * tc;
      };
      const aLo = anchorAt(0.2), aHi = anchorAt(98.8);
      if (aLo <= 0 || aHi <= 0) return 0;
      // Trapezoidal integral of KD(x) over x
      let areaKd = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        areaKd += dx * (pts[i].kd + pts[i - 1].kd) / 2;
      }
      return Math.abs(ivi * (1 / aLo - 1 / aHi) * areaKd);
    } catch { return 0; }
  }

  /** Vehicles note lives in the footer now: it shows only while a comparison
   * is loaded (this used to be the `.legend:empty + .pooled-note` CSS rule). */
  function syncVehiclesNote(list) {
    if (els.vehiclesNote) els.vehiclesNote.hidden = !list || list.length === 0;
  }

  /** Truncatable player name (.nm, ~18ch cap) with the full name in title / data-full. */
  function nameSpan(name, { title = true } = {}) {
    const span = document.createElement("span");
    span.className = "nm";
    span.textContent = name;
    // Chips already carry a title naming the full name ("Remove X" / "… add X").
    if (title) span.title = name;
    span.setAttribute("data-full", name);
    return span;
  }
  /** Altered-stats mark (padding.mjs statMark): "*" padding, "†" adjusted, or none. */
  function isConfirmedPadder(p) {
    return !!p && confirmedPadders.has(slugKey(p.display));
  }
  function playerMark(p) {
    return statMark(p && p.farm, undefined, { confirmed: isConfirmedPadder(p) });
  }

  /** 🚜 "‡" after the ⚔️ iVi value: vehicle / MAX kill shares and the cut on hover. */
  function vehCutHtml(vehPct, maxPct, cutPct) {
    const tip = vehicleCutTip(vehPct, maxPct, cutPct);
    return `<span class="veh-cut" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${VEH_CUT_MARK}</span>`;
  }

  /** Mark after the name (tooltip explains); "" when the stats weren't altered. */
  function padMarkHtml(p) {
    const mk = playerMark(p);
    const poop = p && isPenalizedPadder(p.display) ? poopHtml() : "";
    if (!mk.mark) return poop;
    return `<span class="pad-mark mark-${mk.kind}" title="${escapeHtml(mk.tip)}">${mk.mark}</span>${poop}`;
  }
  /** 💩 confirmed padder (padding.mjs POOP_TIP): −10% adjusted iVi; owner override in data/reviewed.json. */
  function poopHtml() {
    return `<span class="poop-mark" title="${escapeHtml(POOP_TIP)}" aria-label="${escapeHtml(POOP_TIP)}">${POOP_MARK}</span>`;
  }

  /** Subtle "◦" after the name when the sample is the older top-50 one. */
  function legacySampleHtml(p) {
    if (!isLegacySample(p)) return "";
    return `<span class="sample-legacy" title="${escapeHtml(LEGACY_SAMPLE_TIP)}">${LEGACY_SAMPLE_MARK}</span>`;
  }

  /** Name cell title: adds the farm note when farm accounts were excluded. */
  /** Legend text for a player. Shards store { text, basis, at }; older entries are plain strings. */
  function descText(p) {
    const v = playerDescs[slugKey(p && p.display)];
    if (typeof v === "string") return v;
    return (v && typeof v.text === "string" && v.text) || "";
  }
  function descTitle(p) {
    const text = descText(p);
    return text ? `\n\n${text}` : "";
  }

  function farmTitle(p) {
    const note = p && markNote(p.farm, { confirmed: isConfirmedPadder(p) });
    return note ? ` — ${note}` : "";
  }

  function nameSpanHtml(name, extraTitle = "", desc = "", profileUrl = "") {
    const n = escapeHtml(name);
    const d = desc ? ` data-desc="${escapeHtml(desc)}"` : "";
    const pf = profileUrl ? ` data-profile="${escapeHtml(profileUrl)}"` : "";
    return `<span class="nm" data-full="${n}"${d}${pf} title="${n}${escapeHtml(extraTitle)}">${n}</span>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sourceLabel(src) {
    if (!src) return "unknown";
    if (src.startsWith("shared:") || src.startsWith("local:")) {
      return `shared cache (${src.split(":").slice(1).join(":")})`;
    }
    if (src === "cache:localStorage") return "browser cache";
    if (src.startsWith("live:")) return "live Honu/Census";
    return src;
  }

  function setFetching(on) {
    fetching = on;
    if (els.analyzeBtn) els.analyzeBtn.disabled = on;
    if (els.copyLinkBtn) els.copyLinkBtn.disabled = on;
    // Keep × always clickable so users can clear mid-fetch
    if (els.fetchFresh) { els.fetchFresh.disabled = on; updateFreshEta(); }
  }

  /**
   * ✕ / Esc in the progress popup: abort the whole analyze run now.
   * Previous graph (if any) is left untouched; nothing half-done is rendered.
   */
  function uncheckFetchFresh() {
    if (els.fetchFresh) { els.fetchFresh.checked = false; updateFreshEta(); }
  }

  function cancelAnalyze() {
    const run = activeRun;
    if (!run) return;
    activeRun = null;
    if (run.fresh) uncheckFetchFresh();
    try {
      run.controller.abort();
    } catch {
      /* ignore */
    }
    setFetching(false);
    setProgress(false);
    if (!players.length) {
      // No prior graph → back to idle placeholder.
      showIdleChart("▶️ Press Analyze");
    }
    setStatus('<span class="warn">Fetch cancelled.</span>', "warn cancelled");
  }

  function chartWrap() {
    return els.chart ? els.chart.closest(".chart-wrap") : null;
  }

  function setPlaceholderVisible(show) {
    const wrap = chartWrap();
    if (wrap) wrap.classList.toggle("empty", !!show);
    if (els.chartPlaceholder) {
      els.chartPlaceholder.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (els.chart) {
      if (show) els.chart.setAttribute("hidden", "");
      else els.chart.removeAttribute("hidden");
    }
    setYZoomVisible(!show);
    const cta = els.chartPlaceholder
      ? els.chartPlaceholder.querySelector(".chart-placeholder-cta")
      : null;
    if (cta && show) {
      cta.textContent = "▶️ Press Analyze";
    }
  }

  function showIdleChart(message) {
    clearSvg(els.chart);
    if (els.stats) els.stats.innerHTML = "";
    if (els.statsPublic) els.statsPublic.innerHTML = "";
    syncVehiclesNote([]);
    players = [];
    lastAnalyzedNames = [];
    lastLoadedNames = [];
    resetYZoom({ redraw: false });
    setPlaceholderVisible(true);
    const cta = els.chartPlaceholder
      ? els.chartPlaceholder.querySelector(".chart-placeholder-cta")
      : null;
    if (cta) cta.textContent = message || "▶️ Press Analyze";
  }

  function clearChartUi() {
    showIdleChart("▶️ Press Analyze");
    // Drop any bottom padding scrollToResults() added for short result pages.
    if (typeof document !== "undefined" && document.body) document.body.style.paddingBottom = "";
  }

  function findLoadedPlayer(name) {
    const slug = slugKey(name);
    return players.find((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name));
  }

  async function analyzeNames(names, { forceFresh = false, quiet = false } = {}) {
    if (fetching) return;
    const userRun = !quiet && recentGesture(); // t402u: no sounds for auto-restores
    const clean = names.map((n) => String(n).trim()).filter(Boolean);
    if (!clean.length) {
      clearChartUi();
      setStatus('<span class="err">Enter at least one character name (spaces or commas).</span>', "err");
      return;
    }

    const fresh = forceFresh || !!(els.fetchFresh && els.fetchFresh.checked);
    const sameSet =
      players.length > 0 &&
      lastAnalyzedNames.length > 0 &&
      namesSetKey(clean) === namesSetKey(lastAnalyzedNames);

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
        isFailed: (n) => !!getNameFailure(n),
      })
    ) {
      if (quiet) return;
      collapseSharedCache();
      // Re-render chips so force-collapsed state sticks if a render follows
      renderCacheChips();
      showGraphReadyHint();
      scrollToResults();
      return;
    }

    if (!quiet) collapseSharedCache();
    // Every Analyze retries previously failed names: back to pending.
    if (clearNameFailures(clean)) {
      renderNameTokens();
      renderCacheChips();
    }
    clearGraphReadyHint();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const run = {
      controller: controller || { abort() { this.signal.aborted = true; }, signal: { aborted: false } },
      signal: null,
      fresh,
    };
    run.signal = run.controller.signal;
    activeRun = run;
    const signal = run.signal;
    /** True once this run was cancelled (or superseded) — stop touching UI. */
    const cancelled = () => signal.aborted || activeRun !== run;
    setFetching(true);
    if (!quiet) {
      setProgress(true, {
        title: "Analyzing…",
        done: 0,
        total: clean.length,
      });
      setStatus(`Analyzing ${clean.length} player${clean.length > 1 ? "s" : ""}…`);
    }

    // ETA plan: which names will need a live Census fetch (vs cached / in memory).
    const etaPlan = clean.map((n) => fresh || !isNameFetched(n));
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
            p = await loadOne(name, { fresh, run });
          } catch (e) {
            // Never lose a player that is already graphed: keep that copy.
            if (existing && !isAbortError(e) && !cancelled()) return { ...existing, cacheFallback: "kept" };
            throw e;
          }
          if (cancelled()) throw makeAbortError();
          // Only fully loaded live players reach the cache (failures, partial
          // results and cached fallbacks never do).
          if (!p.partialSkipped && !p.cacheFallback) cachePut(name, p);
          if (!quiet) setStatus(
            `Loaded <strong>${escapeHtml(p.display)}</strong> ` +
            `<span class="src">via ${escapeHtml(sourceLabel(p.source))}</span>…`
          );
          return p;
        },
        {
          isCancelled: cancelled,
          onStart: (name, idx, total) => {
            if (quiet) return;
            setProgress(true, { title: "Analyzing…", done: idx, total, name, plan: etaPlan });
          },
          // Success or failure, the name counts as done so the bar/ETA advance.
          onDone: (name, idx, total) => {
            if (cancelled() || quiet) return;
            setProgress(true, {
              title: idx + 1 >= total ? "Finishing…" : "Analyzing…",
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
      if (activeRun === run) {
        activeRun = null;
        setFetching(false);
        setProgress(false);
      }
    }

    // Cancelled: keep previous graph as-is; lastAnalyzedNames unchanged.
    if (result.cancelled || signal.aborted) return;

    // t351u: chips removed while this run was loading must not come back.
    const nowKeys = new Set(currentNamesInField().map(slugKey));
    const keepNow = (x) => nowKeys.has(slugKey(x.name));
    result.loaded = result.loaded.filter(keepNow);
    result.failed = result.failed.filter(keepNow);
    const cleanNow = clean.filter((n) => nowKeys.has(slugKey(n)));

    for (const ok of result.loaded) failedNames.delete(slugKey(ok.name));
    for (const f of result.failed) {
      const key = slugKey(f.name);
      if (key) failedNames.set(key, { name: f.name, kind: f.kind, reason: f.reason });
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
      const hadGraph = players.length > 0;
      if (!hadGraph) clearChartUi();
      renderNameTokens();
      renderCacheChips();
      setStatus(
        skippedWarningHtml(summary, {
          extra: hadGraph ? "Previous graph kept." : "",
          fresh,
        }),
        "warn skipped all-failed"
      );
      if (userRun) sfx("fail", { force: true });
      return;
    }

    const successNames = result.loaded.map((x) => x.name);
    players = result.loaded.map((x) => x.player);
    // Attempted set (incl. skipped names) so a repeat press shows the
    // "graph is ready" hint instead of refetching the same bad name.
    // t328u: a different set of graphed players (one added / removed) → back to
    // Auto zoom so the axes refit; same set (Fetch fresh re-run) keeps manual zoom.
    if (namesSetKey(successNames) !== namesSetKey(lastLoadedNames)) resetYZoom({ redraw: false });
    lastAnalyzedNames = cleanNow.slice();
    lastLoadedNames = successNames.slice();
    lastPlayerByKey = new Map(result.loaded.map((x) => [slugKey(x.name), x.player]));
    drawChart(players);
    setTimeout(loadRankings, 300); // t356u: Rankings after the graph
    // Recent / share link only ever carry names that actually loaded.
    saveLastComparison(successNames);
    syncUrlNames(successNames); // refresh re-opens exactly this comparison
    renderNameTokens();
    renderCacheChips();
    // 🎥 live.html batches its own /add calls (live.mjs, #33); the graph re-runs don't post.
    if (!isLiveMode()) suggestSharedCache(result.loaded); // fire-and-forget, never awaited
    markRequested(result.loaded); // fire-and-forget: analyzed cached players get extra XP detail
    if (fresh) markFresh(result.loaded); // fire-and-forget: shared copy catches up (names only)

    const notes = censusNotesHtml(result.loaded);
    if (summary) {
      setStatus(skippedWarningHtml(summary, { fresh }) + notes, "warn skipped");
    } else {
      setStatus(notes, notes ? "warn census-note" : "");
    }
    if (userRun) {
      if (summary) sfx("fail", { force: true });
      else sfx(fresh ? "fresh" : "chime", { force: true });
    }
    // Results are in: glide the input/header up out of view.
    if (!quiet && location.hash === "#rankings" && !userMovedPage) {
      const sec = document.getElementById("rankings");
      if (sec) requestAnimationFrame(() => sec.scrollIntoView({ block: "start" }));
    } else if (!quiet) scrollToResults();
    // Chips added while loading: bring them in too (cached → no button press).
    scheduleGraphSync();
  }

  /** The player graphed last run for this typed name (slug match, tag-insensitive). */
  function graphedPlayerFor(name) {
    if (!players.length) return null;
    const key = slugKey(name);
    return (key && lastPlayerByKey.get(key)) || findLoadedPlayer(name) || null;
  }

  /** Chip change → keep graph / tables / URL / Rankings in step (t351u). */
  let graphSyncStart = false;
  function scheduleGraphSync({ start = false } = {}) {
    clearTimeout(graphSyncTimer);
    graphSyncStart = graphSyncStart || start;
    graphSyncTimer = setTimeout(() => {
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
    if (fetching || activeRun || (!players.length && !start)) return;
    const names = nameTokens.slice();
    if (!names.length) {
      clearChartUi();
      syncUrlNames([]);
      forgetLastComparison();
      return;
    }
    if (namesSetKey(names) === namesSetKey(lastLoadedNames) && names.every((n) => graphedPlayerFor(n))) return;
    const have = names.map((n) => graphedPlayerFor(n));
    if (have.every(Boolean)) {
      const keys = names.map(slugKey);
      if (namesSetKey(names) !== namesSetKey(lastLoadedNames)) resetYZoom({ redraw: false });
      players = have;
      lastAnalyzedNames = names.slice();
      lastLoadedNames = names.slice();
      lastPlayerByKey = new Map(keys.map((k, i) => [k, have[i]]));
      drawChart(players);
      saveLastComparison(names);
      syncUrlNames(names);
      renderNameTokens();
      renderCacheChips();
      clearGraphReadyHint();
      return;
    }
    const missing = names.filter((n, i) => !have[i]);
    if (missing.every((n) => !getNameFailure(n) && (findSharedEntry(n) || cacheGet(n)))) {
      analyzeNames(names, { quiet: true });
    }
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
        const statusMsg = els.status && els.status.textContent.trim();
        const target = statusMsg ? els.status : els.stats;
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

  /**
   * Fire-and-forget: ask the Worker to add names that did NOT come from the
   * shared data/ cache. Never blocks the UI; failures are console-only.
   * @param {{name:string, player:object}[]} loaded  result.loaded from loadEach
   */
  function isLiveMode() {
    return typeof document !== "undefined" && !!document.body && document.body.classList.contains("live-mode");
  }

  function suggestSharedCache(loaded, { quiet = isLiveMode() } = {}) {
    if (!WORKER_URL || typeof fetch === "undefined") return;
    const names = [];
    for (const { name, player } of loaded || []) {
      const src = String((player && player.source) || "");
      if (src === "local" || src.startsWith("shared:") || src.startsWith("local:")) continue; // already shared
      if (findSharedEntry(name)) continue; // e.g. "Fetch fresh" on a shared name
      const bare = String((player && player.display) || name)
        .trim()
        .replace(/^\[[^\]]*\]\s*/, ""); // Worker also strips [TAG]
      const key = slugKey(bare);
      if (!key || sharedAddSent.has(key)) continue;
      sharedAddSent.add(key);
      names.push(bare);
    }
    if (!names.length) return;

    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: names.slice(0, 10) }),
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(8000);
    }
    fetch(`${WORKER_URL}/add`, opts)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.queued) && data.queued.length) {
          // 🎥 live.html: no note over the feed (#33), console only.
          if (quiet) console.info("[ps2-elite-kd] queued for the shared cache:", data.queued.join(", "));
          else showSharedAddNote(data.queued, data.etaMinutes);
        }
        // Not queued for a transient reason → allow a retry on a later Analyze.
        for (const n of [...(data.unverified || []), ...(data.error ? names : [])]) {
          sharedAddSent.delete(slugKey(n));
        }
      })
      .catch((e) => {
        for (const n of names) sharedAddSent.delete(slugKey(n));
        if (typeof console !== "undefined") {
          console.info("[ps2-elite-kd] shared-cache add skipped:", e && e.message);
        }
      });
  }

  /**
   * Fire-and-forget: tell the Worker which shared-cache players were analyzed
   * (names only), so the background refresh collects full Honu XP detail for
   * them. Deduped per browser (24 h) and silent; no UI.
   */
  const SEEN_TTL_MS = 24 * 3600 * 1000;
  const seenSent = new Set();
  function markRequested(loaded) {
    if (!WORKER_URL || typeof fetch === "undefined") return;
    const now = Date.now();
    const names = [];
    for (const { name, player } of loaded || []) {
      if (names.length >= 10) break; // Worker max per request
      if (!findSharedEntry(name)) continue; // uncached names go through /add
      const bare = String((player && player.display) || name).trim().replace(/^\[[^\]]*\]\s*/, "");
      const key = slugKey(bare);
      if (!key || seenSent.has(key)) continue;
      seenSent.add(key);
      try {
        const last = Number(localStorage.getItem(`ps2ekd:seen:${key}`) || 0);
        if (now - last < SEEN_TTL_MS) continue;
        localStorage.setItem(`ps2ekd:seen:${key}`, String(now));
      } catch {
        /* storage blocked: the in-memory set still dedupes this tab */
      }
      names.push(bare);
    }
    if (!names.length) return;
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: names.slice(0, 10) }),
      keepalive: true,
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000);
    fetch(`${WORKER_URL}/seen`, opts).catch(() => {});
  }

  /**
   * Fire-and-forget (t300u): after "Fetch fresh", tell the Worker which cached
   * players were just fetched live so the next background run refreshes their
   * shared file first. Names only (POST /seen with fresh:true); the browser's
   * data is never uploaded. Deduped per browser for FRESH_PING_GAP_MS.
   */
  const FRESH_PING_GAP_MS = 3600 * 1000;
  function markFresh(loaded) {
    if (!WORKER_URL || typeof fetch === "undefined") return;
    const now = Date.now();
    const names = [];
    for (const { name, player } of loaded || []) {
      if (names.length >= 10) break; // Worker max per request
      if (!String((player && player.source) || "").startsWith("live:")) continue; // cache fallback: nothing new
      if (!findSharedEntry(name)) continue; // uncached names go through /add
      const bare = String((player && player.display) || name).trim().replace(/^\[[^\]]*\]\s*/, "");
      const key = slugKey(bare);
      if (!key) continue;
      try {
        const last = Number(localStorage.getItem(`ps2ekd:fresh:${key}`) || 0);
        if (now - last < FRESH_PING_GAP_MS) continue;
        localStorage.setItem(`ps2ekd:fresh:${key}`, String(now));
      } catch {
        /* storage blocked: the Worker dedupes too */
      }
      names.push(bare);
    }
    if (!names.length) return;
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, fresh: true }),
      keepalive: true,
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000);
    fetch(`${WORKER_URL}/seen`, opts).catch(() => {});
  }

  /** Small, self-dismissing note under the status line. */
  function showSharedAddNote(queued, etaMinutes) {
    if (!els.status || !els.status.parentNode) return;
    let note = document.getElementById("shared-add-note");
    if (!note) {
      note = document.createElement("div");
      note.id = "shared-add-note";
      note.className = "shared-add-note";
      note.setAttribute("role", "status");
      els.status.parentNode.insertBefore(note, els.status.nextSibling);
    }
    const list = queued.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ");
    const eta = etaMinutes ? ` (~${Math.round(etaMinutes)} min)` : "";
    note.innerHTML = `📦 Adding ${list} to the shared cache — ready for everyone in a few minutes${eta}.`;
    note.hidden = false;
    clearTimeout(showSharedAddNote._t);
    showSharedAddNote._t = setTimeout(() => {
      note.hidden = true;
    }, 12000);
  }

  /** Amber status block for names that could not be fetched. */
  /** Friendly notes when Census was busy: cached copies served / opponents left out. */
  function censusNotesHtml(loaded) {
    const fb = loaded.filter((x) => x.player && x.player.cacheFallback === true).map((x) => x.player.display || x.name);
    const kept = loaded.filter((x) => x.player && x.player.cacheFallback === "kept").map((x) => x.player.display || x.name);
    const part = loaded.filter((x) => x.player && x.player.partialSkipped);
    const out = [];
    if (fb.length) {
      out.push(
        `<span class="warn">⚠️ Daybreak Census is busy or down — showing cached data for ` +
        `${fb.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ")}.</span> ` +
        `<button type="button" class="census-retry-btn">↻ Try live again</button>`
      );
    }
    if (kept.length) {
      out.push(
        `<span class="warn">⚠️ Couldn't refresh ` +
        `${kept.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ")} — kept the saved copy.</span>`
      );
    }
    for (const x of part) {
      out.push(
        `<span class="warn">⚠️ ${escapeHtml(x.player.display || x.name)}: ${x.player.partialSkipped} opponent(s) ` +
        `left out (Census busy).</span>`
      );
    }
    return out.length ? `<div class="census-note" role="status">${out.join("<br>")}</div>` : "";
  }

  function skippedWarningHtml(summary, { extra = "", fresh = false } = {}) {
    if (!summary) return "";
    const items = summary.items
      .map(
        (i) =>
          `<strong class="skipped-name">${escapeHtml(i.name)}</strong>` +
          ` <span class="skipped-reason">(${escapeHtml(i.reason)})</span>`
      )
      .join(", ");
    const tail = [summary.tail, extra].filter(Boolean).join(" ");
    const freshNote =
      fresh && summary.allFailed
        ? ` <span class="src">Fetch fresh was on — live Census only.</span>`
        : "";
    const retryBtn = summary.retryable ? ` <button type="button" class="census-retry-btn">↻ Try again</button>` : "";
    return (
      `<div class="skipped-warning" role="status">` +
      `<span class="warn">⚠️ ${escapeHtml(summary.lead)} ${items}.</span> ` +
      `<span class="skipped-tail">${escapeHtml(tail)}</span>${freshNote}${retryBtn}` +
      `</div>`
    );
  }

  function buildShareUrl(names) {
    const list = (names && names.length ? names : currentNamesInField());
    const param = list.map((n) => String(n).trim()).filter(Boolean).join(",");
    const url = new URL(window.location.href);
    if (param) url.searchParams.set("names", param);
    else url.searchParams.delete("names");
    return url.toString();
  }

  async function copyShareLink() {
    // Names that just failed to fetch never go into a share link.
    const inField = currentNamesInField();
    const names = inField.filter((n) => !getNameFailure(n));
    if (!names.length) {
      if (inField.length) {
        setStatus(
          '<span class="warn">Nothing to copy — none of these names could be fetched.</span>',
          "warn"
        );
        return;
      }
      setStatus('<span class="err">Nothing to copy — enter at least one name.</span>', "err");
      return;
    }
    const link = buildShareUrl(names);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      // Quiet success: brief ✓ on the square 🔗 button (same size), no link text in the status line.
      flashCopied();
    } catch (e) {
      setStatus(
        `<span class="warn">Could not copy automatically.</span> ` +
        `<span class="src">${escapeHtml(link)}</span>`,
        "warn"
      );
    }
  }

  let copiedFlashTimer = 0;
  function flashCopied() {
    sfx("sparkle"); // same dice-press sound: the copy landed
    const btn = els.copyLinkBtn;
    if (!btn) return;
    if (copiedFlashTimer) clearTimeout(copiedFlashTimer);
    btn.textContent = "✓";
    btn.classList.add("copied");
    btn.title = "Link copied";
    btn.setAttribute("aria-label", "Link copied");
    copiedFlashTimer = setTimeout(() => {
      copiedFlashTimer = 0;
      btn.textContent = "🔗";
      btn.classList.remove("copied");
      btn.title = "Copy link";
      btn.setAttribute("aria-label", "Copy link");
    }, 1200);
  }

  function namesFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("names");
      if (!raw) return null;
      const list = parseNames(raw);
      return list.length ? list : null;
    } catch {
      return null;
    }
  }

  function resolveStartupNames() {
    // ?names= (auto-runs) → saved field (no auto-run) → last comparison → empty.
    return resolveStartupSelection({
      urlNames: namesFromQuery(),
      pending: getPendingNames(),
      last: getLastComparison(),
      defaults: DEFAULT_NAMES,
    });
  }

  /* ---------- events ---------- */

  /** The 🔍 Analyze action (button, placeholder image, shared-link auto-run). */
  function runAnalyzeFromUi() {
    collapseSharedCache();
    const { rejected } = commitFragment({ clearInput: true });
    if (rejected.length) {
      // Field is full and extra text is waiting: warn instead of eating it or
      // showing "graph is ready".
      showLimitHint();
      return Promise.resolve();
    }
    let names = currentNamesInField();
    if (!names.length) {
      // Empty field → default to ShloDog and show it as a chip
      setNameTokens([DEFAULT_PLACEHOLDER_NAME]);
      names = [DEFAULT_PLACEHOLDER_NAME];
    }
    return analyzeNames(names);
  }

  // "↻ Try again" in Census busy/down messages: re-run with live data.
  if (els.status) {
    els.status.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest(".census-retry-btn") : null;
      if (!btn || fetching) return;
      const names = currentNamesInField();
      if (!names.length) return;
      clearNameFailures(names);
      renderNameTokens();
      analyzeNames(names, { forceFresh: !!btn.textContent.includes("live") });
    });
  }

  if (els.fetchFresh) els.fetchFresh.addEventListener("change", updateFreshEta);
  if (els.analyzeBtn) {
    els.analyzeBtn.addEventListener("click", () => {
      sfx("boop");
      runAnalyzeFromUi();
    });
  }

  /**
   * Shared link (?names=… in the URL): run Analyze once by itself so a friend
   * opening the link lands on the graph. Never for a localStorage-only restore,
   * never with "Fetch fresh", and never on top of a run the user already started
   * (analyzeNames' "graph is ready" check also stops a repeat of the same set).
   * More than 10 names → the first 10 run and the limit hint stays visible.
   */
  /** t379u: this load is a browser refresh / back-forward, not a newly opened link. */
  function isReloadNavigation() {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav) return nav.type === "reload" || nav.type === "back_forward";
      return performance.navigation && (performance.navigation.type === 1 || performance.navigation.type === 2);
    } catch {
      return false;
    }
  }

  /* t379u: keep the reading position across a refresh. The browser restores
   * it before the graph / Rankings are rebuilt (page still short), so we save
   * it on the way out and return to it once the page is tall enough again —
   * unless the person scrolls first. */
  const LS_SCROLL_Y = "ps2-elite-kd-scroll-y";
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      try { sessionStorage.setItem(LS_SCROLL_Y, String(Math.round(window.scrollY || 0))); } catch {}
    });
  }
  function restoreScrollAfterReload() {
    let want = 0;
    try { want = +sessionStorage.getItem(LS_SCROLL_Y) || 0; sessionStorage.removeItem(LS_SCROLL_Y); } catch {}
    if (want <= 0) return;
    let stop = false;
    const quit = () => { stop = true; };
    const evs = ["wheel", "touchstart", "keydown", "pointerdown"];
    evs.forEach((e) => window.addEventListener(e, quit, { once: true, passive: true }));
    const until = Date.now() + 6000;
    const step = () => {
      if (stop) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= want - 2) { window.scrollTo(0, want); evs.forEach((e) => window.removeEventListener(e, quit)); return; }
      if (Date.now() > until) { window.scrollTo(0, Math.max(0, max)); return; }
      requestAnimationFrame(step);
    };
    step();
  }

  async function autoRunFromLink(startup) {
    if (!startup || startup.reason !== "url" || !startup.names.length) return;
    if (fetching || activeRun || players.length) return;
    if (els.fetchFresh) { els.fetchFresh.checked = false; updateFreshEta(); }
    const overLimit = startup.names.length > MAX_NAMES;
    // t379u: a refresh just puts the same graph back — quietly (no "Analyzing…"
    // pop-up, no jump to the results; the browser keeps your scroll position).
    // Only when every name is saved (shared file / this browser); a name that
    // needs a live Census fetch still gets the normal run with its progress.
    const names = currentNamesInField();
    if (isReloadNavigation() && names.length && names.every((n) => !getNameFailure(n) && (findSharedEntry(n) || cacheGet(n)))) {
      const cta = els.chartPlaceholder ? els.chartPlaceholder.querySelector(".chart-placeholder-cta") : null;
      if (cta) cta.textContent = "⏳ Loading…";
      try {
        await analyzeNames(names, { quiet: true });
      } finally {
        if (cta && !players.length) cta.textContent = "▶️ Press Analyze";
      }
      restoreScrollAfterReload();
      return;
    }
    await runAnalyzeFromUi();
    if (overLimit && els.status && !String(els.status.textContent || "").trim()) showLimitHint();
  }

  // Placeholder image (before any analysis): its centre button — and a click
  // anywhere on the image — acts as a second 🔍 Analyze (same handler, so the
  // empty → ShloDog default, limit hint, scroll etc. all apply). People kept
  // clicking the image expecting it to work.
  function analyzeFromPlaceholder(e) {
    if (e) e.preventDefault();
    if (fetching || !els.analyzeBtn || els.analyzeBtn.disabled) return;
    els.analyzeBtn.click();
  }
  if (els.chartPlaceholder) {
    els.chartPlaceholder.addEventListener("click", analyzeFromPlaceholder);
  }

  if (els.namesInput) {
    // Name suggestions after 4 characters (cached players + Census, most recently active first).
    mountNameSuggest({
      input: els.namesInput,
      anchor: document.getElementById("namesBox") || els.namesInput.parentElement,
      censusBase: CENSUS,
      currentNames: () => nameTokens.slice(),
    });
    els.namesInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const { rejected } = commitFragment({ clearInput: true });
        if (rejected.length) return; // limit hint shown, typed text kept
        if (!fetching && els.analyzeBtn) els.analyzeBtn.click();
        return;
      }
      if (e.key === "Backspace" && !els.namesInput.value && nameTokens.length) {
        e.preventDefault();
        const popped = nameTokens.pop();
        clearNameFailures([popped]);
        renderNameTokens();
        renderCacheChips();
        scheduleGraphSync();
      }
    });

    els.namesInput.addEventListener("input", () => {
      clearGraphReadyHint();
      const val = els.namesInput.value;
      // Completed token(s) when text ends with a separator
      if (/[\s,;]$/.test(val)) {
        commitFragment({ clearInput: true });
      } else if (val.trim() && nameTokens.length >= MAX_NAMES) {
        // Typing an 11th name: say so right away (text is kept).
        showLimitHint();
      } else if (!val.trim()) {
        clearLimitHint();
      }
      syncNamesPlaceholder();
      // t343u: no rebuild per key — chip highlights / ETA / 🏆 link follow after a short pause.
      scheduleCacheSelection();
    });

    els.namesInput.addEventListener("blur", () => {
      // Do not auto-commit on blur — only separator / Analyze / Enter
      clearTimeout(cacheSelTimer);
      updateCacheSelection();
    });

    els.namesInput.addEventListener("paste", () => {
      // Bulk paste: lock every complete token parseNames finds (keeps [TAG] Name intact)
      requestAnimationFrame(() => {
        const val = els.namesInput.value;
        if (!/[,;\s]/.test(val)) {
          syncNamesPlaceholder();
          renderCacheChips();
          return;
        }
        commitFragment({ clearInput: true }); // overflow names stay in the field
        syncNamesPlaceholder();
        renderCacheChips();
      });
    });
  }

  if (els.namesBox) {
    els.namesBox.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("#clearNamesBtn, .clear-names")) return;
      const main = els.namesBox.querySelector(".names-box-main");
      if (
        e.target === els.namesBox ||
        e.target === els.nameTokensEl ||
        e.target === main ||
        (main && main.contains(e.target) && e.target.tagName !== "BUTTON")
      ) {
        if (els.namesInput) els.namesInput.focus();
      }
    });
  }

  if (els.progressCancel) {
    els.progressCancel.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelAnalyze();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (!activeRun || !els.progress || els.progress.hidden) return;
    e.preventDefault();
    cancelAnalyze();
  });

  if (els.copyLinkBtn) {
    els.diceBtn?.addEventListener("click", () => { if (!lockedClick(els.diceBtn)) rollDice("range"); });
    // t376u: warm the 🎲 data while the page is idle so the first roll is instant.
    {
      const idle = typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 4000 }) : (f) => setTimeout(f, 1500);
      idle(() => { loadRankVals(); });
    }
    els.diceLowBtn?.addEventListener("click", () => { if (!lockedClick(els.diceLowBtn)) rollDice("low"); });
    els.diceHighBtn?.addEventListener("click", () => { if (!lockedClick(els.diceHighBtn)) rollDice("high"); });
    els.copyLinkBtn.addEventListener("click", () => {
      commitFragment({ clearInput: true });
      copyShareLink();
    });
  }

  if (els.clearNamesBtn) {
    els.clearNamesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearNamesFromInput();
      clearChartUi();
      // Cleared means cleared: a refresh must not restore names from ?names= or
      // the saved last comparison.
      syncUrlNames([]);
      forgetLastComparison();
      persistPendingNames(); // saved field = [] (refresh after clear stays empty)
      setStatus("");
      if (els.namesInput) els.namesInput.focus();
    });
  }


  if (els.yZoomSlider) {
    const onZoomInput = () => {
      setYZoom(zoomFromSlider(els.yZoomSlider.value), { redraw: true });
    };
    els.yZoomSlider.addEventListener("input", onZoomInput);
    els.yZoomSlider.addEventListener("change", onZoomInput);
  }
  if (els.yZoomReset) {
    els.yZoomReset.addEventListener("click", () => resetYZoom({ redraw: true }));
  }
  syncYZoomUi();

  if (els.chartModeBar) {
    els.chartModeBar.addEventListener("click", (e) => {
      if (e.target.closest("[data-ghosts]")) {
        setGhostsOn(!ghostsOn);
        return;
      }
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      if (b.dataset.mode === "cumulative" && yScaleMode === "kd") {
        // Clicking Raw while 💀 is lit switches 💀 off and lights Raw.
        setYScaleMode("ivi");
        sfx("sparkle"); // same dice-press sound: K/D ⇄ iVi mode switch
        return;
      }
      if (b.dataset.mode !== chartMode) setChartMode(b.dataset.mode);
    });
  }
  syncChartModeUi();

  // Y-scale display switch: K/D / A (iVi-median) / B (iVi-start)
  function setYScaleMode(mode, pct) {
    yScaleMode = mode;
    if (pct !== undefined) yScalePct = pct;
    syncYScaleUi();
    syncChartModeUi();
    if (players.length) drawChart(players);
  }
  /* t383u: 👆 swipe sideways on the skill graph switches 💀 ⇄ 🎯 (two views,
   * so either direction flips). Touch, mouse drag, or a two-finger trackpad
   * swipe; vertical drags keep scrolling the page. Phones also get the short
   * "who wins fights / who aims best" tip for the view they landed on. */
  if (els.chart) {
    const flipView = (dir = 1) => {
      // t384u: the other view slides in, carousel-style (restored after d758c9e dropped it).
      const wrap = els.chart.closest(".chart-wrap");
      const panel = wrap ? getComputedStyle(wrap).backgroundColor : "";
      slideSwap({ container: wrap, svg: els.chart, dir, background: panel, draw: () => setYScaleMode(yScaleMode === "kd" ? "ivi" : "kd") });
      sfx("sparkle"); // same dice-press sound: K/D ⇄ iVi mode switch (swipe / keys)
      if (isTouchUi()) {
        const on = document.querySelector(yScaleMode === "kd" ? '[data-yscale="kd-btn"]' : '.chart-mode-btn[data-mode="cumulative"]');
        if (on && on.getAttribute("data-tip")) showHeadTip(on.getAttribute("data-tip"), on);
      }
    };
    // t386u: 👆 finger-following carousel: the current view moves with the
    // finger while the other view comes in from the edge (both visible
    // mid-drag); release past ¼ width or flick to finish, else spring back.
    const showViewTip = () => {
      if (!isTouchUi()) return;
      const on = document.querySelector(yScaleMode === "kd" ? '[data-yscale="kd-btn"]' : '.chart-mode-btn[data-mode="cumulative"]');
      if (on && on.getAttribute("data-tip")) showHeadTip(on.getAttribute("data-tip"), on);
    };
    let viewAtDragStart = yScaleMode;
    const chartWrap = els.chart.closest(".chart-wrap");
    if (chartWrap) {
      attachDragCarousel({
        target: els.chart,
        container: chartWrap,
        svg: () => els.chart,
        background: () => getComputedStyle(chartWrap).backgroundColor,
        canStart: () => players.length > 0 && !els.chart.hasAttribute("hidden"),
        onStart: () => { viewAtDragStart = yScaleMode; },
        show: () => { const want = viewAtDragStart === "kd" ? "ivi" : "kd"; if (yScaleMode !== want) setYScaleMode(want); },
        restore: () => { if (yScaleMode !== viewAtDragStart) setYScaleMode(viewAtDragStart); },
        onCommit: showViewTip,
      });
    }
    const wheelSw = createWheelSwiper();
    els.chart.addEventListener("wheel", (e) => {
      const dir = wheelSw.push(e.deltaX, e.deltaY);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault(); // not browser back / forward
      if (dir && players.length) flipView(dir);
    }, { passive: false });
    // ⌨️ Global ←/→: whichever graph holds the middle of the screen gets the
    // keys — 📊 steps to the next / previous metric, the skill graph flips
    // 💀 ⇄ 🎯 (same as swiping). The pills' own focused-key handler owns
    // arrows while a pill has focus; typing in any field is untouched, and
    // when neither graph is centred the keys keep scrolling the page.
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target;
      if (t && t.closest && t.closest("input, textarea, select, [contenteditable=true], #distPills")) return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const distSection = document.getElementById("distSection");
      const pick = pickGraphForKeys(
        chartWrap ? chartWrap.getBoundingClientRect() : null,
        document.getElementById("distChart")?.getBoundingClientRect() || null,
        window.innerHeight,
        { distOpen: !!distSection?.open, hasPlayers: players.length > 0 }
      );
      if (pick === "dist" && rankingsApi) {
        e.preventDefault();
        rankingsApi.stepDist(dir);
        sfx("sparkle");
      } else if (pick === "skill") {
        e.preventDefault();
        flipView(dir);
      }
    });
  }
  // t380u: phones have no hover — tapping 💀 / 📈 also shows what that view means.
  if (els.chartModeBar) {
    els.chartModeBar.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-tip]");
      if (b && isTouchUi()) showHeadTip(b.getAttribute("data-tip"), b);
    });
  }
  // 💀 button toggles K/D mode (in chartModeBar)
  const kdBtn = document.querySelector('[data-yscale="kd-btn"]');
  if (kdBtn) {
    kdBtn.addEventListener("click", () => {
      setYScaleMode(yScaleMode === "kd" ? "ivi" : "kd");
      sfx("sparkle"); // same dice-press sound: K/D ⇄ iVi mode switch
    });
  }
  // Slider input
  const ySlider = document.getElementById("yScaleSlider");
  const ySliderVal = document.getElementById("yScaleVal");
  if (ySlider) {
    ySlider.addEventListener("input", () => {
      stopWave();
      const v = parseFloat(ySlider.value);
      if (ySliderVal) ySliderVal.textContent = v >= 10 ? v.toFixed(0) + "%" : v.toFixed(1) + "%";
      setYScaleMode("ivi", v);
    });
  }
  // Wave animation: slider oscillates 0.1% <-> 98% on a sine (ease-in-out free).
  let waveOn = false;
  let waveT = 0;
  let waveRaf = 0;
  const WAVE_MIN = 0.2, WAVE_MAX = 98.8; // Dayset: 0.2-98.8 range
  const WAVE_MID = (WAVE_MIN + WAVE_MAX) / 2; // 50.05
  const WAVE_AMP = (WAVE_MAX - WAVE_MIN) / 2; // 49.95
  let waveLastDrawn = -1;
  let waveShape = "smooth"; // Dayset: fixed
  let waveSpeed = 2; // Dayset: fixed 2x
  const waveSortedCache = new WeakMap(); // player -> sorted pace-KD array
  // Waveform: phase 0..2π -> -1..1 with selected easing
  function waveForm(phase) {
    const cyc = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2); // 0..1
    if (waveShape === "linear") {
      // Triangle: constant speed, sharp turns
      return cyc < 0.5 ? (cyc * 4 - 1) : (3 - cyc * 4);
    }
    if (waveShape === "smooth") {
      // Smootherstep on triangle: longer dwells at ends, snappier middle
      const tri = cyc < 0.5 ? cyc * 2 : (1 - cyc) * 2; // 0..1..0
      const s = tri * tri * tri * (tri * (tri * 6 - 15) + 10); // smootherstep
      const sign = cyc < 0.5 ? 1 : -1;
      // map 0..1 to -1..1 with sign for direction
      return sign * (s * 2 - 1) * (cyc < 0.25 || cyc >= 0.75 ? 1 : 1);
    }
    return Math.sin(phase); // sine: natural ease-in-out
  }
  // Smooth variant: use sine of eased phase for extra dwell
  function waveFormSmooth(phase) {
    const cyc = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    // ease the phase itself with smootherstep on each half
    const half = cyc < 0.5 ? cyc * 2 : (cyc - 0.5) * 2; // 0..1 per half
    const e = half * half * half * (half * (half * 6 - 15) + 10);
    const ePhase = (cyc < 0.5 ? e * 0.5 : 0.5 + e * 0.5) * Math.PI * 2;
    return Math.sin(ePhase);
  }
  // Time-based: one full cycle every WAVE_PERIOD_MS whatever the screen's
  // refresh rate (the old per-frame step ran 2x faster at 120 Hz than at 60 Hz
  // and stuttered on any dropped frame). 1250 ms ≈ the speed it ran at
  // before (~125 drawn frames a second).
  const WAVE_PERIOD_MS = 1250;
  const WAVE_RAD_PER_MS = (Math.PI * 2) / WAVE_PERIOD_MS;
  // Draw at most ~this many frames a second, on an even divisor of the
  // screen's refresh (360 Hz → every 3rd frame, 240 → every 2nd, 144 → every
  // one), so the cadence stays even. 0 = draw every frame.
  const WAVE_MAX_FPS = 120;
  let waveLastTs = 0;
  let waveFrameNo = 0;
  let waveDtAvg = 0; // smoothed frame interval (ms) → refresh rate estimate
  // Pause while the chart is scrolled out of view (no point drawing it).
  let chartOnScreen = true;
  if (typeof IntersectionObserver === "function" && els.chart) {
    new IntersectionObserver((entries) => {
      for (const e of entries) chartOnScreen = e.isIntersecting;
    }).observe(els.chart);
  }
  function waveTick(ts) {
    if (!waveOn) return;
    waveRaf = requestAnimationFrame(waveTick);
    if (!chartOnScreen || typeof ts !== "number") {
      waveLastTs = 0;
      return;
    }
    // Cap the step after a long pause (tab switch, GC) so it resumes, not jumps.
    const dt = waveLastTs ? Math.min(50, ts - waveLastTs) : 0;
    waveLastTs = ts;
    waveT += dt * WAVE_RAD_PER_MS;
    if (WAVE_MAX_FPS > 0 && dt > 0) {
      waveDtAvg = waveDtAvg ? waveDtAvg * 0.9 + dt * 0.1 : dt;
      const skip = Math.max(1, Math.floor(1000 / waveDtAvg / WAVE_MAX_FPS + 0.15));
      if (++waveFrameNo % skip !== 0) return;
    }
    let w = waveShape === "smooth" ? waveFormSmooth(waveT) : waveForm(waveT);
    // Snappier reversals: sharpen peaks so less time lingers at 0%/100%
    w = Math.sign(w) * Math.pow(Math.abs(w), 0.2); // Dayset: aggressive snap
    const pct = WAVE_MID + WAVE_AMP * w;
    yScalePct = Math.max(WAVE_MIN, Math.min(WAVE_MAX, pct));
    if (ySlider) ySlider.value = yScalePct;
    if (Math.abs(yScalePct - waveLastDrawn) >= 0.02) {
      waveLastDrawn = yScalePct;
      if (ySliderVal) ySliderVal.textContent = yScalePct >= 10 ? yScalePct.toFixed(0) + "%" : yScalePct.toFixed(1) + "%";
      if (yScaleMode !== "ivi") {
        yScaleMode = "ivi";
        syncYScaleUi();
      }
      // Wave frame: moves the existing chart elements only (no table/legend rebuild).
      if (players.length) drawChart(players, { waveFrame: true });
    }
  }
  /** Wave flicker warning while waving: names the lowest and highest public iVi
   *  players; hidden again as soon as the spread is no longer extreme. */
  function updateWaveRangeWarn(list) {
    const warnEl = document.getElementById("waveRangeWarn");
    if (!warnEl) return;
    let show = false;
    const withIvi = (list || []).filter((p) => isFiniteNum(p.ivi) && p.ivi > 0);
    if (waveOn && withIvi.length >= 2) {
      let lo = withIvi[0], hi = withIvi[0];
      for (const p of withIvi) {
        if (p.ivi < lo.ivi) lo = p;
        if (p.ivi > hi.ivi) hi = p;
      }
      if (hi.ivi / lo.ivi > 4) {
        const nameOf = (p) => escapeHtml(p.display || p.name || "?");
        warnEl.innerHTML =
          `⚠️ Wave flickers: iVi ranges from ${Math.round(lo.ivi)} (${nameOf(lo)}) ` +
          `to ${Math.round(hi.ivi)} (${nameOf(hi)})`;
        show = true;
      }
    }
    warnEl.hidden = !show;
  }
  function startWave() {
    if (waveOn) return;
    waveOn = true;
    // Ghost off while wave is on (Dayset 2026-10-13)
    if (ghostsOn) setGhostsOn(false, { redraw: false });
    updateWaveRangeWarn(players);
    // start phase from current slider so there's no jump
    const frac = (yScalePct - WAVE_MID) / WAVE_AMP;
    waveT = Math.asin(Math.max(-1, Math.min(1, frac)));
    const wb = document.getElementById("yWaveBtn");
    if (wb) { wb.textContent = "⏸️"; wb.classList.add("active"); }
    // Disable ghost button while wave runs
    const gb = document.querySelector("[data-ghosts]");
    if (gb) gb.disabled = true;
    waveLastTs = 0;
    waveFrameNo = 0;
    waveDtAvg = 0;
    waveRaf = requestAnimationFrame(waveTick);
  }
  function stopWave() {
    if (!waveOn) return;
    waveOn = false;
    cancelAnimationFrame(waveRaf);
    const warnEl = document.getElementById("waveRangeWarn");
    if (warnEl) warnEl.hidden = true;
    const wb = document.getElementById("yWaveBtn");
    if (wb) { wb.textContent = "🌊"; wb.classList.remove("active"); }
    const gb = document.querySelector("[data-ghosts]");
    if (gb) gb.disabled = false;
  }
  const waveBtn = document.getElementById("yWaveBtn");
  if (waveBtn) {
    waveBtn.addEventListener("click", () => (waveOn ? stopWave() : startWave()));
  }

  syncYScaleUi();

  mountSfxToggle(document.getElementById("sfxToggle"));
  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", () => toggleTheme());
  }
  if (els.bgToggleBtn) {
    els.bgToggleBtn.addEventListener("click", () => toggleBgImage());
  }
  // 🎥 Live: main page → live.html with the first name; live.html → back.
  if (els.liveBtn) {
    els.liveBtn.addEventListener("click", () => {
      if (LIVE_MODE) {
        const t = currentNamesInField()[0];
        window.location.href = "./" + (t ? `?names=${encodeURIComponent(t)}` : "");
        return;
      }
      commitFragment({ clearInput: true });
      const first = currentNamesInField()[0];
      if (!first) {
        setStatus('<span class="err">🎥 Live needs a name: add one first.</span>', "err");
        return;
      }
      window.location.href = `live.html?names=${encodeURIComponent(first)}`;
    });
  }
  if (els.wipeLocalBtn) {
    els.wipeLocalBtn.addEventListener("click", () => wipeAllLocalAppData());
  }

  // Expose tiny helpers for sanity checks in console / node --check stays syntax-only
  if (typeof window !== "undefined") {
    window.__ps2EliteKd = {
      parseNames,
      namesSetKey,
      CACHE_TTL_MS,
      rfIf,
      adjustedIvi,
      sliceAt,
      combatOutput,
      projectedMech,
      curveSlope,
      slope2575,
      pressureVolume,
      resolveIvi,
      deathMixLite,
      yScale,
      applyYZoom,
      clampYZoom,
      Y_ZOOM_DEFAULT,
      getYZoom: () => yZoom,
      getChartScale: () => (lastChartScale ? { ...lastChartScale } : null),
      getChartMode: () => chartMode,
      setChartMode,
      getGhostsOn: () => ghostsOn,
      setGhostsOn,
      setYZoom,
      INFLATION_KPM,
      RF_SOFT,
      SLOPE_FLOOR,
      SLOPE_EPS,
      LS_CACHE,
      LS_THEME,
      LS_FETCHING,
      wipeAllLocalAppData,
      getStoredTheme,
      applyTheme,
      SHARED_INDEX_URL,
      getSharedIndex: () => sharedIndex,
      findSharedEntry,
      currentNamesInField,
      isNameFetched,
      getNameTokens: () => nameTokens.slice(),
      cancelAnalyze,
      isAnalyzing: () => !!activeRun,
      // 🎥 Live (#32): full Census fetch of one opponent in the background — no progress
      // modal, no chips; waits while an Analyze run is active; keeps a browser copy.
      // 🎥 Live (#33): queue background-fetched opponents for the shared cache, no note.
      queueSharedCache: (loaded) => suggestSharedCache(loaded, { quiet: true }),
      fetchPlayerBg: async (name) => {
        while (activeRun) await new Promise((r) => setTimeout(r, 1000));
        const p = await loadOne(name);
        if (p && String(p.source || "").startsWith("live:")) cachePut(name, p);
        return p;
      },
      getLastAnalyzedNames: () => lastAnalyzedNames.slice(),
      getFailedNames: () => [...failedNames.values()].map((f) => ({ ...f })),
      getPlayerNames: () => players.map((p) => p.display),
      setNameTokens,
      analyzeNames,
      LIVE_MODE,
    };
  }

  // Startup — fill chips only; wait for Analyze (Enter still works)
  // Never persist / restore "Fetch fresh"; always start clean on load/refresh.
  (async () => {
    applyTheme(getStoredTheme(), { redraw: false });
    applyBgImage(getStoredBgImage());
    if (els.fetchFresh) { els.fetchFresh.checked = false; updateFreshEta(); }
    await loadSharedIndex();
    const startup = resolveStartupNames();
    setNameTokens(startup.names); // >6 from ?names= → first 6 + limit hint
    renderCacheChips();
    showIdleChart("▶️ Press Analyze");
    scheduleRankingsLoad(); // t356u: Rankings below load lazily
    // No idle "Ready — press Analyze" line; the status area only shows progress / errors
    // (and the limit hint if ?names= had more than 10).
    // Opened from a shared 🔗 link → draw the graph without a click.
    try {
      await autoRunFromLink(startup);
    } finally {
      // Refresh after analyzing + picking more names: the URL re-draws the
      // analyzed graph, then the field gets the unsaved picks back.
      if (startup.restoreAfter) setNameTokens(startup.restoreAfter);
      persistNamesOn = true;
      persistPendingNames();
      // After the startup lock sync (FIFO): only user edits auto-start Analyze.
      queueMicrotask(() => { limitLockReady = true; });
    }
  })();
