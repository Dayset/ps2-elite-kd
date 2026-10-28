/**
 * The ✨ Stats table (public + adjusted views, sorting, debug columns, the consistency pool) and the name cells with
 * their marks (💩 🌾 🛖 🐣 † …) (#66: moved out of app.js unchanged).
 */
import { playMinutes, HUT_TIP, HUT_MARK } from "./hut.mjs?v=20261023-short1";
import { slugKey, escapeHtml, fmtNum } from "./app-util.mjs?v=20261027-z79";
import { newbieFactor, newPlayerHours } from "./newbie-diff.mjs?v=20261023-nbh1";
import { isFiniteNum } from "./math.mjs?v=20261027-z79";
import { traitPools, aimGap, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { zergEstimate } from "./zerg-revive.mjs?v=20261024-crowd1";
import { infMedian } from "./tractor.mjs?v=20261024-trac1";
import { mountWeapons } from "./weapons.mjs?v=20261022-wp4";
import { mountKillFeed } from "./kill-feed.mjs?v=20261027-kf1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261020-wide1";
import { PS_SERVERS, censusNsBase, roomLsKey } from "./rooms.mjs?v=20261022-ps1";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { t as tr } from "./i18n.mjs";
import { AIMGAP_HINT, ZERG_HINT, ZERG_MISSING, zergCellTip, zergEstHtml, AIMGAP_MISSING, fmtSigned, aimGapCellTip, diffValueHtml } from "./trait-tips.mjs?v=20261024-crowd1";
import { INF_HINT, INF_PENDING_TIP, infTip } from "./infantry.mjs?v=20261023-short1";
import { THIN_MARK, THIN_NOTE_HEAD, playerMetrics, shownValue, THIN_METRICS, thinPlayerLine, isLegacySample, LEGACY_SAMPLE_TIP, LEGACY_SAMPLE_MARK } from "./player-metrics.mjs?v=20261027-z79";
import { compareByCharName, columnRef, honuProfileUrl, pctFromRef, pctTitle, fmtPctFromRef } from "./analyze-run.mjs?v=20261023-priv1";
import { dotSlot } from "./online-status.mjs?v=20261018-onl1";
import { vehicleCutTip } from "./vehicle-cut.mjs?v=20261022-wpc1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { isTouchUi, showHeadTip } from "./head-tip.mjs?v=20261025-loc1";
import { statMark, isPenalizedPadder, POOP_TIP, POOP_MARK, markNote } from "./padding.mjs?v=20261023-short1";
import { autoMarksHtml } from "./auto-marks.mjs?v=20261024-trac1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: CENSUS, CENSUS_BASES, IS_PS, LIVE_MODE, LS_DEBUG_COLS, ROOM, censusJson, confirmedPadders, currentNamesInField, els, hutBySlug, hutMarked, hutOf, isSavedName, lastStatsList, liteSlugs, loadRanksLite, nameTokens, nbdBySlug, nbdCutsLite, nbhBySlug, refreshOnlineRoom, rvpBySlug, seriesColor, serverTagHtml, showDebugCols, thinCellTip, vdfBySlug.
 */
export function createStatsTable($) {
  /* Per-table sort state: key "name" | col index, dir "asc"|"desc" */
  const statsSortState = {
    public: { key: "ivi", dir: "desc" },
    adjusted: { key: "adjs", dir: "desc" },
  };

  /* Older debug columns in the Adjusted table: hidden unless the footer box is ticked. */
  function readShowDebugCols() {
    try {
      return localStorage.getItem($.LS_DEBUG_COLS) === "1";
    } catch (_) {
      return false;
    }
  }

  /** "Why some cells show —" note: collapsed by default; remembered only while the page is open. */
  let thinNoteOpen = false;

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

  let infMed = null;
  let tracCuts = null; // owner t622u: 🚜 cuts from the build (ranks-lite "tracCuts")

  const playMinOf = (p) => (p ? playMinutes(p.infantry && p.infantry.kills, p.global_kpm) : NaN);

  const inBuild = (display) => !!($.liteSlugs && display && $.liteSlugs.has(slugKey(display)));

  const nbdOf = (display, p = null) => {
    if (!display) return null;
    if ($.nbdBySlug && inBuild(display)) return $.nbdBySlug.get(slugKey(display)) ?? null;
    if (p && $.nbdCutsLite && $.liteSlugs) { const f = newbieFactor(playMinOf(p), $.nbdCutsLite); return f != null ? Math.round(f * 1000) / 1000 : null; }
    return null;
  };

  const nbhOf = (display, p = null) => {
    if (!display) return null;
    if ($.nbhBySlug && inBuild(display)) return $.nbhBySlug.get(slugKey(display)) ?? null;
    if (p && $.nbdCutsLite && $.liteSlugs) return newPlayerHours(playMinOf(p), $.nbdCutsLite);
    return null;
  };

  const vdfOf = (display) => ($.vdfBySlug && display ? $.vdfBySlug.get(slugKey(display)) ?? null : null);

  const rvpOf = (display) => ($.rvpBySlug && display ? $.rvpBySlug.get(slugKey(display)) ?? null : null);
  const crpOf = (display) => ($.crpBySlug && display ? $.crpBySlug.get(slugKey(display)) ?? null : null); // 🪳 crowd-score percentile

  // 🤥😤 Impostor–DieHard + 🪳 Zerg (owner 2026-10-21, trait-scores.mjs): rounded
  // ⚔️ iVi / IvI / 🎈 Inflation / 🤝 Assists pools from the same lite payload
  // (Rankings builds the same pools from ranks.json, so both show the same score).
  let traitP = null;

  let aimGapScores = null;

  let zergScores = null;

  const aimGapPool = () => aimGapScores;

  const zergPool = () => zergScores;

  function loadConsPool() {
    if (consPoolLoad) return consPoolLoad;
    consPoolLoad = $.loadRanksLite()
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
          const ti = payload.cols.indexOf("trc"); // 🚜 name mark (1 / 0) from the build
          tracCuts = payload.tracCuts || null;
          infBySlug = new Map();
          for (const row of payload.rows) if (isFiniteNum(row[ii])) infBySlug.set(row[si], { inf: row[ii], max: mi >= 0 ? row[mi] : null, veh: vi >= 0 ? row[vi] : null, trc: ti >= 0 ? row[ti] : null });
          infPool = [...infBySlug.values()].map((e) => e.inf).sort((a, b) => a - b);
          infMed = infMedian(infPool); // owner t590u: median infantry % (the 🚜 mark itself uses the build cuts, t622u)
        }
        const hi = payload.cols.indexOf("hut");
        if (hi >= 0 && si >= 0) {
          $.hutBySlug = new Map();
          const mi = payload.cols.indexOf("hutMk");
          for (const row of payload.rows) if (isFiniteNum(row[hi])) $.hutBySlug.set(row[si], { f: row[hi], mk: mi >= 0 && row[mi] === 1 });
        }
        if (si >= 0) $.liteSlugs = new Set(payload.rows.map((row) => row[si]));
        const nc = payload.nbdCuts;
        $.nbdCutsLite = nc && isFiniteNum(nc.lo) && isFiniteNum(nc.hi) && isFiniteNum(nc.nw) ? nc : null;
        for (const [id, set] of [["vdf", (m) => { $.vdfBySlug = m; }], ["rvp", (m) => { $.rvpBySlug = m; }], ["crp", (m) => { $.crpBySlug = m; }], ["nbd", (m) => { $.nbdBySlug = m; }], ["nbh", (m) => { $.nbhBySlug = m; }]]) {
          const k = payload.cols.indexOf(id);
          if (k < 0 || si < 0) continue;
          const m = new Map();
          for (const row of payload.rows) if (isFiniteNum(row[k])) m.set(row[si], row[k]);
          set(m);
        }
        const colOf = (id) => { const k = payload.cols.indexOf(id); return k >= 0 ? payload.rows.map((row) => row[k]) : []; };
        traitP = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: apkBySlug ? [...apkBySlug.values()] : [] });
        {
          const A = colOf("adjs"), I = colOf("ivi"), F = colOf("inflation"), K = colOf("apk"), H = colOf("hut"), V = colOf("vdf"), P = colOf("rvp"), C = colOf("crp"), N = colOf("nbd");
          const g = [], z = [];
          for (let k = 0; k < payload.rows.length; k++) {
            const a = aimGap(traitP, A[k], I[k], H[k], V[k], N[k]); if (a) g.push(a.score);
            const q = zergScore(traitP, F[k], K[k], P[k], C[k]); if (q) z.push(q.score);
          }
          aimGapScores = g.sort((x, y) => x - y);
          zergScores = z.sort((x, y) => x - y);
        }
        if ($.lastStatsList) renderStatsTable($.lastStatsList);
      })
      .catch(() => {});
    return consPoolLoad;
  }

  /**
   * Startup with names whose graph draws by itself (link / restored / typed early):
   * keep room for the ✨ Stats table so the graph below doesn't jump down when the
   * table appears (2026-10-19). Released when the table renders (or after 8 s).
   */
  function reserveStatsSpace() {
    const sc = document.getElementById("statsCarousel");
    if (!sc || $.LIVE_MODE) return;
    // Names that need a live fetch (or none): nothing will draw by itself, give the room back.
    if (!$.nameTokens.length || !$.nameTokens.every($.isSavedName)) { releaseStatsSpace(); return; }
    const phone = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
    sc.classList.add("sc-reserve");
    sc.style.minHeight = Math.round(30 + $.nameTokens.length * (phone ? 41 : 27) + 2) + "px";
    setTimeout(releaseStatsSpace, 8000);
  }

  function releaseStatsSpace() {
    const sc = document.getElementById("statsCarousel");
    if (!sc || !sc.classList.contains("sc-reserve")) return;
    sc.classList.remove("sc-reserve");
    sc.style.minHeight = "";
  }

  /* 🏆 Auraxium weapons (weapons.mjs): shown for exactly one player on the page. */
  let weaponsPanel = null;

  /* ⚔️ Latest 100 kills & deaths (kill-feed.mjs): same rule, sits above the weapons. */
  let killFeedPanel = null;
  const censusBaseOf = (p) => {
    if (!$.IS_PS) return $.CENSUS;
    const s = Object.values(PS_SERVERS).find((x) => x.name === p.server);
    return s ? censusNsBase(s.ns, CENSUS_SERVICE_ID) : $.CENSUS_BASES[0];
  };

  function syncWeapons(list) {
    const shownList = $.currentNamesInField().length > 1 ? [] : list || [];
    if (!killFeedPanel) {
      killFeedPanel = mountKillFeed(document.getElementById("killFeedSection"), {
        getJson: (u) => $.censusJson(u),
        baseOf: censusBaseOf,
        addName: (name, anchor) => { if ($.toggleNameInField) $.toggleNameInField(name, anchor); },
      });
    }
    killFeedPanel.setPlayers($.LIVE_MODE ? [] : shownList); // not on the LIVE page
    if (!weaponsPanel) {
      weaponsPanel = mountWeapons(document.getElementById("weaponsSection"), {
        getJson: (u) => $.censusJson(u),
        baseOf: censusBaseOf,
        sortScroll: keepSortedColumnVisible,
        // "Fetch fresh data" loaded this player live → weapons are fetched live once too.
        isFresh: (p) => String(p.source || "").startsWith("live"),
        lsKey: (cid) => roomLsKey(`ps2-elite-kd-weapons:${cid}`, $.ROOM),
      });
    }
    weaponsPanel.setPlayers(shownList);
  }

  function renderStatsTable(list) {
    loadConsPool();
    syncWeapons(list);
    if (!$.els.stats) return;
    if (list.length) requestAnimationFrame(releaseStatsSpace);
    $.lastStatsList = list;
    if (!list.length) {
      $.els.stats.innerHTML = "";
      if ($.els.statsPublic) $.els.statsPublic.innerHTML = "";
      return;
    }

    // Same per-player metrics as build-log.html red flags (player-metrics.mjs).
    const metrics = list.map((p) => playerMetrics(p));

    const publicCols = [
      { id: "kd", label: "KD", hint: tr("tip.kd", "Overall kill/death ratio from Census / Honu."), fn: (r) => r.kd, digits: 2 },
      { id: "kpm", label: "KPM", hint: tr("tip.kpm", "Overall kills per minute."), fn: (r) => r.kpm, digits: 2 },
      { id: "ownKpm", label: tr("col.ownKpm", "own KPM"), hint: tr("tip.ownKpm", "Your own weapon pace (kills per minute with your weapons)."), fn: (r) => r.ownKpm, digits: 2 },
      { id: "acc", label: tr("col.acc", "Acc %"), hint: tr("tip.acc", "Hit accuracy percentage."), fn: (r) => r.acc, digits: 1 },
      { id: "hsr", label: "HSR %", hint: tr("tip.hsr", "Headshot rate percentage."), fn: (r) => r.hsr, digits: 1 },
      { id: "ivi", label: "IvI", hint: tr("tip.ivi", "Infantry vs Infantry score from Census / Honu."), fn: (r) => r.ivi, digits: 0 },
    ];

    // Column order is fixed (sort only reorders rows). Visible by default:
    const adjVisibleCols = [
      { id: "adjs", label: "⚔️ iVi", hint: tr("tip.adjs", "Rating vs the ~200 players you fight most. Stronger foes count more; fast kills add, slow safe play costs."), fn: (r) => r.adjs, digits: 0, floorZero: true },
      { id: "act", label: "🏃 Activity", hint: tr("tip.act", "How much winning combat you put out: K/D vs your usual foes × how fast you kill."), fn: (r) => r.act, digits: 2 },
      { id: "pvs", label: "🦁 Brave", hint: tr("tip.pvs", "Stays high if you keep fighting well against the fastest-killing enemies you meet."), fn: (r) => r.pvs, digits: 2 },
      { id: "rf", label: "🛡️ Resist", hint: tr("tip.rf", "How well you hold up vs strong players: K/D vs your usual foes, scaled by how fast they kill."), fn: (r) => r.rf, digits: 2 },
      { id: "rkd", label: "☠️ K/D", hint: tr("tip.rkd", "K/D against the ~200 players you fight most, not your whole lifetime."), fn: (r) => r.rkd, digits: 3 },
      { id: "cons", label: "⚡ Const", hint: tr("tip.cons", "K/D kept vs your strongest third of foes, compared with the weakest: 1.00 = holds, 0.50 = halves."), fn: (r) => r.cons, digits: 2, pctileCell: true },
      { id: "apk", label: tr("col.assists", "🤝 Assists"), hint: tr("tip.apk", "Assists per kill in recent Honu sessions: how often you help teammates get kills."), fn: (r) => (apkBySlug && r.p ? apkBySlug.get(slugKey(r.p.display)) : undefined), digits: 2, apkCell: true, pctDir: "low", pctLowPhrase: "more assists" },
      // 🤥😤 Impostor–DieHard (owner t484u): ⚔️ iVi percentile − IvI percentile, −99…+99; neither side is better.
      // Short hover (owner t9: 2–3 lines); 🛖 / 🚜 / 🐣 details live in columns.html#diff.
      { id: "diff", label: tr("col.diff", "🔀 Diff"), hint: tr("tip.diff", AIMGAP_HINT), digits: 0, aimGapCell: true,
        fn: (r) => { const g = traitP ? aimGap(traitP, shownValue(r, "adjs"), r.ivi, r.p ? $.hutOf(r.p.display) : null, r.p ? vdfOf(r.p.display) : null, r.p ? nbdOf(r.p.display, r.p) : null) : null; return g ? g.score : NaN; } },
      // 🪳 Zerg (owner t480u): lower of the 🎈 Inflation and 🤝 Assists percentiles; lower is better (like 🤝: reversed grey %).
      // Short hover (owner t9); 🪳 revive details in columns.html#zerg.
      { id: "zerg", label: tr("col.zerg", "🪳 Zerg"), hint: tr("tip.zerg", ZERG_HINT), digits: 0, zergCell: true, pctDir: "low",
        fn: (r) => { const z = traitP && r.p ? zergScore(traitP, shownValue(r, "inflation"), apkBySlug && apkBySlug.get(slugKey(r.p.display)), rvpOf(r.p.display), crpOf(r.p.display)) : null; return z ? z.score : NaN; } },
      { id: "inf", label: tr("col.infantry", "🪖 Infantry"), hint: tr("tip.inf", INF_HINT), fn: (r) => { const e = infBySlug && r.p ? infBySlug.get(slugKey(r.p.display)) : undefined; return e ? e.inf : undefined; }, digits: 1, infCell: true },
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
      // (🔀 Diff debug column retired 2026-10-21: the public 🤥😤 Impostor–DieHard column is the same number.)
    ];
    // Opponent-sample metrics: "—" below MIN_FIGHTS (player-metrics.mjs), so they
    // also drop out of sorting and the % column references.
    for (const c of adjVisibleCols.concat(adjDebugCols)) {
      if (!THIN_METRICS.includes(c.id) || c.thinTip) continue;
      c.thinTip = true;
      c.fn = (r) => shownValue(r, c.id);
    }
    const adjCols = $.showDebugCols ? adjVisibleCols.concat(adjDebugCols) : adjVisibleCols;
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
      const nameHint = tr("stats.nameHint", "Player name — number matches the graph series color. Click to sort A–Z.");
      const nameTh =
        `<th class="stats-name sortable${nameActive ? " sorted" : ""}" ` +
        `data-table="${tableId}" data-sort="name" scope="col" role="columnheader" ` +
        `aria-sort="${nameActive ? (state.dir === "asc" ? "ascending" : "descending") : "none"}" ` +
        `title="${escapeHtml(nameHint)}">${tr("rk.player", "Player")}${sortIndicator(nameActive, state.dir)}</th>`;
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
          const col = $.seriesColor(i);
          const vals = cols
            .map((c) => {
              const v = c.fn(row);
              // ⚡ ivi: below-zero values read as "0" (not rated); sort keeps true value so they stay lowest.
              // 🚜 vehicle / MAX cut on ⚔️ iVi (vehicle-cut.mjs): no visible mark (owner), reason in the cell's hover.
              const vc = c.id === "adjs" && row.vehCut > 0 ? vehicleCutTip(row.vehOnly * 100, row.maxShare * 100, row.vehCut * 100) : "";
              if (c.floorZero && isFiniteNum(v) && v < 0) {
                return `<td class="below-scale" title="${escapeHtml("Below the rating scale" + (vc ? ". " + vc : ""))}">0</td>`;
              }
              // Opponent-sample metrics below MIN_FIGHTS: "—" with the reason on hover.
              if (c.thinTip && row.thin && !isFiniteNum(v)) {
                return `<td class="thin-sample" title="${escapeHtml($.thinCellTip(row))}">—</td>`;
              }
              // Small dimmed % = gap to the column reference (none on the reference cell):
              // "−28%" below the highest value, or "+35%" above the lowest for pctDir "low".
              const dir = c.pctDir || "high";
              const ref = colRefs.get(c.id);
              const p = pctFromRef(v, ref, dir);
              const pct =
                p == null
                  ? ""
                  : `<span class="pct" title="${escapeHtml(pctTitle(p, fmtNum(ref, c.digits), dir, c.pctLowPhrase))}">` +
                    `${fmtPctFromRef(p, dir)}</span>`;
              // Below the floor (🎈 Inflation < 1.0): no %, just say why on hover.
              const floor = c.pctRefFloor;
              const tdTitle =
                p == null && floor != null && isFiniteNum(v) && v < floor
                  ? ` title="${escapeHtml(`Below ${fmtNum(floor, c.digits)} = no inflation`)}"`
                  : vc
                    ? ` title="${escapeHtml(vc)}"`
                    : "";
              // 🧱 Const: main value is the population percentile ("19%"); the dimmed gap to the highest value still applies.
              // 🤝 Assists: plain number, percentile + meaning on hover, plus the dimmed % gap above the lowest — lower is better, counted from the lowest (Dayset 2026-10-19).
              if (c.apkCell) {
                if (!isFiniteNum(v)) return `<td title="${tr("stats.notEnough", "Not enough recent sessions (needs 100 kills in Honu sessions)")}">—</td>`;
                const pl = apkPool ? percentileOf(apkPool, v) : null;
                const rel = pl == null ? "" : pl >= 50 ? tr("rk.apkTop", " — top {n}%", { n: Math.max(1, 100 - pl) }) : tr("rk.apkBottom", " — bottom {n}%", { n: Math.max(1, pl) });
                return `<td title="${escapeHtml(tr("apk.tip", "Assists per kill: {v}{rel}. Helps damage enemies that teammates finish.", { v: fmtNum(v, 2), rel }))}">${fmtNum(v, 2)}${pct}</td>`;
              }
              // 🪖 Infantry: plain "%" value, one colour; percentile + MAX / vehicle share on hover, dimmed % gap like 🤝.
              if (c.infCell) {
                if (!isFiniteNum(v)) return `<td title="${escapeHtml(INF_PENDING_TIP)}">—</td>`;
                const e = infBySlug && row.p ? infBySlug.get(slugKey(row.p.display)) : null;
                const pl = infPool ? percentileOf(infPool, v) : null;
                return `<td title="${escapeHtml(infTip(v, e && e.max, e && e.veh, pl))}">${fmtNum(v, 1)}%${pct}</td>`;
              }
              // 🪳 Zerg: plain 0–99 score, one colour; percentile + both parts on hover, reversed grey % like 🤝 (lower is better).
              if (c.zergCell) {
                if (!isFiniteNum(v)) {
                  // "~N" estimate (zerg-revive.mjs zergEstimate): no Zerg score, display only — never sorted, pooled or marked.
                  const est = row.p ? zergEstimate(rvpOf(row.p.display), crpOf(row.p.display)) : null;
                  return isFiniteNum(est) ? zergEstHtml(est, escapeHtml) : `<td title="${escapeHtml(tr("zerg.missing", ZERG_MISSING))}">—</td>`;
                }
                const z = zergScore(traitP, shownValue(row, "inflation"), apkBySlug && apkBySlug.get(slugKey(row.p.display)), rvpOf(row.p.display), crpOf(row.p.display));
                // Grey tag in points (a % of a 0–99 score explodes near 0): "+25" above the column's lowest, like 🤝's "+35%".
                const low = Math.min(...metrics.map((m) => c.fn(m)).filter(isFiniteNum));
                const up = isFiniteNum(low) && v > low ? v - low : null;
                const zTag = up == null ? "" : `<span class="pct" title="${escapeHtml(tr("pct.morePts", "{n} points more {phrase} than the column's lowest ({ref})", { n: up, phrase: tr("pct.phraseZerg", "zerg"), ref: low }))}">+${up}</span>`;
                return `<td title="${escapeHtml(zergCellTip(v, z, zergPool()))}">${v}${zTag}</td>`;
              }
              // 🤥😤 Impostor–DieHard: signed score; neutral grey gap in points to the column top; side + both percentiles on hover.
              if (c.aimGapCell) {
                if (!isFiniteNum(v)) return `<td title="${escapeHtml(tr("diff.missing", AIMGAP_MISSING))}">—</td>`;
                const g = aimGap(traitP, shownValue(row, "adjs"), row.ivi, row.p ? $.hutOf(row.p.display) : null, row.p ? vdfOf(row.p.display) : null, row.p ? nbdOf(row.p.display, row.p) : null);
                const top = Math.max(...metrics.map((m) => c.fn(m)).filter(isFiniteNum));
                const gap = isFiniteNum(top) && v < top ? top - v : null;
                const gTag = gap == null ? "" : `<span class="pct" title="${escapeHtml(tr("pct.belowPts", "{n} points below the column top ({ref})", { n: gap, ref: fmtSigned(top) }))}">−${gap}</span>`;
                const ve = infBySlug && row.p ? infBySlug.get(slugKey(row.p.display)) : null;
                return `<td title="${escapeHtml(aimGapCellTip(v, g, aimGapPool(), ve ? ve.veh : null))}">${diffValueHtml(v)}${gTag}</td>`;
              }
              if (c.pctileCell) {
                const pctl = isFiniteNum(v) && consPool ? percentileOf(consPool, v) : null;
                const txt = pctl == null ? "—" : `${pctl}%`;
                return `<td title="${tr("stats.pctile", "Population percentile: higher than {n}% of cached players", { n: pctl ?? "—" })}">${txt}${pct}</td>`;
              }
              return `<td${tdTitle}>${fmtNum(v, c.digits)}${pct}</td>`;
            })
            .join("");
          const num = i + 1;
          return (
            `<tr><th scope="row" class="stats-name" style="color:${col}">` +
            dotSlot(row.p.cid) +
            `<span class="player-num" aria-label="${tr("stats.series", "Series {n}", { n: num })}">${num}.</span>` +
            `${nameSpanHtml(row.p.display, farmTitle(row.p), "", $.IS_PS ? "" : honuProfileUrl(row.p.cid))}${$.serverTagHtml(row.p)}${padMarkHtml(row.p)}${autoMarkHtml(row)}${legacySampleHtml(row.p)}</th>${vals}</tr>`
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

    // The ♿ "What … means" explanation fold that used to sit here is gone
    // (owner 2026-10-23: too many of them). Marks keep their short hovers;
    // the full explanations live on columns.html.

    const pubSorted = sortRows(metrics, publicCols, statsSortState.public);
    const adjSorted = sortRows(metrics, adjCols, statsSortState.adjusted);

    // 📊 Public lives in the footer (#statsPublic, folded);
    // ✨ Adjusted stays above it without a title line.
    const publicHtml = `
      <details class="stats-section stats-public"${publicStatsOpen ? " open" : ""}>
        <summary>${tr("stats.publicHead", "📊 Public (Census / Honu)")}</summary>
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="public">
            <thead><tr>${metricHead(publicCols, "public", statsSortState.public)}</tr></thead>
            <tbody>${playerRows(publicCols, pubSorted)}</tbody>
          </table>
        </div>
      </details>`;
    if ($.els.statsPublic) $.els.statsPublic.innerHTML = publicHtml;
    $.els.stats.innerHTML = ($.els.statsPublic ? "" : publicHtml) + `
      <div class="stats-section stats-adjusted">
        <div class="stats-table-wrap">
          <table class="stats-table stats-table-transposed" data-stats-table="adjusted">
            <thead><tr>${metricHead(adjCols, "adjusted", statsSortState.adjusted)}</tr></thead>
            <tbody>${playerRows(adjCols, adjSorted)}</tbody>
          </table>
        </div>
        ${thinBlock}
      </div>
    `;

    // 🟢/🔴 online dots: paint from cache now, fetch stale ids from Census.
    $.refreshOnlineRoom([$.els.stats, $.els.statsPublic]);
    // Keep the ⚠️ note open/closed across re-sorts (starts collapsed each page load).
    const thinDet = $.els.stats.querySelector("details.stats-thin-note");
    if (thinDet) thinDet.addEventListener("toggle", () => { thinNoteOpen = thinDet.open; });
    const statsRoots = [$.els.stats, $.els.statsPublic].filter(Boolean);
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
    return !!p && $.confirmedPadders.has(slugKey(p.display));
  }

  function playerMark(p) {
    return statMark(p && p.farm, undefined, { confirmed: isConfirmedPadder(p) });
  }

  /** Mark after the name (tooltip explains); "" when the stats weren't altered. */
  function padMarkHtml(p) {
    const mk = playerMark(p);
    const poop = (p && isPenalizedPadder(p.display) ? poopHtml() : "") + (p && $.hutMarked(p.display) ? hutHtml() : "");
    if (!mk.mark) return poop;
    return `<span class="pad-mark mark-${mk.kind}" title="${escapeHtml(mk.tip)}">${mk.mark}</span>${poop}`;
  }

  /** 🪳 Zerg confirmed / 🐣 newbie-softened Diff next to the name (auto-marks.mjs; owner t504u: auto changes marked by the name). */
  function autoMarkHtml(row) {
    if (!traitP || !row || !row.p) return "";
    const d = row.p.display;
    const g = aimGap(traitP, shownValue(row, "adjs"), row.ivi, $.hutOf(d), vdfOf(d), nbdOf(d, row.p));
    const z = zergScore(traitP, shownValue(row, "inflation"), apkBySlug && apkBySlug.get(slugKey(d)), rvpOf(d), crpOf(d));
    const ie = infBySlug && infBySlug.get(slugKey(d)); // owner t622u: 🚜 by the name from the build's rule (tractor.mjs)
    return autoMarksHtml(g, z, row.p.times || null, Date.now(), nbhOf(d, row.p), ie ? { inf: ie.inf, trc: ie.trc, cuts: tracCuts } : null);
  }

  /** 🛖 safe-spot player (hut.mjs HUT_TIP): positive 🔀 Diff damped; next to the name, never in the Diff cell (owner t504u). */
  function hutHtml() {
    return `<span class="poop-mark hut-mark" title="${escapeHtml(HUT_TIP)}" aria-label="${escapeHtml(HUT_TIP)}">${HUT_MARK}</span>`;
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

  function sourceLabel(src) {
    if (!src) return tr("src.unknown", "unknown");
    if (src.startsWith("shared:") || src.startsWith("local:")) {
      return tr("src.shared", "shared cache ({d})", { d: src.split(":").slice(1).join(":") });
    }
    if (src === "cache:localStorage") return tr("src.browser", "browser cache");
    if (src.startsWith("live:")) return tr("src.live", "live Honu/Census");
    return src;
  }
  return { readShowDebugCols, loadConsPool, reserveStatsSpace, releaseStatsSpace, syncWeapons, renderStatsTable, nameSpan, isConfirmedPadder, playerMark, padMarkHtml, autoMarkHtml, hutHtml, poopHtml, legacySampleHtml, farmTitle, nameSpanHtml, sourceLabel };
}
