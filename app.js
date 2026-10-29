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
} from "./math.mjs?v=20261027-z79";
import { formatClock, fmtNum, slugKey, bareName, parseNames, namesEqualIgnoreCase, namesSetKey, niceLinTicks, niceNum, niceLogTicks, formatTick, escapeHtml, makeAbortError, isAbortError, checkAborted, readJsonLS, writeJsonLS } from "./app-util.mjs?v=20261027-z79";
import { createAnalyze } from "./analyze.mjs?v=20261027-an69";
import { createShareAdd } from "./share-add.mjs?v=20261027-z79";
import { createSharedIndex } from "./shared-index.mjs?v=20261029-purevis1";
import { createNamesField } from "./names-field.mjs?v=20261027-z79";
import { createStatsTable } from "./stats-table.mjs?v=20261029-puregraph1";
import { createChartWave } from "./chart-wave.mjs?v=20261029-puregraph1";
import { createChart } from "./chart.mjs?v=20261029-puregraph1";
import { createLoader } from "./loader.mjs?v=20261027-z79";
import { createCacheChips } from "./cache-chips.mjs?v=20261027-z79";
import { createLocalCache } from "./local-cache.mjs?v=20261027-z79";
import { createProgress } from "./progress.mjs?v=20261027-z79";
import { createTheme } from "./theme.mjs?v=20261024-split2";
import { bandGhost, cumulativeGhost } from "./ghost.mjs?v=20261027-z79";
import GHOST_MODEL from "./data/ghost-model.mjs?v=20261010-sav1";
import { t as tr, ready as i18nReady } from "./i18n.mjs";
// Wait for the chosen language file (English loads nothing), so the first render is translated.
await i18nReady;
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261020-wide1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { traitPools, aimGap, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { AIMGAP_HINT, ZERG_HINT, AIMGAP_MISSING, ZERG_MISSING, fmtSigned, diffValueHtml, aimGapCellTip, zergCellTip } from "./trait-tips.mjs?v=20261024-crowd1";
import { ZREV_NOTE } from "./zerg-revive.mjs?v=20261024-crowd1";
import { VDIFF_NOTE } from "./diff-vehicle.mjs?v=20261023-short1";
import { NBD_NOTE, newbieFactor, newPlayerHours } from "./newbie-diff.mjs?v=20261023-nbh1";
import { INF_HINT, INF_PENDING_TIP, infTip } from "./infantry.mjs?v=20261023-short1";
import { vehicleCutTip } from "./vehicle-cut.mjs?v=20261022-wpc1";
import { infantryKillsUrl, summarizeInfantryKills } from "./infantry.mjs?v=20261023-short1";
import { infMedian } from "./tractor.mjs?v=20261024-trac1";
import { mountWeapons } from "./weapons.mjs?v=20261022-wp4";
import { isTouchUi, showHeadTip } from "./head-tip.mjs?v=20261025-loc1";
import { createWheelSwiper } from "./dist-cycle.mjs?v=20261017-cycle15";
import { slideSwap, attachDragCarousel } from "./chart-slide.mjs?v=20261020-flick1";
import { mountStatsCarousel } from "./stats-carousel.mjs?v=20261025-loc1";
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
} from "./analyze-run.mjs?v=20261023-priv1";
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
} from "./player-metrics.mjs?v=20261027-z79";
/** "22 kills / 60 deaths" in the opponent sample (MIN_FIGHTS counts). */
function fightsText(r) {
  const k = r.sampleKills || 0;
  const d = r.sampleDeaths || 0;
  if (!k && !d) return tr("fights.none", "(no fights on record)");
  return tr("fights.counts", "({k} {kills} / {d} {deaths})", { k, d, kills: k === 1 ? tr("fights.kill", "kill") : tr("fights.kills", "kills"), deaths: d === 1 ? tr("fights.death", "death") : tr("fights.deaths", "deaths") });
}
/** Hover on a blanked cell: the reason plus this player's own counts. */
function thinCellTip(r) {
  return tr("fights.sample", "{tip}. This sample: {sample}", { tip: MIN_FIGHTS_TIP, sample: fightsText(r).replace(/[()]/g, "") });
}
import { markNote, statMark, confirmedPadderSlugs, isPenalizedPadder, POOP_MARK, POOP_TIP, setRoomRule } from "./padding.mjs?v=20261023-short1";
import { psIviBaseline, psKpmRatio } from "./ps-baseline.mjs?v=20261027-z79";
import { removedList } from "./opt-out.mjs?v=20261023-proof1";
import { createPairMatch, PAIR_MATCH_ENABLED } from "./pair-match.mjs?v=20261027-pmoff1"; // t710: 👯 play-pattern match of two names
import { HUT_MARK, HUT_TIP, HUT_DIFF_NOTE, playMinutes } from "./hut.mjs?v=20261023-short1";
import { autoMarksHtml } from "./auto-marks.mjs?v=20261024-trac1";
// Account flairs (🪦 inactive, 👴🏽 veteran) from Census character.times: chart name list only.
import { accountTimes, flairsHtml, flairsFor } from "./flairs.mjs?v=20261010-sav1";
// Full-name popup for truncated .nm names (tap / long-press on touch); installs itself.
import "./name-peek.mjs?v=20261025-loc1";
import { sfx, recentGesture, mountSfxToggle } from "./sfx.mjs?v=20261026-sfx2";
import { mountNameSuggest } from "./name-suggest.mjs?v=20261024-br1";
import { COLORS as PALETTE_DARK, LIGHT_COLORS as PALETTE_LIGHT } from "./palette.mjs?v=20261010-sav1";
// ⬆ / ⬇ floating quick jumps (same buttons as ranks.html).
import { mountJumpButtons, sectionJumpState, glideTo, scrollBehavior } from "./jump-btns.mjs?v=20261020-i18n2";
// Live data: Daybreak Census only (batched, paced); Honu just for a rare history fallback.
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { dotSlot, refreshOnline } from "./online-status.mjs?v=20261018-onl1";
// PC | PlayStation rooms (#55): ?room=ps reads data-ps/ and the PS Census namespaces only.
import { pageRoom, dataPrefix, ROOMS, PS_SERVERS, censusNsBase, nsOfBase, parsePsKey, roomLsKey, withRoom } from "./rooms.mjs?v=20261022-ps1";
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
  // #66: loading players (saved copies, shared cache, live Census) moved to loader.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createLoader;
  function loaderPart() {
    return _createLoader || (_createLoader = createLoader({
      get cacheGet() { return cacheGet; },
      get CENSUS() { return CENSUS; },
      get CENSUS_BASES() { return CENSUS_BASES; },
      get CENSUS_BOARD_TIMEOUT_MS() { return CENSUS_BOARD_TIMEOUT_MS; },
      get CENSUS_TIMEOUT_MS() { return CENSUS_TIMEOUT_MS; },
      get censusBucket() { return censusBucket; },
      get censusLimit() { return censusLimit; },
      get DATA() { return DATA; },
      get els() { return els; },
      get findSharedEntry() { return findSharedEntry; },
      get HONU_SIDE_TIMEOUT_MS() { return HONU_SIDE_TIMEOUT_MS; },
      get IS_PS() { return IS_PS; },
      get normalizePlayer() { return normalizePlayer; },
      get removedNow() { return removedNow; }, set removedNow(v) { removedNow = v; },
      get setStatus() { return setStatus; },
    }));
  }
  function fetchJson(...a) { return loaderPart().fetchJson(...a); }
  function serverTagHtml(...a) { return loaderPart().serverTagHtml(...a); }
  function censusJson(...a) { return loaderPart().censusJson(...a); }
  function loadLive(...a) { return loaderPart().loadLive(...a); }
  function loadOne(...a) { return loaderPart().loadOne(...a); }
  const CENSUS = censusBase(CENSUS_SERVICE_ID);
  /*
   * Room (#55). PC (default) is exactly as before. The PlayStation room
   * (?room=ps) reads data-ps/ only, looks players up on Genudine / Ceres only,
   * keeps its own browser storage and never talks to the PC cache Worker, so
   * a PS player and a PC player can never meet in one search, graph or pool.
   */
  const ROOM = pageRoom();
  const IS_PS = ROOM === "ps";
  const DATA = dataPrefix(ROOM);
  /** 🚫 Removal list (#61): parsed opt-out.json of this room; empty until removedReady() loads it. */
  let removedNow = removedList(null);
  // PS room: scrim rule (padding.mjs PS_SCRIM, owner 2026-10-22): one-sided scrims out, long scrims capped.
  if (IS_PS) setRoomRule("ps");
  // PS room: adjusted iVi uses a lower baseline, 600 ÷ the weekly PC / PS kill-speed gap (ps-baseline.mjs, owner t698).
  function paintPsBaselineNote() {
    const el = typeof document !== "undefined" ? document.getElementById("psBaselineNote") : null;
    if (!el) return;
    el.hidden = !IS_PS;
    if (!IS_PS) return;
    const sum = el.querySelector("summary");
    if (sum) sum.textContent = tr("foot.psVsPc", "PlayStation vs PC difference");
    const body = el.querySelector("#psBaselineText") || el;
    body.textContent = tr("foot.psBaseline", "On PlayStation, adjusted iVi uses a lower baseline (600 divided by the PC/PlayStation kill-speed gap, currently about {n}, rechecked weekly), and 🦁 Brave uses the same gap (×{g}) for enemy kill speed and Activity, so top players compare fairly with PC.", { n: Math.round(psIviBaseline()), g: psKpmRatio().toFixed(2) }) +
      " " + tr("foot.psResist", "🛡️ Resist, 📊 COI and ⚙️ Mech% use the same gap (Resist ×{g}), so they read on the PC scale.", { g: psKpmRatio().toFixed(2) }); // owner t717
  }
  if (IS_PS && typeof window !== "undefined") {
    paintPsBaselineNote();
    window.addEventListener("ps2-lang", paintPsBaselineNote);
  }
  /** Census bases for live loads, in search order (PC: ps2; PS: Genudine, then Ceres). */
  const CENSUS_BASES = IS_PS ? ROOMS.ps.namespaces.map((ns) => censusNsBase(ns, CENSUS_SERVICE_ID)) : [CENSUS];
  async function refreshOnlineRoom(roots) {
    for (const b of CENSUS_BASES) await refreshOnline(b, roots);
  }
  if (typeof document !== "undefined") document.documentElement.dataset.room = ROOM;
  /** Client-side Census pacing (s:example allows 10 req/min per IP). Shared by every live fetch in this tab. */
  setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") refreshOnlineRoom([els.stats, els.statsPublic]);
  }, 60_000);
  const censusBucket = tokenBucket(defaultCensusRate(CENSUS_SERVICE_ID));
  /** At most 2 Census requests in flight per tab (big killboards + batched stats). */
  const censusLimit = limitConcurrency(2);
  // #66: the skill chart (modes, ghosts, y-zoom, drawing, idle/skeleton states) moved to chart.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createChart;
  function chartPart() {
    return _createChart || (_createChart = createChart({
      get AIM_VIEW() { return AIM_VIEW; },
      get analyzeSeq() { return analyzeSeq; },
      get chartFs() { return chartFs; }, set chartFs(v) { chartFs = v; },
      get chartMode() { return chartMode; }, set chartMode(v) { chartMode = v; },
      get chartTheme() { return chartTheme; },
      get els() { return els; },
      get ghostsOn() { return ghostsOn; }, set ghostsOn(v) { ghostsOn = v; },
      get hutMarked() { return hutMarked; },
      get IS_PS() { return IS_PS; },
      get isLightTheme() { return isLightTheme; },
      get lastAnalyzedNames() { return lastAnalyzedNames; }, set lastAnalyzedNames(v) { lastAnalyzedNames = v; },
      get lastChartScale() { return lastChartScale; }, set lastChartScale(v) { lastChartScale = v; },
      get lastLoadedNames() { return lastLoadedNames; }, set lastLoadedNames(v) { lastLoadedNames = v; },
      get LS_CHART_MODE() { return LS_CHART_MODE; },
      get LS_GHOSTS() { return LS_GHOSTS; },
      get ns() { return ns; },
      get playerMark() { return playerMark; },
      get players() { return players; }, set players(v) { players = v; },
      get pureGraphFor() { return pureGraphFor; },
      get PLOT() { return PLOT; },
      get renderStatsTable() { return renderStatsTable; },
      get seriesColor() { return seriesColor; },
      get startWave() { return startWave; },
      get stopWave() { return stopWave; },
      get syncWeapons() { return syncWeapons; },
      get updateWaveRangeWarn() { return updateWaveRangeWarn; },
      get VB() { return VB; },
      get viewXMax() { return viewXMax; }, set viewXMax(v) { viewXMax = v; },
      get yScaleMode() { return yScaleMode; },
      get yScalePct() { return yScalePct; },
      get yZoom() { return yZoom; }, set yZoom(v) { yZoom = v; },
    }));
  }
  function syncYScaleUi(...a) { return chartPart().syncYScaleUi(...a); }
  function syncSmoothBtn(...a) { return chartPart().syncSmoothBtn(...a); }
  function syncChartModeUi(...a) { return chartPart().syncChartModeUi(...a); }
  function setGhostsOn(...a) { return chartPart().setGhostsOn(...a); }
  function setChartMode(...a) { return chartPart().setChartMode(...a); }
  function zoomFromSlider(...a) { return chartPart().zoomFromSlider(...a); }
  function syncYZoomUi(...a) { return chartPart().syncYZoomUi(...a); }
  function setYZoom(...a) { return chartPart().setYZoom(...a); }
  function resetYZoom(...a) { return chartPart().resetYZoom(...a); }
  function drawChart(...a) { return chartPart().drawChart(...a); }
  function currentChartFontScale(...a) { return chartPart().currentChartFontScale(...a); }
  function setChartSkeleton(...a) { return chartPart().setChartSkeleton(...a); }
  function setChartIdle(...a) { return chartPart().setChartIdle(...a); }
  function popChartSection(...a) { return chartPart().popChartSection(...a); }
  function showIdleChart(...a) { return chartPart().showIdleChart(...a); }
  function clearChartUi(...a) { return chartPart().clearChartUi(...a); }

  // Player storage is per room (#55: PS keys end in ":ps"; PC keys unchanged).
  const LS_CACHE = roomLsKey("ps2-elite-kd-cache-v2", ROOM);
  const LS_CACHE_OLD = roomLsKey("ps2-elite-kd-cache-v1", ROOM);
  const LS_RECENT = roomLsKey("ps2-elite-kd-recent", ROOM);
  const LS_LAST = roomLsKey("ps2-elite-kd-last", ROOM);
  // Current name chips (analyzed or not) so a refresh keeps the selection.
  const LS_PENDING = roomLsKey("ps2-elite-kd-pending-names", ROOM);
  const LS_THEME = "ps2-elite-kd-theme";
  // #66: the theme and background-image switches moved to theme.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createTheme;
  function themePart() {
    return _createTheme || (_createTheme = createTheme({
      get drawChart() { return drawChart; },
      get els() { return els; },
      get LS_THEME() { return LS_THEME; },
      get players() { return players; },
    }));
  }
  function getStoredTheme(...a) { return themePart().getStoredTheme(...a); }
  function applyTheme(...a) { return themePart().applyTheme(...a); }
  function toggleTheme(...a) { return themePart().toggleTheme(...a); }
  function getStoredBgImage(...a) { return themePart().getStoredBgImage(...a); }
  function applyBgImage(...a) { return themePart().applyBgImage(...a); }
  function toggleBgImage(...a) { return themePart().toggleBgImage(...a); }
  function chartTheme(...a) { return themePart().chartTheme(...a); }
  /** "1" = show older debug columns in the Adjusted table (footer checkbox). */
  const LS_DEBUG_COLS = "ps2-elite-kd-debug-cols";
  /** "1" = hide adjusted-iVi ≤ 0 players from the Rankings table browse (footer checkbox). */
  const LS_HIDE_ZERO_IVI = "ps2-elite-kd-hide-zero-ivi";
  /** Remove ranks switches (filter row + Settings): ON by default (Dayset 2026-10-22) — the key stores "1" = on / "0" = off, unset = on. */
  const LS_REMOVE_RANKS = "ps2-elite-kd-remove-ranks";
  /** Max account age in whole months (Settings stepper/input): Rankings browse hides accounts registered longer ago than this. At/above the oldest account in the data it cuts nobody. The years key is the 2026-10-22 first-ship unit; saved years values migrate ×12 on first read. */
  const LS_MAX_AGE_MONTHS = "ps2-elite-kd-max-age-months";
  const LS_MAX_AGE_YEARS = "ps2-elite-kd-max-age-years";
  /** Chart view: "banded" (🎚️ Smooth, opt-in) or anything else = cumulative (default; 💀 K/D / 🎯 aim views). Stored values unchanged. */
  // v2: Smooth shipped 2026-10-08 and test taps left "banded" saved for some
  // people, so everyone restarts on Raw once; choices saved from now on stick.
  const LS_CHART_MODE = "ps2-elite-kd-chart-mode-v2";
  const LS_CHART_MODE_OLD = "ps2-elite-kd-chart-mode";
  /** 👻 ghost (predicted) lines: "1" = on (explicit choice); anything else = off (default). */
  const LS_GHOSTS = "ps2-elite-kd-ghosts";
  /** Legacy cross-tab fetch flag (old under-load banner); only wiped now. */
  const LS_FETCHING = "ps2-elite-kd:fetching";
  // #66: the Analyze progress bar and its time estimate moved to progress.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createProgress;
  function progressPart() {
    return _createProgress || (_createProgress = createProgress({
      get els() { return els; },
      get etaLivePriorMs() { return etaLivePriorMs; }, set etaLivePriorMs(v) { etaLivePriorMs = v; },
    }));
  }
  function readEtaLivePrior(...a) { return progressPart().readEtaLivePrior(...a); }
  function setProgress(...a) { return progressPart().setProgress(...a); }
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  // #66: sending players to the shared cache, the 🔗 share link and the start-up names moved to share-add.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createShareAdd;
  function sharePart() {
    return _createShareAdd || (_createShareAdd = createShareAdd({
      get currentNamesInField() { return currentNamesInField; },
      get els() { return els; },
      get findSharedEntry() { return findSharedEntry; },
      get FRESH_PING_GAP_MS() { return FRESH_PING_GAP_MS; },
      get getLastComparison() { return getLastComparison; },
      get getNameFailure() { return getNameFailure; },
      get getPendingNames() { return getPendingNames; },
      get IS_PS() { return IS_PS; },
      get LS_SCROLL_Y() { return LS_SCROLL_Y; },
      get SEEN_TTL_MS() { return SEEN_TTL_MS; },
      get setStatus() { return setStatus; },
    }));
  }
  function isLiveMode(...a) { return sharePart().isLiveMode(...a); }
  function suggestSharedCache(...a) { return sharePart().suggestSharedCache(...a); }
  function markRequested(...a) { return sharePart().markRequested(...a); }
  function markFresh(...a) { return sharePart().markFresh(...a); }
  function censusNotesHtml(...a) { return sharePart().censusNotesHtml(...a); }
  function skippedWarningHtml(...a) { return sharePart().skippedWarningHtml(...a); }
  function copyShareLink(...a) { return sharePart().copyShareLink(...a); }
  function namesFromQuery(...a) { return sharePart().namesFromQuery(...a); }
  function resolveStartupNames(...a) { return sharePart().resolveStartupNames(...a); }
  function isReloadNavigation(...a) { return sharePart().isReloadNavigation(...a); }
  function restoreScrollAfterReload(...a) { return sharePart().restoreScrollAfterReload(...a); }
  /**
   * Empty-field Analyze default + names input placeholder: a random player
   * from the top five ⚔️ iVi tiers (🏆💎🥇🥈🥉), picked per room once its
   * ranks-lite lands (see the picker below). Empty until then — an
   * empty-field Analyze in that window does nothing.
   */
  let DEFAULT_PLACEHOLDER_NAME = "";
  const SHARED_INDEX_URL = `${DATA}index.json`;
  const SHARED_NAMES_URL = `${DATA}names.json`; // slim startup list (scripts/build-ranks.mjs buildNames)

  /** Catalog from data/index.json (shared Pages cache). */
  let sharedIndex = { updatedAt: null, players: [] };
  // #66: the shared-cache name index and the Rankings data loads moved to shared-index.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createSharedIndex;
  function sharedPart() {
    return _createSharedIndex || (_createSharedIndex = createSharedIndex({
      get confirmedPadders() { return confirmedPadders; }, set confirmedPadders(v) { confirmedPadders = v; },
      get DATA() { return DATA; },
      get fetchJson() { return fetchJson; },
      get IS_PS() { return IS_PS; },
      get isSavedName() { return isSavedName; },
      get nameLimit() { return nameLimit; },
      get namesMatch() { return namesMatch; },
      get nameTokens() { return nameTokens; },
      get rankingsApi() { return rankingsApi; }, set rankingsApi(v) { rankingsApi = v; },
      get rankVals() { return rankVals; }, set rankVals(v) { rankVals = v; },
      get scheduleGraphSync() { return scheduleGraphSync; },
      get SHARED_INDEX_URL() { return SHARED_INDEX_URL; },
      get SHARED_NAMES_URL() { return SHARED_NAMES_URL; },
      get sharedIndex() { return sharedIndex; }, set sharedIndex(v) { sharedIndex = v; },
      get toggleNameInField() { return toggleNameInField; },
      get userMovedPage() { return userMovedPage; },
    }));
  }
  function loadSharedIndex(...a) { return sharedPart().loadSharedIndex(...a); }
  function uniqueSavedName(...a) { return sharedPart().uniqueSavedName(...a); }
  function tokenLabel(...a) { return sharedPart().tokenLabel(...a); }
  function findSharedEntry(...a) { return sharedPart().findSharedEntry(...a); }
  function listSharedNames(...a) { return sharedPart().listSharedNames(...a); }
  function loadRanksLite(...a) { return sharedPart().loadRanksLite(...a); }
  function topTierFloorAdjs(...a) { return sharedPart().topTierFloorAdjs(...a); }
  function loadRankVals(...a) { return sharedPart().loadRankVals(...a); }
  function rankingsSync(...a) { return sharedPart().rankingsSync(...a); }
  function loadRankings(...a) { return sharedPart().loadRankings(...a); }
  function scheduleRankingsLoad(...a) { return sharedPart().scheduleRankingsLoad(...a); }
  /** Slugs confirmed as stat padders on review (data/reviewed.json "padding") → always "*". */
  let confirmedPadders = new Set();

  const VB = { w: 1000, h: 564 };
  /** SVG text multiplier for big desktop screens (desk-scale.mjs); 1 on mobile. */
  let chartFs = 1;
  const M = { t: 20, r: 56, b: 28, l: 56 };
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
    pairMatchBtn: document.getElementById("pairMatchBtn"),
    pairMatchNote: document.getElementById("pairMatchNote"),
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
    chartSkeleton: document.getElementById("chartSkeleton"),
    chartSection: document.getElementById("chartSection"),
    chartYZoom: document.getElementById("chartYZoom"),
    yZoomSlider: document.getElementById("yZoomSlider"),
    yZoomReset: document.getElementById("yZoomReset"),
    chartModeBar: document.getElementById("chartModeBar"),
    stats: document.getElementById("statsPanel"),
    statsPublic: document.getElementById("statsPublic"),
    debugColsToggle: document.getElementById("debugColsToggle"),
    hideZeroIviToggle: document.getElementById("hideZeroIviToggle"),
    removeRanksToggle: document.getElementById("removeRanksToggle"),
    removeRanksToggleSettings: document.getElementById("removeRanksToggleSettings"),
    maxAgeInput: document.getElementById("maxAgeInput"),
    maxAgeMinus: document.getElementById("maxAgeMinus"),
    maxAgePlus: document.getElementById("maxAgePlus"),
  };
  // ✨ Stats ⇄ 🏅 Positions share one spot (stats-carousel.mjs); same switch sound as the graph modes.
  if (!LIVE_MODE) mountStatsCarousel({ root: document.getElementById("statsCarousel"), onChange: () => sfx("sparkle") });

  // Dayset 2026-10-20: on phones (portrait) the options group (language /
  // wipe / sounds / theme) lives inside the names field, bottom-right — the
  // fresh row then holds only 🆕 and the centered ❓📖❓. The portrait CSS
  // positions it there; this only moves the node with the breakpoint.
  if (!LIVE_MODE) {
    const phoneMq = matchMedia("(max-width: 600px) and (orientation: portrait)");
    const placeOpts = () => {
      const end = document.querySelector(".fresh-row-end");
      const box = document.getElementById("namesBox");
      const row = document.querySelector(".fresh-row");
      if (!end || !box || !row) return;
      if (phoneMq.matches) { if (end.parentElement !== box) box.appendChild(end); }
      else if (end.parentElement !== row) row.appendChild(end);
    };
    placeOpts();
    if (phoneMq.addEventListener) phoneMq.addEventListener("change", placeOpts);
    // Dayset 2026-10-20: the field's TOP margin (.top-gap CSS) stays while
    // ≤2 names are in the field; from the 3rd name on it goes away and the
    // field sits flush with the panel top, saving the space.
    const tokensEl = document.getElementById("nameTokens");
    const boxEl = document.getElementById("namesBox");
    if (tokensEl && boxEl) {
      const syncGap = () => boxEl.classList.toggle("top-gap", tokensEl.querySelectorAll(".name-token").length <= 2);
      syncGap();
      new MutationObserver(syncGap).observe(tokensEl, { childList: true });
    }
  }

  let players = [];
  let lastAnalyzedNames = [];
  /** Subset of lastAnalyzedNames that actually loaded (graphed) last run. */
  let lastLoadedNames = [];
  /** t351u: slugKey(input name) → graphed player from the last run (removal / re-Analyze reuse). */
  let lastPlayerByKey = new Map();
  let graphSyncTimer = 0;
  /** Preferred open state for shared-cache <details> (collapsed by default). */
  let sharedCacheWantOpen = false;
  // #66: the saved-players chips (A–Z bar, groups, picks) moved to cache-chips.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createCacheChips;
  function cacheChipsPart() {
    return _createCacheChips || (_createCacheChips = createCacheChips({
      get cacheSelTimer() { return cacheSelTimer; }, set cacheSelTimer(v) { cacheSelTimer = v; },
      get currentNamesInField() { return currentNamesInField; },
      get els() { return els; },
      get listCachedNames() { return listCachedNames; },
      get nameSpan() { return nameSpan; },
      get poopHtml() { return poopHtml; },
      get sharedCacheWantOpen() { return sharedCacheWantOpen; }, set sharedCacheWantOpen(v) { sharedCacheWantOpen = v; },
      get sharedIndex() { return sharedIndex; },
      get toggleNameInField() { return toggleNameInField; },
      get updateFreshEta() { return updateFreshEta; },
    }));
  }
  function updateCacheSelection(...a) { return cacheChipsPart().updateCacheSelection(...a); }
  function scheduleCacheSelection(...a) { return cacheChipsPart().scheduleCacheSelection(...a); }
  function renderCacheChips(...a) { return cacheChipsPart().renderCacheChips(...a); }
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
  // t488u (owner): the 🎯 iVi ("IN THEORY") graph view is switched off — the graph
  // only shows 💀 K/D. Its code stays in place: set true to bring the view back
  // (the 💀 / 🎯 buttons, swipe / wheel / ←→ flips all follow this flag).
  const AIM_VIEW = false;
  let yScalePct = 50;
  let ghostsOn = !IS_PS && readGhostsOn(); // 👻 model is fit on PC players (#55)
  let fetching = false;
  /** Active analyze run: { controller, signal } or null. */
  let activeRun = null;
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

  /* ---------- names cap ---------- */
  const MAX_NAMES = 6;
  /* Debug lifts the cap (Dayset 2026-10-21): with the footer's "show
   * older debug stats" box ticked there is no names limit at all — no cap
   * on adding, no limit warnings, no input/button lock, no truncation.
   * readShowDebugCols (hoisted declaration below) is the same source of
   * truth the debug columns render from; every call site runs live. */
  const nameLimit = () => (readShowDebugCols() ? Number.POSITIVE_INFINITY : MAX_NAMES);
  const LIMIT_HINT_HTML = `<span class="warn">${tr("msg.limitReached", "{n} players limit reached", { n: MAX_NAMES })}</span>`;

  // #66: the name field (chips, limit note and toast, 🎲 dice, failed names) moved to names-field.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createNamesField;
  function namesPart() {
    return _createNamesField || (_createNamesField = createNamesField({
      get cacheGet() { return cacheGet; },
      get clearGraphReadyHint() { return clearGraphReadyHint; },
      get DEFAULT_PLACEHOLDER_NAME() { return DEFAULT_PLACEHOLDER_NAME; },
      get els() { return els; },
      get failedNames() { return failedNames; },
      get fetching() { return fetching; },
      get findSharedEntry() { return findSharedEntry; },
      get graphReadyHintTimer() { return graphReadyHintTimer; }, set graphReadyHintTimer(v) { graphReadyHintTimer = v; },
      get isListFull() { return isListFull; },
      get isSavedName() { return isSavedName; },
      get lastLoadedNames() { return lastLoadedNames; },
      get LIMIT_HINT_HTML() { return LIMIT_HINT_HTML; },
      get limitLockReady() { return limitLockReady; },
      get limitNoteFaded() { return limitNoteFaded; }, set limitNoteFaded(v) { limitNoteFaded = v; },
      get LIVE_MODE() { return LIVE_MODE; },
      get loadRankVals() { return loadRankVals; },
      get MAX_NAMES() { return MAX_NAMES; },
      get nameLimit() { return nameLimit; },
      get nameSpan() { return nameSpan; },
      get nameTokens() { return nameTokens; }, set nameTokens(v) { nameTokens = v; },
      get persistPendingNames() { return persistPendingNames; },
      get players() { return players; },
      get poopHtml() { return poopHtml; },
      get rankingsSync() { return rankingsSync; },
      get rankVals() { return rankVals; },
      get renderCacheChips() { return renderCacheChips; },
      get runAnalyzeFromUi() { return runAnalyzeFromUi; },
      get scheduleGraphSync() { return scheduleGraphSync; },
      get setChartIdle() { return setChartIdle; },
      get setStatus() { return setStatus; },
      get tokenLabel() { return tokenLabel; },
      get topTierFloorAdjs() { return topTierFloorAdjs; },
    }));
  }
  function getNameFailure(...a) { return namesPart().getNameFailure(...a); }
  function isNameFetched(...a) { return namesPart().isNameFetched(...a); }
  function setNameTokens(...a) { return namesPart().setNameTokens(...a); }
  function clearNameFailures(...a) { return namesPart().clearNameFailures(...a); }
  function namesMatch(...a) { return namesPart().namesMatch(...a); }
  function rollDice(...a) { return namesPart().rollDice(...a); }
  function toggleNameInField(...a) { return namesPart().toggleNameInField(...a); }
  function syncNamesPlaceholder(...a) { return namesPart().syncNamesPlaceholder(...a); }
  function showLimitNote(...a) { return namesPart().showLimitNote(...a); }
  function hideLimitNote(...a) { return namesPart().hideLimitNote(...a); }
  function syncLimitLock(...a) { return namesPart().syncLimitLock(...a); }
  function lockedClick(...a) { return namesPart().lockedClick(...a); }
  function renderNameTokens(...a) { return namesPart().renderNameTokens(...a); }
  function commitFragment(...a) { return namesPart().commitFragment(...a); }
  function currentNamesInField(...a) { return namesPart().currentNamesInField(...a); }
  function clearNamesFromInput(...a) { return namesPart().clearNamesFromInput(...a); }
  function showLimitHint(...a) { return namesPart().showLimitHint(...a); }
  function hideLimitToast(...a) { return namesPart().hideLimitToast(...a); }
  function clearLimitHint(...a) { return namesPart().clearLimitHint(...a); }

  function showGraphReadyHint() {
    if (!els.status) return;
    if (graphReadyHintTimer) {
      clearTimeout(graphReadyHintTimer);
      graphReadyHintTimer = 0;
    }
    setStatus(
      '<div class="graph-ready-hint">' +
        `<div>${tr("msg.graphReady", "Your Graph is ready.")}</div>` +
        `<div>${tr("msg.graphReadySub", "Enter a new name to analyze.")}</div>` +
      "</div>",
      "graph-ready"
    );
    // Auto-fade after ~2s
    graphReadyHintTimer = setTimeout(() => {
      if (!els.status || !els.status.classList.contains("graph-ready")) return;
      els.status.classList.add("graph-ready-fade");
      graphReadyHintTimer = setTimeout(() => {
        graphReadyHintTimer = 0;
        if (els.status && els.status.classList.contains("graph-ready")) setStatus("");
        // Dayset 2026-10-19: once the hint is gone, nudge the page so the
        // ✨ Stats / 🏅 Positions tab bar slides off the top and the stats
        // table is the first thing on screen. Only ever scrolls down — never
        // yanks the page back up if the user already scrolled past.
        scrollStatsPanelToTop();
      }, 450);
    }, 2000);
  }

  /** Scroll the stats table to the top of the screen (Dayset 2026-10-19). */
  function scrollStatsPanelToTop() {
    if (typeof window === "undefined" || !window.scrollTo) return;
    const target = els.stats;
    if (!target || !target.getBoundingClientRect) return;
    const raf = window.requestAnimationFrame
      ? (fn) => window.requestAnimationFrame(fn)
      : (fn) => setTimeout(fn, 16);
    raf(() => {
      const y = window.scrollY || window.pageYOffset || 0;
      const top = Math.max(
        0,
        Math.round(target.getBoundingClientRect().top + y - 3)
      );
      if (y >= top - 8) return; // already there or scrolled past — leave it
      const reduce =
        !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Short pages (few names on a phone) can't scroll the panel to the top:
      // pad the bottom just enough so the tab bar can slide fully out of view.
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
    });
  }

  let etaLivePriorMs = readEtaLivePrior();

  /* ---------- theme (dark / creamy light): theme.mjs ---------- */

  /* math: imported from ./math.mjs */

  /** Shared with build-log.html (player-metrics.mjs) so numbers always match. */
  function normalizePlayer(raw) {
    // 🚫 Players removed at their request never show up as someone's opponent (#61).
    const rp = raw && raw.player;
    if (rp && removedNow.size) removedNow.blankOpponents(rp.rows, raw.server || rp.server || "");
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
      // 🪖 / 🚜 just the kill split the Infantry column and the vehicle / MAX cut need (infantry.mjs v2).
      infantry: p.infantry && p.infantry.v >= 2
        ? { v: p.infantry.v, kills: p.infantry.kills, footKills: p.infantry.footKills, maxKills: p.infantry.maxKills, vehKills: p.infantry.vehKills, otherKills: p.infantry.otherKills }
        : null,
    };
  }

  /* ---------- shared data/ cache (GitHub Pages / Actions) ---------- */

  /* ---------- localStorage helpers ---------- */

  // #66: this browser's saved players, last comparison and the wipe moved to local-cache.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createLocalCache;
  function localCachePart() {
    return _createLocalCache || (_createLocalCache = createLocalCache({
      get applyBgImage() { return applyBgImage; },
      get applyTheme() { return applyTheme; },
      get CACHE_TTL_MS() { return CACHE_TTL_MS; },
      get clearChartUi() { return clearChartUi; },
      get els() { return els; },
      get failedNames() { return failedNames; },
      get lastAnalyzedNames() { return lastAnalyzedNames; }, set lastAnalyzedNames(v) { lastAnalyzedNames = v; },
      get lastLoadedNames() { return lastLoadedNames; }, set lastLoadedNames(v) { lastLoadedNames = v; },
      get listSharedNames() { return listSharedNames; },
      get LIVE_MODE() { return LIVE_MODE; },
      get LS_CACHE() { return LS_CACHE; },
      get LS_CACHE_OLD() { return LS_CACHE_OLD; },
      get LS_DEBUG_COLS() { return LS_DEBUG_COLS; },
      get LS_FETCHING() { return LS_FETCHING; },
      get LS_LAST() { return LS_LAST; },
      get LS_PENDING() { return LS_PENDING; },
      get LS_RECENT() { return LS_RECENT; },
      get LS_THEME() { return LS_THEME; },
      get nameLimit() { return nameLimit; },
      get namesFromQuery() { return namesFromQuery; },
      get nameTokens() { return nameTokens; }, set nameTokens(v) { nameTokens = v; },
      get persistNamesOn() { return persistNamesOn; },
      get players() { return players; }, set players(v) { players = v; },
      get renderCacheChips() { return renderCacheChips; },
      get renderNameTokens() { return renderNameTokens; },
      get setStatus() { return setStatus; },
      get showDebugCols() { return showDebugCols; },
      get syncUrlNames() { return syncUrlNames; },
      get trimForCache() { return trimForCache; },
      get updateFreshEta() { return updateFreshEta; },
    }));
  }
  function cacheGet(...a) { return localCachePart().cacheGet(...a); }
  function cachePut(...a) { return localCachePart().cachePut(...a); }
  function listCachedNames(...a) { return localCachePart().listCachedNames(...a); }
  function forgetLastComparison(...a) { return localCachePart().forgetLastComparison(...a); }
  function saveLastComparison(...a) { return localCachePart().saveLastComparison(...a); }
  function getLastComparison(...a) { return localCachePart().getLastComparison(...a); }
  function persistPendingNames(...a) { return localCachePart().persistPendingNames(...a); }
  function getPendingNames(...a) { return localCachePart().getPendingNames(...a); }
  function wipeAllLocalAppData(...a) { return localCachePart().wipeAllLocalAppData(...a); }

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

  /*
   * Keep the field's chips across a refresh: saved on every change (incl. an
   * empty list after × / 🗑️, so a cleared field stays cleared). `base` = the
   * ?names= in the address bar at save time, so edits made on top of an
   * analyzed (URL-synced) comparison come back after its auto-run.
   * Off until startup has restored the field (no clobbering while loading).
   */
  let persistNamesOn = false;

  /* ---------- tokenized name input / chips / last link ---------- */

  let rankVals = null;

  // Default name (both rooms): a random player from the top five ⚔️ iVi
  // tiers (🏆💎🥇🥈🥉 — adjusted iVi at/above the cached median), never the
  // lower half (Dayset 2026-10-22; was PC ShloDog / PS top player).
  if (typeof window !== "undefined") {
    if (els.namesInput) els.namesInput.placeholder = "";
    loadRanksLite().then(async (d) => {
      if (!d || !Array.isArray(d.cols) || !Array.isArray(d.rows)) return;
      const iN = d.cols.indexOf("name"), iA = d.cols.indexOf("adjs");
      if (iN < 0 || iA < 0) return;
      const floor = await topTierFloorAdjs();
      const pool = d.rows.filter((r) => Number.isFinite(r[iA]) && r[iA] >= floor);
      if (!pool.length) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      DEFAULT_PLACEHOLDER_NAME = bareName(pick[iN]);
      syncNamesPlaceholder();
    }).catch(() => {});
  }

  let limitLockReady = false; // false during startup (?names= / restore)
  const isListFull = () => nameTokens.length >= nameLimit();
  let limitNoteFaded = false; // true once the note faded for the current full list

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
  if (typeof window !== "undefined") window.__loadRankings = loadRankings;

  /** t306u: "~20 s for 3 names" next to Fetch fresh while it's ticked (hidden otherwise). */
  function updateFreshEta() {
    const el = els.freshEta;
    if (!el) return;
    const on = !!(els.fetchFresh && els.fetchFresh.checked && !els.fetchFresh.disabled);
    const text = on ? freshEtaText(currentNamesInField().length, etaLivePriorMs) : "";
    el.textContent = text;
    el.hidden = !text;
  }

 // { sig, groups, byLetter }

  let cacheSelTimer = 0;

 // up to this many names start open

  /* ---------- abort helpers ---------- */

  /* ---------- loaders ---------- */

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

  /** The 🎥 Live button hides behind the same "show older debug stats" box. */
  function syncLiveBtn() {
    if (els.liveBtn) els.liveBtn.hidden = IS_PS || !showDebugCols; // Live is PC only (#55)
  }

  /** Right edge of the visible X window (X_MAX unless zoomed into the left). */
  let viewXMax = X_MAX;

  if (typeof window !== "undefined") {
    let deskResizeT = 0;
    window.addEventListener("resize", () => {
      clearTimeout(deskResizeT);
      deskResizeT = setTimeout(() => {
        if (players.length && currentChartFontScale() !== chartFs) drawChart(players);
      }, 150);
    });
  }

  // #66: the ✨ Stats table and the name cells (marks, flairs, server tags) moved to stats-table.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createStatsTable;
  function statsPart() {
    return _createStatsTable || (_createStatsTable = createStatsTable({
      get CENSUS() { return CENSUS; },
      get CENSUS_BASES() { return CENSUS_BASES; },
      get censusJson() { return censusJson; },
      get confirmedPadders() { return confirmedPadders; },
      get currentNamesInField() { return currentNamesInField; },
      get els() { return els; },
      get hutBySlug() { return hutBySlug; }, set hutBySlug(v) { hutBySlug = v; },
      get hutMarked() { return hutMarked; },
      get hutOf() { return hutOf; },
      get IS_PS() { return IS_PS; },
      get isSavedName() { return isSavedName; },
      get lastStatsList() { return lastStatsList; }, set lastStatsList(v) { lastStatsList = v; },
      get liteSlugs() { return liteSlugs; }, set liteSlugs(v) { liteSlugs = v; },
      get LIVE_MODE() { return LIVE_MODE; },
      get loadRanksLite() { return loadRanksLite; },
      get loadRanksPayload() { return () => sharedPart().loadRanksPayload(); },
      get DATA() { return DATA; },
      get LS_DEBUG_COLS() { return LS_DEBUG_COLS; },
      get nameTokens() { return nameTokens; },
      get nbdBySlug() { return nbdBySlug; }, set nbdBySlug(v) { nbdBySlug = v; },
      get nbdCutsLite() { return nbdCutsLite; }, set nbdCutsLite(v) { nbdCutsLite = v; },
      get nbhBySlug() { return nbhBySlug; }, set nbhBySlug(v) { nbhBySlug = v; },
      get refreshOnlineRoom() { return refreshOnlineRoom; },
      get ROOM() { return ROOM; },
      get rvpBySlug() { return rvpBySlug; }, set rvpBySlug(v) { rvpBySlug = v; },
      get crpBySlug() { return crpBySlug; }, set crpBySlug(v) { crpBySlug = v; },
      get seriesColor() { return seriesColor; },
      get serverTagHtml() { return serverTagHtml; },
      get showDebugCols() { return showDebugCols; },
      get thinCellTip() { return thinCellTip; },
      get toggleNameInField() { return toggleNameInField; },
      get vdfBySlug() { return vdfBySlug; }, set vdfBySlug(v) { vdfBySlug = v; },
    }));
  }
  function readShowDebugCols(...a) { return statsPart().readShowDebugCols(...a); }
  function reserveStatsSpace(...a) { return statsPart().reserveStatsSpace(...a); }
  function syncWeapons(...a) { return statsPart().syncWeapons(...a); }
  function renderStatsTable(...a) { return statsPart().renderStatsTable(...a); }
  function pureGraphFor(...a) { return statsPart().pureGraphFor(...a); }
  function nameSpan(...a) { return statsPart().nameSpan(...a); }
  function playerMark(...a) { return statsPart().playerMark(...a); }
  function poopHtml(...a) { return statsPart().poopHtml(...a); }
  function sourceLabel(...a) { return statsPart().sourceLabel(...a); }

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
      // The names cap follows this same box (Dayset 2026-10-21): re-sync
      // the lock so a full list unlocks the moment debug goes on, and
      // clear any limit warnings still on screen.
      syncLimitLock();
      if (showDebugCols) { hideLimitNote(); clearLimitHint(); hideLimitToast(); }
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

  /* Remove ranks (Dayset 2026-10-22): one switch by the Rankings filter and
   * the same switch inside ⚙️ Settings — the pair stays in sync, the choice
   * is saved, and Rankings hears the same "change" and re-renders flat. */
  {
    const pair = [els.removeRanksToggle, els.removeRanksToggleSettings].filter(Boolean);
    if (pair.length) {
      let on = true; // default ON (Dayset 2026-10-22); only a saved "0" is off
      try { on = localStorage.getItem(LS_REMOVE_RANKS) !== "0"; } catch (_) { /* private mode */ }
      pair.forEach((el) => { el.checked = on; });
      pair.forEach((el) => el.addEventListener("change", () => {
        const v = !!el.checked;
        pair.forEach((o) => { o.checked = v; });
        try {
          localStorage.setItem(LS_REMOVE_RANKS, v ? "1" : "0");
        } catch (_) {
          /* private mode: Rankings keeps its own in-memory choice */
        }
      }));
    }
  }

  /* Max account age (Settings): − / + steppers and a directly editable value
   * in whole months, 1-month steps (Dayset 2026-10-22: months read better
   * than decimal years). app.js owns the control and the saved value;
   * Rankings reads the same key and hears the input's "change" (fired by the
   * steppers, and by typed edits — this clamp runs first, so Rankings sees
   * the final value). With nothing saved the input shows a stand-in ceiling
   * above any real account age (cuts nobody); Rankings refines the ceiling
   * to the oldest account in the loaded data once it arrives. */
  if (els.maxAgeInput) {
    const AGE_CEIL_FALLBACK = 200;
    const ageCeil = () => parseFloat(els.maxAgeInput.max) || AGE_CEIL_FALLBACK;
    // 0 = max age (Dayset 2026-10-22): entering 0 means the ceiling value
    // (the oldest account's age — cuts nobody), not 1 month.
    const clampAge = (v) => {
      const r = Math.round(v);
      return r <= 0 ? ageCeil() : Math.min(ageCeil(), r);
    };
    const ageShown = () => {
      const v = parseFloat(els.maxAgeInput.value);
      return Number.isFinite(v) ? v : ageCeil();
    };
    const applyAge = (v, fire) => {
      const cl = clampAge(v);
      els.maxAgeInput.value = String(cl);
      try {
        localStorage.setItem(LS_MAX_AGE_MONTHS, String(cl));
        localStorage.removeItem(LS_MAX_AGE_YEARS);
      } catch (_) { /* private mode */ }
      if (fire) els.maxAgeInput.dispatchEvent(new Event("change", { bubbles: true }));
    };
    els.maxAgeInput.max = AGE_CEIL_FALLBACK;
    let savedAge = NaN;
    try {
      savedAge = parseFloat(localStorage.getItem(LS_MAX_AGE_MONTHS));
      if (!Number.isFinite(savedAge)) {
        // First-ship values were decimal years: migrate ×12, once.
        const yrs = parseFloat(localStorage.getItem(LS_MAX_AGE_YEARS));
        if (Number.isFinite(yrs)) {
          savedAge = Math.round(yrs * 12);
          localStorage.setItem(LS_MAX_AGE_MONTHS, String(savedAge));
          localStorage.removeItem(LS_MAX_AGE_YEARS);
        }
      }
    } catch (_) { /* private mode */ }
    els.maxAgeInput.value = String(Number.isFinite(savedAge) ? clampAge(savedAge) : AGE_CEIL_FALLBACK);
    /* Press-and-hold repeats, faster the longer the hold (Dayset 2026-10-22):
     * one step on press, repeats start after 0.4 s at ~12/s, then ~33/s.
     * The click that follows a pointer press is swallowed (the press already
     * stepped); a click without a press (keyboard / assistive) steps once. */
    const holdStep = (btn, dir) => {
      if (!btn) return;
      let timer = 0, pressed = false;
      const stop = () => { clearTimeout(timer); timer = 0; };
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pressed = true;
        applyAge(ageShown() + dir, true);
        let n = 0;
        const tick = () => { applyAge(ageShown() + dir, true); n += 1; timer = setTimeout(tick, n < 10 ? 80 : 30); };
        stop();
        timer = setTimeout(tick, 400);
      });
      for (const evName of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(evName, stop);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        if (pressed) { pressed = false; return; }
        applyAge(ageShown() + dir, true);
      });
    };
    holdStep(els.maxAgeMinus, -1);
    holdStep(els.maxAgePlus, 1);
    els.maxAgeInput.addEventListener("change", () => applyAge(ageShown(), false));
  }

 // median infantry % (owner t590u 🚜 switch point)
  // 🛖 safe-spot damping factor on positive 🔀 Diff by slug (hut.mjs, ranks-lite "hut"); reviewed.json "hut": "cleared" is applied at build time.
  let hutBySlug = null; // slug → { f: factor, mk: 🛖 shown (drop ≥ HUT_MARK_MIN points) }
  const hutOf = (display) => {
    if (!hutBySlug || !display) return null;
    const e = hutBySlug.get(slugKey(display));
    return e ? e.f : null;
  };
  const hutMarked = (display) => hutOf(display) != null && hutBySlug.get(slugKey(display)).mk;
  // 🔀 vehicle damp factor (diff-vehicle.mjs, ranks-lite "vdf") and 🪳 revive / crowd percentiles (zerg-revive.mjs, "rvp" / "crp") by slug; reviewed.json clearances applied at build time.
  // 🐣 newbie factor on a negative 🔀 Diff (newbie-diff.mjs, ranks-lite "nbd").
  // 🐣 "nbh" = new-player hours; liteSlugs = players in this build. A player fetched after
  // the build (not in liteSlugs) is rated here from lifetime kills ÷ KPM with the build's
  // nbdCuts (same rule as build-ranks.mjs; reviewed.json clearances are build-side only).
  let vdfBySlug = null, rvpBySlug = null, crpBySlug = null, nbdBySlug = null, nbhBySlug = null, liteSlugs = null, nbdCutsLite = null;
 // sorted population scores (hover "top / bottom X%")

  // #66: the 🌊 wave and the y-scale switch moved to chart-wave.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createChartWave;
  function wavePart() {
    return _createChartWave || (_createChartWave = createChartWave({
      get AIM_VIEW() { return AIM_VIEW; },
      get chartOnScreen() { return chartOnScreen; },
      get drawChart() { return drawChart; },
      get ghostsOn() { return ghostsOn; },
      get players() { return players; },
      get setGhostsOn() { return setGhostsOn; },
      get syncChartModeUi() { return syncChartModeUi; },
      get syncYScaleUi() { return syncYScaleUi; },
      get WAVE_AMP() { return WAVE_AMP; },
      get WAVE_MAX() { return WAVE_MAX; },
      get WAVE_MID() { return WAVE_MID; },
      get WAVE_MIN() { return WAVE_MIN; },
      get WAVE_RAD_PER_MS() { return WAVE_RAD_PER_MS; },
      get waveOn() { return waveOn; }, set waveOn(v) { waveOn = v; },
      get yScaleMode() { return yScaleMode; }, set yScaleMode(v) { yScaleMode = v; },
      get yScalePct() { return yScalePct; }, set yScalePct(v) { yScalePct = v; },
      get ySlider() { return ySlider; },
      get ySliderVal() { return ySliderVal; },
    }));
  }
  function setYScaleMode(...a) { return wavePart().setYScaleMode(...a); }
  function updateWaveRangeWarn(...a) { return wavePart().updateWaveRangeWarn(...a); }
  function startWave(...a) { return wavePart().startWave(...a); }
  function stopWave(...a) { return wavePart().stopWave(...a); }

  // #69: the Analyze controller (runs, cancel, chip ↔ graph sync, the Analyze controls' events) moved to analyze.mjs unchanged. These wrappers keep the old names; the part is created on
  // first use and reads this file's state through live getters (and setters where it changes it).
  var _createAnalyze;
  function analyzePart() {
    return _createAnalyze || (_createAnalyze = createAnalyze({
      get activeRun() { return activeRun; }, set activeRun(v) { activeRun = v; },
      get analyzeSeq() { return analyzeSeq; }, set analyzeSeq(v) { analyzeSeq = v; },
      get cacheGet() { return cacheGet; },
      get cachePut() { return cachePut; },
      get cacheSelTimer() { return cacheSelTimer; },
      get CENSUS() { return CENSUS; },
      get CENSUS_BASES() { return CENSUS_BASES; },
      get censusNotesHtml() { return censusNotesHtml; },
      get clearChartUi() { return clearChartUi; },
      get clearGraphReadyHint() { return clearGraphReadyHint; },
      get clearLimitHint() { return clearLimitHint; },
      get clearNameFailures() { return clearNameFailures; },
      get collapseSharedCache() { return collapseSharedCache; },
      get commitFragment() { return commitFragment; },
      get currentNamesInField() { return currentNamesInField; },
      get DATA() { return DATA; },
      get DEFAULT_PLACEHOLDER_NAME() { return DEFAULT_PLACEHOLDER_NAME; },
      get drawChart() { return drawChart; },
      get els() { return els; },
      get failedNames() { return failedNames; },
      get fetching() { return fetching; }, set fetching(v) { fetching = v; },
      get findSharedEntry() { return findSharedEntry; },
      get forgetLastComparison() { return forgetLastComparison; },
      get getNameFailure() { return getNameFailure; },
      get graphSyncTimer() { return graphSyncTimer; }, set graphSyncTimer(v) { graphSyncTimer = v; },
      get IS_PS() { return IS_PS; },
      get isListFull() { return isListFull; },
      get isLiveMode() { return isLiveMode; },
      get isNameFetched() { return isNameFetched; },
      get isReloadNavigation() { return isReloadNavigation; },
      get lastAnalyzedNames() { return lastAnalyzedNames; }, set lastAnalyzedNames(v) { lastAnalyzedNames = v; },
      get lastLoadedNames() { return lastLoadedNames; }, set lastLoadedNames(v) { lastLoadedNames = v; },
      get lastPlayerByKey() { return lastPlayerByKey; }, set lastPlayerByKey(v) { lastPlayerByKey = v; },
      get limitNoteFaded() { return limitNoteFaded; }, set limitNoteFaded(v) { limitNoteFaded = v; },
      get LIVE_MODE() { return LIVE_MODE; },
      get loadOne() { return loadOne; },
      get loadRankings() { return loadRankings; },
      get markFresh() { return markFresh; },
      get markRequested() { return markRequested; },
      get nameLimit() { return nameLimit; },
      get nameTokens() { return nameTokens; },
      get players() { return players; }, set players(v) { players = v; },
      get popChartSection() { return popChartSection; },
      get renderCacheChips() { return renderCacheChips; },
      get renderNameTokens() { return renderNameTokens; },
      get resetYZoom() { return resetYZoom; },
      get restoreScrollAfterReload() { return restoreScrollAfterReload; },
      get saveLastComparison() { return saveLastComparison; },
      get scheduleCacheSelection() { return scheduleCacheSelection; },
      get setChartIdle() { return setChartIdle; },
      get setChartSkeleton() { return setChartSkeleton; },
      get setNameTokens() { return setNameTokens; },
      get setProgress() { return setProgress; },
      get setStatus() { return setStatus; },
      get showGraphReadyHint() { return showGraphReadyHint; },
      get showIdleChart() { return showIdleChart; },
      get showLimitHint() { return showLimitHint; },
      get showLimitNote() { return showLimitNote; },
      get skippedWarningHtml() { return skippedWarningHtml; },
      get sourceLabel() { return sourceLabel; },
      get suggestSharedCache() { return suggestSharedCache; },
      get syncNamesPlaceholder() { return syncNamesPlaceholder; },
      get syncUrlNames() { return syncUrlNames; },
      get uniqueSavedName() { return uniqueSavedName; },
      get updateCacheSelection() { return updateCacheSelection; },
      get updateFreshEta() { return updateFreshEta; },
      get userMovedPage() { return userMovedPage; },
    }));
  }
  function cancelAnalyze(...a) { return analyzePart().cancelAnalyze(...a); }
  function analyzeNames(...a) { return analyzePart().analyzeNames(...a); }
  function scheduleGraphSync(...a) { return analyzePart().scheduleGraphSync(...a); }
  function isSavedName(...a) { return analyzePart().isSavedName(...a); }
  function runAnalyzeFromUi(...a) { return analyzePart().runAnalyzeFromUi(...a); }
  function autoRunFromLink(...a) { return analyzePart().autoRunFromLink(...a); }

  /* The collapsible skill-graph section: analyzing pops it open — when the
   * drawn names change, or when a fresh Analyze runs (even for the same
   * names after a manual fold). Redraws for other reasons (language, theme,
   * resize) leave the fold exactly as the user left it. */
  let analyzeSeq = 0;

  /**
   * Fire-and-forget: tell the Worker which shared-cache players were analyzed
   * (names only), so the background refresh collects full Honu XP detail for
   * them. Deduped per browser (24 h) and silent; no UI.
   */
  const SEEN_TTL_MS = 24 * 3600 * 1000;

  /**
   * Fire-and-forget (t300u): after "Fetch fresh", tell the Worker which cached
   * players were just fetched live so the next background run refreshes their
   * shared file first. Names only (POST /seen with fresh:true); the browser's
   * data is never uploaded. Deduped per browser for FRESH_PING_GAP_MS.
   */
  const FRESH_PING_GAP_MS = 3600 * 1000;

  /* ---------- events ---------- */

  analyzePart().wireAnalyzeEvents(); // #69: the Analyze controls' listeners (analyze.mjs)

  // 📝 Update log counter (Dayset 2026-10-20): "(N commits since Oct 7, 2026)"
  // beside the footer link — page commits only: the repo's contributors list
  // minus every [bot] identity (routine cache refreshes + service bots), so
  // the number grows with real work. One API call, cached 6h in localStorage;
  // on any failure the counter simply stays hidden.
  (function pageCommitCount() {
    const el = document.getElementById("pageCommitCount");
    if (!el) return;
    const show = (n) => {
      if (n > 0) {
        el.textContent = tr("foot.commits", "({n} commits since Oct 7, 2026)", { n });
        el.hidden = false;
      }
    };
    const KEY = "ps2ekd-page-commits";
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || "null");
      if (c && Date.now() - c.t < 6 * 3600e3) { show(c.n); return; }
    } catch {}
    fetch("https://api.github.com/repos/Dayset/ps2-elite-kd/contributors?per_page=100&anon=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (!Array.isArray(list)) return;
        let n = 0;
        for (const c of list) {
          const who = String(c.login || c.name || "");
          if (/\[bot\]$/i.test(who)) continue;
          if (Number.isFinite(c.contributions)) n += c.contributions;
        }
        try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), n })); } catch {}
        show(n);
      })
      .catch(() => {});
  })();

  /**
   * Footer cache-growth line, under the commit count: how many new names
   * the shared cache adds per day = total cached names (data/names.json,
   * data-ps/names.json in the PlayStation room) ÷ days online (launch =
   * first commit: Oct 7, 2026 PC, Oct 22, 2026 PS). Computed in the
   * page like the commit counter above; the total is re-fetched at most
   * once a day (localStorage day stamp), the per-day rate is recomputed
   * from the stored total on every load.
   */
  (function pageNameRate() {
    const el = document.getElementById("pageNameRate");
    if (!el) return; // owner 2026-10-26: both rooms — the line is the mirror's liveness signal
    const LAUNCH_UTC = IS_PS ? Date.UTC(2026, 9, 22) : Date.UTC(2026, 9, 7);
    const compute = (total) => {
      const now = new Date();
      const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const days = Math.max(1, Math.round((todayUtc - LAUNCH_UTC) / 86400000));
      return { total, perDay: Math.round(total / days) };
    };
    const fmtStamp = (iso) => {
      const t = Date.parse(iso || "");
      if (!Number.isFinite(t)) return "";
      return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    };
    const show = (r) => {
      if (r && r.total > 0) {
        // Rate first (Dayset 2026-10-20; the cached total itself already shows
        // in the recent players added line), then the stacked liveness stamps
        // (owner 2026-10-28): growth, then last bot run.
        let text = tr("foot.namesPerDay", "≈{perDay} New names a day.", {
          perDay: r.perDay.toLocaleString(),
        });
        const grown = fmtStamp(r.updatedAt);
        if (grown) text += " " + tr("foot.mirrorUpdated", "Mirror updated {date}.", { date: grown });
        const run = fmtStamp(r.lastRun);
        if (run) text += " " + tr("foot.lastRun", "Last bot run {date}.", { date: run });
        el.textContent = text;
        el.hidden = false;
      }
    };
    // Last discovery sweep doneAt: PC has one sweep; PS takes the latest across its servers.
    const runOf = (d) => {
      if (!d) return null;
      if (!IS_PS) return (d.lastSweep && d.lastSweep.doneAt) || (d.sweep && d.sweep.lastDoneAt) || d.updatedAt || null;
      const servers = d.servers ? Object.values(d.servers) : [];
      const done = servers.map((s) => (s.lastSweep && s.lastSweep.doneAt) || (s.sweep && s.sweep.lastDoneAt)).filter(Boolean);
      if (done.length) return done.sort()[done.length - 1];
      return d.updatedAt || null;
    };
    const KEY = IS_PS ? "ps2ekd-page-namerate-ps" : "ps2ekd-page-namerate"; // room-scoped: a PC total cached today must not show in the PS room
    const today = new Date().toDateString();
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || "null");
      // lastRun !== undefined: pre-stamp caches (no such field) refetch once, then the new shape is kept.
      if (c && c.day === today && c.total > 0 && c.lastRun !== undefined) {
        show({ ...compute(c.total), updatedAt: c.updatedAt || null, lastRun: c.lastRun });
        return;
      }
    } catch {}
    const fetchJson = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([
      fetchJson(IS_PS ? "data-ps/names.json" : "data/names.json"),
      fetchJson(IS_PS ? "data-ps/discovery.json" : "data/discovery.json"),
    ]).then(([n, d]) => {
      const total = n && (Number.isFinite(n.count) ? n.count : Array.isArray(n.players) ? n.players.length : 0);
      if (!total) return;
      const updatedAt = (n && n.updatedAt) || null;
      const lastRun = runOf(d);
      try {
        localStorage.setItem(KEY, JSON.stringify({ day: today, total, updatedAt, lastRun }));
      } catch {}
      show({ ...compute(total), updatedAt, lastRun });
    }).catch(() => {});
  })();

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

  if (els.copyLinkBtn) {
    els.diceBtn?.addEventListener("click", () => { if (!lockedClick(els.diceBtn)) rollDice("range"); });
    // t376u: warm the 🎲 data while the page is idle so the first roll is instant.
    {
      const idle = typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 4000 }) : (f) => setTimeout(f, 1500);
      idle(() => { loadRankVals(); });
    }
    els.diceLowBtn?.addEventListener("click", () => { if (!lockedClick(els.diceLowBtn)) rollDice("low"); });
    els.diceHighBtn?.addEventListener("click", () => { if (!lockedClick(els.diceHighBtn)) rollDice("high"); });
    // t710: 👯 shows for exactly two names (PC room, nobody on the removal list); one line on click, public play-time data only.
    if (els.pairMatchBtn && !LIVE_MODE && PAIR_MATCH_ENABLED) { // t715: switched off in pair-match.mjs for now // 🎥 live page: stays hidden
      createPairMatch({
        get els() { return els; },
        get nameTokens() { return nameTokens; },
        get IS_PS() { return IS_PS; },
        get DATA() { return DATA; },
        get removedNow() { return removedNow; },
        removedReady: () => loaderPart().removedReady(),
        loadRanksPayload: () => sharedPart().loadRanksPayload(),
        censusJson: (url) => censusJson(url),
        get CENSUS() { return CENSUS; },
        tagName: (n) => findSharedEntry(n)?.name || "",
      }).sync();
    }
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

  // 🧘 Pure view (owner 2026-10-29): the skill graph flips 💀 ⇄ 🧘 only when at least one plotted player has a usable Pure value; the 🎯 view stays off per t488u.
  const pureAvailable = () => !IS_PS && players.some((p) => { const g = pureGraphFor(p.display); return g && isFiniteNum(g.pure) && g.pure > 0; });
  /* t383u: 👆 swipe sideways on the skill graph switches 💀 ⇄ 🧘 (two views,
   * so either direction flips). Touch, mouse drag, or a two-finger trackpad
   * swipe; vertical drags keep scrolling the page. Phones also get the short
   * "who wins fights / solo ability" tip for the view they landed on. */
  if (els.chart) {
    const flipView = (dir = 1) => {
      if (!pureAvailable()) return; // 🧘 flip needs a usable Pure value somewhere; 🎯 stays off per t488u
      // t384u: the other view slides in, carousel-style (restored after d758c9e dropped it).
      const wrap = els.chart.closest(".chart-wrap");
      const panel = wrap ? getComputedStyle(wrap).backgroundColor : "";
      slideSwap({ container: wrap, svg: els.chart, dir, background: panel, draw: () => setYScaleMode(yScaleMode === "pure" ? "kd" : "pure") });
      sfx("sparkle"); // same dice-press sound: K/D ⇄ Pure mode switch (swipe / keys)
      if (isTouchUi()) {
        const on = document.querySelector(yScaleMode === "kd" ? '[data-yscale="kd-btn"]' : '[data-yscale="pure-btn"]');
        if (on && on.getAttribute("data-tip")) showHeadTip(on.getAttribute("data-tip"), on);
      }
    };
    // t386u: 👆 finger-following carousel: the current view moves with the
    // finger while the other view comes in from the edge (both visible
    // mid-drag); release past ¼ width or flick to finish, else spring back.
    const showViewTip = () => {
      if (!isTouchUi()) return;
      const on = document.querySelector(yScaleMode === "kd" ? '[data-yscale="kd-btn"]' : '[data-yscale="pure-btn"]');
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
        canStart: () => pureAvailable() && players.length > 0 && !els.chart.hasAttribute("hidden"),
        onStart: () => { viewAtDragStart = yScaleMode; },
        show: () => { const want = viewAtDragStart === "pure" ? "kd" : "pure"; if (yScaleMode !== want) setYScaleMode(want); },
        restore: () => { if (yScaleMode !== viewAtDragStart) setYScaleMode(viewAtDragStart); },
        onCommit: showViewTip,
      });
    }
    const wheelSw = createWheelSwiper();
    els.chart.addEventListener("wheel", (e) => {
      if (!pureAvailable()) return; // no Pure value anywhere → sideways wheel scrolls like anywhere else
      const dir = wheelSw.push(e.deltaX, e.deltaY);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault(); // not browser back / forward
      if (dir && players.length) flipView(dir);
    }, { passive: false });
    // ⌨️ Global ←/→: whichever graph holds the middle of the screen gets the
    // keys — 📊 steps to the next / previous metric, the skill graph flips
    // 💀 ⇄ 🧘 (same as swiping). The pills' own focused-key handler owns
    // arrows while a pill has focus; typing in any field is untouched, and
    // when neither graph is centred the keys keep scrolling the page.
    // t489u: CAPTURE phase + stopPropagation on a claim. A control that kept
    // focus from an earlier click (the ✨ stats-carousel tabs) otherwise grabs
    // the arrow first — its handler switches slide and focus()es the new tab,
    // dragging the page up to it while the user is looking at the 📊 chart.
    // Claiming here, by screen geometry, keeps the keys with the graph the
    // user is actually looking at; unclaimed keys flow on untouched.
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
        e.stopPropagation();
        rankingsApi.stepDist(dir);
        sfx("sparkle");
      } else if (pick === "skill" && pureAvailable()) {
        e.preventDefault();
        e.stopPropagation();
        flipView(dir);
      }
    }, { capture: true });
  }
  // t380u: phones have no hover — tapping 💀 / 📈 also shows what that view means.
  if (els.chartModeBar) {
    els.chartModeBar.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-tip]");
      if (b && isTouchUi()) showHeadTip(b.getAttribute("data-tip"), b);
    });
  }
  // 💀 button selects K/D mode, 🧘 selects Pure mode (in chartModeBar)
  const kdBtn = document.querySelector('[data-yscale="kd-btn"]');
  if (kdBtn) {
    kdBtn.addEventListener("click", () => {
      setYScaleMode("kd");
      sfx("sparkle"); // same dice-press sound: K/D ⇄ Pure mode switch
    });
  }
  const pureBtn = document.querySelector('[data-yscale="pure-btn"]');
  if (pureBtn) {
    pureBtn.addEventListener("click", () => {
      setYScaleMode("pure");
      sfx("sparkle"); // same dice-press sound: K/D ⇄ Pure mode switch
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
      setYScaleMode(yScaleMode, v); // keep the current scale (💀 stays 💀, 🧘 stays 🧘); the slider only moves the anchor percentile
    });
  }
  // Wave animation: slider oscillates 0.1% <-> 98% on a sine (ease-in-out free).
  let waveOn = false;
  const WAVE_MIN = 0.2, WAVE_MAX = 98.8; // Dayset: 0.2-98.8 range
  const WAVE_MID = (WAVE_MIN + WAVE_MAX) / 2; // 50.05
  const WAVE_AMP = (WAVE_MAX - WAVE_MIN) / 2; // 49.95
 // Dayset: fixed
  let waveSpeed = 2; // Dayset: fixed 2x
  // Time-based: one full cycle every WAVE_PERIOD_MS whatever the screen's
  // refresh rate (the old per-frame step ran 2x faster at 120 Hz than at 60 Hz
  // and stuttered on any dropped frame). 1250 ms ≈ the speed it ran at
  // before (~125 drawn frames a second).
  const WAVE_PERIOD_MS = 1250;
  const WAVE_RAD_PER_MS = (Math.PI * 2) / WAVE_PERIOD_MS;
 // smoothed frame interval (ms) → refresh rate estimate
  // Pause while the chart is scrolled out of view (no point drawing it).
  let chartOnScreen = true;
  if (typeof IntersectionObserver === "function" && els.chart) {
    new IntersectionObserver((entries) => {
      for (const e of entries) chartOnScreen = e.isIntersecting;
    }).observe(els.chart);
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
  // PC | PlayStation room switch (#55): a new room starts empty — names never travel between rooms.
  {
    // Room indicator (Dayset 2026-10-22): a single emoji outside Settings,
    // visible at a glance; display only — the switch itself stays in the menu.
    const roomBadge = document.getElementById("roomBadge");
    if (roomBadge) {
      const isPs = ROOM === "ps";
      roomBadge.textContent = isPs ? "🎮" : "🖥️";
      roomBadge.setAttribute("aria-label", isPs ? "PlayStation" : "PC");
    }
    const roomSelect = document.getElementById("roomSelect");
    if (roomSelect) {
      roomSelect.value = ROOM;
      roomSelect.hidden = LIVE_MODE; // Live is PC only
      const roomRow = roomSelect.closest(".settings-row");
      if (roomRow) roomRow.hidden = LIVE_MODE; // t490u: hide the whole Settings row, not just the select
      roomSelect.addEventListener("change", () => {
        const next = roomSelect.value === "ps" ? "ps" : "pc";
        if (next === ROOM) return;
        const u = new URL(window.location.href);
        u.search = "";
        u.hash = "";
        window.location.href = withRoom(u.toString(), next);
      });
    }
  }
  // 🎥 Live: main page → live.html with the first name; live.html → back.
  if (els.liveBtn) {
    els.liveBtn.addEventListener("click", () => {
      if (IS_PS) return; // Live is PC only (#55)
      if (LIVE_MODE) {
        const t = currentNamesInField()[0];
        window.location.href = "./" + (t ? `?names=${encodeURIComponent(t)}` : "");
        return;
      }
      commitFragment({ clearInput: true });
      const first = currentNamesInField()[0];
      if (!first) {
        setStatus(`<span class="err">${tr("msg.liveNeedsName", "🎥 Live needs a name: add one first.")}</span>`, "err");
        return;
      }
      window.location.href = `live.html?names=${encodeURIComponent(first)}`;
    });
  }
  if (els.wipeLocalBtn) {
    els.wipeLocalBtn.addEventListener("click", () => wipeAllLocalAppData());
  }
  // t490u: ⚙️ Settings menu — an outside click or Esc folds it back up.
  {
    const settingsMenu = document.getElementById("settingsMenu");
    if (settingsMenu) {
      document.addEventListener("pointerdown", (e) => {
        if (settingsMenu.open && !settingsMenu.contains(e.target)) settingsMenu.open = false;
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && settingsMenu.open) settingsMenu.open = false;
      });
    }
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
      // 🎥 Live (owner t586u): fresh Census numbers for the tracked player — no browser copy, no shared cache, no modal.
      fetchPlayerFresh: async (name) => {
        while (activeRun) await new Promise((r) => setTimeout(r, 1000));
        return loadLive(name);
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
    // Chips first (they come from the link / this browser, not the name list), so the
    // names box has its final height on the first paint instead of growing later.
    const startup = resolveStartupNames();
    const typedEarly = nameTokens.length > 0 || !!String((els.namesInput && els.namesInput.value) || "").trim();
    if (typedEarly && startup.reason !== "url") startup.names = nameTokens.slice();
    else setNameTokens(startup.names); // >6 from ?names= → first 6 + limit hint
    await loadSharedIndex();
    // Typed while the name list was still loading: keep it (startup used to wipe it).
    if (!typedEarly && startup.reason !== "url" && nameTokens.length && namesSetKey(nameTokens) !== namesSetKey(startup.names)) startup.names = nameTokens.slice();
    renderNameTokens();
    renderCacheChips();
    if (!players.length) showIdleChart(tr("cta.press", "▶️ Press Analyze"));
    reserveStatsSpace();
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
      // Restored / typed names that are all saved: show their graph right away (no Analyze).
      if (!players.length && !activeRun && nameTokens.length) scheduleGraphSync();
      // After the startup lock sync (FIFO): only user edits auto-start Analyze.
      queueMicrotask(() => { limitLockReady = true; });
    }
  })();
