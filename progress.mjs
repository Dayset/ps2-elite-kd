/**
 * The Analyze progress bar: percent, creeping between names, and the time estimate learned from earlier runs (#66: moved
 * out of app.js unchanged).
 */
import { etaLearnLiveMs, estimateRemainingMs, nextEtaDeadline, expectedNameMs, formatEtaLeft } from "./analyze-run.mjs?v=20261023-priv1";
import { t as tr } from "./i18n.mjs";
import { formatClock } from "./app-util.mjs?v=20261024-split1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: els, etaLivePriorMs.
 */
export function createProgress($) {
  /** Remembered live-fetch time per name in this browser (ms, moving average) → first ETA guess. */
  const LS_ETA_LIVE = "ps2-elite-kd-eta-live-ms";

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

  const avgMs = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  function readEtaLivePrior() {
    try {
      const v = Number(localStorage.getItem(LS_ETA_LIVE));
      return Number.isFinite(v) && v > 0 ? etaLearnLiveMs(0, v) : 0;
    } catch {
      return 0;
    }
  }

  function learnEtaLive(ms) {
    $.etaLivePriorMs = etaLearnLiveMs($.etaLivePriorMs, ms);
    try {
      if ($.etaLivePriorMs > 0) localStorage.setItem(LS_ETA_LIVE, String($.etaLivePriorMs));
    } catch {
      /* private mode / quota */
    }
  }

  const etaKinds = () => ({
    liveAvgMs: avgMs(progressLiveMs),
    cachedAvgMs: avgMs(progressCachedMs),
    livePriorMs: $.etaLivePriorMs,
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
    if ($.els.progressBar) $.els.progressBar.style.width = `${progressDisplayPct}%`;
    if ($.els.progressPct) $.els.progressPct.textContent = `${Math.round(progressDisplayPct)}%`;
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
    if (!$.els.progressTiming) return;
    const now = Date.now();
    const elapsed = now - progressStartedAt;
    const elapsedStr = tr("progress.elapsed", "Elapsed {t}", { t: formatClock(elapsed) });
    let remainStr = "";
    const left = progressTotalCount - progressDoneCount;
    if (progressTotalCount > 0 && left <= 0) {
      remainStr = tr("progress.almost", "Almost done…");
    } else if (progressTotalCount > 0) {
      updateEtaDeadline(now);
      // Last name running past its estimate → "Almost done…" rather than a stuck "0s".
      remainStr = formatEtaLeft(progressEtaDeadline - now) || tr("progress.almost", "Almost done…");
    }
    $.els.progressTiming.textContent = remainStr ? `${elapsedStr} · ${remainStr}` : elapsedStr;
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
    if (!$.els.progress) return;
    if (!show) {
      stopProgressTick();
      $.els.progress.hidden = true;
      $.els.progress.setAttribute("aria-hidden", "true");
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
      if ($.els.progressText) $.els.progressText.textContent = "";
      if ($.els.progressTitle) $.els.progressTitle.textContent = tr("progress.title", "Analyzing…");
      applyProgressBar(0);
      if ($.els.progressTiming) $.els.progressTiming.textContent = "";
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
        text = tr("progress.starting", "Starting…");
      }
    }

    let title = opts.title;
    if (!title) {
      if (total > 0 && done >= total) title = tr("progress.finishing", "Finishing…");
      else title = tr("progress.title", "Analyzing…");
    }

    $.els.progress.hidden = false;
    $.els.progress.setAttribute("aria-hidden", "false");
    document.body.classList.add("progress-open");
    if ($.els.progressTitle) $.els.progressTitle.textContent = title;
    if ($.els.progressText) $.els.progressText.textContent = text;
    applyProgressBar(progressDisplayPct);
    renderProgressTiming();
    startProgressTick();
  }
  return { readEtaLivePrior, learnEtaLive, updateEtaDeadline, stopProgressTick, applyProgressBar, fakeSegmentMs, creepProgressBar, renderProgressTiming, startProgressTick, setProgress };
}
