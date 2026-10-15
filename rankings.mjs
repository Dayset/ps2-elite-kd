// 🏆 Rankings — the lower half of the one-page site (t356u; was ranks.html).
// Loaded lazily by app.js (dynamic import after the graph) and driven by the
// ONE names box: host.getNames() is the selection, host.toggleName() changes it.
// Everything Rankings had stays: fresh-fetch ↻ rows, band dividers, marks,
// hidden players left out (ranks.json), 📊 distribution with jumps.

import { compareByCharName } from "./analyze-run.mjs?v=20261010-sav1";
import { histogram, binIndexOf, percentileOf, shareAtOrAbove, stepDigits, binJumpTarget } from "./dist.mjs?v=20261010-sav1";
import { MIN_FIGHTS_RULE, MIN_FIGHTS_TIP, THIN_METRICS, LEGACY_SAMPLE_MARK, LEGACY_SAMPLE_TIP } from "./player-metrics.mjs?v=20261010-sav1";
import { PADDING_MARK, PADDING_MARK_TIP, ADJUSTED_MARK, ADJUSTED_MARK_TIP } from "./padding.mjs?v=20261010-sav1";
import { paletteColor } from "./palette.mjs?v=20261010-sav1";
import { keepSortedColumnVisible } from "./sort-scroll.mjs?v=20261010-sav1";
import { isTouchUi, showHeadTip } from "./head-tip.mjs?v=20261015-tip1";
import { deskUiScale } from "./desk-scale.mjs?v=20261010-sav1";
import { matchPicks } from "./pick-sync.mjs?v=20261010-sav1";
import { mountJumpButtons, jumpButtonsVisible, glideTo, scrollBehavior } from "./jump-btns.mjs?v=20261010-sav1";
import { mergeFreshRows } from "./rank-row.mjs?v=20261010-sav1";
import { layoutLabels, estimateWidth } from "./dist-labels.mjs?v=20261010-sav1";
import { confirmedPadderSlugs } from "./padding.mjs?v=20261010-sav1";
import { slugKey } from "./rank-row.mjs?v=20261010-sav1";
import { hiddenList } from "./hidden.mjs?v=20261010-sav1";

/**
 * @param {{ getNames: () => string[], toggleName: (name: string, anchor: Element, add: boolean) => void }} host
 * @returns {{ syncPicks: Function, ready: Promise<void> }}
 */
