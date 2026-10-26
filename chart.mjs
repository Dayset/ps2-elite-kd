/**
 * The skill chart: raw / smooth modes, 👻 ghosts, the y-scale and zoom, the SVG drawing (also the 🌊 wave frames), and
 * the chart section's idle / skeleton states (#66: moved out of app.js unchanged).
 */
import { playerMetrics } from "./player-metrics.mjs?v=20261026-brv1";
import { bandGhost, cumulativeGhost } from "./ghost.mjs?v=20261026-brv1";
import GHOST_MODEL from "./data/ghost-model.mjs?v=20261010-sav1";
import { kpmBandCurve, isFiniteNum, X_MAX, bandReliability, clampYZoom, Y_ZOOM_DEFAULT, yScale, windowYValues, applyYZoom, xMaxForZoom, EASY_MAX, HARD_MIN } from "./math.mjs?v=20261026-brv1";
import { niceLogTicks, niceLinTicks, formatTick, slugKey } from "./app-util.mjs?v=20261026-brv1";
import { POOP_MARK, POOP_TIP, isPenalizedPadder } from "./padding.mjs?v=20261023-short1";
import { HUT_MARK, HUT_TIP } from "./hut.mjs?v=20261023-short1";
import { t as tr } from "./i18n.mjs";
import { chartFontScale } from "./desk-scale.mjs?v=20261010-sav1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: AIM_VIEW, IS_PS, LS_CHART_MODE, LS_GHOSTS, PLOT, VB, analyzeSeq, chartFs, chartMode, chartTheme, els, ghostsOn, hutMarked, isLightTheme, lastAnalyzedNames, lastChartScale, lastLoadedNames, ns, playerMark, players, renderStatsTable, seriesColor, startWave, stopWave, syncWeapons, updateWaveRangeWarn, viewXMax, yScaleMode, yScalePct, yZoom.
 */
