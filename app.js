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
} from "./math.mjs";

  const COLORS = [
    "#9fd4ee", "#ff7a7a", "#ffd166", "#8ef0b0", "#e8b0ff",
    "#ffb07a", "#7ef0e6", "#ffa0c8", "#c6f06a", "#8cbcff",
  ];
  const HONU = "https://wt.honu.pw/api/character/";
  const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
  const DOT_R = 3;

  const LS_CACHE = "ps2-elite-kd-cache-v2";
  const LS_CACHE_OLD = "ps2-elite-kd-cache-v1";
  const LS_RECENT = "ps2-elite-kd-recent";
  const LS_LAST = "ps2-elite-kd-last";
  const LS_THEME = "ps2-elite-kd-theme";
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
  const DEFAULT_NAMES = ["JustV6me", "ChrisJTTR"];
  const SHARED_INDEX_URL = "data/index.json";

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
    namesBox: document.getElementById("namesBox"),
    nameTokensEl: document.getElementById("nameTokens"),
    namesInput: document.getElementById("namesInput") || document.getElementById("names"),
    analyzeBtn: document.getElementById("analyzeBtn") || document.getElementById("loadBtn"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    clearNamesBtn: document.getElementById("clearNamesBtn"),
    fetchFresh: document.getElementById("fetchFresh"),
    cacheChips: document.getElementById("cacheChips") || document.getElementById("recentChips"),
    lastLink: document.getElementById("lastLink"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    progressTitle: document.getElementById("progressTitle"),
    progressText: document.getElementById("progressText"),
    progressBar: document.getElementById("progressBar"),
    progressPct: document.getElementById("progressPct"),
    progressTiming: document.getElementById("progressTiming"),
    underLoadNote: document.getElementById("underLoadNote"),
    underLoadInModal: document.getElementById("underLoadInModal"),
    chart: document.getElementById("chart"),
    chartPlaceholder: document.getElementById("chartPlaceholder"),
    chartYZoom: document.getElementById("chartYZoom"),
    yZoomSlider: document.getElementById("yZoomSlider"),
    yZoomReset: document.getElementById("yZoomReset"),
    stats: document.getElementById("statsPanel"),
    legend: document.getElementById("legend"),
  };

  let players = [];
  let lastAnalyzedNames = [];
  /** Y-axis zoom factor; 1 = auto-fit current data (default). */
  let yZoom = Y_ZOOM_DEFAULT;
  let fetching = false;
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

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function setStatus(html, cls) {
    els.status.innerHTML = html || "";
    els.status.className = cls || "";
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

  /** Chart chrome colors for current theme (series COLORS stay the same). */
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

  function normalizePlayer(raw) {
    const p = raw.player || raw;
    const rows = (p.rows || []).map((r) => ({
      name: r.name || "",
      kills: +r.kills || 0,
      deaths: +r.deaths || 0,
      kpm: +r.kpm || 0,
    }));
    let curve = p.curve;
    if (!curve || !curve.length) curve = kpmCurve(rows);
    curve = curve.map((pt) => ({
      kpm: +pt.kpm,
      kd: pt.kd == null || pt.kd !== pt.kd ? NaN : +pt.kd,
      kills: +pt.kills || 0,
      deaths: +pt.deaths || 0,
      n: +pt.n || 0,
    }));
    return {
      display: p.display || p.name || "?",
      cid: p.cid || "",
      global_kd: +p.global_kd || 0,
      global_kpm: +p.global_kpm || 0,
      own_kpm: +p.own_kpm || +p.global_kpm || 0,
      acc: p.acc != null ? +p.acc : null,
      hsr: p.hsr != null ? +p.hsr : null,
      ivi: p.ivi != null ? +p.ivi : null,
      rows,
      curve,
      honu: p.honu || (p.cid ? `https://wt.honu.pw/c/${p.cid}/killboard` : ""),
      source: raw._source || "local",
    };
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
    return tokens.slice(0, 10);
  }

  function namesEqualIgnoreCase(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  /** Order-insensitive casefold key for skip-refetch compare. */
  function namesSetKey(names) {
    return names
      .map((n) => String(n).trim().toLowerCase())
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

  function saveLastComparison(names) {
    writeJsonLS(LS_LAST, names.map((n) => String(n).trim()).filter(Boolean));
    renderLastLink();
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

  /* ---------- tokenized name input / chips / last link ---------- */

  function isNameFetched(name) {
    if (findSharedEntry(name)) return true;
    if (cacheGet(name)) return true;
    const slug = slugKey(name);
    if (players.some((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name))) {
      return true;
    }
    if (lastAnalyzedNames.some((n) => namesEqualIgnoreCase(n, name) || slugKey(n) === slug)) {
      return true;
    }
    return false;
  }

  function setNameTokens(names) {
    const seen = new Set();
    nameTokens = [];
    for (const raw of names || []) {
      const clean = String(raw).trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      nameTokens.push(clean);
      if (nameTokens.length >= 10) break;
    }
    if (els.namesInput) els.namesInput.value = "";
    renderNameTokens();
    renderCacheChips();
  }

  function addNameToField(name) {
    const clean = String(name).trim();
    if (!clean) return;
    if (nameTokens.some((n) => namesEqualIgnoreCase(n, clean))) {
      renderNameTokens();
      renderCacheChips();
      return;
    }
    if (nameTokens.length >= 10) {
      setStatus('<span class="warn">Max 10 names</span>', "warn");
      return;
    }
    nameTokens.push(clean);
    renderNameTokens();
    renderCacheChips();
  }

  function removeNameToken(name) {
    nameTokens = nameTokens.filter((n) => !namesEqualIgnoreCase(n, name));
    renderNameTokens();
    renderCacheChips();
  }

  function renderNameTokens() {
    if (!els.nameTokensEl) return;
    els.nameTokensEl.innerHTML = "";
    nameTokens.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-token " + (isNameFetched(name) ? "fetched" : "unfetched");
      btn.textContent = name;
      btn.setAttribute("aria-label", `Remove ${name}`);
      btn.title = `Remove ${name}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeNameToken(name);
      });
      els.nameTokensEl.appendChild(btn);
    });
  }

  /** Commit trailing raw input into chips (separator flush or Analyze/Enter). */
  function commitFragment({ clearInput = true } = {}) {
    if (!els.namesInput) return [];
    const raw = els.namesInput.value;
    const tokens = parseNames(raw);
    for (const t of tokens) addNameToField(t);
    if (clearInput) els.namesInput.value = "";
    return tokens;
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
    return out.slice(0, 10);
  }

  function renderCacheChips() {
    if (!els.cacheChips) return;
    const cached = listCachedNames();
    const inField = currentNamesInField();
    els.cacheChips.innerHTML = "";
    if (!cached.length) return;

    function appendGroup(title, items) {
      if (!items.length) return;
      const label = document.createElement("span");
      label.className = "fresh-hint";
      label.style.marginRight = "0.35rem";
      label.textContent = title;
      els.cacheChips.appendChild(label);
      for (const item of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        if (item.source === "shared") btn.classList.add("shared");
        if (inField.some((n) => namesEqualIgnoreCase(n, item.name))) {
          btn.classList.add("active");
        }
        btn.textContent = item.name;
        const when = item.savedAt
          ? new Date(item.savedAt).toLocaleDateString()
          : "";
        btn.title = item.source === "shared"
          ? `Shared cache${when ? ` · ${when}` : ""} — add ${item.name}`
          : `Browser cache${when ? ` · ${when}` : ""} — add ${item.name}`;
        btn.addEventListener("click", () => addNameToField(item.name));
        els.cacheChips.appendChild(btn);
      }
    }

    appendGroup("📦 Shared:", cached.filter((c) => c.source === "shared"));
    appendGroup("💾 Browser:", cached.filter((c) => c.source !== "shared"));
  }

  function renderLastLink() {
    if (!els.lastLink) return;
    const last = getLastComparison();
    if (!last || !last.length) {
      els.lastLink.innerHTML = "";
      return;
    }
    const namesStr = last.join(",");
    const url = buildShareUrl(last);
    els.lastLink.innerHTML =
      `Latest comparison: <a href="${escapeHtml(url)}">${escapeHtml(namesStr)}</a>`;
  }

  /* ---------- loaders ---------- */

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }

  async function loadLocal(name) {
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
        const data = await fetchJson(path);
        data._source = `shared:${path}`;
        return normalizePlayer(data);
      } catch (e) {
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

  async function resolveCensus(name) {
    const raw = name.trim();
    let url;
    if (/^\d{16,}$/.test(raw)) {
      url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
    } else {
      url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
    }
    const data = await fetchJson(url);
    const chars = data.character_list || [];
    if (!chars.length) throw new Error(`Census: no character ${raw}`);
    return chars[0];
  }

  async function honuKillboard(cid) {
    return fetchJson(`${HONU}${cid}/killboard`);
  }

  async function honuMeta(cid) {
    try {
      return await fetchJson(`${HONU}${cid}`);
    } catch {
      return {};
    }
  }

  async function honuWeaponPace(cid) {
    try {
      const stats = await fetchJson(`${HONU}${cid}/stats`);
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
    } catch {
      return { wk: 0, wd: 0, kpm: 0, acc: 0, hsr: 0, ivi: 0 };
    }
  }

  function hist(c, stat) {
    for (const row of ((c.stats || {}).stat_history) || []) {
      if (row.stat_name === stat) return +row.all_time || 0;
    }
    return 0;
  }

  async function loadLive(name) {
    beginLiveFetch();
    try {
      return await loadLiveInner(name);
    } finally {
      endLiveFetch();
    }
  }

  async function loadLiveInner(name) {
    const c = await resolveCensus(name);
    const cid = c.character_id;
    const outfit = c.outfit || {};
    const gk = hist(c, "kills"), gd = hist(c, "deaths"), gt = hist(c, "time");
    const gkd = gd ? gk / gd : gk;
    const gkpm = gt ? gk / (gt / 60) : 0;
    const tag = outfit.alias ? `[${outfit.alias}] ` : "";
    const display = `${tag}${c.name.first}`;

    const own = await honuWeaponPace(cid);
    const board = await honuKillboard(cid);
    board.sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths));
    const sample = board.slice(0, 50);

    const rows = [];
    const concurrency = 4;
    let i = 0;
    async function worker() {
      while (i < sample.length) {
        const idx = i++;
        const pair = sample[idx];
        const oid = String(pair.otherCharacterID);
        const [meta, pace] = await Promise.all([honuMeta(oid), honuWeaponPace(oid)]);
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
  async function loadOne(name, { fresh = false } = {}) {
    if (fresh) {
      try {
        return await loadLive(name);
      } catch (e) {
        throw new Error(`Live fetch failed for ${JSON.stringify(name)}: ${e.message}`);
      }
    }
    const errors = [];
    try {
      return await loadLocal(name);
    } catch (e) {
      errors.push(`shared: ${e.message}`);
    }
    try {
      return loadFromCache(name);
    } catch (e) {
      errors.push(`cache: ${e.message}`);
    }
    try {
      return await loadLive(name);
    } catch (e) {
      errors.push(`live: ${e.message}`);
    }
    throw new Error(
      `Could not load ${JSON.stringify(name)}. ${errors.join(" · ")}`
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
    list.forEach((p, i) => {
      const col = COLORS[i % COLORS.length];
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
        path.setAttribute("stroke-width", "0.7");
        path.setAttribute("stroke-opacity", "0.2");
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
        seg.setAttribute("stroke-width", (0.5 + 1.3 * r).toFixed(2));
        seg.setAttribute("stroke-opacity", (0.3 + 0.7 * r).toFixed(2));
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
    adjusted: { key: "adj", dir: "desc" },
  };

  function renderStatsTable(list) {
    if (!els.stats) return;
    if (!list.length) {
      els.stats.innerHTML = "";
      return;
    }

    const metrics = list.map((p) => {
      const m = rfIf(p);
      const ivi = resolveIvi(p);
      const rf = m && isFiniteNum(m.rf) ? m.rf : NaN;
      const act = m && isFiniteNum(m.ifactor) ? m.ifactor : NaN;
      const rkd = m && isFiniteNum(m.rkd) ? m.rkd : NaN;
      const ekpm = m && isFiniteNum(m.avg_opp) ? m.avg_opp : NaN;
      const own = m && isFiniteNum(m.own) ? m.own : (+p.own_kpm || +p.global_kpm || NaN);
      const slope = curveSlope(p);
      const dm = deathMixLite(p);
      return {
        p,
        m,
        kd: p.global_kd,
        kpm: p.global_kpm,
        ownKpm: p.own_kpm || p.global_kpm,
        acc: p.acc,
        hsr: p.hsr,
        ivi,
        rkd,
        ekpm,
        own,
        rf,
        act,
        coi: combatOutput(rf),
        mech: projectedMech(rf),
        slope,
        pvs: pressureVolume(act, slope),
        adj: adjustedIvi(ivi, rf),
        kd05: dm.kd05,
        inflation: dm.inflation,
      };
    });

    const publicCols = [
      { id: "kd", label: "KD", hint: "Overall kill/death ratio from Census / Honu.", fn: (r) => r.kd, digits: 2 },
      { id: "kpm", label: "KPM", hint: "Overall kills per minute.", fn: (r) => r.kpm, digits: 2 },
      { id: "ownKpm", label: "own KPM", hint: "Your own weapon pace (kills per minute with your weapons).", fn: (r) => r.ownKpm, digits: 2 },
      { id: "acc", label: "Acc %", hint: "Hit accuracy percentage.", fn: (r) => r.acc, digits: 1 },
      { id: "hsr", label: "HSR %", hint: "Headshot rate percentage.", fn: (r) => r.hsr, digits: 1 },
      { id: "ivi", label: "IvI", hint: "Infantry vs Infantry score from Census / Honu.", fn: (r) => r.ivi, digits: 0 },
    ];

    // Column order is fixed (sort only reorders rows). ivi (adj) is always first metric.
    const adjCols = [
      { id: "adj", label: "🎯 ivi", hint: "Opposition-weighted IvI: public IvI adjusted by Resistance so soft-farm padding is tempered.", fn: (r) => r.adj, digits: 0 },
      { id: "rkd", label: "⚔️ KD", hint: "Resistance-weighted K/D against the opposition mix you actually face.", fn: (r) => r.rkd, digits: 3 },
      { id: "ekpm", label: "eKPM", hint: "Average enemy weapon KPM faced (how hard the opposition shoots).", fn: (r) => r.ekpm, digits: 2 },
      { id: "own", label: "own KPM", hint: "Your weapon pace used on the elite K/D curve.", fn: (r) => r.own, digits: 2 },
      { id: "rf", label: "🛡️ Resistance", hint: "How hard the players you die to are (Resistance Factor).", fn: (r) => r.rf, digits: 2 },
      { id: "act", label: "🔥 Activity", hint: "How much high-pressure combat you see (Activity / IF).", fn: (r) => r.act, digits: 2 },
      { id: "coi", label: "📊 COI", hint: "Combat Output Index derived from Resistance.", fn: (r) => r.coi, digits: 2 },
      { id: "mech", label: "⚙️ Mech%", hint: "Projected mechanized / vehicle share implied by Resistance.", fn: (r) => r.mech, digits: 1 },
      { id: "slope", label: "📉 Slope", hint: "Overall graph angle: death-weighted K/D vs enemy KPM across the full curve — negative means K/D falls as opposition hardens.", fn: (r) => r.slope, digits: 2 },
      { id: "pvs", label: "🦁 LionHeart", hint: "Activity × pressure slope — sustained elite volume under hard opposition.", fn: (r) => r.pvs, digits: 2 },
      { id: "inflation", label: "🎈 Inflation", hint: "Global KD ÷ KD at ≥0.5 enemy KPM — how much soft opposition inflates your KD (avg planetman ~0.35).", fn: (r) => r.inflation, digits: 2 },
    ];

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
        const getter = col ? col.fn : (r) => r.adj;
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
          const col = COLORS[i % COLORS.length];
          const vals = cols
            .map((c) => `<td>${fmtNum(c.fn(row), c.digits)}</td>`)
            .join("");
          const num = i + 1;
          return (
            `<tr><th scope="row" class="stats-name" style="color:${col}">` +
            `<span class="player-num" aria-label="Series ${num}">${num}.</span>` +
            `${escapeHtml(row.p.display)}</th>${vals}</tr>`
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
      const col = COLORS[i % COLORS.length];
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <span class="legend-swatch" style="background:${col}"></span>
        <span style="color:${col}"><strong>${i + 1}.</strong> ${escapeHtml(p.display)}</span>
      `;
      els.legend.appendChild(item);
    });
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
    resetYZoom({ redraw: false });
    setPlaceholderVisible(true);
    const cta = els.chartPlaceholder
      ? els.chartPlaceholder.querySelector(".chart-placeholder-cta")
      : null;
    if (cta) cta.textContent = message || "▶️ Press Analyze";
  }

  function clearChartUi() {
    showIdleChart("▶️ Press Analyze");
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

    // Unchanged names + fresh unchecked → re-render only (no refetch)
    if (sameSet && !fresh) {
      drawChart(players);
      setStatus("");
      return;
    }

    setFetching(true);
    setProgress(true, {
      title: "Analyzing…",
      done: 0,
      total: clean.length,
    });
    updateUnderLoadNotice();
    setStatus(`Analyzing ${clean.length} player${clean.length > 1 ? "s" : ""}…`);

    const loaded = [];
    const errors = [];
    const successNames = [];

    try {
      for (let idx = 0; idx < clean.length; idx++) {
        const name = clean[idx];
        setProgress(true, {
          title: "Analyzing…",
          done: idx,
          total: clean.length,
          name,
        });

        // Reuse in-memory player when names changed but this one is still present
        if (!fresh) {
          const existing = findLoadedPlayer(name);
          if (existing && lastAnalyzedNames.some((n) => namesEqualIgnoreCase(n, name))) {
            loaded.push(existing);
            successNames.push(name);
            setProgress(true, {
              title: "Analyzing…",
              done: idx + 1,
              total: clean.length,
              name,
            });
            continue;
          }
        }

        try {
          const p = await loadOne(name, { fresh });
          loaded.push(p);
          successNames.push(name);
          cachePut(name, p);
          setStatus(
            `Loaded <strong>${escapeHtml(p.display)}</strong> ` +
            `<span class="src">via ${escapeHtml(sourceLabel(p.source))}</span>…`
          );
        } catch (e) {
          errors.push(`${name}: ${e.message}`);
        }

        setProgress(true, {
          title: idx + 1 >= clean.length ? "Finishing…" : "Analyzing…",
          done: idx + 1,
          total: clean.length,
          name,
        });
      }
    } finally {
      setFetching(false);
      setProgress(false);
      updateUnderLoadNotice();
    }

    if (!loaded.length) {
      clearChartUi();
      setStatus(
        `<span class="err">Nothing loaded.</span> ` +
        `<span class="err">${escapeHtml(errors.join(" | "))}</span>` +
        (fresh
          ? ` <span class="src">Fetch fresh was on — live Honu/Census only.</span>`
          : ` <span class="src">Tried shared ./data/ → browser cache → live.</span>`),
        "err"
      );
      return;
    }

    players = loaded;
    lastAnalyzedNames = successNames.slice();
    drawChart(players);
    saveLastComparison(successNames);
    renderNameTokens();
    renderCacheChips();

    if (errors.length) {
      setStatus(
        `<span class="warn">Partial — skipped: ${escapeHtml(errors.join(" | "))}</span>`,
        "warn"
      );
    } else {
      setStatus("");
    }
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
    const names = currentNamesInField();
    if (!names.length) {
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
      setStatus(`<span class="ok">Copied link</span> <span class="src">${escapeHtml(link)}</span>`);
    } catch (e) {
      setStatus(
        `<span class="warn">Could not copy automatically.</span> ` +
        `<span class="src">${escapeHtml(link)}</span>`,
        "warn"
      );
    }
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
    return { names: DEFAULT_NAMES.slice(), reason: "default" };
  }

  /* ---------- events ---------- */

  if (els.analyzeBtn) {
    els.analyzeBtn.addEventListener("click", () => {
      commitFragment({ clearInput: true });
      const names = currentNamesInField();
      if (!names.length) {
        clearChartUi();
        setStatus('<span class="err">Enter at least one character name (spaces or commas).</span>', "err");
        return;
      }
      analyzeNames(names);
    });
  }

  if (els.namesInput) {
    els.namesInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFragment({ clearInput: true });
        if (!fetching && els.analyzeBtn) els.analyzeBtn.click();
        return;
      }
      if (e.key === "Backspace" && !els.namesInput.value && nameTokens.length) {
        e.preventDefault();
        nameTokens.pop();
        renderNameTokens();
        renderCacheChips();
      }
    });

    els.namesInput.addEventListener("input", () => {
      const val = els.namesInput.value;
      // Completed token(s) when text ends with a separator
      if (/[\s,;]$/.test(val)) {
        const tokens = parseNames(val);
        for (const t of tokens) addNameToField(t);
        els.namesInput.value = "";
      }
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
          renderCacheChips();
          return;
        }
        const tokens = parseNames(val);
        for (const t of tokens) addNameToField(t);
        if (tokens.length) els.namesInput.value = "";
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
      setStatus("Ready — press Analyze");
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
    setNameTokens(startup.names);
    renderLastLink();
    renderCacheChips();
    showIdleChart("▶️ Press Analyze");
    const reasonNote =
      startup.reason === "url"
        ? "from URL"
        : startup.reason === "last"
          ? "restored last comparison"
          : "demo defaults";
    const sharedN = (sharedIndex.players || []).length;
    const sharedNote = sharedN
      ? ` · ${sharedN} shared cache name${sharedN === 1 ? "" : "s"}`
      : "";
    setStatus(
      `Ready — press Analyze <span class="src">${reasonNote}${sharedNote}</span>`
    );
  })();