export function initRankings(host) {

  const LS_DEBUG_COLS = "ps2-elite-kd-debug-cols";
  const MAX_NAMES = 10;

  // Column definitions: same ids / labels / digits / floorZero as app.js.
  const VISIBLE = [
    { id: "adjs", label: "⚔️ iVi", digits: 0, floorZero: true, tip: "Overall rating from how you do against the ~200 players you fight most, worth more the stronger they are, with a bonus for fast killing and a cut for slow, safe play." },
    { id: "act", label: "🏃 Activity", digits: 2, tip: "How much winning combat you put out: your K/D against the players you fight most, multiplied by how fast you kill." },
    { id: "pvs", label: "🦁 Brave", digits: 2, tip: "Activity that keeps up as enemies get stronger: high when you stay productive even against the fastest-killing players you meet." },
    { id: "rf", label: "🛡️ Resist", digits: 2, tip: "How well you stand up to strong players: your K/D against the players you fight most, scaled up by how fast those players kill." },
    { id: "cons", label: "⚡ Const", digits: 2, tip: "How much of your K/D you keep against the strongest third of your opponents compared with the weakest third: 1.00 means it holds completely, 0.50 means it halves." },
    { id: "rkd", label: "☠️ K/D", digits: 3, tip: "Kills ÷ deaths against the ~200 players you fight most, so it reflects real matchups rather than your whole lifetime." },
  ];
  const DEBUG = [
    { id: "mech", label: "🎯 Aim", digits: 1, tip: "Estimated share of your fights that are vehicle or mech play, projected from 🛡️ Resist rather than measured from shooting." },
    { id: "adj", label: "🎯🎈 ivi", digits: 0, tip: "Opposition-weighted IvI (before speed adjustment)" },
    { id: "ekpm", label: "eKPM", digits: 2, tip: "Average enemy weapon KPM faced" },
    { id: "own", label: "own KPM", digits: 2, tip: "Your weapon pace" },
    { id: "coi", label: "📊 COI", digits: 2, tip: "Combat Output Index" },
    { id: "slope", label: "📉 Slope", digits: 2, tip: "Curve slope (death-weighted)" },
    // t345u: rarely meaningful → older stats only (table with the debug box; not in the chart menu).
    { id: "inflation", label: "🎈 Inflation", digits: 2, tip: "Global KD ÷ KD at ≥0.5 enemy KPM — lower is better", ascFirst: true },
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

  /** America/Winnipeg label for an ISO / ms timestamp. */
  function fmtUpdated(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const s = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Winnipeg", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(d);
      return s + " CT";
    } catch { return String(iso); }
  }

  /** Bare name for search / ?names= (strip "[TAG] "). */
  function bare(name) {
    return String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
  }

  /** Population percentile (dist.mjs): share of cached players strictly below, floored (p0…p99). */
  const pctOf = percentileOf;

  let data = null; // { cols, idx, rows:[{name,query,slug,savedAt, metrics…, rank, pcts}] }
  let showDebug = readDebug();
  let sortKey = "adjs";
  let sortDir = "desc"; // Inflation starts asc on first click
  let filter = "";
  // t356u: the ONE selection is the names box (host.getNames()); these are
  // the ranked rows it matches, in its order (names not ranked are skipped).
  const picked = new Map(); // query → display
  const fieldFull = () => host.getNames().length >= MAX_NAMES;
  let pickSig = "";
  /** Names box → ✅ boxes / chart / positions. Cheap no-op when nothing changed. */
  function syncPicks({ force = false } = {}) {
    if (!data) return;
    // t359u: a graphed name that's new to this browser's cache (quick fetch /
    // Fetch fresh after Rankings loaded) → re-merge so it joins 📊 / 🏅 / the table.
    if (base && localSig() !== mergedSig) { remerge(); render(); drawDist(); force = true; }
    const hits = matchPicks(host.getNames(), data.rows, MAX_NAMES);
    const sig = hits.map((h) => h.query).join("\n") + "|" + host.getNames().join("\n");
    if (!force && sig === pickSig) return;
    pickSig = sig;
    picked.clear();
    for (const h of hits) picked.set(h.query, h.name);
    updateTicks();
    syncPickedUi();
    drawDist();
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

  /** Browser cache written by Analyze (app.js LS_CACHE). */
  const LS_CACHE = "ps2-elite-kd-cache-v2";
  function readLocalStore() {
    try { const o = JSON.parse(localStorage.getItem(LS_CACHE) || "null"); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
  }
  const FRESH_MARK = "↻";
  const LOCAL_ONLY_TIP = "Not in the shared Rankings yet: stats from the copy this browser fetched (this browser only). It's queued for the shared cache; everyone else sees it after the background refresh.";
  function freshTip(at, localOnly = false) {
    if (localOnly) return `${LOCAL_ONLY_TIP} Fetched ${fmtUpdated(at)}.`;
    return `Fresh: your own "Fetch fresh" copy from ${fmtUpdated(at)} (this browser only). Others still see the shared copy until the background refresh catches up.`;
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
        name: r[idx.name],
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
      };
      o.mark = o.markKind === "padding" ? PADDING_MARK : o.markKind === "adjusted" ? ADJUSTED_MARK : "";
      o.markTip = o.markKind === "padding" ? PADDING_MARK_TIP : o.markKind === "adjusted" ? ADJUSTED_MARK_TIP : "";
      o.label = o.name + o.mark;
      for (const id of Object.keys(pools)) {
        const v = r[idx[id]];
        o[id] = v;
        o.pcts[id] = pctOf(pools[id], v);
      }
      return o;
    });
    // t360u: new row objects carry no .rank yet → force assignRanks() to run again
    // (it skipped on an unchanged sort and left "undefined" ranks / a broken order).
    rankedFor = "";
    data = { updatedAt: payload.updatedAt, count: (+payload.count || payload.rows.length - localOnly.size) + localOnly.size, rows, pools };
    histCache.clear();
  }

  function sortedFiltered() {
    if (!data) return [];
    const q = bare(filter); // "[RITE] shlo" → "shlo"
    let list = data.rows;
    if (q) {
      // Name only — the outfit tag is ignored ("rite" doesn't list every [RITE] member).
      list = list.filter((r) => r._bare.includes(q));
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

  function renderHead() {
    const cols = colList();
    const cells = [
      `<th class="rk-pick" scope="col" title="Pick up to ${MAX_NAMES} to Compare"></th>`,
      `<th class="rk-num" scope="col" title="Rank under the current sort">#</th>`,
      `<th class="rk-name sortable${sortKey === "name" ? " sorted" : ""}" data-key="name" scope="col">Player<span class="sort-ind${sortKey === "name" ? " active" : ""}">${sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : "▾"}</span></th>`,
    ];
    for (const c of cols) {
      const on = sortKey === c.id;
      cells.push(
        `<th class="sortable${on ? " sorted" : ""}" data-key="${c.id}" scope="col" title="${esc(c.tip || c.label)}">${esc(c.label)}<span class="sort-ind${on ? " active" : ""}">${on ? (sortDir === "asc" ? "▲" : "▼") : "▾"}</span></th>`,
      );
    }
    $("ranksHead").innerHTML = `<tr>${cells.join("")}</tr>`;
  }

  function cellHtml(c, row) {
    const v = row[c.id];
    if (c.floorZero && fin(v) && v < 0) {
      return `<td class="below-scale" title="Below the rating scale">0</td>`;
    }
    if (!fin(v) && c.thinTip && row.thin) return `<td class="thin-sample" title="${esc(MIN_FIGHTS_TIP)}">—</td>`;
    if (!fin(v)) return `<td>—</td>`;
    const p = row.pcts[c.id];
    const pct = p == null ? "" : `<span class="pct" title="Population percentile: higher than ${p}% of cached players">p${p}</span>`;
    return `<td>${fmt(v, c.digits)}${pct}</td>`;
  }

  /**
   * "#" cell. A player with no value for the current sort (e.g. "—" below the
   * minimum fights) is listed after everyone else but gets no rank number:
   * sitting "last" would wrongly read as "worst".
   */
  function rankCellHtml(r) {
    if (sortKey !== "name" && !fin(r[sortKey])) {
      const why = r.thin && colById(sortKey)?.thinTip ? `Not ranked: ${MIN_FIGHTS_TIP.charAt(0).toLowerCase()}${MIN_FIGHTS_TIP.slice(1)}` : "Not ranked: no value for this column";
      return `<td class="rk-num thin-sample" title="${esc(why)}">—</td>`;
    }
    return `<td class="rk-num">${r.rank}</td>`;
  }

  /** Row HTML for one player (plain strings: cheap for ~1000 rows). */
  function rowHtml(r, cols) {
    const checked = picked.has(r.query) ? " checked" : "";
    const disabled = !picked.has(r.query) && fieldFull() ? " disabled" : "";
    const href = `?names=${encodeURIComponent(r.query)}`;
    return (
      `<tr data-q="${esc(r.query)}">` +
      `<td class="rk-pick"><input type="checkbox" aria-label="Pick ${esc(r.name)}"${checked}${disabled} /></td>` +
      rankCellHtml(r) +
      `<td class="rk-name"><a href="${href}" class="rk-open" title="Add to the comparison (graph above)"><span class="nm" data-full="${esc(r.name)}" title="${esc(r.name + (r.farm ? " — " + r.farm : "") + (r.freshAt ? " — " + freshTip(r.freshAt, r.localOnly) : ""))}">${esc(r.name)}</span></a>` +
      (r.mark ? `<span class="pad-mark mark-${["padding","adjusted"].includes(r.markKind) ? r.markKind : ""}" title="${esc(r.markTip + ". " + r.farm)}">${r.mark}</span>` : "") +
      (r.legacy ? `<span class="sample-legacy" title="${esc(LEGACY_SAMPLE_TIP)}">${LEGACY_SAMPLE_MARK}</span>` : "") +
      (r.freshAt ? `<span class="sample-fresh" title="${esc(freshTip(r.freshAt, r.localOnly))}">${FRESH_MARK}</span>` : "") + `</td>` +
      cols.map((c) => cellHtml(c, r)).join("") +
      `</tr>`
    );
  }

  // Progressive render: the first screenful goes in at once, the rest is
  // appended in small chunks on later frames so phones stay responsive.
  const FIRST_CHUNK = 80;
  const TYPING_QUIET_MS = 300; // filter typing pause before the rest of the list goes in
  let lastTypeAt = -1e9;
  const CHUNK = 200;
  let renderToken = 0;
  let renderState = null; // { list, cols, at } of the current progressive render

  /** Append rows synchronously until at least `n` are in the table (chart jumps). */
  function renderRowsTo(n) {
    const st = renderState;
    if (!st) return;
    const end = Math.min(st.list.length, n);
    if (end <= st.at) return;
    let html = "";
    for (let i = st.at; i < end; i++) {
      const r = st.list[i];
      // Band separators (t310u): a thin divider wherever the sorted metric
      // crosses into another 📊 chart bin (same ranges as the bars).
      if (st.hist) {
        const bi = binIndexOf(st.hist, r[sortKey]);
        if (bi >= 0 && bi !== st.prevBin) html += sepRowHtml(bi, st);
        st.prevBin = bi;
      }
      html += rowHtml(r, st.cols);
    }
    $("ranksBody").insertAdjacentHTML("beforeend", html);
    st.at = end;
  }

  /** Divider row before the first player of chart bin `bi`: "⚔️ iVi 1100–1200 · top 36%". */
  function sepRowHtml(bi, st) {
    const h = st.hist;
    const b = h.bins[bi];
    const col = colById(sortKey);
    const share = sortDir === "asc"
      ? `bottom ${fmtPct(b.cumPct)}`
      : `top ${fmtPct(b.kind === "under" ? 100 : shareAtOrAbove(h.sorted, b.x0))}`;
    const label = `${col.label} ${binRangeText(b, h, col)} · ${share}`;
    return `<tr class="rk-sep" data-bin="${bi}" aria-hidden="true"><td colspan="${3 + st.cols.length}"><span>${esc(label)}</span></td></tr>`;
  }

  function renderBody() {
    assignRanks();
    const cols = colList();
    const list = sortedFiltered();
    const token = ++renderToken;
    const body = $("ranksBody");
    body.innerHTML = "";
    // Separators only for a metric sort (not by name).
    const st = { list, cols, at: 0, prevBin: -1, hist: sortKey !== "name" && colById(sortKey) ? getHist(sortKey) : null };
    renderState = st;
    renderRowsTo(FIRST_CHUNK);
    const step = () => {
      if (token !== renderToken || st.at >= list.length) return;
      // Typing in the filter (t324u): don't append (and relayout) the big table
      // between keystrokes — wait until the typing pauses.
      const quiet = TYPING_QUIET_MS - (performance.now() - lastTypeAt);
      if (quiet > 0) { setTimeout(step, quiet + 10); return; }
      renderRowsTo(st.at + CHUNK);
      if (st.at < list.length) requestAnimationFrame(() => setTimeout(step, 0));
    };
    if (st.at < list.length) requestAnimationFrame(() => setTimeout(step, 0));
    const nLocal = data.rows.reduce((n, r) => n + (r.localOnly ? 1 : 0), 0);
    const nFresh = data.rows.reduce((n, r) => n + (r.freshAt && !r.localOnly ? 1 : 0), 0);
    if ($("ranksTableCount")) $("ranksTableCount").textContent = `(${data.count.toLocaleString()})`;
    $("ranksMeta").textContent = `${list.length.toLocaleString()} of ${data.count.toLocaleString()} players · updated ${fmtUpdated(data.updatedAt)}` +
      (nFresh ? ` · ${FRESH_MARK} ${nFresh} from your fresh fetch` : "") +
      (nLocal ? ` · ${FRESH_MARK} ${nLocal} only in this browser (not shared yet)` : "");
    $("ranksMeta").title = nFresh || nLocal ? `${FRESH_MARK} = stats from your own fetch on Analyze (this browser only); everyone else uses the shared copy.` : "";
    syncPickedUi();
  }

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
    if ($("rkPosCount")) $("rkPosCount").textContent = picks.length ? `(${picks.length})` : "";
    const missing = names.filter((n) => !matchPicks([n], rows, 1).length);
    if (!rows.length && !missing.length) {
      box.innerHTML = `<p class="rk-pos-hint">Add players in the names box (or tick ✅ in the table below) to see where they rank.</p>`;
      return;
    }
    const light = document.documentElement.getAttribute("data-theme") === "light";
    const head = `<tr><th scope="col" class="rk-pos-name">Player</th>` + VISIBLE.map((c) => `<th scope="col" title="${esc(c.tip || c.label)}">${esc(c.label)}</th>`).join("") + `</tr>`;
    const body = rows.map((r) => {
      const i = colorOf.get(r.query);
      const cells = VISIBLE.map((c) => {
        const v = r[c.id];
        if (!fin(v)) return r.thin && c.thinTip ? `<td class="thin-sample" title="${esc(MIN_FIGHTS_TIP)}">—</td>` : `<td>—</td>`;
        const pool = data.pools[c.id] || [];
        const k = rankIn(pool, v, !!c.ascFirst);
        const p = r.pcts[c.id];
        return `<td title="${esc(c.label)} ${fmt(v, c.digits)}: rank ${k.toLocaleString()} of ${pool.length.toLocaleString()} cached players">` +
          `<b>#${k.toLocaleString()}</b>${p != null ? `<span class="pct">p${p}</span>` : ""}</td>`;
      }).join("");
      return `<tr><th scope="row" class="rk-pos-name"><a href="#" class="rk-pos-jump" data-q="${esc(r.query)}" style="color:${paletteColor(i, light)}" title="Show ${esc(r.name)} in the table"><span class="nm" data-full="${esc(r.name)}">${esc(r.name)}</span></a>${r.freshAt ? `<span class="sample-fresh" title="${esc(freshTip(r.freshAt, r.localOnly))}">${FRESH_MARK}</span>` : ""}${r.mark ? `<span class="pad-mark mark-${["padding","adjusted"].includes(r.markKind) ? r.markKind : ""}" title="${esc(r.markTip)}">${r.mark}</span>` : ""}</th>${cells}</tr>`;
    }).join("");
    const miss = missing.length ? `<p class="rk-pos-hint">Not in the Rankings (new, hidden or not cached yet): ${missing.map((n) => `<strong>${esc(n)}</strong>`).join(", ")}</p>` : "";
    box.innerHTML = (rows.length ? `<div class="rk-pos-wrap"><table class="rk-pos-table" aria-label="Rank of the selected players among ${data.count.toLocaleString()} cached players"><thead>${head}</thead><tbody>${body}</tbody></table></div>` : "") + miss;
  }

  /* ---------- 📊 Distribution chart ---------- */

  const SVGNS = "http://www.w3.org/2000/svg";
  let distMetric = "adjs";
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
  }

  /** Metrics the 📊 chart menu offers (our own current stats only, t345u/t346u). */
  const DIST_IDS = new Set(VISIBLE.map((c) => c.id));
  function setDistMetric(id) {
    if (!DIST_IDS.has(id)) return; // older stat (debug column sort): chart keeps its metric
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
  rememberOpen($("rkPosSection"), "ps2-elite-kd-ranks-pos-open");
  function openTable() {
    if (tableSection && !tableSection.open) tableSection.open = true;
  }
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
    if (!data || !svg || !$("distSection").open) return;
    const col = colById(distMetric);
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
      svg.appendChild(svgEl("text", { x: W / 2, y: H / 2, fill: th.dim, "text-anchor": "middle", "font-size": 12 }, "No data"));
      $("distSummary").textContent = "";
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
      if (x != null) hlItems.push({ r, i, x, text: shortName(r.name) + r.mark });
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
    const stats = [["median", h.median], ["p90", h.p90], ["p99", h.p99]];
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
        "aria-label": `Show ${r.name} in the list`,
      }, it.text);
      // t350u: click / tap a picked player's name → scroll the list to their row.
      t.addEventListener("pointerdown", (ev) => { lastPointer = ev.pointerType || "mouse"; });
      t.addEventListener("click", () => { const touch = lastPointer === "touch" || lastPointer === "pen"; lastPointer = "mouse"; jumpToPlayer(r.query, { touch }); });
      t.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jumpToPlayer(r.query); } });
      gm.appendChild(t);
      const shown = col.floorZero && fin(v) && v < 0 ? "0 (below scale)" : fin(v) ? (+v).toFixed(col.digits) : "—";
      const p = r.pcts[distMetric];
      gm.appendChild(svgEl("title", {}, `${r.label}${r.mark ? ` (${r.markTip})` : ""}: ${col.label} ${shown}${p != null ? ` · p${p}` : ""} · rank #${r.rank} (current sort)${r.freshAt ? ` · ${FRESH_MARK} your fresh fetch` : ""}`));
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
        "aria-label": `${col.label} ${binRangeText(b, h, col)}: ${b.count} players. Jump to players in this range`,
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

    const below = col.floorZero ? h.sorted.filter((v) => v < 0).length : 0;
    $("distSummary").textContent =
      `${h.n.toLocaleString()} players · median ${(+h.median).toFixed(col.digits)} · p90 ${(+h.p90).toFixed(col.digits)} · p99 ${(+h.p99).toFixed(col.digits)}` +
      (below ? ` · ${below} below scale (shown as 0)` : "");
  }

  function binRangeText(b, h, col) {
    if (b.kind === "under") return col.floorZero ? `below 0 (below scale)` : `below ${fmtEdge(h.lo, h)}`;
    if (b.kind === "over") return `above ${fmtEdge(h.hi, h)}`;
    return `${fmtEdge(b.x0, h)}–${fmtEdge(b.x1, h)}`;
  }

  let lastPointer = "mouse";
  let tipBin = -1;

  function showTip(ev, b, h, col, bi = -1) {
    const tip = $("distTip");
    const name = col.label;
    const range = binRangeText(b, h, col);
    const touch = lastPointer === "touch" || lastPointer === "pen" || ev.pointerType === "touch" || ev.pointerType === "pen";
    tipBin = bi;
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
    renderBody();
    const sig = hlSignature();
    if (sig !== hlSig) { hlSig = sig; requestAnimationFrame(() => drawDist()); }
  }
  $("ranksSearch").addEventListener("input", (e) => {
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
    if (want !== picked.has(q)) host.toggleName(q, inp, want);
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
  $("rkPositions").addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.rk-pos-jump");
    if (!a) return;
    e.preventDefault();
    jumpToPlayer(a.getAttribute("data-q"));
  });

  $("distMetric").addEventListener("change", (e) => setDistMetric(e.target.value));
  $("distSection").addEventListener("toggle", () => drawDist());
  let distResizeTimer = 0;
  let lastDistW = 0;
  window.addEventListener("resize", () => {
    clearTimeout(distResizeTimer);
    distResizeTimer = setTimeout(() => {
      const w = $("distChart").clientWidth;
      if (w !== lastDistW) { lastDistW = w; drawDist(); }
    }, 120);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest || !e.target.closest("#distChart")) hideTip();
  });

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
    if (tableScroll) glideTo(tableScroll, end ? Math.max(0, tableScroll.scrollHeight - tableScroll.clientHeight) : 0, behavior);
    const sec = $("rankings");
    const secTop = sec ? sec.getBoundingClientRect().top + (window.scrollY || 0) - 8 : 0;
    window.scrollTo({ top: end ? document.documentElement.scrollHeight : Math.max(0, secTop), behavior });
  }
  mountJumpButtons({ state: jumpState, jump: jumpTo, scrollers: [tableScroll], ids: { top: "jumpTop", bottom: "jumpBottom" }, topLabel: "Top of the Rankings", bottomLabel: "End of the Rankings" });

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
    // --- load ---
    $("ranksStatus").textContent = "Loading ranks…";
    try {
      const hiddenP = fetch("data/hidden.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const reviewedP = fetch("data/reviewed.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const res = await fetch("data/ranks.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      // Players this browser fetched on Analyze: newer copies replace shared rows,
      // brand-new graphed names join as local-only rows (remerge, t338u/t359u).
      try { confirmedSet = confirmedPadderSlugs(await reviewedP); } catch {}
      try { hidden = hiddenList(await hiddenP); } catch {}
      base = payload;
      { const ix = payload.cols.indexOf("query"), it = payload.cols.indexOf("savedAt"); baseAt = new Map(payload.rows.map((r) => [slugKey(r[ix]), +r[it] || 0])); }
      remerge();
      syncPicks({ force: true });
      // No mark legend on Rankings (t290u): * / † / ◦ explain themselves via their hover tooltips.
      $("ranksStatus").innerHTML = "";
      fillMetricSelect();
      render();
      drawDist();
    } catch (err) {
      $("ranksStatus").innerHTML = `<span class="err">Could not load ranks.json (${esc(err && err.message)}).</span>`;
      $("ranksMeta").textContent = "—";
    }
  }
  const ready = load();
  return { syncPicks, ready };
}