export function createChart($) {
  const DOT_R = 3;

  function reliability(pt) {
    const n = pt.n || 0;
    const d = pt.deaths || 0;
    if (d <= 0 || n <= 0) return 0;
    return Math.min(1, (n / 8) * 0.5 + (Math.min(d, 80) / 80) * 0.5);
  }

  function syncYScaleUi() {
    const kdBtn = document.querySelector('[data-yscale="kd-btn"]');
    if (kdBtn) {
      const on = $.yScaleMode === "kd";
      kdBtn.classList.toggle("active", on);
      kdBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const ySlider = document.getElementById("yScaleSlider");
    if (ySlider) {
      ySlider.disabled = $.yScaleMode === "kd";
      if (document.activeElement !== ySlider) ySlider.value = $.yScalePct;
      const ySliderVal = document.getElementById("yScaleVal");
      if (ySliderVal) ySliderVal.textContent = $.yScalePct >= 10 ? $.yScalePct.toFixed(0) + "%" : $.yScalePct.toFixed(1) + "%";
    }
  }

  function syncSmoothBtn() {
    // Dayset 2026-10-20: Smooth (banded) and its 🌊 wave are retired from the
    // UI — "fancy but useless". The button now stays hidden even with the
    // debug stats on (buried deeper than the debug box that used to reveal
    // it). The banded / wave code itself is left in place, untouched.
    const b = document.querySelector('[data-mode="banded"]');
    if (b) b.hidden = true;
    // t488u: no 🎯 view → no 💀 / 🎯 switch either (the whole corner bar goes when nothing is left in it).
    if (!$.AIM_VIEW && $.els.chartModeBar) {
      for (const x of $.els.chartModeBar.querySelectorAll('[data-mode="cumulative"], [data-yscale="kd-btn"]')) x.hidden = true;
      $.els.chartModeBar.hidden = ![...$.els.chartModeBar.children].some((x) => !x.hidden);
    }
  }

  function syncChartModeUi() {
    if (!$.els.chartModeBar) return;
    syncSmoothBtn();
    for (const b of $.els.chartModeBar.querySelectorAll("[data-mode]")) {
      // Raw (📈) and KD (💀) are one choice: while 💀 is lit, Raw is not.
      const on = b.dataset.mode === $.chartMode && !(b.dataset.mode === "cumulative" && $.yScaleMode === "kd");
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const gb = $.els.chartModeBar.querySelector("[data-ghosts]");
    if (gb) {
      gb.classList.toggle("active", $.ghostsOn);
      gb.setAttribute("aria-pressed", $.ghostsOn ? "true" : "false");
    }
  }

  function setGhostsOn(on, { redraw = true } = {}) {
    $.ghostsOn = !$.IS_PS && !!on;
    try {
      localStorage.setItem($.LS_GHOSTS, $.ghostsOn ? "1" : "0");
    } catch {
      /* private mode: session-only */
    }
    syncChartModeUi();
  syncSmoothBtn();
    if (redraw && $.players.length) drawChart($.players);
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
    if (!$.ghostsOn || !p || !Array.isArray(p.rows) || !p.rows.length) return [];
    const key = p.rows;
    let byMode = ghostCache.get(key);
    if (!byMode) {
      byMode = {};
      ghostCache.set(key, byMode);
    }
    if (byMode[$.chartMode]) return byMode[$.chartMode];
    let out = [];
    try {
      const m = metricsFor(p);
      if ($.chartMode === "banded") {
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
    byMode[$.chartMode] = out;
    return out;
  }

  function setChartMode(mode, { redraw = true } = {}) {
    const wasBanded = $.chartMode === "banded";
    $.chartMode = mode === "banded" ? "banded" : "cumulative";
    try {
      localStorage.setItem($.LS_CHART_MODE, $.chartMode);
    } catch {
      /* private mode: session-only */
    }
    syncChartModeUi();
    // Dayset: wave auto-starts on Smooth, stops on Raw
    if ($.chartMode === "banded" && !wasBanded) {
      if (typeof $.startWave === "function") $.startWave();
    } else if ($.chartMode !== "banded" && wasBanded) {
      if (typeof $.stopWave === "function") $.stopWave();
    }
    if (redraw && $.players.length) drawChart($.players);
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
    if ($.chartMode === "banded") {
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
    if ($.yScaleMode === "ivi") {
      const ivi = p.ivi;
      if (isFiniteNum(ivi) && ivi > 0) {
        // Cache sorted K/D per player-curve (avoids re-sort every wave frame)
        let sorted = waveSortedCache.get(p);
        // Raw and Smooth curves can have the same length: key on the mode too.
        const cacheKey = `${$.chartMode}:${pts.length}`;
        if (!sorted || sorted._n !== cacheKey) {
          const validKds = pts.filter((pt) => pt.valid && isFiniteNum(pt.kd)).map((pt) => pt.kd);
          sorted = [...validKds].sort((a, b) => a - b);
          sorted._n = cacheKey;
          waveSortedCache.set(p, sorted);
        }
        if (sorted.length > 0) {
          const frac = Math.max(0.00001, Math.min(1, $.yScalePct / 100));
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

  function xToPx(x) {
    return $.PLOT.x + (x / $.viewXMax) * $.PLOT.w;
  }

  function makeYMapper(scale) {
    if (scale.log) {
      const logLo = Math.log10(scale.lo);
      const logHi = Math.log10(scale.hi);
      return (y) => {
        const t = (Math.log10(Math.max(y, scale.lo)) - logLo) / (logHi - logLo);
        return $.PLOT.y + $.PLOT.h * (1 - t);
      };
    }
    return (y) => {
      const t = (y - scale.lo) / (scale.hi - scale.lo || 1);
      return $.PLOT.y + $.PLOT.h * (1 - t);
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
    if ($.els.yZoomSlider) {
      const sv = sliderFromZoom($.yZoom);
      if (Math.abs(+$.els.yZoomSlider.value - sv) > 0.001) {
        $.els.yZoomSlider.value = String(sv);
      }
    }
  }

  function setYZoom(z, { redraw = true } = {}) {
    $.yZoom = clampYZoom(z);
    syncYZoomUi();
    // Zoom stays inside the skill graph: the stats table above is zoom-independent,
    // so a zoom change must not rebuild it (flicker / lost table state).
    if (redraw && $.players.length) drawChart($.players, { skipTable: true });
  }

  function resetYZoom({ redraw = true } = {}) {
    setYZoom(Y_ZOOM_DEFAULT, { redraw });
  }

  function setYZoomVisible(show) {
    // Dayset 2026-10-21: the zoom slider + Auto button are retired from
    // the UI — "barely usable". The controls stay hidden whatever the
    // caller asks; all the zoom code itself is left in place, untouched
    // (same treatment as the 🎚️ Smooth button in syncSmoothBtn). yZoom
    // always starts at Y_ZOOM_DEFAULT, so no one is stuck zoomed.
    if (!$.els.chartYZoom) return;
    $.els.chartYZoom.setAttribute("hidden", "");
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
    return `${$.chartMode}|${$.ghostsOn}|${$.yZoom}|${$.yScaleMode}|${$.isLightTheme()}|${currentChartFontScale()}`;
  }

  /** Y scale for the visible curves (shared by full draws and wave frames). */
  function chartYScale(validCurves, ghostY, yvals, zoomedLeft) {
    return zoomedLeft
      ? yScale(
          windowYValues(validCurves, $.viewXMax).concat(
            ghostY.filter((gp) => gp.kpm <= $.viewXMax + 1e-9).map((gp) => gp.kd)
          )
        ) // fit the left window
      : applyYZoom(yScale(yvals), $.yZoom);
  }

  /** Horizontal grid lines + right-hand tick labels for `scale`. */
  function drawYAxis(gLines, gText, scale, yToPx, th, fz) {
    const yTicks = scale.log ? niceLogTicks(scale.lo, scale.hi) : niceLinTicks(scale.lo, scale.hi, 6);
    for (const y of yTicks) {
      const line = $.ns("line");
      line.setAttribute("x1", $.PLOT.x);
      line.setAttribute("x2", $.PLOT.x + $.PLOT.w);
      line.setAttribute("y1", yToPx(y));
      line.setAttribute("y2", yToPx(y));
      gLines.appendChild(line);
      const t = $.ns("text");
      t.setAttribute("x", $.PLOT.x + $.PLOT.w + 8);
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
      fy = Math.min($.PLOT.y + $.PLOT.h - 8, Math.max($.PLOT.y + 10, fy));
      placed.push(fy);
      const num = $.ns("text");
      num.setAttribute("x", $.PLOT.x - 10);
      num.setAttribute("y", fy + 4);
      num.setAttribute("fill", lab.col);
      num.setAttribute("font-size", fz(14));
      num.setAttribute("font-weight", "800");
      num.setAttribute("text-anchor", "end");
      num.textContent = String(lab.i + 1) + lab.mark.mark + (lab.poop ? POOP_MARK : "") + (lab.hut ? HUT_MARK : "");
      if (lab.mark.mark || lab.poop || lab.hut) {
        const t = $.ns("title");
        t.textContent = [lab.mark.mark ? `${lab.display}${lab.mark.mark}: ${lab.mark.tip}` : "", lab.poop ? `${lab.display} ${POOP_TIP}` : "", lab.hut ? `${lab.display} ${HUT_TIP}` : ""].filter(Boolean).join("\n");
        num.appendChild(t);
      }
      g.appendChild(num);
      const link = $.ns("line");
      link.setAttribute("x1", $.PLOT.x - 4);
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
    if (!rig || rig.list !== list || rig.sig !== waveRigSig() || $.ghostsOn) return false;
    const ptsByPlayer = list.map((p) => chartPoints(p));
    const validCurves = ptsByPlayer.map((pts) => pts.filter((pt) => pt.valid));
    const yvals = [];
    for (const pts of validCurves) for (const pt of pts) yvals.push(pt.kd);
    const scale = chartYScale(validCurves, [], yvals, rig.zoomedLeft);
    $.lastChartScale = scale;
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

  function drawChart(list, { waveFrame = false, skipTable = false, pop = true } = {}) {
    $.updateWaveRangeWarn(list);
    if (waveFrame && updateWaveFrame(list)) return;
    waveRig = null;
    const svg = $.els.chart;
    clearSvg(svg);
    setChartIdle(false);
    setChartSkeleton(false); // a drawn graph replaces any loading stand-in
    if (pop) popChartSection(list);
    else syncChartSectionNames(list);
    svg.setAttribute("viewBox", `0 0 ${$.VB.w} ${$.VB.h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", tr("chart.elite", "Elite K/D vs Enemy KPM"));
    $.chartFs = currentChartFontScale();
    const fz = (n) => String(Math.round(n * $.chartFs * 10) / 10);

    const th = $.chartTheme();

    const bg = $.ns("rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", $.VB.w);
    bg.setAttribute("height", $.VB.h);
    bg.setAttribute("fill", th.bg);
    svg.appendChild(bg);

    // Zoom slider: above the middle zooms into the LEFT start of the graph
    // (X shrinks fast from the right, X min stays 0) and Y re-fits to what is
    // visible; at/below the middle X is full and Y uses the old fit / zoom-out.
    const zoomedLeft = $.yZoom > 1 + 1e-9;
    $.viewXMax = zoomedLeft ? xMaxForZoom($.yZoom) : X_MAX;

    const bands = [
      { x0: 0, x1: EASY_MAX, fill: "#6a8f6a", opacity: th.bandOpacity },
      { x0: EASY_MAX, x1: HARD_MIN, fill: "#8a8a6a", opacity: th.bandOpacity * 0.75 },
      { x0: HARD_MIN, x1: X_MAX, fill: "#8a6a6a", opacity: th.bandOpacity },
    ];
    for (const b of bands) {
      if (b.x0 >= $.viewXMax) continue;
      const x1 = Math.min(b.x1, $.viewXMax);
      const r = $.ns("rect");
      r.setAttribute("x", xToPx(b.x0));
      r.setAttribute("y", $.PLOT.y);
      r.setAttribute("width", xToPx(x1) - xToPx(b.x0));
      r.setAttribute("height", $.PLOT.h);
      r.setAttribute("fill", b.fill);
      r.setAttribute("fill-opacity", b.opacity);
      svg.appendChild(r);
    }

    const banded = $.chartMode === "banded";
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
    $.lastChartScale = scale;
    const yToPx = makeYMapper(scale);
    const xTicks = zoomedLeft ? niceLinTicks(0, $.viewXMax, 5) : [0, 0.5, 1.0, 1.5, 2.0];
    const xTickDigits = zoomedLeft && xTicks.length > 1 && xTicks[1] - xTicks[0] < 0.1 ? 2 : 1;

    const gGrid = $.ns("g");
    gGrid.setAttribute("stroke", th.grid);
    gGrid.setAttribute("stroke-width", "0.8");
    for (const x of xTicks) {
      const line = $.ns("line");
      line.setAttribute("x1", xToPx(x));
      line.setAttribute("x2", xToPx(x));
      line.setAttribute("y1", $.PLOT.y);
      line.setAttribute("y2", $.PLOT.y + $.PLOT.h);
      gGrid.appendChild(line);
    }
    svg.appendChild(gGrid);
    // Y grid lines in their own group (same look, same layer) so wave frames
    // can redraw just these; their tick labels go in gYText further down.
    const gYGrid = $.ns("g");
    gYGrid.setAttribute("stroke", th.grid);
    gYGrid.setAttribute("stroke-width", "0.8");
    svg.appendChild(gYGrid);
    const gYText = $.ns("g");
    drawYAxis(gYGrid, gYText, scale, yToPx, th, fz);

    for (const xv of [EASY_MAX, HARD_MIN]) {
      if (xv >= $.viewXMax) continue;
      const line = $.ns("line");
      line.setAttribute("x1", xToPx(xv));
      line.setAttribute("x2", xToPx(xv));
      line.setAttribute("y1", $.PLOT.y);
      line.setAttribute("y2", $.PLOT.y + $.PLOT.h);
      line.setAttribute("stroke", th.dash);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "5 4");
      line.setAttribute("stroke-opacity", "0.4");
      svg.appendChild(line);
    }

    const border = $.ns("rect");
    border.setAttribute("x", $.PLOT.x);
    border.setAttribute("y", $.PLOT.y);
    border.setAttribute("width", $.PLOT.w);
    border.setAttribute("height", $.PLOT.h);
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", th.border);
    border.setAttribute("stroke-width", "1");
    svg.appendChild(border);

    const clip = $.ns("clipPath");
    clip.setAttribute("id", "plot-clip");
    const clipRect = $.ns("rect");
    clipRect.setAttribute("x", $.PLOT.x);
    clipRect.setAttribute("y", $.PLOT.y);
    clipRect.setAttribute("width", $.PLOT.w);
    clipRect.setAttribute("height", $.PLOT.h);
    clip.appendChild(clipRect);
    const defs = $.ns("defs");
    defs.appendChild(clip);
    svg.appendChild(defs);

    const ylab = $.ns("text");
    ylab.setAttribute("x", $.PLOT.x + $.PLOT.w + 44);
    ylab.setAttribute("y", $.PLOT.y + $.PLOT.h / 2);
    ylab.setAttribute("fill", th.text);
    ylab.setAttribute("font-size", fz(12));
    ylab.setAttribute("text-anchor", "middle");
    ylab.setAttribute("transform", `rotate(90 ${$.PLOT.x + $.PLOT.w + 44} ${$.PLOT.y + $.PLOT.h / 2})`);
    // t378u/t381u: 🎯 aim mode rescales each curve to its player's iVi; say so on the axis.
    ylab.textContent = banded ? tr("chart.ylabBanded", "K/D vs enemies near this KPM") : $.yScaleMode === "ivi" ? tr("chart.ylabAim", "Aim score (public IvI)") : tr("chart.ylabKpd", "Kills per death");
    svg.appendChild(ylab);

    for (const x of xTicks) {
      const t = $.ns("text");
      t.setAttribute("x", xToPx(x));
      t.setAttribute("y", $.PLOT.y + $.PLOT.h + 14 + 4 * $.chartFs);
      t.setAttribute("fill", th.text);
      t.setAttribute("font-size", fz(11));
      t.setAttribute("text-anchor", "middle");
      t.textContent = x.toFixed(xTickDigits);
      svg.appendChild(t);
    }
    // Dayset 2026-10-19: 🐣Easy / 🥵 Hard sit on the tick line itself —
    // right after 0.0, right before the last tick. No separate caption line.
    {
      const tickY = $.PLOT.y + $.PLOT.h + 14 + 4 * $.chartFs;
      const easyT = $.ns("text");
      easyT.setAttribute("x", xToPx(xTicks[0]) + 14);
      easyT.setAttribute("y", tickY);
      easyT.setAttribute("fill", th.muted);
      easyT.setAttribute("font-size", fz(11));
      easyT.setAttribute("text-anchor", "start");
      easyT.textContent = tr("chart.easy", "🐣Easy");
      svg.appendChild(easyT);
      const hardT = $.ns("text");
      hardT.setAttribute("x", xToPx(xTicks[xTicks.length - 1]) - 14);
      hardT.setAttribute("y", tickY);
      hardT.setAttribute("fill", th.muted);
      hardT.setAttribute("font-size", fz(11));
      hardT.setAttribute("text-anchor", "end");
      hardT.textContent = tr("chart.hard", "🥵 Hard");
      svg.appendChild(hardT);
    }
    svg.appendChild(gYText);

    const seriesG = $.ns("g");
    seriesG.setAttribute("clip-path", "url(#plot-clip)");
    svg.appendChild(seriesG);

    const labelAnchors = [];
    const lightLines = $.isLightTheme();
    let drewGhost = false;
    const rigSeries = [];
    list.forEach((p, i) => {
      const col = $.seriesColor(i);
      const pts = ptsByPlayer[i];
      if (drawGhostRuns(seriesG, ghostsByPlayer[i], col, yToPx, p.display, th)) drewGhost = true;
      const rs = { n: pts.length, path: null, segs: [], marks: [], anchor: null };
      rigSeries.push(rs);

      const faint = pts.filter((pt) => pt.valid);
      if (faint.length >= 2) {
        const path = $.ns("path");
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
        const seg = $.ns("line");
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
          const c = $.ns("circle");
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
        rs.anchor = { i, col, k: ak, display: p.display, mark: $.playerMark(p), poop: isPenalizedPadder(p.display), hut: $.hutMarked(p.display) };
        labelAnchors.push({ ...rs.anchor, x: pts[ak].kpm, y: pts[ak].kd });
      }
    });

    const gLabels = $.ns("g");
    svg.appendChild(gLabels);
    drawChartLabels(gLabels, labelAnchors, yToPx, fz);

    waveRig = { list, sig: waveRigSig(), zoomedLeft, banded, th, fz, gYGrid, gYText, gLabels, series: rigSeries };

    if (!skipTable) $.renderStatsTable(list);
    setGhostCaption($.ghostsOn, drewGhost);
  }

  /**
   * Dashed, low-opacity 👻 ghost runs (plus a faint ±1σ shade) wherever the
   * ghost flag is set; each run is extended one grid step into the real line
   * so the prediction visibly continues it. Returns true if anything drew.
   */
  function drawGhostRuns(g, gpts, col, yToPx, display, th) {
    if (!gpts || !gpts.length) return false;
    const pts = gpts
      .filter((gp) => isFiniteNum(gp.kd) && gp.kd > 0 && gp.kpm <= $.viewXMax + 0.051)
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
    const light = $.isLightTheme();
    const tip = `${display}: 👻 predicted from play style, not real fights`;
    let drew = false;
    for (const run of runs) {
      if (run.length < 2) continue;
      const xs = run.map((gp) => xToPx(gp.kpm).toFixed(2));
      const band = $.ns("path");
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
      const line = $.ns("path");
      line.setAttribute("d", run.map((gp, j) => `${j ? "L" : "M"}${xs[j]},${yToPx(gp.kd).toFixed(2)}`).join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", col);
      line.setAttribute("stroke-width", light ? "1.6" : "1.4");
      line.setAttribute("stroke-opacity", light ? "0.7" : "0.55");
      line.setAttribute("stroke-dasharray", "6 4");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("class", "ghost-line");
      const t = $.ns("title");
      t.textContent = tip;
      line.appendChild(t);
      g.appendChild(line);
      drew = true;
    }
    return drew;
  }

  function drawX(svg, cx, cy, s, col) {
    const g = $.ns("g");
    g.setAttribute("stroke", col);
    g.setAttribute("stroke-width", "1.2");
    g.setAttribute("stroke-linecap", "round");
    const a = $.ns("line");
    a.setAttribute("x1", cx - s * 0.55);
    a.setAttribute("y1", cy - s * 0.55);
    a.setAttribute("x2", cx + s * 0.55);
    a.setAttribute("y2", cy + s * 0.55);
    const b = $.ns("line");
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
    if (typeof window === "undefined" || !$.els.chart) return 1;
    const wrap = $.els.chart.closest(".chart-wrap");
    const w = (wrap && wrap.clientWidth) || $.els.chart.clientWidth || 0;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return chartFontScale(window.innerWidth, rootPx, w);
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
    } else if ($.chartMode === "banded") {
      text.innerHTML = "Ghost on: no gaps to predict here<br />(every line has enough fights)";
    } else {
      text.innerHTML = "Ghost on: no gaps to predict here,<br />try 🎚️ Smooth";
    }
  }

  /* Graph skeleton (Dayset 2026-10-22): while an analysis fetches from
   * Census and there is NO graph yet, the chart box shows a graph-shaped
   * stand-in instead of staying hidden. If a previous graph exists it
   * stays on screen for the whole load — the skeleton is only for the
   * nothing-before case (Dayset, later the same day). Off restores the
   * drawn graph's svg when there is one; the draw / idle paths set final
   * visibility. */
  function setChartSkeleton(on) {
    const sk = $.els.chartSkeleton;
    if (!sk) return;
    if (on) {
      if ($.players.length) return; // an old graph exists: keep it during the load
      setChartIdle(false); // the box exists: section un-hidden
      if ($.els.chart) $.els.chart.setAttribute("hidden", "");
      sk.removeAttribute("hidden");
      if ($.els.chartSection) $.els.chartSection.open = true;
    } else {
      sk.setAttribute("hidden", "");
      if ($.players.length && $.els.chart) $.els.chart.removeAttribute("hidden");
    }
  }

  /* Idle = no graph: the svg hides and the whole section folds away (there
   * is no placeholder image any more — Dayset 2026-10-22). */
  function setChartIdle(idle) {
    if ($.els.chart) {
      if (idle) $.els.chart.setAttribute("hidden", "");
      else $.els.chart.removeAttribute("hidden");
    }
    // Idle = no graph: the whole box is unavailable (hidden, like the 🏆
    // weapons box) instead of a folded bar that opens onto an empty frame
    // (owner 2026-10-22).
    if ($.els.chartSection) {
      if (idle) $.els.chartSection.setAttribute("hidden", "");
      else $.els.chartSection.removeAttribute("hidden");
    }
    setYZoomVisible(!idle);
  }

  let chartPoppedFor = "";

  let chartPoppedSeq = -1;

  function popChartSection(list) {
    const sec = $.els.chartSection;
    if (!sec || !list || !list.length) return;
    const prevSig = chartPoppedFor;
    const prevSeq = chartPoppedSeq;
    const sig = syncChartSectionNames(list);
    if (sig && (sig !== prevSig || $.analyzeSeq !== prevSeq)) sec.open = true;
  }

  /* Keep the section header + pop bookkeeping in step with the drawn set
   * WITHOUT opening the section (a chip removal redraws the graph, but
   * deleting names must never spring the section open — owner 2026-10-22). */
  function syncChartSectionNames(list) {
    if (!list || !list.length) return "";
    const names = list.map((p) => p && (p.display || p.name)).filter(Boolean);
    if (!names.length) return "";
    const namesEl = document.getElementById("chartSectionNames");
    if (namesEl) namesEl.textContent = names.join(", ");
    const sig = names.map((n) => slugKey(n)).sort().join("|");
    chartPoppedFor = sig;
    chartPoppedSeq = $.analyzeSeq;
    return sig;
  }

  function foldChartSection() {
    if ($.els.chartSection) $.els.chartSection.open = false;
    chartPoppedFor = "";
    chartPoppedSeq = -1;
    const namesEl = document.getElementById("chartSectionNames");
    if (namesEl) namesEl.textContent = "";
  }

  function showIdleChart() {
    setChartSkeleton(false);
    clearSvg($.els.chart);
    if ($.els.stats) $.els.stats.innerHTML = "";
    if ($.els.statsPublic) $.els.statsPublic.innerHTML = "";
    $.syncWeapons([]); // 🏆 one-player box: unavailable while nothing is graphed
    $.players = [];
    $.lastAnalyzedNames = [];
    $.lastLoadedNames = [];
    resetYZoom({ redraw: false });
    setChartIdle(true);
    foldChartSection();
  }

  function clearChartUi() {
    showIdleChart();
    // Drop any bottom padding scrollToResults() added for short result pages.
    if (typeof document !== "undefined" && document.body) document.body.style.paddingBottom = "";
  }

  const waveSortedCache = new WeakMap();
  return { reliability, syncYScaleUi, syncSmoothBtn, syncChartModeUi, setGhostsOn, metricsFor, ghostPointsFor, setChartMode, bandCurveFor, chartPoints, xToPx, makeYMapper, zoomFromSlider, sliderFromZoom, syncYZoomUi, setYZoom, resetYZoom, setYZoomVisible, clearSvg, waveRigSig, chartYScale, drawYAxis, drawChartLabels, faintPathD, updateWaveFrame, drawChart, drawGhostRuns, drawX, currentChartFontScale, setGhostCaption, setChartSkeleton, setChartIdle, popChartSection, syncChartSectionNames, foldChartSection, showIdleChart, clearChartUi };
}
