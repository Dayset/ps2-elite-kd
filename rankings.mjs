// 🏆 Rankings — the lower half of the one-page site (t356u; was ranks.html).
// Loaded lazily by app.js (dynamic import after the graph) and driven by the
// ONE names box: host.getNames() is the selection, host.toggleName() changes it.
// Everything Rankings had stays: fresh-fetch ↻ rows, band dividers, marks,
// hidden players left out (ranks.json), 📊 distribution with jumps.

import { t as tr, currentLang } from "./i18n.mjs";
// Column tip in the current language (tip.<id> in i18n/*.json, English otherwise).
const tipOf = (c) => (c.id ? tr("tip." + c.id, c.tip || "") : c.tip || "") + (c.tipExtra ? " " + c.tipExtra : "");
import { compareByCharName } from "./analyze-run.mjs?v=20261023-priv1";
import { histogram, binIndexOf, percentileOf, shareAtOrAbove, stepDigits, binJumpTarget } from "./dist.mjs?v=20261010-sav1";
import { MIN_FIGHTS_RULE, MIN_FIGHTS_TIP, THIN_METRICS, LEGACY_SAMPLE_MARK, LEGACY_SAMPLE_TIP } from "./player-metrics.mjs?v=20261027-z79";
import { PADDING_MARK, PADDING_MARK_TIP, ADJUSTED_MARK, ADJUSTED_MARK_TIP, isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { HUT_MARK, HUT_TIP, HUT_DIFF_NOTE } from "./hut.mjs?v=20261023-short1";
import { paletteColor } from "./palette.mjs?v=20261010-sav1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261020-wide1";
import { isTouchUi, showHeadTip } from "./head-tip.mjs?v=20261025-loc1";
import { watchDismiss } from "./tip-dismiss.mjs?v=20261025-loc1";
import { deskUiScale } from "./desk-scale.mjs?v=20261010-sav1";
import { matchPicks } from "./pick-sync.mjs?v=20261023-twin1";
import { mountJumpButtons, jumpButtonsVisible, glideTo, scrollBehavior } from "./jump-btns.mjs?v=20261020-i18n2";
import { groupByTier, openTierIds, pickedInGroup, groupIndexAt, tierOf } from "./tiers.mjs?v=20261017-tier1";
import { createDistCycler, createWheelSwiper } from "./dist-cycle.mjs?v=20261017-cycle15";
import { sfx } from "./sfx.mjs?v=20261026-sfx2";
import { slideSwap, attachDragCarousel } from "./chart-slide.mjs?v=20261020-flick1";
import { mergeFreshRows } from "./rank-row.mjs?v=20261027-z79";
import { layoutLabels, estimateWidth } from "./dist-labels.mjs?v=20261010-sav1";
import { confirmedPadderSlugs } from "./padding.mjs?v=20261023-short1";
import { slugKey, bareName } from "./rank-row.mjs?v=20261027-z79";
import { hiddenList } from "./hidden.mjs?v=20261025-oor1";
// PC | PlayStation rooms (#55): each room ranks its own players only (data/ or data-ps/).
import { pageRoom, dataPrefix, roomLsKey, psServer } from "./rooms.mjs?v=20261022-ps1";
import { INF_HINT, INF_PENDING_TIP, infTip } from "./infantry.mjs?v=20261023-short1";
import { infMedian } from "./tractor.mjs?v=20261024-trac1";
import { vehicleCutTip } from "./vehicle-cut.mjs?v=20261022-wpc1";
import { traitPools, aimGap, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { zergChargedAdjs, zergFresh } from "./zerg-charge.mjs?v=20261029-zadj2";
import { AIMGAP_HINT, ZERG_HINT, AIMGAP_MISSING, ZERG_MISSING, fmtSigned, DIFF_THIRD, aimGapCellTip, zergCellTip, zergEstHtml } from "./trait-tips.mjs?v=20261024-crowd1";
import { ZREV_NOTE, zergEstimate } from "./zerg-revive.mjs?v=20261024-crowd1";
import { VDIFF_NOTE } from "./diff-vehicle.mjs?v=20261023-short1";
import { NBD_NOTE } from "./newbie-diff.mjs?v=20261023-nbh1";
import { autoMarksHtml } from "./auto-marks.mjs?v=20261024-trac1";

/**
 * @param {{ getNames: () => string[], toggleName: (name: string, anchor: Element, add: boolean) => void, maxNames?: number }} host
 * @returns {{ syncPicks: Function, ready: Promise<void> }}
 */
const ROOM = pageRoom();
const DATA = dataPrefix(ROOM);

export function initRankings(host) {

  const LS_DEBUG_COLS = "ps2-elite-kd-debug-cols";
  const LS_HIDE_ZERO_IVI = "ps2-elite-kd-hide-zero-ivi";
  const LS_REMOVE_RANKS = "ps2-elite-kd-remove-ranks";
  const MONTH_S = 365.25 * 86400 / 12;
  // Same limit as the names box (app.js MAX_NAMES, 6 since t400u; this said 10, so the
  // table let you tick a 7th name the box then refused — issue #35). Read live via
  // the host getter: the debug option lifts the cap to Infinity (Dayset 2026-10-21).
  const maxNames = () => host.maxNames || 6;

  // Column definitions: same ids / labels / digits / floorZero as app.js.
  const VISIBLE = [
    { id: "adjs", label: "⚔️ iVi", digits: 0, floorZero: true, tip: "Rating vs the ~200 players you fight most. Stronger foes count more; fast kills add, slow safe play costs." },
    { id: "act", label: "🏃 Activity", digits: 2, tip: "How much winning combat you put out: K/D vs your usual foes × how fast you kill." },
    { id: "pvs", label: "🦁 Brave", digits: 2, tip: "Stays high if you keep fighting well against the fastest-killing enemies you meet." },
    { id: "rf", label: "🛡️ Resist", digits: 2, tip: "How well you hold up vs strong players: K/D vs your usual foes, scaled by how fast they kill." },
    { id: "rkd", label: "☠️ K/D", digits: 3, tip: "K/D against the ~200 players you fight most, not your whole lifetime." },
    { id: "cons", label: "⚡ Const", digits: 2, tip: "K/D kept vs your strongest third of foes, compared with the weakest: 1.00 = holds, 0.50 = halves." },
    { id: "apk", label: tr("col.assists", "🤝 Assists"), digits: 2, apk: true, tip: "Assists per kill in recent Honu sessions: how often you help teammates get kills." },
    // 🪳 Zerg / 🤥😤 Impostor–DieHard (owner t480u–t485u): computed here from the ranks.json pools (trait-scores.mjs), same numbers as ✨ Stats.
    { id: "zerg", label: tr("col.zerg", "🪳 Zerg"), digits: 0, zerg: true, tip: ZERG_HINT }, // short hover (owner t9); details on columns.html#zerg
    { id: "inf", label: tr("col.infantry", "🪖 Infantry"), digits: 1, inf: true, tip: INF_HINT },
  ];
  const DEBUG = [
    { id: "mech", label: "⚙️ Mech%", digits: 1, tip: "Estimated share of your fights that are vehicle or mech play, projected from 🛡️ Resist rather than measured from shooting." },
    { id: "adj", label: "🎯🎈 ivi", digits: 0, tip: "Opposition-weighted IvI (before speed adjustment)" },
    { id: "ekpm", label: "eKPM", digits: 2, tip: "Average enemy weapon KPM faced" },
    { id: "own", label: "own KPM", digits: 2, tip: "Your weapon pace" },
    { id: "coi", label: "📊 COI", digits: 2, tip: "Combat Output Index" },
    { id: "slope", label: "📉 Slope", digits: 2, tip: "Curve slope (death-weighted)" },
    // t345u: rarely meaningful → older stats only (table with the debug box; not in the chart menu).
    { id: "inflation", label: "🎈 Inflation", digits: 2, tip: "Global KD ÷ KD at ≥0.5 enemy KPM — lower is better", ascFirst: true },
    // owner 2026-10-28: low value currently → older stats only (table with the debug box; not in the chart menu).
    { id: "diff", label: tr("col.diff", "🔀 Diff"), digits: 0, aimgap: true, tip: AIMGAP_HINT }, // short hover (owner t9); details on columns.html#diff
  ];

  // Public stats (in ranks.json; chart only — the table keeps the main page's columns).
  const PUBLIC = [
    { id: "kd", label: "KD", digits: 2, tip: "Overall kill/death ratio" },
    { id: "kpm", label: "KPM", digits: 2, tip: "Overall kills per minute" },
    { id: "ownKpm", label: "own KPM (public)", digits: 2, tip: "Your own weapon pace (public)" },
    { id: "acc", label: "Acc %", digits: 1, tip: "Hit accuracy %" },
    { id: "hsr", label: "HSR %", digits: 1, tip: "Headshot rate %" },
    { id: "ivi", label: "IvI", digits: 0, tip: "Public Infantry vs Infantry score" },
  ];
  const ALL_COLS = [...VISIBLE, ...DEBUG, ...PUBLIC];
  // Opponent-sample metrics are null in ranks.json below MIN_FIGHTS (player-metrics.mjs):
  // "—" with the reason on hover; they're left out of ranks, percentiles and histograms.
  for (const c of ALL_COLS) {
    if (!THIN_METRICS.includes(c.id)) continue;
    c.thinTip = true;
  }
  const colById = (id) => ALL_COLS.find((c) => c.id === id);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  const fmt = (v, d) => (fin(v) ? (+v).toFixed(d) : "—");


  function readDebug() {
    try { return localStorage.getItem(LS_DEBUG_COLS) === "1"; } catch { return false; }
  }

  function readHideZeroIvi() {
    try { return localStorage.getItem(LS_HIDE_ZERO_IVI) === "1"; } catch { return false; }
  }

  function readRemoveRanks() {
    // Default ON (Dayset 2026-10-22): only a saved "0" — the visitor turned
    // it off — brings the tier separators back.
    try { return localStorage.getItem(LS_REMOVE_RANKS) !== "0"; } catch { return true; }
  }

  const LS_MAX_AGE_MONTHS = "ps2-elite-kd-max-age-months";
  const LS_MAX_AGE_YEARS = "ps2-elite-kd-max-age-years";
  function readMaxAgeMonths() {
    try {
      const v = parseFloat(localStorage.getItem(LS_MAX_AGE_MONTHS));
      if (Number.isFinite(v) && v > 0) return Math.round(v);
      // First-ship values were decimal years (app.js migrates them at boot;
      // convert in memory too, so the read order never matters).
      const yrs = parseFloat(localStorage.getItem(LS_MAX_AGE_YEARS));
      return Number.isFinite(yrs) && yrs > 0 ? Math.round(yrs * 12) : null;
    } catch { return null; }
  }

  /** America/Winnipeg label for an ISO / ms timestamp. */
  function fmtUpdated(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const s = new Intl.DateTimeFormat(currentLang() === "en" ? "en-CA" : currentLang(), {
        timeZone: "America/Winnipeg", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(d);
      return s + tr("date.zone", " CT");
    } catch { return String(iso); }
  }

  /** Bare name for search / ?names= (strip "[TAG] "). */
  function bare(name) {
    return String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
  }

  /** Population percentile (dist.mjs): share of cached players strictly below, floored (p0…p99). */
  const pctOf = percentileOf;

  let data = null; // { cols, idx, rows:[{name,query,slug,savedAt, metrics…, rank, pcts}] }
  const infMed = () => (data ? data.infMed : null); // owner t590u: median infantry %
  const tracCuts = () => (data ? data.tracCuts : null); // owner t622u: 🚜 cuts from the build (ranks.json "tracCuts")
  let showDebug = readDebug();
  let hideZeroIvi = readHideZeroIvi();
  let removeRanks = readRemoveRanks();
  let maxAgeMonths = readMaxAgeMonths();
  let sortKey = "adjs";
  let sortDir = "desc"; // Inflation starts asc on first click
  let filter = "";
  // t356u: the ONE selection is the names box (host.getNames()); these are
  // the ranked rows it matches, in its order (names not ranked are skipped).
  const picked = new Map(); // query → display
  const pickedSrc = new Map(); // query → the names-box entry that picked it (untick removes exactly that one)
  /** Character id this browser resolved a names-box entry to (PS namesakes pick the exact row). */
  // (One read of the browser cache per sync; only PS namesake rows ask.)
  let cidStore = null;
  const cidOf = (n) => { const st = cidStore || (cidStore = readLocalStore() || {}); const e = st && (st[slugKey(n)] || st[String(n).toLowerCase()]); return e && e.player && e.player.cid != null ? String(e.player.cid) : null; };
  const fieldFull = () => host.getNames().length >= maxNames();
  let pickSig = "";
  // t655u: Locate player follows the CURRENT single name. locatedFor = the row last located;
  // a new name / saved ON at page load / a re-render with the row not yet located → locate
  // again once the rows exist (same as turning the switch off and on).
  let locatedFor = "", relocRaf = 0;
  // 2026-10-19: the big table re-renders (13k rows, ~0.2 s desktop / ~1 s phone) only
  // when it's open; a name change while it's folded just marks it stale.
  let tableStale = false;
  /** Names box → ✅ boxes / chart / positions. Cheap no-op when nothing changed. */
  function syncPicks({ force = false } = {}) {
    syncFindMe();
    if (!data) return;
    // t359u: a graphed name that's new to this browser's cache (quick fetch /
    // Fetch fresh after Rankings loaded) → re-merge so it joins 📊 / 🏅 / the table.
    if (base && localSig() !== mergedSig) { remerge(); render(); drawDist(); force = true; }
    cidStore = null;
    const hits = matchPicks(host.getNames(), data.rows, maxNames(), { cidOf });
    const sig = hits.map((h) => h.query).join("\n") + "|" + host.getNames().join("\n");
    if (!force && sig === pickSig) return;
    pickSig = sig;
    const before = new Set(picked.keys());
    picked.clear();
    pickedSrc.clear();
    for (const h of hits) { picked.set(h.query, h.name); pickedSrc.set(h.query, h.src || h.query); }
    syncFindMe();
    // ⚔️ tiers: a newly added name opens its tier, even one closed by hand.
    for (const h of hits) {
      if (before.has(h.query)) continue;
      const row = data.rows.find((r) => r.query === h.query);
      if (row) tierManual.delete(tierOf(row.adjs, data.pools.adjs || []));
    }
    if (renderState && renderState.groups) {
      const st = renderState;
      const next = openTierIds(st.groups, { list: st.list, picked, filtering: st.filtering, manual: tierManual });
      const same = next.size === st.open.size && [...next].every((id) => st.open.has(id));
      // t376u: same tiers open → only the header labels (selected names)
      // change, so patch those rows instead of re-rendering the whole table.
      if (!same) {
        const sec = $("ranksTableSection");
        if (sec && !sec.open) tableStale = true;
        else rerenderKeepingView();
      } else refreshTierHeaders();
    }
    updateTicks();
    syncPickedUi();
    drawDist();
    relocateSoon();
  }
  /** ✅ boxes of the rows already in the table follow the selection (no re-render). */
  function updateTicks() {
    const full = fieldFull();
    $("ranksBody").querySelectorAll("tr[data-q]").forEach((tr) => {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!cb) return;
      const on = picked.has(tr.getAttribute("data-q"));
      cb.checked = on;
      cb.disabled = !on && full;
    });
  }

  function colList() {
    const base = showDebug ? VISIBLE.concat(DEBUG) : VISIBLE.slice();
    // Sorted by a metric the table doesn't show (a 📊 chart jump on a public /
    // debug metric, t308u): append it so the order and values are visible.
    const extra = sortKey !== "name" && !base.some((c) => c.id === sortKey) && colById(sortKey);
    return extra ? base.concat(extra) : base;
  }

  /** Browser cache written by Analyze (app.js LS_CACHE; per room, #55). */
  const LS_CACHE = roomLsKey("ps2-elite-kd-cache-v2", ROOM);
  function readLocalStore() {
    try { const o = JSON.parse(localStorage.getItem(LS_CACHE) || "null"); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
  }
  const FRESH_MARK = "↻";
  const LOCAL_ONLY_TIP = tr("fresh.localOnly", "Not in the shared Rankings yet: only this browser sees these stats. Everyone else will after the next refresh.");
  function freshTip(at, localOnly = false) {
    if (localOnly) return tr("fresh.localOnlyFetched", "{tip} Fetched {date}.", { tip: LOCAL_ONLY_TIP, date: fmtUpdated(at) });
    return tr("fresh.tip", "Fresh copy from {date}, this browser only. Others see it after the next refresh.", { date: fmtUpdated(at) });
  }

  function rebuildIndex(payload, freshMap = new Map(), localOnly = new Set()) {
    const cols = payload.cols;
    const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
    // Population percentiles once, over every finite value of each metric.
    const pools = {};
    for (const id of ALL_COLS.map((c) => c.id)) {
      const i = idx[id];
      pools[id] = payload.rows.map((r) => r[i]).filter(fin).sort((a, b) => a - b);
    }
    const rows = payload.rows.map((r) => {
      const o = {
        // Display name is always bare (owner 2026-10-21: no outfit tags) —
        // strips here too so an older ranks.json shows clean immediately.
        name: bareName(r[idx.name]),
        query: r[idx.query],
        slug: r[idx.slug],
        savedAt: r[idx.savedAt],
        thin: idx.thin != null && r[idx.thin] === 1,
        // 🚩 stat padder (padding.mjs): "*" after the name; farm = excluded-kills note.
        // Altered stats: "padding" → "*", "adjusted" → "†" (padding.mjs statMark).
        markKind: idx.mark != null ? r[idx.mark] || "" : idx.pad != null && r[idx.pad] === 1 ? "padding" : "",
        farm: idx.farm != null ? r[idx.farm] || "" : "",
        // Older top-50 opponent sample (new fetches use 200): subtle "◦" after the name.
        legacy: idx.top != null ? (+r[idx.top] || 50) < 200 : false,
        _bare: bare(r[idx.name]),
        // Recomputed from this browser's newer "Fetch fresh" copy (t338u): subtle ↻.
        freshAt: freshMap.get(r[idx.slug]) || 0,
        // t359u: not in ranks.json at all; added from this browser's own copy.
        localOnly: localOnly.has(r[idx.slug]),
        pcts: {},
        // 🪖 hover-only parts of the Infantry column (% of lifetime kills).
        infMax: idx.infMax != null ? r[idx.infMax] : null,
        infVeh: idx.infVeh != null ? r[idx.infVeh] : null,
        // 🚜 vehicle / MAX cut % already applied to adjs (null = none).
        vcut: idx.vcut != null ? r[idx.vcut] : null,
        // ⚔️ iVi before the 🪳 evening-out (#84, build-ranks "adjs0"); adjs is already evened out.
        adjs0: idx.adjs0 != null && Number.isFinite(r[idx.adjs0]) ? r[idx.adjs0] : null,
        zat: idx.zat != null && Number.isFinite(r[idx.zat]) ? r[idx.zat] : null, // 🪳⚔️ newest 🤝 session day
        // 🛖 safe-spot damping factor on positive 🔀 Diff (hut.mjs; null = none).
        hut: idx.hut != null && Number.isFinite(r[idx.hut]) ? r[idx.hut] : null,
        // 🛖 shown only where the drop is meaningful (build-ranks: ≥ HUT_MARK_MIN points).
        hutMk: idx.hutMk != null && r[idx.hutMk] === 1,
        // 🔀 vehicle damp factor on positive Diff (diff-vehicle.mjs; null = none) and 🪳 revive percentile (zerg-revive.mjs; null = no XP detail).
        vdf: idx.vdf != null && Number.isFinite(r[idx.vdf]) ? r[idx.vdf] : null,
        rvp: idx.rvp != null && Number.isFinite(r[idx.rvp]) ? r[idx.rvp] : null,
        // 🪳 crowd-score percentile (zerg-revive.mjs crowdPercentiles; null = no XP detail).
        crp: idx.crp != null && Number.isFinite(r[idx.crp]) ? r[idx.crp] : null,
        // 🚜 vehicle name mark from the build (tractor.mjs tractorRule; 1 / 0, null = not in the build → fallback only).
        trc: idx.trc != null && (r[idx.trc] === 1 || r[idx.trc] === 0) ? r[idx.trc] : null,
        // 🐣 newbie factor on a negative 🔀 Diff (newbie-diff.mjs; null = none).
        nbd: idx.nbd != null && Number.isFinite(r[idx.nbd]) ? r[idx.nbd] : null,
        // 🐣 new-player hours (newbie-diff.mjs newPlayerHours; null = not new / cleared).
        nbh: idx.nbh != null && Number.isFinite(r[idx.nbh]) ? r[idx.nbh] : null,
        // PlayStation room (#55): "us" Genudine / "eu" Ceres (null on PC).
        srv: idx.srv != null ? r[idx.srv] || null : null,
        // 📅 Registration epoch — not a stat column, but the Settings
        // max-account-age cut (sortedFiltered) and its ceiling need it per row.
        created: idx.created != null ? r[idx.created] : null,
        // 🪦 inactive mark (auto-marks.mjs): last activity, UNIX seconds.
        last: idx.last != null ? r[idx.last] : null,
      };
      o.mark = o.markKind === "padding" ? PADDING_MARK : o.markKind === "adjusted" ? ADJUSTED_MARK : "";
      o.markTip = o.markKind === "padding" ? PADDING_MARK_TIP : o.markKind === "adjusted" ? ADJUSTED_MARK_TIP : "";
      // 💩 confirmed padder: −10% adjusted iVi already in the numbers (padding.mjs); owner override in reviewed.json.
      o.poop = isPenalizedPadder(o.slug || o.query);
      // 🛖 safe-spot player (hut.mjs): positive 🔀 Diff damped; reviewed.json "hut": "cleared" wins.
      // reviewed.json "hut": "cleared" is applied at build time (scripts/build-ranks.mjs → null factor, no mark).
      if (o.hut == null) o.hutMk = false;
      o.label = o.name + o.mark + (o.poop ? POOP_MARK : "") + (o.hutMk ? HUT_MARK : "");
      for (const id of Object.keys(pools)) {
        const v = r[idx[id]];
        o[id] = v;
        o.pcts[id] = pctOf(pools[id], v);
      }
      return o;
    });
    // 🤥😤 / 🪳 trait scores (trait-scores.mjs): pools of rounded ⚔️ iVi, IvI, 🎈 Inflation and 🤝 Assists.
    {
      const colOf = (id) => (idx[id] != null ? payload.rows.map((r) => r[idx[id]]) : []);
      const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
      for (const o of rows) {
        const z = zergScore(tp, o.inflation, o.apk, o.rvp, o.crp);
        // 🪳⚔️ (#84): ranks.json rows are already evened out ("adjs0" = before); a row rebuilt from this
        // browser's own fresh copy has no "adjs0" yet, so even it out here the same way (PC only).
        if (ROOM !== "ps" && o.adjs0 == null && fin(o.adjs) && z && zergFresh(o.zat)) {
          o.adjs0 = o.adjs;
          o.adjs = Math.round(zergChargedAdjs(o.adjs, z.score) * 10) / 10;
          if (pools.adjs) o.pcts.adjs = pctOf(pools.adjs, o.adjs);
        }
        const g = aimGap(tp, o.adjs, o.ivi, o.hut, o.vdf, o.nbd);
        o.diff = g ? g.score : null; o._gap = g;
        o.zerg = z ? z.score : null; o._zerg = z;
        o.zest = z ? null : zergEstimate(o.rvp, o.crp); // "~N" estimate: display only, never in o.zerg / pools / sorting / marks
      }
      for (const id of ["diff", "zerg"]) {
        pools[id] = rows.map((o) => o[id]).filter(fin).sort((a, b) => a - b);
        for (const o of rows) o.pcts[id] = pctOf(pools[id], o[id]);
      }
    }
    // t360u: new row objects carry no .rank yet → force assignRanks() to run again
    // (it skipped on an unchanged sort and left "undefined" ranks / a broken order).
    rankedFor = "";
    data = { updatedAt: payload.updatedAt, count: (+payload.count || payload.rows.length - localOnly.size) + localOnly.size, rows, pools, infMed: infMedian(pools.inf), tracCuts: payload.tracCuts || null };
    histCache.clear();
    syncAgeCeiling();
  }

  /* Max-age Settings input: once the data is in, the stepper ceiling is the
   * oldest account's age (rounded up to a whole month). A never-touched
   * control (no saved value) also displays that ceiling, so its resting
   * value always means "cut nobody"; a saved value is never lowered, only
   * the ceiling grows to fit it. */
  function syncAgeCeiling() {
    const input = $("maxAgeInput");
    if (!input || !data) return;
    let oldest = Infinity;
    for (const r of data.rows) if (fin(r.created) && r.created > 0 && r.created < oldest) oldest = r.created;
    if (!Number.isFinite(oldest)) return;
    const ceil = Math.ceil((Date.now() / 1000 - oldest) / MONTH_S);
    const saved = readMaxAgeMonths();
    input.max = String(Math.max(ceil, saved || 0));
    if (saved == null) input.value = String(ceil);
  }

  function sortedFiltered() {
    if (!data) return [];
    const q = bare(filter); // "[RITE] shlo" → "shlo"
    let list = data.rows;
    if (q) {
      // Name only — the outfit tag is ignored ("rite" doesn't list every [RITE] member).
      list = list.filter((r) => r._bare.includes(q));
    } else {
      // Browse only: the two view cuts below. A name search above still finds
      // everyone, and the names box / chart never filter.
      if (hideZeroIvi) {
        // Hide adjusted-iVi ≤ 0 rows. Thin rows (no adjs) stay — only players
        // with a real adjusted iVi ≤ 0 are hidden.
        list = list.filter((r) => !(fin(r.adjs) && r.adjs <= 0));
      }
      if (maxAgeMonths) {
        // Hide accounts registered more than maxAgeMonths ago (Settings
        // stepper). Rows without a registration date stay. A value at/above
        // the oldest account's age cuts nobody, so the default is a no-op.
        const cutoff = Date.now() / 1000 - maxAgeMonths * MONTH_S;
        list = list.filter((r) => !(fin(r.created) && r.created > 0 && r.created < cutoff));
      }
    }
    // assignRanks() already ordered the whole population for the current
    // sort; the filtered view keeps that order and the true rank numbers.
    return list.slice().sort((a, b) => a.rank - b.rank);
  }

  /** Assign 1-based ranks for the current sort over the whole population. */
  let rankedFor = "";
  function assignRanks() {
    if (!data) return;
    const sig = sortKey + ":" + sortDir;
    if (rankedFor === sig) return; // same sort → ranks unchanged (search / picks)
    rankedFor = sig;
    const key = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a, b) => compareByCharName(a.name, b.name); // shared helper (analyze-run.mjs)
    const all = data.rows.slice().sort((a, b) => {
      if (key === "name") return byName(a, b) * dir; // Player: A→Z first (tag ignored)
      const av = a[key], bv = b[key];
      const aOk = fin(av), bOk = fin(bv);
      if (!aOk && !bOk) return byName(a, b);
      if (!aOk) return 1; // missing values always last
      if (!bOk) return -1;
      if (av !== bv) return av < bv ? -dir : dir;
      return byName(a, b);
    });
    all.forEach((r, i) => { r.rank = i + 1; });
  }

  // Fixed metric column widths in ch (Dayset 2026-10-19): with
  // table-layout: fixed these come from the header row, so widths never depend
  // on which data rows happen to be rendered — no jumping on sort / tier toggle.
  // Sized to fit the header label + sort indicator, the widest thing in the column.
  const COL_W = {
    adjs: 9, act: 13, pvs: 10, rf: 11, cons: 10, apk: 12, zerg: 10, diff: 8, rkd: 8, inf: 13,
    mech: 11, adj: 10, ekpm: 8, own: 10, coi: 9, slope: 10, inflation: 13,
    kd: 8, kpm: 8, ownKpm: 12, acc: 8, hsr: 8, ivi: 8,
  };

  function renderHead() {
    const cols = colList();
    // Fixed column widths via <colgroup> (Dayset 2026-10-19): with
    // table-layout: fixed the colgroup wins over cell widths, so widths never
    // depend on which data rows happen to be rendered — no jumping on sort or
    // tier toggle. The name column's width lives in CSS (media queries).
    const colEls = [
      `<col style="width:1.6rem">`,
      `<col style="width:2.6rem">`,
      `<col class="rk-name-col">`,
    ];
    for (const c of cols) colEls.push(`<col style="width:${COL_W[c.id] || 10}ch">`);
    $("ranksCols").innerHTML = colEls.join("");
    // t483u: width the number columns take (pick + # + each col; fixed-layout
    // col widths already include cell padding) — styles.css lets the name
    // column use the rest of the box.
    const fixedCh = cols.reduce((s, c) => s + (COL_W[c.id] || 10), 0);
    $("ranksTable").style.setProperty("--rk-fixed", `calc(4.2rem + ${fixedCh}ch + 1px)`);
    const cells = [
      `<th class="rk-pick" scope="col" title="${tr("rk.pickMax", "Pick up to {n} to Compare", { n: maxNames() })}"></th>`,
      `<th class="rk-num" scope="col" title="${tr("rk.rankTitle", "Rank under the current sort")}">#</th>`,
      `<th class="rk-name sortable${sortKey === "name" ? " sorted" : ""}" data-key="name" scope="col">${tr("rk.player", "Player")}<span class="sort-ind${sortKey === "name" ? " active" : ""}">${sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : "▾"}</span></th>`,
    ];
    for (const c of cols) {
      const on = sortKey === c.id;
      cells.push(
        `<th class="sortable${on ? " sorted" : ""}" data-key="${c.id}" scope="col" title="${esc(tipOf(c) || c.label)}">${esc(c.label)}<span class="sort-ind${on ? " active" : ""}">${on ? (sortDir === "asc" ? "▲" : "▼") : "▾"}</span></th>`,
      );
    }
    $("ranksHead").innerHTML = `<tr>${cells.join("")}</tr>`;
  }

  /** 🤝 Assists per kill (t382u): raw value, percentile (among players with ≥100 session kills. */
  function apkCell(v, p) {
    if (!fin(v)) return `<td title="${tr("stats.notEnough", "Not enough recent sessions (needs 100 kills in Honu sessions)")}">—</td>`;
    const rel = p == null ? "" : p >= 50 ? tr("rk.apkTop", " — top {n}%", { n: Math.max(1, 100 - p) }) : tr("rk.apkBottom", " — bottom {n}%", { n: Math.max(1, p) });
    const tip = tr("apk.tip", "Assists per kill: {v}{rel}. Helps damage enemies that teammates finish.", { v: fmt(v, 2), rel });
    return `<td title="${esc(tip)}">${fmt(v, 2)}${apkPctTag(p)}</td>`;
  }

  /**
   * t495u: the same small "pXX" as the other columns, for 🤝 Assists and 🪳 Zerg.
   * Same convention as everywhere on the site (and 🏅 Positions): pXX = higher
   * than XX% of the pool — for these two that pool is players with 100+ session
   * kills. Same numbers as the 🏅 Positions pN and the hover's "top / bottom X%";
   * for these lower-is-better columns a low pXX is the good end.
   */
  function apkPctTag(p) {
    return p == null ? "" : `<span class="pct" title="${esc(tr("rk.pctileApk", "Percentile: higher than {n}% of players with 100+ session kills", { n: p }))}">p${p}</span>`;
  }

  /** 🚜 vehicle / MAX cut hover for the ⚔️ iVi cell (vehicle-cut.mjs, no visible mark): parts + total; "" without a cut. */
  function vcutTip(row) {
    const v = row && row.vcut > 0 ? vehicleCutTip(row.infVeh, row.infMax, row.vcut) : "";
    // 🪳⚔️ (#84): ⚔️ iVi is evened out for 🪳 Zerg at build time; say so when it moved the value.
    const z = row && fin(row.adjs0) && fin(row.adjs) && Math.abs(row.adjs - row.adjs0) >= 0.5
      ? tr("rk.zergAdjTip", "🪳 Zerg: {a} → {b}, evened out to the average crowd (🪳 26.8), measured on 100,000+ duel pairs. Low 🪳 goes up, high 🪳 down; details under “What the columns mean”", { a: Math.round(row.adjs0).toLocaleString(), b: Math.round(row.adjs).toLocaleString() })
      : "";
    return [v, z].filter(Boolean).join(". ");
  }

  function cellHtml(c, row) {
    const v = row[c.id];
    const vc = c.id === "adjs" ? vcutTip(row) : "";
    if (c.floorZero && fin(v) && v < 0) {
      return `<td class="below-scale" title="${esc("Below the rating scale" + (vc ? ". " + vc : ""))}">0</td>`;
    }
    if (c.apk) return apkCell(v, row.pcts[c.id]);
    // 🪳 Zerg: score + pXX like 🤝 (t495u); 🔀 Diff: signed score + plain pXX (t497u); parts on hover.
    if (c.zerg) return fin(v) ? `<td title="${esc(zergCellTip(v, row._zerg, data.pools.zerg))}">${v}${apkPctTag(row.pcts.zerg)}</td>` : fin(row.zest) ? zergEstHtml(row.zest, esc) : `<td title="${esc(tr("zerg.missing", ZERG_MISSING))}">—</td>`;
    // t497u: 🔀 pXX = plain percentile of the signed score (share of players below); no better side.
    if (c.aimgap) return fin(v) ? `<td title="${esc(aimGapCellTip(v, row._gap, data.pools.diff, row.infVeh))}">${fmtSigned(v)}${row.pcts.diff == null ? "" : `<span class="pct" title="${esc(tr("stats.pctile", "Population percentile: higher than {n}% of cached players", { n: row.pcts.diff }))}">p${row.pcts.diff}</span>`}</td>` : `<td title="${esc(tr("diff.missing", AIMGAP_MISSING))}">—</td>`;
    if (c.inf) return fin(v) ? `<td title="${esc(infTip(v, row.infMax, row.infVeh, row.pcts[c.id]))}">${fmt(v, 1)}%</td>` : `<td title="${esc(INF_PENDING_TIP)}">—</td>`;
    if (!fin(v) && c.thinTip && row.thin) return `<td class="thin-sample" title="${esc(MIN_FIGHTS_TIP)}">—</td>`;
    if (!fin(v)) return `<td>—</td>`;
    const p = row.pcts[c.id];
    const pct = p == null ? "" : `<span class="pct" title="${tr("stats.pctile", "Population percentile: higher than {n}% of cached players", { n: p })}">p${p}</span>`;
    return `<td${vc ? ` title="${esc(vc)}"` : ""}>${fmt(v, c.digits)}${pct}</td>`;
  }

  /**
   * "#" cell. A player with no value for the current sort (e.g. "—" below the
   * minimum fights) is listed after everyone else but gets no rank number:
   * sitting "last" would wrongly read as "worst".
   */
  function rankCellHtml(r) {
    if (sortKey !== "name" && !fin(r[sortKey])) {
      const why = r.thin && colById(sortKey)?.thinTip ? tr("rank.notFights", "Not ranked: too few fights to measure (needs {rule})", { rule: MIN_FIGHTS_RULE }) : tr("rank.notValue", "Not ranked: no value for this column");
      return `<td class="rk-num thin-sample" title="${esc(why)}">—</td>`;
    }
    return `<td class="rk-num">${r.rank}</td>`;
  }

  /** Row HTML for one player (plain strings: cheap for ~1000 rows). */
  /** 💩 after a confirmed padder's name (hover explains the −10% iVi penalty). */
  function poopHtml(r) {
    return (r && r.poop ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "") + hutHtml(r) + autoMarksHtml(r._gap, r._zerg, r.last ? { created: r.created, last: r.last } : null, Date.now(), r.nbh, fin(r.inf) ? { inf: r.inf, trc: r.trc, cuts: tracCuts() } : null);
  }
  /** 🛖 next to the name (owner t504u: auto changes are marked by the name, never inside numeric cells). */
  function hutHtml(r) {
    return r && r.hutMk ? `<span class="poop-mark hut-mark" title="${esc(HUT_TIP)}" aria-label="${esc(HUT_TIP)}">${HUT_MARK}</span>` : "";
  }
  /** PlayStation room: the player's server after the name ("Genudine" / "Ceres"). */
  function srvTagHtml(r) {
    const sv = r && r.srv ? psServer(r.srv) : null;
    return sv ? `<span class="srv-tag" title="${esc(tr("room.serverTip", "PlayStation server: {s}", { s: sv.name }))}">${esc(sv.name)}</span>` : "";
  }
  function rowHtml(r, cols) {
    const checked = picked.has(r.query) ? " checked" : "";
    const disabled = !picked.has(r.query) && fieldFull() ? " disabled" : "";
    const href = `?names=${encodeURIComponent(r.query)}${ROOM === "ps" ? "&room=ps" : ""}`;
    return (
      `<tr data-q="${esc(r.query)}">` +
      `<td class="rk-pick"><input type="checkbox" aria-label="${tr("rk.pick", "Pick {name}", { name: esc(r.name) })}"${checked}${disabled} /></td>` +
      rankCellHtml(r) +
      `<td class="rk-name"><a href="${href}" class="rk-open" title="${tr("rk.addCompare", "Add to the comparison (graph above)")}"><span class="nm" data-full="${esc(r.name)}" title="${esc(r.name + (r.farm ? " — " + r.farm : "") + (r.freshAt ? " — " + freshTip(r.freshAt, r.localOnly) : ""))}">${esc(r.name)}</span></a>` +
      (r.mark ? `<span class="pad-mark mark-${["padding","adjusted"].includes(r.markKind) ? r.markKind : ""}" title="${esc(r.markTip + ". " + r.farm)}">${r.mark}</span>` : "") +
      poopHtml(r) +
      (r.legacy ? `<span class="sample-legacy" title="${esc(LEGACY_SAMPLE_TIP)}">${LEGACY_SAMPLE_MARK}</span>` : "") +
      (r.freshAt ? `<span class="sample-fresh" title="${esc(freshTip(r.freshAt, r.localOnly))}">${FRESH_MARK}</span>` : "") +
      srvTagHtml(r) + `</td>` +
      cols.map((c) => cellHtml(c, r)).join("") +
      `</tr>`
    );
  }

  // Progressive render: the first screenful goes in at once, more in small chunks
  // as the list box scrolls (fillAhead) so phones stay responsive.
  const FIRST_CHUNK = 80;
  const TYPING_QUIET_MS = 300; // filter typing pause before the rest of the list goes in
  let lastTypeAt = -1e9;
  const CHUNK = 200;
  let renderState = null; // { list, cols, at } of the current progressive render

  /** Append rows synchronously until at least `n` are in the table (chart jumps). */
  function renderRowsTo(n) {
    const st = renderState;
    if (!st) return;
    let end = Math.min(st.list.length, n);
    if (end <= st.at) return;
    let html = "";
    let i = st.at;
    for (; i < end; i++) {
      // ⚔️ iVi tiers (t371u): a header row starts each tier; a collapsed tier's
      // rows are skipped (and don't use up this chunk's budget).
      if (st.groups) {
        const g = st.startAt.get(i);
        if (g) {
          html += tierRowHtml(g, st);
          st.prevBin = -1;
          if (!st.open.has(g.id)) {
            end = Math.min(st.list.length, end + (g.end - i));
            i = g.end - 1;
            continue;
          }
        }
      }
      const r = st.list[i];
      // Band separators (t310u): a thin divider wherever the sorted metric
      // crosses into another 📊 chart bin (same ranges as the bars).
      if (st.hist) {
        const bi = binIndexOf(st.hist, r[sortKey]);
        if (bi >= 0 && bi !== st.prevBin) html += st.groups ? tierSepRowHtml(bi, i, st) : sepRowHtml(bi, st);
        st.prevBin = bi;
      }
      html += rowHtml(r, st.cols);
    }
    $("ranksBody").insertAdjacentHTML("beforeend", html);
    st.at = i;
  }

  /* ---------- ⚔️ iVi tiers (t371u) ----------
   * Sorted by ⚔️ iVi (the default), the table is split into collapsible tiers
   * by population share (tiers.mjs). All start collapsed; a tier opens by
   * itself when it holds a player from the names box, or when the name filter
   * is used. Header clicks win for the rest of the visit (reset by a new
   * filter, or when a newly added name lands in that tier). Other sorts stay
   * one flat list with the thin chart-bin dividers. */
  const tierManual = new Map(); // tier id → open (true) / closed (false)
  const tieredView = () => sortKey === "adjs" && !removeRanks;

  function tierRowHtml(g, st) {
    const open = st.open.has(g.id);
    const fmt0 = (v) => (+v).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const range = Number.isFinite(g.lo) && g.id !== "below"
      ? tr("rk.iviRange", " · iVi {a}–{b}", { a: fmt0(sortDir === "asc" ? g.lo : g.hi), b: fmt0(sortDir === "asc" ? g.hi : g.lo) })
      : "";
    const what = st.filtering ? (g.count === 1 ? tr("rk.match", "match") : tr("rk.matches", "matches")) : (g.count === 1 ? tr("rk.playerOne", "player") : tr("rk.players", "players"));
    const picks = pickedInGroup(g, st.list, picked);
    const pickTxt = picks.length
      ? `<span class="rk-tier-picks" title="${tr("rk.tierPicks", "Selected in this tier")}">✅ ${picks.slice(0, 3).map((r) => esc(r.name)).join(", ")}${picks.length > 3 ? ` +${picks.length - 3}` : ""}</span>`
      : "";
    return `<tr class="rk-tier${open ? " open" : ""}" data-tier="${esc(g.id)}"><td colspan="${3 + st.cols.length}">` +
      `<button type="button" class="rk-tier-btn" aria-expanded="${open}" title="${open ? tr("rk.collapse", "Collapse this tier") : tr("rk.open", "Open this tier")}">` +
      `<span class="rk-tier-caret" aria-hidden="true">${open ? "▾" : "▸"}</span>` +
      `<span class="rk-tier-label">${esc(tr("tier." + g.id, g.label))}</span>` +
      `<span class="rk-tier-meta">${tr("rk.tierCount", "{n} {what}", { n: g.count.toLocaleString(), what })}${range}</span>` +
      pickTxt + `</button></td></tr>`;
  }

  /** Open / close one tier; the clicked header stays where it was on screen. */
  function toggleTier(id) {
    const st = renderState;
    if (!st || !st.groups) return;
    const was = st.open.has(id);
    tierManual.set(id, !was);
    const sel = `tr.rk-tier[data-tier="${CSS.escape(id)}"]`;
    const before = $("ranksBody").querySelector(sel);
    const y0 = before ? before.getBoundingClientRect().top : null;
    renderBody();
    const st2 = renderState;
    const g = st2.groups.find((x) => x.id === id);
    if (g) renderRowsTo(g.start + FIRST_CHUNK);
    const after = $("ranksBody").querySelector(sel);
    if (after && y0 != null && tableScroll) {
      tableScroll.scrollTop += after.getBoundingClientRect().top - y0;
    }
  }

  /**
   * Re-render the table without moving what's on screen: the first visible
   * player row keeps its position (ticking a box deep in the list must not
   * throw the view back to the top).
   */
  function rerenderKeepingView() {
    const wrap = typeof tableScroll !== "undefined" ? tableScroll : null;
    const prevAt = renderState ? renderState.at : 0;
    let anchorQ = null, y0 = 0;
    // Folded table: nothing on screen to keep in place (t376u: skip the measuring).
    const sec = $("ranksTableSection");
    if (wrap && (!sec || sec.open) && wrap.scrollTop > 0) {
      // t376u: binary search for the first visible row (was one
      // getBoundingClientRect per row: ~0.8 s on a big open tier).
      const top = wrap.getBoundingClientRect().top + ($("ranksHead").getBoundingClientRect().height || 0);
      const rows = $("ranksBody").querySelectorAll("tr[data-q]");
      let lo = 0, hi = rows.length - 1, hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].getBoundingClientRect().bottom > top) { hit = mid; hi = mid - 1; } else lo = mid + 1;
      }
      if (hit >= 0) { anchorQ = rows[hit].getAttribute("data-q"); y0 = rows[hit].getBoundingClientRect().top; }
    }
    renderBody();
    renderRowsTo(prevAt);
    if (wrap && anchorQ) {
      const tr = $("ranksBody").querySelector(`tr[data-q="${CSS.escape(anchorQ)}"]`);
      if (tr) wrap.scrollTop += tr.getBoundingClientRect().top - y0;
    }
  }

  /** Re-draw just the tier header rows (selected names in them), no table re-render. */
  function refreshTierHeaders() {
    const st = renderState;
    if (!st || !st.groups) return;
    const byId = new Map(st.groups.map((g) => [g.id, g]));
    for (const tr of $("ranksBody").querySelectorAll("tr.rk-tier")) {
      const g = byId.get(tr.getAttribute("data-tier"));
      if (g) tr.outerHTML = tierRowHtml(g, st);
    }
  }

  /** Make sure the tiers covering list indices [from, to) are open (jumps). Re-renders when needed. */
  function openTiersFor(from, to) {
    const st = renderState;
    if (!st || !st.groups) return false;
    let changed = false;
    for (const g of st.groups) {
      if (g.end <= from || g.start >= to) continue;
      if (!st.open.has(g.id)) { tierManual.set(g.id, true); changed = true; }
    }
    if (changed) renderBody();
    return changed;
  }

  /** Divider row before the first player of chart bin `bi`: "⚔️ iVi 1100–1200 · top 36%". */
  function sepRowHtml(bi, st) {
    const h = st.hist;
    const b = h.bins[bi];
    const col = colById(sortKey);
    const share = sortDir === "asc"
      ? tr("dist.bottom", "bottom {p}", { p: fmtPct(b.cumPct) })
      : tr("dist.top", "top {p}", { p: fmtPct(b.kind === "under" ? 100 : shareAtOrAbove(h.sorted, b.x0)) });
    const label = `${col.label} ${binRangeText(b, h, col)} · ${share}`;
    return `<tr class="rk-sep" data-bin="${bi}" aria-hidden="true"><td colspan="${3 + st.cols.length}"><span>${esc(label)}</span></td></tr>`;
  }

  /**
   * Divider inside a ⚔️ tier (t372u): a chart bin can straddle a tier edge
   * (bin 1500–1600 vs the top-5% cut near 1571), so the label describes the
   * rows actually under it — their own iVi range and the share of players at
   * or above the lowest of them — instead of the whole bin's lower edge.
   * Keeps "top x%" consistent with the tier header above it.
   */
  function tierSepRowHtml(bi, i, st) {
    const h = st.hist;
    const list = st.list;
    const gi = groupIndexAt(st.groups, i);
    const stop = gi >= 0 ? st.groups[gi].end : list.length;
    let j = i + 1;
    while (j < stop && binIndexOf(h, list[j][sortKey]) === bi) j++;
    const a = list[i][sortKey], z = list[j - 1][sortKey];
    const lo = Math.min(a, z), hi = Math.max(a, z);
    const col = colById(sortKey);
    const d = col && Number.isFinite(col.digits) ? col.digits : 0;
    const f = (v) => (+v).toLocaleString(undefined, { maximumFractionDigits: d });
    const n = h.sorted.length || 1;
    let share;
    if (sortDir === "asc") {
      // bottom x% = players at or below the highest value in this segment
      let k = 0, m = h.sorted.length;
      while (k < m) { const c = (k + m) >> 1; if (h.sorted[c] <= hi) k = c + 1; else m = c; }
      share = tr("dist.bottom", "bottom {p}", { p: fmtPct((k / n) * 100) });
    } else {
      share = tr("dist.top", "top {p}", { p: fmtPct(shareAtOrAbove(h.sorted, lo)) });
    }
    const range = lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
    const label = `${col.label} ${range} · ${share}`;
    return `<tr class="rk-sep" data-bin="${bi}" aria-hidden="true"><td colspan="${3 + st.cols.length}"><span>${esc(label)}</span></td></tr>`;
  }

  function renderBody() {
    tableStale = false;
    assignRanks();
    const cols = colList();
    const list = sortedFiltered();
    const body = $("ranksBody");
    body.innerHTML = "";
    // Separators only for a metric sort (not by name). Remove ranks flattens
    // the ⚔️ iVi view completely: no tier rows and no chart-bin dividers.
    const st = { list, cols, at: 0, prevBin: -1, hist: sortKey !== "name" && colById(sortKey) && !(removeRanks && sortKey === "adjs") ? getHist(sortKey) : null };
    if (tieredView()) {
      st.filtering = !!bare(filter);
      st.groups = groupByTier(list, data.pools.adjs || []);
      st.startAt = new Map(st.groups.map((g) => [g.start, g]));
      st.open = openTierIds(st.groups, { list, picked, filtering: st.filtering, manual: tierManual });
    }
    renderState = st;
    renderRowsTo(FIRST_CHUNK);
    scheduleFill();
    relocateSoon(); // t655u: rows for a not-yet-located name exist now
    const nLocal = data.rows.reduce((n, r) => n + (r.localOnly ? 1 : 0), 0);
    const nFresh = data.rows.reduce((n, r) => n + (r.freshAt && !r.localOnly ? 1 : 0), 0);
    if ($("ranksTableCount")) $("ranksTableCount").textContent = `(${data.count.toLocaleString()})`;
    // Dayset 2026-10-20: the footer stats block shows one fact per line
    // (players / Updated / fresh-fetch), not one "·"-joined sentence.
    const metaLines = [
      tr("rk.metaPlayers", "{shown} of {total} players", { shown: list.length.toLocaleString(), total: data.count.toLocaleString() }),
      tr("rk.metaUpdated", "Updated {date}", { date: fmtUpdated(data.updatedAt) }),
    ];
    if (nFresh) metaLines.push(`${FRESH_MARK} ${tr("rk.metaFresh", "{n} From your fresh fetch.", { n: nFresh })}`);
    if (nLocal) metaLines.push(`${FRESH_MARK} ${tr("rk.metaLocal", "{n} Only in this browser (not shared yet).", { n: nLocal })}`);
    $("ranksMeta").replaceChildren(...metaLines.map((t) => {
      const d = document.createElement("div");
      d.textContent = t;
      return d;
    }));
    $("ranksMeta").title = nFresh || nLocal ? `${FRESH_MARK} = stats from your own fetch on Analyze (this browser only); everyone else uses the shared copy.` : "";
    syncPickedUi();
  }

  /* Loaded in parts (2026-10-19): rows go in as the list box scrolls, a few screens
   * ahead, instead of all ~13k in the background. Every appended chunk re-lays out the
   * whole table, so the background fill got slower as it grew (0.1 → 0.5 s per chunk,
   * ~20 s of a stuttering page after each sort). Chart jumps render up to their row
   * (renderRowsTo); ⬇ renders the rest when it is small. A folded table renders nothing more. */
  const AHEAD_SCREENS = 3;
  let fillQueued = false;
  function fillAhead() {
    fillQueued = false;
    const st = renderState;
    if (!st || st.at >= st.list.length) return;
    const sec = $("ranksTableSection");
    if (sec && !sec.open) return;
    // Typing in the filter (t324u): don't append (and relayout) between keystrokes.
    const quiet = TYPING_QUIET_MS - (performance.now() - lastTypeAt);
    if (quiet > 0) { setTimeout(scheduleFill, quiet + 10); return; }
    const box = $("ranksScroll");
    if (!box) { renderRowsTo(st.list.length); return; }
    const want = box.scrollTop + box.clientHeight * (1 + AHEAD_SCREENS);
    if (box.scrollHeight >= want) return;
    renderRowsTo(st.at + CHUNK);
    scheduleFill();
  }
  function scheduleFill() {
    if (fillQueued) return;
    fillQueued = true;
    requestAnimationFrame(() => setTimeout(fillAhead, 0));
  }
  /** ⬇ End of the Rankings: the whole list when it is small (a filter, a few open tiers).
   *  The full ~13k rows take ~4 s to lay out on a desktop (much longer on a phone), so a
   *  big list goes to the end of what is in; scrolling on loads more. */
  const RENDER_ALL_MAX = 2500;
  function renderAllRows() {
    const st = renderState;
    if (st && st.list.length - st.at <= RENDER_ALL_MAX) renderRowsTo(st.list.length);
  }
  if ($("ranksScroll")) $("ranksScroll").addEventListener("scroll", scheduleFill, { passive: true });

  // t496u: the header row already sticks to the top of the table's own
  // scroll box; when the PAGE is scrolled past the box top (rows still on
  // screen), push the sticky offset down so the column names stay at the top
  // of the window. Was PC-only (a scroll-driven offset can lag a frame behind
  // touch scrolling); Dayset 2026-10-22 asked for the same pin on phones —
  // both pins, top and left, in the full player list on every device.
  {
    let pinQueued = false, lastOff = -1;
    const pinHead = () => {
      pinQueued = false;
      const wrap = $("ranksScroll"), table = $("ranksTable");
      if (!wrap || !table) return;
      let off = 0;
      const r = wrap.getBoundingClientRect();
      const headH = $("ranksHead") ? $("ranksHead").getBoundingClientRect().height : 0;
      if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top, Math.max(0, wrap.clientHeight - headH));
      off = Math.round(off);
      if (off !== lastOff) { lastOff = off; table.style.setProperty("--rk-head-top", off + "px"); }
    };
    const queuePin = () => { if (!pinQueued) { pinQueued = true; requestAnimationFrame(pinHead); } };
    window.addEventListener("scroll", queuePin, { passive: true });
    window.addEventListener("resize", queuePin, { passive: true });
    queuePin();
  }
  window.addEventListener("resize", scheduleFill, { passive: true });

  function render() {
    if (!data) return;
    if (sortKey !== "name" && !colById(sortKey)) {
      sortKey = "adjs";
      sortDir = "desc";
    }
    renderHead();
    renderBody();
  }


  /* ---------- 🏅 positions of the selected players ---------- */

  /** 1-based rank of v in an ascending pool (higher = better unless asc). */
  function rankIn(pool, v, asc) {
    let lo = 0, hi = pool.length;
    if (asc) { // count strictly below
      while (lo < hi) { const m = (lo + hi) >> 1; if (pool[m] < v) lo = m + 1; else hi = m; }
      return lo + 1;
    }
    while (lo < hi) { const m = (lo + hi) >> 1; if (pool[m] <= v) lo = m + 1; else hi = m; }
    return pool.length - lo + 1; // count strictly above + 1
  }
  function syncPickedUi() {
    const box = $("rkPositions");
    if (!box || !data) return;
    const names = host.getNames();
    const byQ = new Map(data.rows.map((r) => [r.query, r]));
    // Colours follow the graph (names-box order); rows sort by ⚔️ iVi rank (t358u).
    const picks = [...picked.keys()].map((q) => byQ.get(q)).filter(Boolean);
    const colorOf = new Map(picks.map((r, i) => [r.query, i]));
    const ivi = (r) => (fin(r.adjs) ? r.adjs : -Infinity);
    const rows = picks.slice().sort((a, b) => ivi(b) - ivi(a) || compareByCharName(a.name, b.name));
    const missing = names.filter((n) => !matchPicks([n], rows, 1).length);
    if (!rows.length && !missing.length) {
      box.innerHTML = `<p class="rk-pos-hint">${tr("rk.posHintEmpty", "Add players in the names box (or tick ✅ in the table below) to see where they rank.")}</p>`;
      return;
    }
    const light = document.documentElement.getAttribute("data-theme") === "light";
    const head = `<tr><th scope="col" class="rk-pos-name">${tr("rk.player", "Player")}</th>` + VISIBLE.map((c) => `<th scope="col" data-col="${c.id}" title="${esc(tipOf(c) || c.label)}">${esc(c.label)}</th>`).join("") + `</tr>`;
    const body = rows.map((r) => {
      const i = colorOf.get(r.query);
      const cells = VISIBLE.map((c) => {
        const v = r[c.id];
        if ((c.apk || c.inf || c.zerg || c.aimgap) && !fin(v)) return `<td>—</td>`; // t396u: APK ranks like the other columns
        if (!fin(v)) return r.thin && c.thinTip ? `<td class="thin-sample" title="${esc(MIN_FIGHTS_TIP)}">—</td>` : `<td>—</td>`;
        const pool = data.pools[c.id] || [];
        const k = rankIn(pool, v, !!c.ascFirst);
        const p = r.pcts[c.id];
        return `<td title="${esc(c.label)} ${fmt(v, c.digits)}: ${tr("rk.rank", "rank {k} of {n} {basis}", { k: k.toLocaleString(), n: pool.length.toLocaleString(), basis: c.apk || c.zerg ? tr("rk.basisApk", "players with 100+ session kills") : c.inf ? tr("rk.basisInf", "measured players (100+ kills)") : tr("rk.basisCached", "cached players") })}${c.id === "adjs" && vcutTip(r) ? ". " + esc(vcutTip(r)) : ""}">` +
          `<b>#${k.toLocaleString()}</b>${p != null ? `<span class="pct">p${p}</span>` : ""}</td>`;
      }).join("");
      // Same "1." series number as the ✨ Stats table (graph colour order), so both modes read alike.
      return `<tr><th scope="row" class="rk-pos-name"><span class="player-num" style="color:${paletteColor(i, light)}">${i + 1}.</span><a href="#" class="rk-pos-jump" data-q="${esc(r.query)}" style="color:${paletteColor(i, light)}" title="${tr("rk.showTable", "Show {name} in the table", { name: esc(r.name) })}"><span class="nm" data-full="${esc(r.name)}">${esc(r.name)}</span></a>${r.freshAt ? `<span class="sample-fresh" title="${esc(freshTip(r.freshAt, r.localOnly))}">${FRESH_MARK}</span>` : ""}${r.mark ? `<span class="pad-mark mark-${["padding","adjusted"].includes(r.markKind) ? r.markKind : ""}" title="${esc(r.markTip)}">${r.mark}</span>` : ""}${poopHtml(r)}</th>${cells}</tr>`;
    }).join("");
    const miss = missing.length ? `<p class="rk-pos-hint">${tr("rk.posHint", "Not in the Rankings (new, hidden or not cached yet):")} ${missing.map((n) => `<strong>${esc(n)}</strong>`).join(", ")}</p>` : "";
    box.innerHTML = (rows.length ? `<div class="rk-pos-wrap"><table class="rk-pos-table" aria-label="${tr("rk.posAria", "Rank of the selected players among {n} cached players", { n: data.count.toLocaleString() })}"><thead>${head}</thead><tbody>${body}</tbody></table></div>` : "") + miss;
  }

  /* ---------- 📊 Distribution chart ---------- */

  const SVGNS = "http://www.w3.org/2000/svg";
  let distMetric = "adjs";
  let distCycler = null; // 📊 auto-cycle (t373u), set up with the chart's events
  const histCache = new Map();

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function isLight() {
    return document.documentElement.getAttribute("data-theme") === "light";
  }
  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }
  function getHist(id) {
    if (!histCache.has(id)) {
      const vals = data.rows.map((r) => r[id]);
      histCache.set(id, histogram(vals, { floor: id === "adjs" ? 0 : null }));
    }
    return histCache.get(id);
  }
  function fmtEdge(v, h) {
    return fin(v) ? (+v).toFixed(stepDigits(h.step)) : "—";
  }
  function fmtPct(p) {
    if (!fin(p)) return "—";
    if (p > 0 && p < 0.1) return "<0.1%";
    return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + "%";
  }
  /** Label width in px (canvas text metrics; rough estimate when unavailable). */
  let measureCtx = null;
  function textWidth(text, px, family) {
    try {
      measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
      measureCtx.font = `700 ${px}px ${family}`;
      const w = measureCtx.measureText(text).width;
      if (w > 0) return w + 2;
    } catch {}
    return estimateWidth(text, px);
  }
  /** First non-transparent background behind the chart (label halo colour). */
  function chartBg(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
    }
    return cssVar("--bg", "#0b0c0e");
  }
  function shortName(n, max = 14) {
    return n.length > max ? n.slice(0, max - 1) + "…" : n;
  }

  /** Players to mark: picked ones (pick order), else a search with ≤ 5 matches. */
  function highlightRows() {
    if (!data) return [];
    if (picked.size) {
      const byQ = new Map(data.rows.map((r) => [r.query, r]));
      return [...picked.keys()].map((q) => byQ.get(q)).filter(Boolean);
    }
    const q = bare(filter);
    if (!q) return [];
    const hits = data.rows.filter((r) => r._bare.includes(q));
    return hits.length <= 5 ? hits : [];
  }

  function fillMetricSelect() {
    const sel = $("distMetric");
    // t345u/t346u: only our own current metrics — no older / outdated stats
    // (DEBUG, incl. 🎈 Inflation) and no 📊 Public lifetime Census stats.
    const groups = [["✨ Adjusted", VISIBLE]];
    sel.innerHTML = groups
      .map(([g, cols]) => `<optgroup label="${esc(g)}">` + cols.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("") + `</optgroup>`)
      .join("");
    sel.value = distMetric;
    buildDistPills(groups.flatMap(([, cols]) => cols));
  }

  /* t377u: the metric row. Emoji per metric; the current one also shows
   * its name. Click / arrow keys pick (counts as an interaction, so the
   * auto-cycle holds); syncDistPills() follows every switch, auto or not. */
  function splitLabel(label) {
    const s = String(label || "").trim();
    const i = s.indexOf(" ");
    return i > 0 ? { icon: s.slice(0, i), text: s.slice(i + 1) } : { icon: s, text: "" };
  }
  function buildDistPills(cols) {
    const box = $("distPills");
    if (!box) return;
    box.innerHTML = cols.map((c) => {
      const { icon, text } = splitLabel(c.label);
      return `<button type="button" class="dist-pill" role="radio" data-id="${esc(c.id)}" aria-checked="false" tabindex="-1" title="${esc(distHintText(c))}" aria-label="${esc(c.label)}">` +
        `<span class="dist-pill-icon" aria-hidden="true">${esc(icon)}</span><span class="dist-pill-text" aria-hidden="true">${esc(text)}</span></button>`;
    }).join("");
    syncDistPills();
  }
  function syncDistPills() {
    const box = $("distPills");
    if (!box) return;
    for (const b of box.querySelectorAll(".dist-pill")) {
      const on = b.getAttribute("data-id") === distMetric;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
  }

  /** Metrics the 📊 chart menu offers (our own current stats only, t345u/t346u). */
  const DIST_IDS = new Set(VISIBLE.map((c) => c.id));
  function setDistMetric(id) {
    if (!DIST_IDS.has(id)) return; // older stat (debug column sort): chart keeps its metric
    // Only user actions land here (menu / column sort): hold the auto-cycle.
    if (distCycler) distCycler.interact();
    // t382u: clicked switches dissolve too (they used to jump).
    if (id !== distMetric && distCycler) { crossfadeDistTo(id); return; }
    distMetric = id;
    if ($("distMetric").value !== id) $("distMetric").value = id;
    drawDist();
  }

  function hideTip() {
    $("distTip").hidden = true;
    tipBin = -1;
  }

  /**
   * 📊 bar → list (t308u): sort the table by the chart metric (descending unless
   * it's already sorted by it), then glide to the first player of that bar's
   * range and flash its rows. Empty bar → the nearest row (where the range
   * would start). Players without a value ("—", thin samples) and hidden ones
   * (not in ranks.json) never match.
   */
  let flashTimer = 0;
  /* t357u: the table block is a <details>; open / closed is remembered.
   * Chart jumps (bar / name label / 🏅 name) open it before scrolling. */
  // t358u: folded by default; "1" = the user opened it last time.
  function rememberOpen(el, key) {
    if (!el) return;
    try { el.open = localStorage.getItem(key) === "1"; } catch {}
    el.addEventListener("toggle", () => {
      try { localStorage.setItem(key, el.open ? "1" : "0"); } catch {}
    });
  }
  const tableSection = $("ranksTableSection");
  rememberOpen(tableSection, "ps2-elite-kd-ranks-table-open");
  // 🏅 positions: no longer a fold of their own; they share the ✨ Stats spot (stats-carousel.mjs).
  function openTable() {
    if (tableStale) renderBody(); // picks changed while folded: bring the rows up to date first
    if (tableSection && !tableSection.open) tableSection.open = true;
  }
  if (tableSection) tableSection.addEventListener("toggle", () => {
    if (!tableSection.open) return;
    if (tableStale) rerenderKeepingView();
    scheduleFill();
    relocateSoon(); // t655u: folded while the name changed → locate on opening
  });
  /** Desktop jump: list scroll only (no page scroll). Matches the 600px mobile breakpoint. */
  function listOnlyJump(touch) {
    return !touch && (window.innerWidth || 0) > 600;
  }
  /*
   * t349u: a chart click works on the WHOLE list. Before, text left in the
   * name box (e.g. after searching for the players you then ticked) kept the
   * table filtered to those few names, so a column's range had no rows to
   * scroll to and the click seemed dead. Picks stay; only the filter text goes.
   */
  function clearFilterForJump() {
    if (!bare(filter) && !bare($("ranksSearch").value || "")) return false;
    clearTimeout(searchTimer);
    $("ranksSearch").value = "";
    filter = "";
    return true;
  }
  function chartAfterFilterClear() {
    const sig = hlSignature();
    if (sig !== hlSig) { hlSig = sig; requestAnimationFrame(() => drawDist()); }
  }
  /** Scroll the list box to a row (desktop: list only; touch / phones: page too) and flash rows. */
  function scrollListTo(anchor, flashRows, touch) {
    const behavior = scrollBehavior();
    const wrap = tableScroll;
    if (!listOnlyJump(touch)) {
      const pageY = window.scrollY || document.documentElement.scrollTop || 0;
      window.scrollTo({ top: Math.max(0, wrap.getBoundingClientRect().top + pageY - 8), behavior });
    }
    const headH = $("ranksHead").getBoundingClientRect().height || 0;
    const y = anchor.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop - headH;
    glideTo(wrap, Math.max(0, Math.round(y)), behavior);
    clearTimeout(flashTimer);
    $("ranksBody").querySelectorAll("tr.rk-flash").forEach((tr) => tr.classList.remove("rk-flash"));
    void $("ranksBody").offsetWidth;
    for (const tr of flashRows) tr && tr.classList.add("rk-flash");
    flashTimer = setTimeout(() => $("ranksBody").querySelectorAll("tr.rk-flash").forEach((tr) => tr.classList.remove("rk-flash")), 2600);
  }
  /** Click on a picked player's name on the chart → their row (neighbours around it). */
  function jumpToPlayer(q, { touch = false } = {}) {
    if (!data) return;
    openTable();
    const cleared = clearFilterForJump();
    if (cleared) renderBody();
    const list = renderState ? renderState.list : sortedFiltered();
    const k = list.findIndex((r) => r.query === q);
    if (k < 0) return;
    openTiersFor(k, k + 1);
    renderRowsTo(k + 40);
    const row = $("ranksBody").querySelector(`tr[data-q="${CSS.escape(q)}"]`);
    if (!row) return;
    // Centre-ish: land a few rows above so neighbours on both sides show.
    let anchor = row;
    for (let n = 0; n < 4 && anchor.previousElementSibling; n++) anchor = anchor.previousElementSibling;
    scrollListTo(anchor, [row], touch);
    if (cleared) chartAfterFilterClear();
    window.__lastPlayerJump = { q, index: k };
  }

  function jumpToBin(bi, { touch = false } = {}) {
    if (!data) return;
    openTable();
    const h = getHist(distMetric);
    if (!h.bins[bi]) return;
    const cleared = clearFilterForJump();
    if (sortKey !== distMetric) {
      sortKey = distMetric;
      sortDir = "desc";
      render();
    } else if (cleared) {
      renderBody();
    }
    if (cleared) chartAfterFilterClear();
    const list = renderState ? renderState.list : sortedFiltered();
    const t = binJumpTarget(list.map((r) => r[distMetric]), h, bi, sortDir);
    if (t.index < 0) return;
    const span = Math.max(1, t.count);
    openTiersFor(t.index, t.index + span);
    renderRowsTo(t.index + span + 40);
    const body = $("ranksBody");
    const rowOf = (k) => (list[k] ? body.querySelector(`tr[data-q="${CSS.escape(list[k].query)}"]`) : null);
    const row = rowOf(t.index);
    if (!row) return;
    // Land on the band's separator (t310u) when the jump starts a band.
    const prev = row.previousElementSibling;
    const anchor = t.exact && prev && prev.classList.contains("rk-sep") ? prev : row;
    // Desktop (mouse / keyboard, wide screen, t309u): only the list box scrolls —
    // the page and the chart stay put. Touch / phones: also bring the box to the top.
    const end = t.index + (t.exact ? Math.min(t.count, 400) : 1);
    const flash = [];
    for (let k = t.index; k < end; k++) flash.push(rowOf(k));
    scrollListTo(anchor, flash, touch);
    window.__lastBinJump = { bin: bi, metric: distMetric, dir: sortDir, ...t, q: row.getAttribute("data-q") };
  }

  let hlSig = "";
  function drawDist() {
    const svg = $("distSvg");
    syncDistPills();
    if (!data || !svg || !$("distSection").open) return;
    const col = colById(distMetric);
    // t464u: the metric explanation is the popup hint now (showDistHint), no text under the chart.
    const h = getHist(distMetric);
    const box = $("distChart");
    const W = Math.max(320, Math.round(box.clientWidth || 640));
    const narrow = W < 560;
    // Big desktop screens (t299u): grow text / margins / height with the root font; 1 below 1400px.
    const ui = deskUiScale(window.innerWidth, parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const H = Math.round(Math.min(380 * ui, Math.max(250, W * 0.42)));
    const hl = highlightRows();
    hlSig = hl.map((r) => r.query).join("\n"); // what the chart now marks (filter typing skips no-op redraws)
    // M.t (room for the name rows above the plot) is set once the labels are laid out.
    const M = { l: (narrow ? 34 : 44) * ui, r: (narrow ? 34 : 44) * ui, t: 32 * ui, b: 38 * ui };
    const PW = W - M.l - M.r;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    hideTip();

    const th = {
      text: cssVar("--text", "#f2f0ea"),
      dim: cssVar("--dim", "#8a8882"),
      grid: cssVar("--grid", "#2a2e36"),
      accent: cssVar("--accent", "#9fd4ee"),
      border: cssVar("--border", "#2a2e36"),
      warn: cssVar("--warn", "#ffd166"),
    };
    const fs = narrow ? 10 : Math.round(11 * ui);
    // Light theme: pronounced like the main chart's light palette (darker,
    // more saturated, thicker); dark theme keeps its original look.
    const LT = isLight();
    const st = LT
      ? { grid: "#b3a894", gridW: 1, axis: "#3d382f", bar: "#1f5f86", barOp: 0.82, barStroke: "#123f5c",
          tail: "#5c5549", tailOp: 0.7, cum: "#b04a00", cumW: 2.8, cumOp: 1, stat: "#1c1914", statW: 1.4, statOp: 0.8, statTextOp: 1, markW: 2.6 }
      : { grid: th.grid, gridW: 0.8, axis: th.dim, bar: th.accent, barOp: 0.6, barStroke: "none",
          tail: th.dim, tailOp: 0.45, cum: th.warn, cumW: 2, cumOp: 0.9, stat: th.text, statW: 1, statOp: 0.55, statTextOp: 0.8, markW: 2 };

    if (!h.bins.length) {
      svg.appendChild(svgEl("text", { x: W / 2, y: H / 2, fill: th.dim, "text-anchor": "middle", "font-size": 12 }, tr("rank.noData", "No data")));
      return;
    }

    // Slots: one per bin (≤ / ≥ tail bins get a slot each at the ends).
    const nb = h.bins.length;
    const slotW = PW / nb;
    const slotX = (i) => M.l + i * slotW;
    const maxPct = Math.max(...h.bins.map((b) => b.pct));
    const yTop = Math.max(1, Math.ceil((maxPct * 1.12) / (maxPct > 20 ? 5 : maxPct > 6 ? 2 : 1)) * (maxPct > 20 ? 5 : maxPct > 6 ? 2 : 1));
    const yL = (p) => M.t + PH - (p / yTop) * PH;
    const yR = (p) => M.t + PH - (p / 100) * PH;

    // value → x (inside its bin; tails at the slot centre)
    const xOf = (v) => {
      const i = binIndexOf(h, v);
      if (i < 0) return null;
      const b = h.bins[i];
      if (b.kind !== "core") return slotX(i) + slotW / 2;
      const f = b.x1 > b.x0 ? (v - b.x0) / (b.x1 - b.x0) : 0.5;
      return slotX(i) + Math.max(0, Math.min(1, f)) * slotW;
    };

    // Highlighted players' name labels (t338u): no more names on top of each
    // other — first free row above the plot, nudged sideways with a thin
    // leader line when needed; font shrinks only as a last resort.
    const light = isLight();
    const hlItems = [];
    hl.forEach((r, i) => {
      const x = xOf(r[distMetric]);
      if (x != null) hlItems.push({ r, i, x, text: shortName(r.name) + r.mark + (r.poop ? POOP_MARK : "") + (r.hutMk ? HUT_MARK : "") });
    });
    const famly = getComputedStyle(svg).fontFamily || "sans-serif";
    const widthAt = (k, scale) => textWidth(hlItems[k].text, fs * scale, famly);
    const lay = layoutLabels(hlItems.map((it) => ({ x: it.x, w: widthAt(hlItems.indexOf(it), 1) })), {
      minX: 2, maxX: W - 2, gap: 6 * ui, maxRows: narrow ? 5 : 4, widthAt, scales: [1, 0.9, 0.8],
    });
    const lfs = Math.max(8, Math.round(fs * lay.scale * 10) / 10);
    const lineH = lfs * 1.25 + 2 * ui; // bold text box ≈ 1.2 × font size
    M.t = Math.max(32 * ui, 12 * ui + lay.rows * lineH + 8 * ui);
    const PH = H - M.t - M.b;
    const labelY = (row) => M.t - 10 * ui - row * lineH; // row 0 = nearest the plot

    // grid + left axis (% of players)
    const g = svgEl("g", {});
    const yStep = yTop / 4;
    for (let k = 0; k <= 4; k++) {
      const p = k * yStep;
      const y = yL(p);
      g.appendChild(svgEl("line", { x1: M.l, x2: M.l + PW, y1: y, y2: y, stroke: st.grid, "stroke-width": st.gridW }));
      g.appendChild(svgEl("text", { x: M.l - 5, y: y + 3.5 * ui, fill: st.axis, "font-size": fs, "text-anchor": "end" }, (p % 1 ? p.toFixed(1) : p.toFixed(0)) + "%"));
      g.appendChild(svgEl("text", { x: M.l + PW + 5, y: yR(k * 25) + 3.5 * ui, fill: LT ? st.cum : st.axis, "font-size": fs, "text-anchor": "start" }, k * 25 + "%"));
    }
    svg.appendChild(g);

    // bars
    const bars = svgEl("g", {});
    h.bins.forEach((b, i) => {
      const x = slotX(i) + 1;
      const w = Math.max(1, slotW - 2);
      const y = yL(b.pct);
      const tail = b.kind !== "core";
      bars.appendChild(svgEl("rect", {
        x, y, width: w, height: Math.max(0, M.t + PH - y), rx: 1.5,
        fill: tail ? st.tail : st.bar, "fill-opacity": tail ? st.tailOp : st.barOp,
        stroke: tail ? "none" : st.barStroke, "stroke-width": LT ? 0.6 : 0,
      }));
    });
    svg.appendChild(bars);

    // 🔀 Diff thirds (owner t487u): faint boundaries at ±33 and 🤥 / 😤 over the outer thirds.
    if (distMetric === "diff") {
      const tg = svgEl("g", { "pointer-events": "none" });
      for (const edge of [-DIFF_THIRD, DIFF_THIRD]) {
        const x = xOf(edge);
        if (x != null) tg.appendChild(svgEl("line", { x1: x, x2: x, y1: M.t, y2: M.t + PH, stroke: st.axis, "stroke-width": 1, "stroke-dasharray": "1 3", opacity: 0.7 }));
      }
      for (const [v, e] of [[-66, "🤥"], [66, "😤"]]) {
        const x = xOf(v);
        if (x != null) tg.appendChild(svgEl("text", { x, y: M.t + PH * 0.45, "font-size": Math.round(fs * 1.6), "text-anchor": "middle", opacity: 0.55 }, e));
      }
      svg.appendChild(tg);
    }

    // x labels: tail bins "≤lo" / "≥hi" + every k-th core edge
    const maxLabels = narrow ? 5 : 9;
    const coreIdx = h.bins.map((b, i) => (b.kind === "core" ? i : -1)).filter((i) => i >= 0);
    const every = Math.max(1, Math.ceil((coreIdx.length + 1) / maxLabels));
    const xl = svgEl("g", { fill: st.axis, "font-size": fs, "text-anchor": "middle" });
    coreIdx.forEach((i, k) => {
      if (k % every === 0) xl.appendChild(svgEl("text", { x: slotX(i), y: M.t + PH + 14 * ui }, fmtEdge(h.bins[i].x0, h)));
    });
    const lastCore = coreIdx[coreIdx.length - 1];
    if ((coreIdx.length) % every === 0 || coreIdx.length < 3) {
      xl.appendChild(svgEl("text", { x: slotX(lastCore) + slotW, y: M.t + PH + 14 * ui }, fmtEdge(h.hi, h)));
    }
    if (h.bins[0].kind === "under") xl.appendChild(svgEl("text", { x: slotX(0) + slotW / 2, y: M.t + PH + 26 * ui }, `<${fmtEdge(h.lo, h)}`));
    if (h.bins[nb - 1].kind === "over") xl.appendChild(svgEl("text", { x: slotX(nb - 1) + slotW / 2, y: M.t + PH + 26 * ui }, `>${fmtEdge(h.hi, h)}`));
    xl.appendChild(svgEl("text", { x: M.l + PW / 2, y: H - 3, fill: th.text, "font-size": fs + 1 }, col.label));
    svg.appendChild(xl);

    // cumulative line (right axis)
    let d = `M${slotX(0).toFixed(1)},${yR(0).toFixed(1)}`;
    h.bins.forEach((b, i) => { d += ` L${(slotX(i) + slotW).toFixed(1)},${yR(b.cumPct).toFixed(1)}`; });
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: st.cum, "stroke-width": st.cumW, "stroke-linejoin": "round", opacity: st.cumOp }));

    // median / p90 / p99
    const stats = [[tr("dist.median", "median"), h.median], ["p90", h.p90], ["p99", h.p99]];
    stats.forEach(([lab, v], k) => {
      const x = xOf(v);
      if (x == null) return;
      svg.appendChild(svgEl("line", { x1: x, x2: x, y1: M.t, y2: M.t + PH, stroke: st.stat, "stroke-width": st.statW, "stroke-dasharray": "4 3", opacity: st.statOp }));
      const right = x > M.l + PW * 0.75; // keep labels inside the plot near the right edge
      const t = svgEl("text", { x: right ? x - 3 : x + 3, y: M.t + (10 + k * 11) * ui, fill: st.stat, "font-size": fs - 1, opacity: st.statTextOp, "font-weight": LT ? 600 : 400, "text-anchor": right ? "end" : "start" }, `${lab} ${(+v).toFixed(col.digits)}`);
      svg.appendChild(t);
    });

    // highlighted players: coloured markers + laid-out names (halo keeps text readable over leader lines)
    const halo = chartBg(svg);
    const leaders = svgEl("g", {});
    const marks = svgEl("g", {});
    hlItems.forEach((it, k) => {
      const { r, i, x } = it;
      const v = r[distMetric];
      const L = lay.labels[k];
      const color = paletteColor(i, light);
      const ly = labelY(L.row);
      const gm = svgEl("g", {});
      // marker inside the plot
      gm.appendChild(svgEl("line", { x1: x, x2: x, y1: M.t, y2: M.t + PH, stroke: color, "stroke-width": st.markW }));
      gm.appendChild(svgEl("circle", { cx: x, cy: M.t + PH, r: 3.5, fill: color }));
      // leader: label → top of its marker (straight down when centred)
      leaders.appendChild(svgEl("path", {
        d: `M${L.cx.toFixed(1)},${(ly + 3 * ui).toFixed(1)} L${x.toFixed(1)},${(M.t - 2 * ui).toFixed(1)} L${x.toFixed(1)},${M.t.toFixed(1)}`,
        fill: "none", stroke: color, "stroke-width": L.shifted ? 1 : st.markW, opacity: L.shifted ? 0.75 : 1,
      }));
      const t = svgEl("text", {
        x: L.cx, y: ly, fill: color, "font-size": lfs, "font-weight": 700, "text-anchor": "middle",
        stroke: halo, "stroke-width": 3 * ui, "stroke-linejoin": "round", "paint-order": "stroke",
        class: "dist-name", "data-q": r.query, tabindex: "0", role: "button",
        "aria-label": tr("rk.showList", "Show {name} in the list", { name: r.name }),
      }, it.text);
      // t350u: click / tap a picked player's name → scroll the list to their row.
      t.addEventListener("pointerdown", (ev) => { lastPointer = ev.pointerType || "mouse"; });
      t.addEventListener("click", () => { const touch = lastPointer === "touch" || lastPointer === "pen"; lastPointer = "mouse"; jumpToPlayer(r.query, { touch }); });
      t.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jumpToPlayer(r.query); } });
      gm.appendChild(t);
      const shown = col.floorZero && fin(v) && v < 0 ? tr("dist.zeroBelow", "0 (below scale)") : fin(v) ? (+v).toFixed(col.digits) : "—";
      const p = r.pcts[distMetric];
      gm.appendChild(svgEl("title", {}, tr("dist.dotTip", "{label}{mark}{poop}: {col} {shown}{p} · rank #{rank} (current sort){fresh}", { label: r.label, mark: r.mark ? ` (${r.markTip})` : "", poop: (r.poop ? ` (${POOP_TIP})` : "") + (r.hutMk ? ` (${HUT_TIP})` : ""), col: col.label, shown, p: p != null ? ` · p${p}` : "", rank: r.rank, fresh: r.freshAt ? tr("dist.freshTag", " · {mark} your fresh fetch", { mark: FRESH_MARK }) : "" })));
      marks.appendChild(gm);
    });
    svg.appendChild(leaders);
    svg.appendChild(marks);

    // hit areas (full-height, per slot) for hover / tap details
    const hits = svgEl("g", {});
    h.bins.forEach((b, i) => {
      const rect = svgEl("rect", {
        x: slotX(i), y: M.t, width: slotW, height: PH, fill: "transparent", class: "dist-hit",
        tabindex: "0", role: "button", "data-bin": String(i),
        "aria-label": tr("dist.binAria", "{label} {range}: {n} players. Jump to players in this range", { label: col.label, range: binRangeText(b, h, col), n: b.count }),
      });
      const show = (ev) => showTip(ev, b, h, col, i);
      rect.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") show(ev); });
      rect.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") show(ev); });
      rect.addEventListener("pointerdown", (ev) => { lastPointer = ev.pointerType || "mouse"; });
      // Mouse: click jumps. Touch / pen: 1st tap shows the details, a 2nd tap on
      // the same bar jumps (so the tip stays readable on phones).
      rect.addEventListener("click", (ev) => {
        const touch = lastPointer === "touch" || lastPointer === "pen";
        lastPointer = "mouse";
        if (touch && !(tipBin === i && !$("distTip").hidden)) { show(ev); return; }
        jumpToBin(i, { touch });
      });
      rect.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jumpToBin(i); }
      });
      rect.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hideTip(); });
      hits.appendChild(rect);
    });
    svg.appendChild(hits);

  }

  /* t464u (owner: "put a description of the distribution graph on the popup
   * hint, as in KD/iVi, and remove the text with stats from under the graph").
   * Same bubble as 💀 / 🎯 (head-tip.mjs): phones get it for ~5 s under the
   * current pill after a tap / swipe; PC has the same text as the pill's hover title. */
  // The tip often starts with the label's own emoji ("🔀 Diff, all players: 🔀 Results…"): drop the repeat so phones keep it to 3 lines.
  function distHintText(c) {
    if (!c) return "";
    const lead = String(c.label || "").split(" ")[0];
    let tip = String(tipOf(c) || "");
    if (lead && /\p{Extended_Pictographic}/u.test(lead) && tip.startsWith(lead + " ")) tip = tip.slice(lead.length + 1);
    return tr("dist.hint", "{label}, all players: {tip}", { label: c.label, tip }).trim();
  }
  function showDistHint() {
    if (!isTouchUi()) return;
    const c = colById(distMetric);
    const pill = $("distPills") && $("distPills").querySelector(".dist-pill.on");
    if (c && pill) showHeadTip(distHintText(c), pill);
  }

  function binRangeText(b, h, col) {
    if (b.kind === "under") return col.floorZero ? tr("dist.below0", "below 0 (below scale)") : tr("dist.below", "below {x}", { x: fmtEdge(h.lo, h) });
    if (b.kind === "over") return tr("dist.above", "above {x}", { x: fmtEdge(h.hi, h) });
    return `${fmtEdge(b.x0, h)}–${fmtEdge(b.x1, h)}`;
  }

  let lastPointer = "mouse";
  let tipBin = -1;
  let distTipOpened = () => {}; // set below (tip-dismiss.mjs, owner t642u–t644u)

  function showTip(ev, b, h, col, bi = -1) {
    const tip = $("distTip");
    const name = col.label;
    const range = binRangeText(b, h, col);
    const touch = lastPointer === "touch" || lastPointer === "pen" || ev.pointerType === "touch" || ev.pointerType === "pen";
    tipBin = bi;
    distTipOpened();
    const from = b.kind === "under" ? -Infinity : b.x0;
    const top = b.kind === "under" ? 100 : shareAtOrAbove(h.sorted, from);
    tip.innerHTML =
      `<b>${fmtPct(b.pct)}</b> of players have ${esc(name)} ${esc(range)} ` +
      `(${b.count.toLocaleString()} player${b.count === 1 ? "" : "s"}); ` +
      `top <b>${fmtPct(top)}</b> from here` +
      `<span class="dist-jump-hint">↓ ${touch ? "Tap again" : "Click"} to jump to players in this range</span>`;
    tip.hidden = false;
    const box = $("distChart").getBoundingClientRect();
    const tw = tip.offsetWidth;
    const thh = tip.offsetHeight;
    let left = ev.clientX - box.left + 12;
    if (left + tw > box.width - 4) left = Math.max(4, ev.clientX - box.left - tw - 12);
    let top2 = ev.clientY - box.top - thh - 10;
    if (top2 < 0) top2 = ev.clientY - box.top + 14;
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top2) + "px";
  }

  // --- events ---
  // app.js owns ☀️ / the debug box; Rankings just redraws after them.
  $("themeToggle").addEventListener("click", () => requestAnimationFrame(() => { drawDist(); syncPickedUi(); }));

  const dbg = $("debugColsToggle");
  dbg.addEventListener("change", () => {
    showDebug = !!dbg.checked;
    render();
  });

  const hideZero = $("hideZeroIviToggle");
  hideZero.addEventListener("change", () => {
    hideZeroIvi = !!hideZero.checked;
    render();
  });

  // Remove ranks: both switches (filter row + ⚙️ Settings) re-render flat.
  for (const id of ["removeRanksToggle", "removeRanksToggleSettings"]) {
    const el = $(id);
    if (el) el.addEventListener("change", () => {
      removeRanks = !!el.checked;
      render();
    });
  }

  const ageInput = $("maxAgeInput");
  if (ageInput) ageInput.addEventListener("change", () => {
    const v = parseFloat(ageInput.value);
    maxAgeMonths = Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    render();
  });

  /*
   * Filter typing (t324u). The input element is never re-created or refocused
   * here; filtering is debounced, skipped when the bare name didn't change
   * (tag / case / spaces), the rest of the list waits for a typing pause, and
   * the 📊 chart only redraws when the highlighted players actually change —
   * a full table + chart redraw on every key made typing stutter.
   */
  let searchTimer = 0;
  const hlSignature = () => highlightRows().map((r) => r.query).join("\n");
  function applyFilter() {
    clearTimeout(searchTimer);
    const next = $("ranksSearch").value || "";
    if (bare(next) === bare(filter)) { filter = next; return; }
    filter = next;
    tierManual.clear();
    renderBody();
    const sig = hlSignature();
    if (sig !== hlSig) { hlSig = sig; requestAnimationFrame(() => drawDist()); }
  }
  /**
   * 👤 find-me (owner t641u): while the filter is empty and exactly ONE name is in
   * the names box, a static 👤 sits where the search ✕ goes; a click puts that
   * player's name (the table's spelling when it matched) in the filter, so the
   * ✕ comes back as usual. 0 or 2+ names, or any filter text: hidden (as before).
   */
  function findMeName() {
    const names = host.getNames();
    if (names.length !== 1 || bare($("ranksSearch").value || "")) return "";
    const hit = picked.size === 1 ? [...picked.values()][0] : "";
    return String(hit || names[0] || "").trim();
  }
  function syncFindMe() {
    const b = $("ranksFindMe");
    if (!b) return;
    const n = findMeName();
    b.hidden = !n;
    b.dataset.name = n;
    if (b.parentElement) b.parentElement.classList.toggle("has-find-me", !!n); // room for 👤 only while it shows (t646u)
    syncLocate();
  }
  /*
   * Locate player (owner t648u): a switch next to Hide ranks, shown only while exactly
   * ONE name is entered (same rule as 👤). When on, every sort (and turning it on) scrolls
   * the table box so that player's row sits in the middle, neighbours above and below,
   * and flashes it (the chart jump's rk-flash). Instant scroll, no focus (no keyboard).
   * Not in the table (filtered out / not a ranked player): nothing happens.
   */
  const LS_LOCATE = "ps2-elite-kd-locate";
  const locateEl = $("locateToggle");
  if (locateEl) {
    try { locateEl.checked = localStorage.getItem(LS_LOCATE) === "1"; } catch {}
    locateEl.addEventListener("change", () => {
      try { localStorage.setItem(LS_LOCATE, locateEl.checked ? "1" : "0"); } catch {}
      locatedFor = "";
      if (locateEl.checked) locatePlayer();
    });
  }
  /** t655u: the single name changed / rows (re)built → locate it (next frame, after the render). */
  function relocateSoon() {
    const q = locateOn() && picked.size === 1 ? [...picked.keys()][0] : "";
    if (!q) { locatedFor = ""; return; }
    if (q === locatedFor) return;
    cancelAnimationFrame(relocRaf);
    relocRaf = requestAnimationFrame(() => { relocRaf = 0; locatePlayer(); });
  }
  function syncLocate() {
    const w = $("locateWrap");
    if (w) w.hidden = host.getNames().length !== 1;
  }
  function locateOn() {
    const w = $("locateWrap");
    return !!(locateEl && locateEl.checked && w && !w.hidden);
  }
  function locatePlayer() {
    if (!locateOn() || !renderState || picked.size !== 1) return;
    const sec = $("ranksTableSection");
    if (sec && !sec.open) return;
    const q = [...picked.keys()][0];
    const k = renderState.list.findIndex((r) => r.query === q);
    if (k < 0) return; // filtered out / not in the table: quietly nothing
    openTiersFor(k, k + 1);
    renderRowsTo(k + 40);
    const row = $("ranksBody").querySelector(`tr[data-q="${CSS.escape(q)}"]`);
    const box = $("ranksScroll");
    if (!row || !box) return;
    const headH = $("ranksHead").getBoundingClientRect().height || 0;
    const rr = row.getBoundingClientRect();
    const top = rr.top - box.getBoundingClientRect().top + box.scrollTop - headH;
    box.scrollTop = Math.max(0, Math.round(top - (box.clientHeight - headH - rr.height) / 2));
    clearTimeout(flashTimer);
    $("ranksBody").querySelectorAll("tr.rk-flash").forEach((t) => t.classList.remove("rk-flash"));
    void $("ranksBody").offsetWidth;
    row.classList.add("rk-flash");
    flashTimer = setTimeout(() => $("ranksBody").querySelectorAll("tr.rk-flash").forEach((t) => t.classList.remove("rk-flash")), 2600);
    locatedFor = q;
    window.__lastLocate = { q, index: k };
  }
  if ($("ranksFindMe")) $("ranksFindMe").addEventListener("click", (e) => {
    e.preventDefault();
    const n = findMeName();
    if (!n) return syncFindMe();
    const i = $("ranksSearch");
    i.value = n;
    syncFindMe();
    applyFilter(); // filter now (no typing pause)
    // Owner t645u: no focus — the phone keyboard must not open; drop focus from the input / button.
    const act = document.activeElement;
    if (act && (act === i || act === e.currentTarget) && act.blur) act.blur();
  });
  $("ranksSearch").addEventListener("input", (e) => {
    syncFindMe();
    lastTypeAt = performance.now();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 150);
  });

  $("ranksSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) applyFilter(); // no wait on Enter
  });

  $("ranksHead").addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.getAttribute("data-key");
    if (!key) return;
    if (sortKey === key) {
      sortDir = sortDir === "desc" ? "asc" : "desc";
    } else {
      sortKey = key;
      const col = [...VISIBLE, ...DEBUG].find((c) => c.id === key);
      sortDir = col && col.ascFirst ? "asc" : (key === "name" ? "asc" : "desc");
    }
    const wrap = th.closest(".ranks-table-wrap");
    const prevLeft = wrap ? wrap.scrollLeft : 0;
    render();
    // Sorting by a metric also shows its distribution.
    if (key !== "name" && colById(key)) setDistMetric(key);
    // t329u: keep the sorted column in view horizontally (wrapper only).
    const newTh = [...$("ranksHead").querySelectorAll("th.sortable")].find((h) => h.getAttribute("data-key") === key);
    if (newTh) keepSortedColumnVisible(newTh.closest(".ranks-table-wrap"), newTh, prevLeft);
    locatePlayer(); // t648u: Locate player on → the row stays in view after every sort
    // Phones have no hover: show the column's description for 5 s after a tap.
    if (newTh && isTouchUi()) showHeadTip(newTh.getAttribute("title"), newTh);
  });

  $("ranksBody").addEventListener("change", (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || inp.type !== "checkbox") return;
    const tr = inp.closest("tr");
    const q = tr && tr.getAttribute("data-q");
    if (!q) return;
    // t356u: a tick adds / removes the name in the ONE names box (10 limit,
    // graph + tables + URL follow there); the box then syncs back here.
    const want = inp.checked;
    // Untick removes the names-box entry that picked this row (a bare PS
    // namesake name, not this row's server key; owner 2026-10-23).
    if (want !== picked.has(q)) host.toggleName(want ? q : pickedSrc.get(q) || q, inp, want);
    syncPicks({ force: true });
  });
  // Player name in the table: add to the comparison (Ctrl / middle-click still opens a link).
  $("ranksBody").addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.rk-open");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const q = a.closest("tr").getAttribute("data-q");
    if (q && !picked.has(q)) host.toggleName(q, a, true);
    syncPicks({ force: true });
  });
  $("ranksBody").addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("button.rk-tier-btn");
    if (!btn) return;
    e.preventDefault();
    const tr = btn.closest("tr.rk-tier");
    if (tr) toggleTier(tr.getAttribute("data-tier"));
  });
  $("rkPositions").addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.rk-pos-jump");
    if (!a) return;
    e.preventDefault();
    jumpToPlayer(a.getAttribute("data-q"));
  });

  $("distMetric").addEventListener("change", (e) => setDistMetric(e.target.value));
  $("distPills").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".dist-pill");
    if (b) {
      sfx("sparkle");
      const sec = $("distSection");
      if (sec && !sec.open) sec.open = true; // collapsed: open the graph on this metric right away
      setDistMetric(b.getAttribute("data-id"));
      showDistHint();
    }
  });
  $("distPills").addEventListener("keydown", (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== "Home" && e.key !== "End") return;
    const pills = [...$("distPills").querySelectorAll(".dist-pill")];
    if (!pills.length) return;
    e.preventDefault();
    let i = pills.findIndex((b) => b.getAttribute("data-id") === distMetric);
    i = e.key === "Home" ? 0 : e.key === "End" ? pills.length - 1 : (i + keys[e.key] + pills.length) % pills.length;
    sfx("sparkle");
    setDistMetric(pills[i].getAttribute("data-id"));
    pills[i].focus();
  });
  $("distSection").addEventListener("toggle", () => drawDist());

  /* ---------- 📊 auto-cycle (t373u) ----------
   * The chart steps through the menu's metrics every 15 s with a short
   * crossfade. Any interaction with the chart block (pointer, keys, focus,
   * the menu, a column sort) holds it for 30 s, then it carries on. It waits
   * while the block is folded or off screen, the tab is hidden, or a bar
   * tooltip is open. Reduced motion: the switch is instant (no fade). */
  const DIST_FADE_MS = 800;
  let distOnScreen = true;
  /**
   * t382u: dissolve between two charts. A snapshot of the current chart (with
   * a solid panel background, so it fully covers what's beneath) is laid over
   * the chart, the new chart is drawn underneath, and the snapshot fades out —
   * old losing opacity while the new one is revealed. Used for every switch
   * (auto-cycle and clicks). Opacity only, so it also runs under reduced motion.
   */
  function crossfadeDist(draw) {
    const box = $("distChart");
    const svg = $("distSvg");
    hideTip();
    if (distDrag && distDrag.busy()) distDrag.reset(); // t387u: never stack on a carousel glide
    // A switch during a fade: finish the previous one at once.
    box.querySelectorAll("svg.dist-ghost").forEach((g) => g.remove());
    const canFade = svg && svg.childNodes.length && $("distSection").open;
    let ghost = null;
    if (canFade) {
      ghost = svg.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("dist-ghost");
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const vb = (svg.getAttribute("viewBox") || "0 0 1000 400").split(/\s+/).map(Number);
      bg.setAttribute("x", String(vb[0] || 0));
      bg.setAttribute("y", String(vb[1] || 0));
      bg.setAttribute("width", String(vb[2] || 1000));
      bg.setAttribute("height", String(vb[3] || 400));
      bg.setAttribute("fill", cssVar("--panel", "#14161a"));
      ghost.insertBefore(bg, ghost.firstChild);
      // Inline so a cached stylesheet can't drop the overlay below the chart (t374u).
      Object.assign(ghost.style, { position: "absolute", top: "0", left: "0", width: "100%", pointerEvents: "none", opacity: "1", transition: "none", willChange: "opacity" });
      if (getComputedStyle(box).position === "static") box.style.position = "relative";
      box.appendChild(ghost);
    }
    draw();
    if (!ghost) return;
    void ghost.getBoundingClientRect(); // commit opacity 1 before fading out
    requestAnimationFrame(() => {
      ghost.style.transition = `opacity ${DIST_FADE_MS}ms ease-in-out`;
      ghost.style.opacity = "0";
    });
    setTimeout(() => ghost.remove(), DIST_FADE_MS + 150);
  }
  function crossfadeDistTo(id) {
    crossfadeDist(() => {
      distMetric = id;
      if ($("distMetric").value !== id) $("distMetric").value = id;
      drawDist();
    });
  }
  distCycler = createDistCycler({
    ids: () => [...$("distMetric").options].map((o) => o.value).filter((v) => DIST_IDS.has(v)),
    current: () => distMetric,
    show: crossfadeDistTo,
    canRun: () => !document.body.classList.contains("live-mode") && !!data && $("distSection").open && !document.hidden && distOnScreen && $("distTip").hidden && !(distDrag && distDrag.busy()),
  });
  /* t383u: 👆 swipe on the chart — finger / mouse drag to the right = next
   * metric, to the left = previous (two-finger sideways on a trackpad too).
   * Same path as clicking an emoji: dissolve + 30 s hold of the auto-cycle.
   * A swipe that ends on a bar doesn't also count as a bar click. */
  function stepDist(dir) {
    const ids = [...$("distPills").querySelectorAll(".dist-pill")].map((b) => b.getAttribute("data-id"));
    if (ids.length < 2) return;
    const i = Math.max(0, ids.indexOf(distMetric));
    const id = ids[(i + dir + ids.length) % ids.length];
    // t384u: a swipe slides (next comes in from the right, previous from the
    // left); the auto-cycle and emoji clicks keep the dissolve.
    if (distCycler) distCycler.interact();
    hideTip();
    if (distDrag && distDrag.busy()) distDrag.reset(); // t387u
    $("distChart").querySelectorAll("svg.dist-ghost").forEach((g) => g.remove());
    slideSwap({
      container: $("distChart"),
      svg: $("distSvg"),
      dir,
      background: cssVar("--panel", "#14161a"),
      draw: () => {
        distMetric = id;
        if ($("distMetric").value !== id) $("distMetric").value = id;
        drawDist();
      },
    });
    showDistHint();
  }
  /* t386u: 👆 finger-following carousel on the chart (drag left = next from
   * the right, drag right = previous from the left; both charts visible
   * mid-drag; release past ¼ width or flick to finish, else spring back). */
  let distDrag = null;
  {
    const chart = $("distChart");
    const ids = () => [...$("distPills").querySelectorAll(".dist-pill")].map((b) => b.getAttribute("data-id"));
    let orig = null;
    const setMetric = (id) => {
      distMetric = id;
      if ($("distMetric").value !== id) $("distMetric").value = id;
      drawDist();
    };
    distDrag = attachDragCarousel({
      target: chart,
      container: chart,
      svg: () => $("distSvg"),
      background: () => cssVar("--panel", "#14161a"),
      canStart: () => !!data && $("distSection").open && $("distSvg").childNodes.length > 0 && ids().length > 1,
      onStart: () => {
        orig = distMetric;
        if (distCycler) distCycler.interact();
        hideTip();
        chart.querySelectorAll("svg.dist-ghost").forEach((g) => g.remove());
      },
      show: (dir) => {
        const list = ids();
        const i = Math.max(0, list.indexOf(orig));
        setMetric(list[(i + dir + list.length) % list.length]);
      },
      restore: () => { if (orig) setMetric(orig); },
      onCommit: () => { if (distCycler) distCycler.interact(); showDistHint(); },
    });
  }
  {
    const chart = $("distChart");
    const wheel = createWheelSwiper();
    chart.addEventListener("wheel", (e) => {
      const dir = wheel.push(e.deltaX, e.deltaY);
      // Sideways gesture on the chart: keep the browser from treating it as back / forward.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
      if (dir) { hideTip(); stepDist(dir); }
    }, { passive: false });
  }
  for (const ev of ["pointerdown", "pointermove", "wheel", "keydown", "focusin", "touchstart"]) {
    $("distSection").addEventListener(ev, () => distCycler.interact(), { passive: true });
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) distOnScreen = e.isIntersecting;
    }, { threshold: 0.25 }).observe($("distChart"));
  }
  distCycler.start();
  let distResizeTimer = 0;
  let lastDistW = 0;
  window.addEventListener("resize", () => {
    clearTimeout(distResizeTimer);
    distResizeTimer = setTimeout(() => {
      const w = $("distChart").clientWidth;
      if (w !== lastDistW) { lastDistW = w; drawDist(); }
    }, 120);
  });
  // Owner t642u–t644u: the bar tip closes on a tap outside the chart (as before) and
  // now also at once on any scroll / wheel / finger drag / tab to the background (tip-dismiss.mjs).
  distTipOpened = watchDismiss(() => !$("distTip").hidden, hideTip, { inside: (t) => !!(t && t.closest && t.closest("#distChart")) });

  /* ---------- ⬆ / ⬇ quick jumps (shared module jump-btns.mjs) ----------
   * The rankings list scrolls inside its own box (sticky header / columns), and
   * the page scrolls around it. ⬆ = top of both, ⬇ = bottom of both (last
   * player + footer). Shown after ~1 screen of scrolling; ⬇ hides at the end. */
  const tableScroll = $("ranksScroll");
  function jumpState() {
    const vh = window.innerHeight || 800;
    const doc = document.documentElement;
    const pageY = window.scrollY || doc.scrollTop || 0;
    const pageMax = Math.max(0, doc.scrollHeight - vh);
    const t = tableScroll;
    const tMax = t ? Math.max(0, t.scrollHeight - t.clientHeight) : 0;
    const tY = t ? t.scrollTop : 0;
    const nearEnd = pageY >= pageMax - 40 && tY >= tMax - 40;
    // t356u: one page — only once the Rankings part is reached (the shared-cache list has its own).
    const sec = $("rankings");
    const secTop = sec ? sec.getBoundingClientRect().top : 0;
    return jumpButtonsVisible({ active: secTop < vh * 0.25, scrolled: Math.max(0, -secTop) + tY + vh, viewport: vh, nearEnd });
  }
  function jumpTo(end) {
    const behavior = scrollBehavior();
    if (end) renderAllRows();
    if (tableScroll) glideTo(tableScroll, end ? Math.max(0, tableScroll.scrollHeight - tableScroll.clientHeight) : 0, behavior);
    const sec = $("rankings");
    const secTop = sec ? sec.getBoundingClientRect().top + (window.scrollY || 0) - 8 : 0;
    window.scrollTo({ top: end ? document.documentElement.scrollHeight : Math.max(0, secTop), behavior });
  }
  mountJumpButtons({ state: jumpState, jump: jumpTo, scrollers: [tableScroll], ids: { top: "jumpTop", bottom: "jumpBottom" }, topLabel: tr("jump.top", "Top of the Rankings"), bottomLabel: tr("jump.bottom", "End of the Rankings") });

  /* ---------- this browser's own copies (t338u fresh rows, t359u local-only rows) ---------- */
  let base = null; // ranks.json as fetched (never mutated)
  let confirmedSet = new Set();
  let hidden = hiddenList(null);
  let mergedSig = "";
  /** Graphed names + their browser-cache copy times: changes when a name is fetched / added / removed. */
  function localSig() {
    const store = readLocalStore() || {};
    const keys = host.getNames().map(slugKey).filter(Boolean).sort();
    // Only names that would change the merge: unranked ones with a browser copy,
    // ranked ones whose browser copy is newer (Fetch fresh). Plain ranked picks
    // don't re-render the big table.
    return keys.filter((k) => {
      const e = store[k];
      if (!e || !e.player) return false;
      const at = baseAt.get(k);
      return at == null || (+e.fetchedAt || 0) > at;
    }).map((k) => `${k}:${+store[k].fetchedAt || 0}/${+store[k].savedAt || 0}`).join(",");
  }
  let baseAt = new Map();
  function remerge() {
    if (!base) return;
    mergedSig = localSig();
    let rows = base.rows, fresh = new Map(), localOnly = new Set();
    const store = readLocalStore();
    if (store) {
      try {
        const m = mergeFreshRows(base, store, {
          confirmed: confirmedSet,
          extra: host.getNames(),
          skip: (e, key) => !!hidden.match({ slug: key, name: (e.player && e.player.display) || e.name, cid: e.player && e.player.cid }),
        });
        ({ rows, fresh, localOnly } = m);
      } catch (e) { console.warn("fresh merge skipped", e); }
    }
    rebuildIndex({ ...base, rows }, fresh, localOnly);
  }

  async function load() {
    // --- load --- (no "Loading ranks…" text: the preloaded skeleton inside
    // #ranksScroll is the loading state — Dayset 2026-10-22)
    try {
      const hiddenP = fetch(`${DATA}hidden.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const reviewedP = fetch(`${DATA}reviewed.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      // t376u: the page already loads ranks.json once (🎲, 🧱 / 🤝 pools); reuse it.
      let payload = host.loadRanks ? await host.loadRanks() : null;
      if (!payload) {
        const res = await fetch(`${DATA}ranks.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json();
      }
      // Players this browser fetched on Analyze: newer copies replace shared rows,
      // brand-new graphed names join as local-only rows (remerge, t338u/t359u).
      try { confirmedSet = confirmedPadderSlugs(await reviewedP); } catch {}
      try { hidden = hiddenList(await hiddenP); } catch {}
      base = payload;
      { const ix = payload.cols.indexOf("query"), it = payload.cols.indexOf("savedAt"); baseAt = new Map(payload.rows.map((r) => [slugKey(r[ix]), +r[it] || 0])); }
      remerge();
      syncPicks({ force: true });
      // No mark legend on Rankings (t290u): * / † / ◦ explain themselves via their hover tooltips.
      const sk = $("ranksSkeleton");
      if (sk) sk.remove();
      $("ranksStatus").innerHTML = "";
      fillMetricSelect();
      render();
      drawDist();
    } catch (err) {
      const sk = $("ranksSkeleton");
      if (sk) sk.remove();
      $("ranksStatus").innerHTML = `<span class="err">${tr("rank.loadFail", "Could not load ranks.json ({msg}).", { msg: esc(err && err.message) })}</span>`;
      $("ranksMeta").textContent = "—";
    }
  }
  const ready = load();
  return { syncPicks, ready, stepDist };
}
