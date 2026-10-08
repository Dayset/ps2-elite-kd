/**
 * PlanetSide 2 elite K/D comparison chart (vanilla JS + SVG).
 * Mirrors absolute_target_split / kpm_curve / rf_if / adjusted_ivi from ps2_elite_kd.py
 * Pure math lives in math.mjs (shared with Node tests).
 */
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
} from "./math.mjs?v=20261007-infl";
import {
  NameLoadError,
  classifyLoadError,
  failureReason,
  censusQueryName,
  loadEach,
  summarizeFailures,
  compareByCharName,
  groupByCharName,
  shouldShowGraphReady,
  forgetFailures,
  honuProfileUrl,
  columnRef,
  pctFromRef,
  fmtPctFromRef,
  pctTitle,
} from "./analyze-run.mjs?v=20261007-infl";
import {
  normalizePlayer as normalizePlayerShared,
  playerMetrics,
} from "./player-metrics.mjs?v=20261007-infl";
// Full-name popup for truncated .nm names (tap / long-press on touch); installs itself.
import "./name-peek.mjs?v=20261007-infl";

  const COLORS = [
    "#9fd4ee", "#ff7a7a", "#ffd166", "#8ef0b0", "#e8b0ff",
    "#ffb07a", "#7ef0e6", "#ffa0c8", "#c6f06a", "#8cbcff",
  ];
  /**
   * Light theme: same hues, darker/more saturated so lines and names reach
   * ≥4.5:1 contrast on the cream panel (#e8e1d4) and page (#f0ebe3).
   * Generated from COLORS by HSL lightness reduction (saturation ≥ 0.75).
   */
  const LIGHT_COLORS = [
    "#156b95", "#cc0000", "#855d00", "#0f7332", "#9f00e0",
    "#ab4500", "#0d7067", "#c70054", "#4e6d0b", "#005cdb",
  ];
  function isLightTheme() {
    return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  }
  /** Series colour for player i in the current theme (graph, legend, table names). */
  function seriesColor(i) {
    const pal = isLightTheme() ? LIGHT_COLORS : COLORS;
    return pal[i % pal.length];
  }
  const HONU = "https://wt.honu.pw/api/character/";
  const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
  const DOT_R = 3;

  const LS_CACHE = "ps2-elite-kd-cache-v2";
  const LS_CACHE_OLD = "ps2-elite-kd-cache-v1";
  const LS_RECENT = "ps2-elite-kd-recent";
  const LS_LAST = "ps2-elite-kd-last";
  const LS_THEME = "ps2-elite-kd-theme";
  /** "1" = show older debug columns in the Adjusted table (footer checkbox). */
  const LS_DEBUG_COLS = "ps2-elite-kd-debug-cols";
  /** Cross-tab live-fetch flag (browser-local). */
  const LS_FETCHING = "ps2-elite-kd:fetching";
  const FETCHING_TTL_MS = 3 * 60 * 1000; // 3 min stale expiry
  const FETCHING_HEARTBEAT_MS = 30 * 1000;
  /** Shared Actions under-load flag on Pages (data/load-flag.json). */
  const SERVER_LOAD_FLAG_URL = "data/load-flag.json";
  const SERVER_LOAD_FLAG_TTL_MS = 20 * 60 * 1000; // 20 min freshness
  const SERVER_LOAD_FLAG_POLL_MS = 30 * 1000;
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const TAB_ID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  const VB = { w: 1000, h: 580 };
  const M = { t: 20, r: 56, b: 72, l: 56 };
  const PLOT = {
    x: M.l,
    y: M.t,
    w: VB.w - M.l - M.r,
    h: VB.h - M.t - M.b,
  };

  const els = {
    themeToggle: document.getElementById("themeToggle"),
    wipeLocalBtn: document.getElementById("wipeLocalBtn"),
    namesBox: document.getElementById("namesBox"),
    nameTokensEl: document.getElementById("nameTokens"),
    namesInput: document.getElementById("namesInput") || document.getElementById("names"),
    analyzeBtn: document.getElementById("analyzeBtn") || document.getElementById("loadBtn"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    clearNamesBtn: document.getElementById("clearNamesBtn"),
    fetchFresh: document.getElementById("fetchFresh"),
    cacheChips: document.getElementById("cacheChips") || document.getElementById("recentChips"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    progressTitle: document.getElementById("progressTitle"),
    progressText: document.getElementById("progressText"),
    progressBar: document.getElementById("progressBar"),
    progressPct: document.getElementById("progressPct"),
    progressTiming: document.getElementById("progressTiming"),
    underLoadNote: document.getElementById("underLoadNote"),
    underLoadInModal: document.getElementById("underLoadInModal"),
    progressCancel: document.getElementById("progressCancel"),
    chart: document.getElementById("chart"),
    chartPlaceholder: document.getElementById("chartPlaceholder"),
    chartYZoom: document.getElementById("chartYZoom"),
    yZoomSlider: document.getElementById("yZoomSlider"),
    yZoomReset: document.getElementById("yZoomReset"),
    stats: document.getElementById("statsPanel"),
    legend: document.getElementById("legend"),
    debugColsToggle: document.getElementById("debugColsToggle"),
  };

  let players = [];
  let lastAnalyzedNames = [];
  /** Subset of lastAnalyzedNames that actually loaded (graphed) last run. */
  let lastLoadedNames = [];
  /** Preferred open state for shared-cache <details> (collapsed by default). */
  let sharedCacheWantOpen = false;
  /** Timer for graph-ready hint auto-dismiss. */
  let graphReadyHintTimer = 0;
  /** Y-axis zoom factor; 1 = auto-fit current data (default). */
  let yZoom = Y_ZOOM_DEFAULT;
  let fetching = false;
  /**
   * Active analyze run: { controller, signal, live } or null.
   * `live` = how many beginLiveFetch() holds this run still owns.
   */
  let activeRun = null;
  /** Progress modal timing for ETA (names completed). */
  let progressStartedAt = 0;
  let progressDoneCount = 0;
  let progressTotalCount = 0;
  /** Frozen avg ms/name; updated only when done increases. */
  let progressAvgPerMs = 0;
  /** Absolute ETA deadline (ms epoch). Counts down each tick; never extended mid-run. */
  let progressEtaDeadline = 0;
  let progressTickTimer = null;
  /** Visual bar % (creeps forward for hope; snaps up on real done/total). */
  let progressDisplayPct = 0;
  /** Nested depth of in-flight live Honu/Census loads owned by this tab. */
  let liveFetchDepth = 0;
  let fetchHeartbeatTimer = null;
  let fetchExpireTimer = null;
  let serverLoadPollTimer = null;
  /** Last known Actions load-flag state (null = unknown / idle). */
  let serverLoadFlag = null;
  let fetchBroadcast = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      fetchBroadcast = new BroadcastChannel("ps2-elite-kd-fetch");
    }
  } catch {
    fetchBroadcast = null;
  }
  /** Locked name chips in the token input (order preserved). */
  let nameTokens = [];
  /** slug → { name, kind, reason } for names the last run(s) could not fetch. */
  const failedNames = new Map();
  /** Per-request timeouts so one hung Census/Honu call can't stall the run. */
  const CENSUS_TIMEOUT_MS = 20 * 1000;
  const HONU_BOARD_TIMEOUT_MS = 45 * 1000;
  const HONU_SIDE_TIMEOUT_MS = 45 * 1000;

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
  const MAX_NAMES = 10;
  const LIMIT_HINT_HTML = '<span class="warn">10 players limit reached</span>';

  /** Warn (status line) that the field is full; replaces any "graph is ready" hint. */
  function showLimitHint() {
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
   * Show "10 players limit reached" next to `anchor` (above it, or below when
   * there's no room), clamped to the viewport; bottom-centre if no anchor.
   * Auto-hides after 2.5 s, on tap, or on scroll; repeat calls restart it.
   */
  function showLimitToast(anchor) {
    if (typeof document === "undefined") return;
    if (!limitToastEl) {
      limitToastEl = document.createElement("div");
      limitToastEl.id = "limitToast";
      limitToastEl.className = "limit-toast";
      limitToastEl.setAttribute("role", "alert");
      limitToastEl.innerHTML =
        '<strong>10 players limit reached</strong><span class="limit-toast-sub">remove a name to add another</span>';
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

  function formatRemaining(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return `~${sec}s left`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s ? `~${m}m ${s}s left` : `~${m}m left`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `~${h}h ${rm}m left` : `~${h}h left`;
  }

  /**
   * Remaining from a frozen deadline. Always non-increasing between deadline updates.
   * @param {number} deadlineMs
   * @param {number} nowMs
   */
  function etaRemainingMs(deadlineMs, nowMs) {
    if (!(deadlineMs > 0)) return NaN;
    return Math.max(0, deadlineMs - nowMs);
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

  /** ~30s of random creep to fill the current name's slice (not the whole bar). */
  const PROGRESS_TICK_MS = 220;
  const FAKE_SEGMENT_MS = 30000; // one person's segment ≈ 30s of fake fill

  /**
   * Creep within the current done→done+1 slice over ~FAKE_SEGMENT_MS.
   * E.g. 2 names: 0–50% ~30s, then 50–100% ~30s. Snap on finish is in setProgress.
   */
  function creepProgressBar() {
    if (!progressStartedAt || progressDisplayPct >= 100) return;
    if (progressTotalCount <= 0) return;

    const floor = (progressDoneCount / progressTotalCount) * 100;
    const ceil = ((progressDoneCount + 1) / progressTotalCount) * 100;
    const segmentWidth = Math.max(0.0001, ceil - floor);

    // Average step so this slice alone fills in ~30s (not 0→100 in 30s).
    const ticksPerSegment = FAKE_SEGMENT_MS / PROGRESS_TICK_MS;
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
    if (progressTotalCount > 0 && progressDoneCount >= progressTotalCount) {
      remainStr = "Almost done…";
    } else if (progressEtaDeadline > 0 && left > 0) {
      const remain = etaRemainingMs(progressEtaDeadline, now);
      remainStr = remain > 0 ? formatRemaining(remain) : "~0s left";
    } else if (progressTotalCount > 0) {
      remainStr = "Estimating…";
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
      progressAvgPerMs = 0;
      progressEtaDeadline = 0;
      progressDisplayPct = 0;
      if (els.progressText) els.progressText.textContent = "";
      if (els.progressTitle) els.progressTitle.textContent = "Analyzing…";
      applyProgressBar(0);
      if (els.progressTiming) els.progressTiming.textContent = "";
      updateUnderLoadNotice();
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
      progressAvgPerMs = 0;
      progressEtaDeadline = 0;
      progressDisplayPct = 0; // always start the bar at zero
    }
    progressDoneCount = done;
    progressTotalCount = total;
    // Recalc avg when a name completes. Deadline = now + avg*left, but never extend
    // an existing deadline so the displayed remaining cannot climb mid-run.
    if (done > prevDone && done > 0) {
      progressAvgPerMs = (now - progressStartedAt) / done;
      const left = Math.max(0, total - done);
      if (left > 0 && progressAvgPerMs > 0) {
        const tentative = now + progressAvgPerMs * left;
        // Once set, deadline only moves earlier — remaining never climbs mid-run
        // (including after an overdue/~0s stretch).
        progressEtaDeadline =
          progressEtaDeadline > 0
            ? Math.min(progressEtaDeadline, tentative)
            : tentative;
      } else {
        progressEtaDeadline = now;
      }
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
    updateUnderLoadNotice();
  }

  function writeFetchFlag() {
    const payload = JSON.stringify({ owner: TAB_ID, ts: Date.now() });
    try {
      localStorage.setItem(LS_FETCHING, payload);
    } catch {
      /* private mode / quota */
    }
    if (fetchBroadcast) {
      try {
        fetchBroadcast.postMessage({ type: "fetching", owner: TAB_ID, ts: Date.now() });
      } catch {
        /* ignore */
      }
    }
  }

  function clearFetchFlagIfOwned() {
    try {
      const raw = localStorage.getItem(LS_FETCHING);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.owner !== TAB_ID) return;
      localStorage.removeItem(LS_FETCHING);
    } catch {
      try {
        localStorage.removeItem(LS_FETCHING);
      } catch {
        /* ignore */
      }
    }
    if (fetchBroadcast) {
      try {
        fetchBroadcast.postMessage({ type: "idle", owner: TAB_ID });
      } catch {
        /* ignore */
      }
    }
  }

  function readFetchFlag() {
    try {
      const raw = localStorage.getItem(LS_FETCHING);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.owner || typeof data.ts !== "number") return null;
      if (Date.now() - data.ts > FETCHING_TTL_MS) {
        try {
          localStorage.removeItem(LS_FETCHING);
        } catch {
          /* ignore */
        }
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function otherTabFetching() {
    const data = readFetchFlag();
    return !!(data && data.owner !== TAB_ID);
  }

  function serverSideFetching() {
    const f = serverLoadFlag;
    if (!f || !f.fetching) return false;
    const ts = typeof f.ts === "number" ? f.ts : 0;
    if (!ts || Date.now() - ts > SERVER_LOAD_FLAG_TTL_MS) return false;
    return true;
  }

  async function pollServerLoadFlag() {
    try {
      const url = `${SERVER_LOAD_FLAG_URL}?t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        serverLoadFlag = null;
      } else {
        const data = await res.json();
        serverLoadFlag =
          data && typeof data === "object"
            ? {
                fetching: !!data.fetching,
                ts: typeof data.ts === "number" ? data.ts : 0,
                source: data.source || "actions",
                runId: data.runId || null,
                message: data.message || null,
              }
            : null;
      }
    } catch {
      /* offline / blocked — keep last known */
    }
    updateUnderLoadNotice();
  }

  function startServerLoadFlagPolling() {
    if (serverLoadPollTimer) return;
    pollServerLoadFlag();
    serverLoadPollTimer = setInterval(pollServerLoadFlag, SERVER_LOAD_FLAG_POLL_MS);
  }

  function updateUnderLoadNotice() {
    const show = otherTabFetching() || serverSideFetching();
    const modalOpen = !!(els.progress && !els.progress.hidden);
    if (els.underLoadNote) {
      // Page banner only when modal is closed (other tab / Actions refresh).
      els.underLoadNote.hidden = !show || modalOpen;
    }
    if (els.underLoadInModal) {
      // Keep under-load visible inside the analyzing popup when applicable.
      els.underLoadInModal.hidden = !show || !modalOpen;
    }
    if (fetchExpireTimer) {
      clearTimeout(fetchExpireTimer);
      fetchExpireTimer = null;
    }
    const data = readFetchFlag();
    let nextMs = null;
    if (data) {
      nextMs = FETCHING_TTL_MS - (Date.now() - data.ts) + 100;
    }
    if (serverSideFetching() && serverLoadFlag && serverLoadFlag.ts) {
      const rem = SERVER_LOAD_FLAG_TTL_MS - (Date.now() - serverLoadFlag.ts) + 100;
      nextMs = nextMs == null ? rem : Math.min(nextMs, rem);
    }
    if (nextMs != null) {
      fetchExpireTimer = setTimeout(updateUnderLoadNotice, Math.max(1000, nextMs));
    }
  }

  function beginLiveFetch() {
    liveFetchDepth += 1;
    writeFetchFlag();
    if (liveFetchDepth === 1 && !fetchHeartbeatTimer) {
      fetchHeartbeatTimer = setInterval(() => {
        if (liveFetchDepth > 0) writeFetchFlag();
      }, FETCHING_HEARTBEAT_MS);
    }
    updateUnderLoadNotice();
  }

  function endLiveFetch() {
    liveFetchDepth = Math.max(0, liveFetchDepth - 1);
    if (liveFetchDepth === 0) {
      if (fetchHeartbeatTimer) {
        clearInterval(fetchHeartbeatTimer);
        fetchHeartbeatTimer = null;
      }
      clearFetchFlagIfOwned();
    }
    updateUnderLoadNotice();
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
        els.themeToggle.textContent = "🌙 Dark";
        els.themeToggle.title = "Switch to dark theme";
        els.themeToggle.setAttribute("aria-label", "Switch to dark theme");
      } else {
        els.themeToggle.textContent = "☀️ Light";
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

  /** Shared with status.html (player-metrics.mjs) so numbers always match. */
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
      rows: p.rows,
      curve: p.curve.map((pt) => ({
        kpm: pt.kpm,
        kd: isFiniteNum(pt.kd) ? pt.kd : null,
        kills: pt.kills,
        deaths: pt.deaths,
        n: pt.n,
      })),
      honu: p.honu,
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
    sharedIndexLoaded = true;
    return sharedIndex;
  }

  function findSharedEntry(name) {
    const key = slugKey(name);
    const lower = String(name || "").trim().toLowerCase();
    for (const p of sharedIndex.players || []) {
      if (!p) continue;
      if ((p.slug && p.slug === key) || slugKey(p.name) === key) return p;
      if (String(p.name || "").trim().toLowerCase() === lower) return p;
      const aliases = p.aliases || [];
      for (const a of aliases) {
        if (String(a).toLowerCase() === lower || slugKey(a) === key) return p;
      }
    }
    return null;
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
    store[key] = {
      name: String(name).trim(),
      savedAt: Date.now(),
      player: trimForCache(player),
    };
    pruneCache(store);
    writeJsonLS(LS_CACHE, store);
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
    writeJsonLS(LS_LAST, names.map((n) => String(n).trim()).filter(Boolean));
  }

  function getLastComparison() {
    const list = readJsonLS(LS_LAST, null);
    if (!Array.isArray(list) || !list.length) return null;
    return list.filter((s) => typeof s === "string" && s.trim());
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

    try {
      clearFetchFlagIfOwned();
    } catch {
      /* ignore */
    }
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
    if (els.fetchFresh) els.fetchFresh.checked = false;
    players = [];
    lastAnalyzedNames = [];
    lastLoadedNames = [];
    failedNames.clear();
    clearChartUi(); // idle chart + drops the auto-scroll bottom padding
    renderNameTokens();
    renderCacheChips();
    updateUnderLoadNotice();
    // Default theme after wipe (persists fresh dark preference)
    applyTheme("dark", { redraw: false });
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
   * Add one name as a chip. Returns false (and shows "10 players limit reached")
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
    return true;
  }

  /** Case-insensitive or slug-equal (ignores [TAG] / punctuation). */
  function namesMatch(a, b) {
    if (namesEqualIgnoreCase(a, b)) return true;
    const ka = slugKey(a);
    return !!ka && ka === slugKey(b);
  }

  /** Cache chip click: add if absent, remove (chip or trailing text) if present. */
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
  }

  /** Hide ShloDog placeholder whenever chips or typed text occupy the field. */
  function syncNamesPlaceholder() {
    if (!els.namesInput) return;
    const hasChips = nameTokens.length > 0;
    const hasTyped = String(els.namesInput.value || "").length > 0;
    els.namesInput.placeholder = hasChips || hasTyped ? "" : DEFAULT_PLACEHOLDER_NAME;
  }

  function renderNameTokens() {
    clearGraphReadyHint();
    if (nameTokens.length < MAX_NAMES) clearLimitHint();
    if (!els.nameTokensEl) return;
    els.nameTokensEl.innerHTML = "";
    nameTokens.forEach((name) => {
      const fail = getNameFailure(name);
      if (fail) {
        els.nameTokensEl.appendChild(makeFailedToken(name, fail));
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-token " + (isNameFetched(name) ? "fetched" : "unfetched");
      btn.appendChild(nameSpan(name, { title: false }));
      btn.setAttribute("aria-label", `Remove ${name}`);
      btn.title = `Remove ${name}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeNameToken(name);
      });
      els.nameTokensEl.appendChild(btn);
    });
    syncNamesPlaceholder();
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

  function renderCacheChips() {
    if (!els.cacheChips) return;
    const cached = listCachedNames();
    const inField = currentNamesInField();
    els.cacheChips.innerHTML = "";
    if (!cached.length) return;

    function sortAlpha(items) {
      // By character name only — a leading "[TAG] " doesn't affect order.
      return [...items].sort((a, b) => compareByCharName(a.name, b.name));
    }

    function makeChip(item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      if (item.source === "shared") btn.classList.add("shared");
      const selected = inField.some((n) => namesMatch(n, item.name));
      if (selected) btn.classList.add("active", "selected");
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
      btn.appendChild(nameSpan(item.name, { title: false }));
      const when = item.savedAt
        ? new Date(item.savedAt).toLocaleDateString()
        : "";
      const src = item.source === "shared" ? "Shared cache" : "Browser cache";
      btn.title = `${src}${when ? ` · ${when}` : ""} — ${selected ? "remove" : "add"} ${item.name}`;
      btn.addEventListener("click", () => toggleNameInField(item.name, btn));
      return btn;
    }

    const shared = cached.filter((c) => c.source === "shared");
    const browser = sortAlpha(cached.filter((c) => c.source !== "shared"));

    if (shared.length) {
      const details = document.createElement("details");
      details.className = "cache-shared";
      // Collapsed by default; preserve user open preference across re-renders
      // (e.g. chip click). Analyze forces closed via sharedCacheWantOpen = false.
      if (sharedCacheWantOpen) details.open = true;
      details.addEventListener("toggle", () => {
        sharedCacheWantOpen = details.open;
      });
      const summary = document.createElement("summary");
      summary.textContent = `📦 Shared cache (${shared.length})`;
      details.appendChild(summary);
      const inner = document.createElement("div");
      inner.className = "cache-shared-chips";
      inner.setAttribute("aria-label", "Shared cached character names");
      // Letter separators: [#] (digits/symbols) first, then [A], [B], …
      for (const group of groupByCharName(shared)) {
        const sep = document.createElement("span");
        sep.className = "chip-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = `[${group.letter}]`;
        inner.appendChild(sep);
        for (const item of group.items) inner.appendChild(makeChip(item));
      }
      details.appendChild(inner);
      els.cacheChips.appendChild(details);
    }

    if (browser.length) {
      const label = document.createElement("span");
      label.className = "fresh-hint";
      label.style.marginRight = "0.35rem";
      label.textContent = "💾 Browser:";
      els.cacheChips.appendChild(label);
      for (const item of browser) els.cacheChips.appendChild(makeChip(item));
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
        return normalizePlayer(data);
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
    return normalizePlayer({
      _source: "cache:localStorage",
      player: entry.player,
    });
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
    const data = await fetchJson(url, signal, { timeoutMs: CENSUS_TIMEOUT_MS });
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

  async function honuKillboard(cid, signal) {
    const board = await fetchJson(`${HONU}${cid}/killboard`, signal, {
      timeoutMs: HONU_BOARD_TIMEOUT_MS,
    });
    if (!Array.isArray(board)) {
      throw new NameLoadError(`Honu: unexpected killboard for ${cid}`, "bad-response");
    }
    if (!board.length) {
      throw new NameLoadError(`Honu: empty killboard for ${cid}`, "no-data");
    }
    return board;
  }

  async function honuMeta(cid, signal) {
    try {
      return await fetchJson(`${HONU}${cid}`, signal, { timeoutMs: HONU_SIDE_TIMEOUT_MS });
    } catch (e) {
      if (isAbortError(e)) throw e;
      return {};
    }
  }

  async function honuWeaponPace(cid, signal) {
    try {
      const stats = await fetchJson(`${HONU}${cid}/stats`, signal, {
        timeoutMs: HONU_SIDE_TIMEOUT_MS,
      });
      if (!Array.isArray(stats)) throw new Error("Honu: stats not a list");
      let wk = 0, wd = 0, wt = 0;
      let fire = 0, hitc = 0, hs = 0;
      for (const row of stats) {
        const n = row.statName;
        const v = +row.valueForever || 0;
        if (n === "weapon_kills") wk = v;
        else if (n === "weapon_deaths") wd = v;
        else if (n === "weapon_play_time") wt = v;
        else if (n === "weapon_fire_count") fire = v;
        else if (n === "weapon_hit_count") hitc = v;
        else if (n === "weapon_headshots") hs = v;
      }
      const kpm = wt ? wk / (wt / 60) : 0;
      const acc = fire ? (100 * hitc) / fire : 0;
      const hsr = wk ? (100 * hs) / wk : 0;
      const ivi = acc * hsr;
      return { wk, wd, kpm, acc, hsr, ivi };
    } catch (e) {
      if (isAbortError(e)) throw e;
      return { wk: 0, wd: 0, kpm: 0, acc: 0, hsr: 0, ivi: 0 };
    }
  }

  function hist(c, stat) {
    for (const row of ((c.stats || {}).stat_history) || []) {
      if (row.stat_name === stat) return +row.all_time || 0;
    }
    return 0;
  }

  /**
   * Live load. The under-load hold is tracked on `run` so a cancel can release
   * it immediately (releaseRunLiveHolds) without a late double-decrement here.
   */
  async function loadLive(name, run) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    beginLiveFetch();
    if (run) run.live += 1;
    try {
      return await loadLiveInner(name, signal);
    } finally {
      if (!run) {
        endLiveFetch();
      } else if (run.live > 0) {
        run.live -= 1;
        endLiveFetch();
      }
    }
  }

  async function loadLiveInner(name, signal) {
    const c = await resolveCensus(name, signal);
    const cid = c.character_id;
    const outfit = c.outfit || {};
    const gk = hist(c, "kills"), gd = hist(c, "deaths"), gt = hist(c, "time");
    const gkd = gd ? gk / gd : gk;
    const gkpm = gt ? gk / (gt / 60) : 0;
    const tag = outfit.alias ? `[${outfit.alias}] ` : "";
    const display = `${tag}${(c.name && c.name.first) || censusQueryName(name)}`;

    const own = await honuWeaponPace(cid, signal);
    const board = await honuKillboard(cid, signal);
    board.sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths));
    const sample = board.slice(0, 50);

    const rows = [];
    const concurrency = 4;
    let i = 0;
    async function worker() {
      while (i < sample.length) {
        checkAborted(signal); // stop pulling queued opponents after cancel
        const idx = i++;
        const pair = sample[idx];
        const oid = String(pair.otherCharacterID);
        const [meta, pace] = await Promise.all([
          honuMeta(oid, signal),
          honuWeaponPace(oid, signal),
        ]);
        const etag = meta.outfitTag ? `[${meta.outfitTag}] ` : "";
        rows[idx] = {
          name: etag + (meta.name || oid),
          kills: +pair.kills || 0,
          deaths: +pair.deaths || 0,
          kpm: pace.kpm || 0,
        };
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    checkAborted(signal);

    return normalizePlayer({
      _source: "live:honu",
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
        honu: `https://wt.honu.pw/c/${cid}/killboard`,
      },
    });
  }

  /**
   * Default: shared data/ → browser localStorage → live.
   * Fresh: live only (error if live fails).
   */
  async function loadOne(name, { fresh = false, run = null } = {}) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    if (fresh) {
      try {
        return await loadLive(name, run);
      } catch (e) {
        if (isAbortError(e)) throw e;
        throw new NameLoadError(
          `Live fetch failed for ${JSON.stringify(name)}: ${e.message}`,
          classifyLoadError(e)
        );
      }
    }
    const errors = [];
    try {
      return await loadLocal(name, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      errors.push(`shared: ${e.message}`);
    }
    checkAborted(signal);
    try {
      return loadFromCache(name);
    } catch (e) {
      errors.push(`cache: ${e.message}`);
    }
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

  function xToPx(x) {
    return PLOT.x + (x / X_MAX) * PLOT.w;
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

  function drawChart(list) {
    const svg = els.chart;
    clearSvg(svg);
    setPlaceholderVisible(false);
    svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Elite K/D vs Enemy KPM");

    const th = chartTheme();

    const bg = ns("rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", VB.w);
    bg.setAttribute("height", VB.h);
    bg.setAttribute("fill", th.bg);
    svg.appendChild(bg);

    const bands = [
      { x0: 0, x1: EASY_MAX, fill: "#6a8f6a", opacity: th.bandOpacity },
      { x0: EASY_MAX, x1: HARD_MIN, fill: "#8a8a6a", opacity: th.bandOpacity * 0.75 },
      { x0: HARD_MIN, x1: X_MAX, fill: "#8a6a6a", opacity: th.bandOpacity },
    ];
    for (const b of bands) {
      const r = ns("rect");
      r.setAttribute("x", xToPx(b.x0));
      r.setAttribute("y", PLOT.y);
      r.setAttribute("width", xToPx(b.x1) - xToPx(b.x0));
      r.setAttribute("height", PLOT.h);
      r.setAttribute("fill", b.fill);
      r.setAttribute("fill-opacity", b.opacity);
      svg.appendChild(r);
    }

    const yvals = [];
    for (const p of list) {
      for (const pt of p.curve || []) {
        if (pt.kpm <= X_MAX && isFiniteNum(pt.kd) && pt.deaths > 0) {
          yvals.push(pt.kd);
        }
      }
    }
    const autoScale = yScale(yvals);
    const scale = applyYZoom(autoScale, yZoom);
    const yToPx = makeYMapper(scale);

    const gGrid = ns("g");
    gGrid.setAttribute("stroke", th.grid);
    gGrid.setAttribute("stroke-width", "0.8");
    for (let x = 0; x <= X_MAX + 1e-9; x += 0.5) {
      const line = ns("line");
      line.setAttribute("x1", xToPx(x));
      line.setAttribute("x2", xToPx(x));
      line.setAttribute("y1", PLOT.y);
      line.setAttribute("y2", PLOT.y + PLOT.h);
      gGrid.appendChild(line);
    }
    const yTicks = scale.log
      ? niceLogTicks(scale.lo, scale.hi)
      : niceLinTicks(scale.lo, scale.hi, 6);
    for (const y of yTicks) {
      const line = ns("line");
      line.setAttribute("x1", PLOT.x);
      line.setAttribute("x2", PLOT.x + PLOT.w);
      line.setAttribute("y1", yToPx(y));
      line.setAttribute("y2", yToPx(y));
      gGrid.appendChild(line);
    }
    svg.appendChild(gGrid);

    for (const xv of [EASY_MAX, HARD_MIN]) {
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
    ylab.setAttribute("font-size", "12");
    ylab.setAttribute("text-anchor", "middle");
    ylab.setAttribute("transform", `rotate(90 ${PLOT.x + PLOT.w + 44} ${PLOT.y + PLOT.h / 2})`);
    ylab.textContent = "Projected K/D";
    svg.appendChild(ylab);

    for (const x of [0, 0.5, 1.0, 1.5, 2.0]) {
      const t = ns("text");
      t.setAttribute("x", xToPx(x));
      t.setAttribute("y", PLOT.y + PLOT.h + 18);
      t.setAttribute("fill", th.text);
      t.setAttribute("font-size", "11");
      t.setAttribute("text-anchor", "middle");
      t.textContent = x.toFixed(1);
      svg.appendChild(t);
    }
    for (const y of yTicks) {
      const t = ns("text");
      t.setAttribute("x", PLOT.x + PLOT.w + 8);
      t.setAttribute("y", yToPx(y) + 4);
      t.setAttribute("fill", th.text);
      t.setAttribute("font-size", "11");
      t.setAttribute("text-anchor", "start");
      t.textContent = formatTick(y, scale.log);
      svg.appendChild(t);
    }

    // Short axis labels only (no farm % clutter)
    const capY = PLOT.y + PLOT.h + 40;
    addText(svg, PLOT.x, capY, "🐣 Easy", th.muted, 10, "start");
    addText(svg, PLOT.x + PLOT.w / 2, capY, "Enemy 💪 KPM", th.muted, 10, "middle");
    addText(svg, PLOT.x + PLOT.w, capY, "🥵 Hard", th.muted, 10, "end");
    addText(svg, xToPx(EASY_MAX), capY + 14, "0.75", th.muted, 9, "middle");
    addText(svg, xToPx(HARD_MIN), capY + 14, "1.50", th.muted, 9, "middle");

    const seriesG = ns("g");
    seriesG.setAttribute("clip-path", "url(#plot-clip)");
    svg.appendChild(seriesG);

    const labelAnchors = [];
    const lightLines = isLightTheme();
    list.forEach((p, i) => {
      const col = seriesColor(i);
      const pts = (p.curve || [])
        .filter((pt) => pt.kpm <= X_MAX + 1e-9)
        .map((pt) => ({
          ...pt,
          rel: reliability(pt),
          valid: isFiniteNum(pt.kd) && pt.deaths > 0,
        }));

      const faint = pts.filter((pt) => pt.valid);
      if (faint.length >= 2) {
        const path = ns("path");
        path.setAttribute(
          "d",
          faint
            .map((pt, j) => `${j ? "L" : "M"}${xToPx(pt.kpm).toFixed(2)},${yToPx(pt.kd).toFixed(2)}`)
            .join(" ")
        );
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
      }

      // Fixed small markers (no √deaths sizing)
      for (const pt of pts) {
        if (!pt.valid) continue;
        if (pt.rel < 0.35) {
          drawX(seriesG, xToPx(pt.kpm), yToPx(pt.kd), DOT_R, col);
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
        }
      }

      let anchor = null;
      const easyPts = pts.filter((pt) => pt.valid && pt.kpm <= 0.25);
      if (easyPts.length) {
        easyPts.sort((a, b) => a.kpm - b.kpm);
        anchor = easyPts[0];
      } else {
        const finite = pts.filter((pt) => pt.valid);
        if (finite.length) {
          finite.sort((a, b) => a.kpm - b.kpm);
          anchor = finite[0];
        }
      }
      if (anchor) {
        labelAnchors.push({
          i,
          col,
          x: anchor.kpm,
          y: anchor.kd,
          display: p.display,
        });
      }
    });

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
      num.setAttribute("font-size", "14");
      num.setAttribute("font-weight", "800");
      num.setAttribute("text-anchor", "end");
      num.textContent = String(lab.i + 1);
      svg.appendChild(num);
      const link = ns("line");
      link.setAttribute("x1", PLOT.x - 4);
      link.setAttribute("y1", fy);
      link.setAttribute("x2", xToPx(lab.x));
      link.setAttribute("y2", yToPx(lab.y));
      link.setAttribute("stroke", lab.col);
      link.setAttribute("stroke-width", "0.7");
      link.setAttribute("stroke-opacity", "0.7");
      svg.appendChild(link);
    }

    renderStatsTable(list);
    renderLegend(list);
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
  }

  function addText(svg, x, y, text, fill, size, anchor) {
    const t = ns("text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("fill", fill);
    t.setAttribute("font-size", String(size));
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
      return y.toFixed(2);
    }
    if (Math.abs(y) >= 10) return y.toFixed(0);
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
    });
  }

  function renderStatsTable(list) {
    if (!els.stats) return;
    lastStatsList = list;
    if (!list.length) {
      els.stats.innerHTML = "";
      return;
    }

    // Same per-player metrics as status.html red flags (player-metrics.mjs).
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
      { id: "adjs", label: "⚔️ iVi", hint: "ivi adjusted for your own kill speed (🎯🎈 ivi in the debug columns is the unadjusted score). Own KPM 0.8–1.4 = unchanged; faster earns a growing bonus; slower scales the score down (at most halved), so a slow, safe KD counts for less but never goes negative. Below zero shows as 0.", fn: (r) => r.adjs, digits: 0, floorZero: true },
      { id: "rf", label: "🛡️ Resist", hint: "Resistance: how hard the players you die to are (Resistance Factor).", fn: (r) => r.rf, digits: 2 },
      { id: "act", label: "🔥 Active", hint: "Activity: how much high-pressure combat you see (☠️ K/D × own KPM).", fn: (r) => r.act, digits: 2 },
      { id: "pvs", label: "🦁 Brave", hint: "Bravery (formerly LionHeart): 🔥 Active × pressure slope — sustained elite volume under hard opposition.", fn: (r) => r.pvs, digits: 2 },
      { id: "rkd", label: "☠️ K/D", hint: "Resistance-weighted K/D against the opposition mix you actually face.", fn: (r) => r.rkd, digits: 3 },
      { id: "mech", label: "⚙️ Mech%", hint: "Projected mechanized / vehicle share implied by 🛡️ Resist.", fn: (r) => r.mech, digits: 1 },
      { id: "inflation", label: "🎈 Inflation", hint: "Global KD ÷ KD at ≥0.5 enemy KPM — how much soft opposition inflates your KD (avg planetman ~0.35).", fn: (r) => r.inflation, digits: 2, pctDir: "low" },
    ];
    // Older debug columns: appended only when "show older debug stats" (footer) is ticked.
    const adjDebugCols = [
      { id: "adj", label: "🎯🎈 ivi", hint: "Opposition-weighted IvI before the kill-speed adjustment: public IvI adjusted by 🛡️ Resist so soft-farm padding is tempered. The 🎈 is a reminder that this score is still inflated (slow, safe play is not penalised here — see ⚔️ iVi).", fn: (r) => r.adj, digits: 0 },
      { id: "ekpm", label: "eKPM", hint: "Average enemy weapon KPM faced (how hard the opposition shoots).", fn: (r) => r.ekpm, digits: 2 },
      { id: "own", label: "own KPM", hint: "Your weapon pace used on the elite K/D curve and for the ⚔️ iVi speed adjustment.", fn: (r) => r.own, digits: 2 },
      { id: "coi", label: "📊 COI", hint: "Combat Output Index derived from 🛡️ Resist.", fn: (r) => r.coi, digits: 2 },
      { id: "slope", label: "📉 Slope", hint: "Overall graph angle: death-weighted K/D vs enemy KPM across the full curve — negative means K/D falls as opposition hardens (feeds 🦁 Brave).", fn: (r) => r.slope, digits: 2 },
    ];
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
          const an = String(a.p.display || "").toLowerCase();
          const bn = String(b.p.display || "").toLowerCase();
          if (an < bn) return -1 * (state.dir === "asc" ? 1 : -1);
          if (an > bn) return 1 * (state.dir === "asc" ? 1 : -1);
          return 0;
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

    function playerRows(cols, ordered) {
      // Column references over every analysed player (not just the visible order).
      const colRefs = new Map(cols.map((c) => [c.id, columnRef(metrics.map((r) => c.fn(r)), c.pctDir || "high")]));
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
              if (c.floorZero && isFiniteNum(v) && v < 0) {
                return `<td class="below-scale" title="Below the rating scale">0</td>`;
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
              return `<td>${fmtNum(v, c.digits)}${pct}</td>`;
            })
            .join("");
          const num = i + 1;
          return (
            `<tr><th scope="row" class="stats-name" style="color:${col}">` +
            `<span class="player-num" aria-label="Series ${num}">${num}.</span>` +
            `${nameSpanHtml(row.p.display)}</th>${vals}</tr>`
          );
        })
        .join("");
    }

    const pubSorted = sortRows(metrics, publicCols, statsSortState.public);
    const adjSorted = sortRows(metrics, adjCols, statsSortState.adjusted);

    els.stats.innerHTML = `
      <details class="stats-section">
        <summary>📊 Public (Census / Honu)</summary>
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="public">
            <thead><tr>${metricHead(publicCols, "public", statsSortState.public)}</tr></thead>
            <tbody>${playerRows(publicCols, pubSorted)}</tbody>
          </table>
        </div>
      </details>
      <div class="stats-section">
        <div class="section-title">✨ Adjusted (calculated)</div>
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="adjusted">
            <thead><tr>${metricHead(adjCols, "adjusted", statsSortState.adjusted)}</tr></thead>
            <tbody>${playerRows(adjCols, adjSorted)}</tbody>
          </table>
        </div>
      </div>
    `;

    els.stats.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
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
        renderStatsTable(list);
      });
    });
  }

  function renderLegend(list) {
    els.legend.innerHTML = "";
    list.forEach((p, i) => {
      const col = seriesColor(i);
      const item = document.createElement("div");
      item.className = "legend-item";
      // Name links to the player's Honu profile (plain text if no character id).
      const url = honuProfileUrl(p.cid);
      const full = escapeHtml(p.display);
      const nameHtml = url
        ? `<a class="legend-link nm" href="${escapeHtml(url)}" target="_blank" ` +
          `rel="noopener noreferrer" data-full="${full}" title="Open ${full} on Honu">` +
          `${full}</a>`
        : `<span class="nm" data-full="${full}" title="${full}">${full}</span>`;
      item.innerHTML = `
        <span class="legend-swatch" style="background:${col}"></span>
        <span class="legend-label" style="color:${col}"><strong>${i + 1}.</strong>${nameHtml}</span>
      `;
      els.legend.appendChild(item);
    });
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
  function nameSpanHtml(name) {
    const n = escapeHtml(name);
    return `<span class="nm" data-full="${n}" title="${n}">${n}</span>`;
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
    if (els.fetchFresh) els.fetchFresh.disabled = on;
  }

  /** Release any under-load holds a (cancelled) run still owns. */
  function releaseRunLiveHolds(run) {
    if (!run) return;
    while (run.live > 0) {
      run.live -= 1;
      endLiveFetch();
    }
  }

  /**
   * ✕ / Esc in the progress popup: abort the whole analyze run now.
   * Previous graph (if any) is left untouched; nothing half-done is rendered.
   */
  function uncheckFetchFresh() {
    if (els.fetchFresh) els.fetchFresh.checked = false;
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
    releaseRunLiveHolds(run);
    setFetching(false);
    setProgress(false);
    if (!players.length) {
      // No prior graph → back to idle placeholder.
      showIdleChart("▶️ Press Analyze");
    }
    updateUnderLoadNotice();
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
    els.legend.innerHTML = "";
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

  async function analyzeNames(names, { forceFresh = false } = {}) {
    if (fetching) return;
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
    if (
      shouldShowGraphReady({
        sameSet,
        fresh,
        names: clean,
        isLoaded: (n) => !!findLoadedPlayer(n),
        isFailed: (n) => !!getNameFailure(n),
      })
    ) {
      collapseSharedCache();
      // Re-render chips so force-collapsed state sticks if a render follows
      renderCacheChips();
      showGraphReadyHint();
      scrollToResults();
      return;
    }

    collapseSharedCache();
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
      live: 0,
      fresh,
    };
    run.signal = run.controller.signal;
    activeRun = run;
    const signal = run.signal;
    /** True once this run was cancelled (or superseded) — stop touching UI. */
    const cancelled = () => signal.aborted || activeRun !== run;
    setFetching(true);
    setProgress(true, {
      title: "Analyzing…",
      done: 0,
      total: clean.length,
    });
    updateUnderLoadNotice();
    setStatus(`Analyzing ${clean.length} player${clean.length > 1 ? "s" : ""}…`);

    let result = { loaded: [], failed: [], cancelled: false };
    try {
      result = await loadEach(
        clean,
        async (name) => {
          // Reuse in-memory player when names changed but this one is still present
          if (!fresh) {
            const existing = findLoadedPlayer(name);
            if (existing && lastAnalyzedNames.some((n) => namesEqualIgnoreCase(n, name))) {
              return existing;
            }
          }
          const p = await loadOne(name, { fresh, run });
          if (cancelled()) throw makeAbortError();
          // Only fully loaded players reach the cache (failures never do).
          cachePut(name, p);
          setStatus(
            `Loaded <strong>${escapeHtml(p.display)}</strong> ` +
            `<span class="src">via ${escapeHtml(sourceLabel(p.source))}</span>…`
          );
          return p;
        },
        {
          isCancelled: cancelled,
          onStart: (name, idx, total) => {
            setProgress(true, { title: "Analyzing…", done: idx, total, name });
          },
          // Success or failure, the name counts as done so the bar/ETA advance.
          onDone: (name, idx, total) => {
            if (cancelled()) return;
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
        updateUnderLoadNotice();
      } else {
        releaseRunLiveHolds(run);
      }
    }

    // Cancelled: keep previous graph as-is; lastAnalyzedNames unchanged.
    if (result.cancelled || signal.aborted) return;

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
      return;
    }

    const successNames = result.loaded.map((x) => x.name);
    players = result.loaded.map((x) => x.player);
    // Attempted set (incl. skipped names) so a repeat press shows the
    // "graph is ready" hint instead of refetching the same bad name.
    lastAnalyzedNames = clean.slice();
    lastLoadedNames = successNames.slice();
    drawChart(players);
    // Recent / share link only ever carry names that actually loaded.
    saveLastComparison(successNames);
    syncUrlNames(successNames); // refresh re-opens exactly this comparison
    renderNameTokens();
    renderCacheChips();
    suggestSharedCache(result.loaded); // fire-and-forget, never awaited

    if (summary) {
      setStatus(skippedWarningHtml(summary, { fresh }), "warn skipped");
    } else {
      setStatus("");
    }
    // Results are in: glide the input/header up out of view.
    scrollToResults();
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
  function suggestSharedCache(loaded) {
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
          showSharedAddNote(data.queued, data.etaMinutes);
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
        ? ` <span class="src">Fetch fresh was on — live Honu/Census only.</span>`
        : "";
    return (
      `<div class="skipped-warning" role="status">` +
      `<span class="warn">⚠️ ${escapeHtml(summary.lead)} ${items}.</span> ` +
      `<span class="skipped-tail">${escapeHtml(tail)}</span>${freshNote}` +
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
    const fromQuery = namesFromQuery();
    if (fromQuery) return { names: fromQuery, reason: "url" };
    const last = getLastComparison();
    if (last && last.length) return { names: last, reason: "last" };
    return { names: DEFAULT_NAMES.slice(), reason: "empty" };
  }

  /* ---------- events ---------- */

  if (els.analyzeBtn) {
    els.analyzeBtn.addEventListener("click", () => {
      collapseSharedCache();
      const { rejected } = commitFragment({ clearInput: true });
      if (rejected.length) {
        // Field is full and extra text is waiting: warn instead of eating it or
        // showing "graph is ready".
        showLimitHint();
        return;
      }
      let names = currentNamesInField();
      if (!names.length) {
        // Empty field → default to ShloDog and show it as a chip
        setNameTokens([DEFAULT_PLACEHOLDER_NAME]);
        names = [DEFAULT_PLACEHOLDER_NAME];
      }
      analyzeNames(names);
    });
  }

  if (els.namesInput) {
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
      renderCacheChips();
    });

    els.namesInput.addEventListener("blur", () => {
      // Do not auto-commit on blur — only separator / Analyze / Enter
      renderCacheChips();
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

  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", () => toggleTheme());
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
      SERVER_LOAD_FLAG_URL,
      getServerLoadFlag: () => serverLoadFlag,
      currentNamesInField,
      isNameFetched,
      getNameTokens: () => nameTokens.slice(),
      cancelAnalyze,
      isAnalyzing: () => !!activeRun,
      getLiveFetchDepth: () => liveFetchDepth,
      getLastAnalyzedNames: () => lastAnalyzedNames.slice(),
      getFailedNames: () => [...failedNames.values()].map((f) => ({ ...f })),
      getPlayerNames: () => players.map((p) => p.display),
    };
  }

  window.addEventListener("storage", (e) => {
    if (e.key === LS_FETCHING || e.key === null) updateUnderLoadNotice();
  });
  if (fetchBroadcast) {
    fetchBroadcast.addEventListener("message", () => {
      updateUnderLoadNotice();
    });
  }
  window.addEventListener("pagehide", () => {
    if (liveFetchDepth > 0) clearFetchFlagIfOwned();
  });
  window.addEventListener("beforeunload", () => {
    if (liveFetchDepth > 0) clearFetchFlagIfOwned();
  });

  // Startup — fill chips only; wait for Analyze (Enter still works)
  // Never persist / restore "Fetch fresh"; always start clean on load/refresh.
  (async () => {
    applyTheme(getStoredTheme(), { redraw: false });
    if (els.fetchFresh) els.fetchFresh.checked = false;
    startServerLoadFlagPolling();
    updateUnderLoadNotice();
    await loadSharedIndex();
    const startup = resolveStartupNames();
    setNameTokens(startup.names); // >10 from ?names= → first 10 + limit hint
    renderCacheChips();
    showIdleChart("▶️ Press Analyze");
    // No idle "Ready — press Analyze" line; the status area only shows progress / errors
    // (and the limit hint if ?names= had more than 10).
  })();
