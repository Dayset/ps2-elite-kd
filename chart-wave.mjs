/**
 * The 🌊 wave (the y-scale slider swinging on its own, drawn at most ~120 times a second) and the K/D ⇄ iVi y-scale
 * switch (#66: moved out of app.js unchanged).
 */
import { isFiniteNum } from "./math.mjs?v=20261026-psb1";
import { escapeHtml } from "./app-util.mjs?v=20261026-psb1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: AIM_VIEW, WAVE_AMP, WAVE_MAX, WAVE_MID, WAVE_MIN, WAVE_RAD_PER_MS, chartOnScreen, drawChart, ghostsOn, players, setGhostsOn, syncChartModeUi, syncYScaleUi, waveOn, yScaleMode, yScalePct, ySlider, ySliderVal.
 */
export function createChartWave($) {
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

  // Y-scale display switch: K/D / A (iVi-median) / B (iVi-start)
  function setYScaleMode(mode, pct) {
    $.yScaleMode = $.AIM_VIEW ? mode : "kd"; // t488u: always 💀 K/D while the 🎯 view is off
    if (pct !== undefined) $.yScalePct = pct;
    $.syncYScaleUi();
    $.syncChartModeUi();
    if ($.players.length) $.drawChart($.players);
  }

  let waveT = 0;

  let waveRaf = 0;

  let waveLastDrawn = -1;

  let waveShape = "smooth";

   // player -> sorted pace-KD array
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

  // Draw at most ~this many frames a second, on an even divisor of the
  // screen's refresh (360 Hz → every 3rd frame, 240 → every 2nd, 144 → every
  // one), so the cadence stays even. 0 = draw every frame.
  const WAVE_MAX_FPS = 120;

  let waveLastTs = 0;

  let waveFrameNo = 0;

  let waveDtAvg = 0;

  function waveTick(ts) {
    if (!$.waveOn) return;
    waveRaf = requestAnimationFrame(waveTick);
    if (!$.chartOnScreen || typeof ts !== "number") {
      waveLastTs = 0;
      return;
    }
    // Cap the step after a long pause (tab switch, GC) so it resumes, not jumps.
    const dt = waveLastTs ? Math.min(50, ts - waveLastTs) : 0;
    waveLastTs = ts;
    waveT += dt * $.WAVE_RAD_PER_MS;
    if (WAVE_MAX_FPS > 0 && dt > 0) {
      waveDtAvg = waveDtAvg ? waveDtAvg * 0.9 + dt * 0.1 : dt;
      const skip = Math.max(1, Math.floor(1000 / waveDtAvg / WAVE_MAX_FPS + 0.15));
      if (++waveFrameNo % skip !== 0) return;
    }
    let w = waveShape === "smooth" ? waveFormSmooth(waveT) : waveForm(waveT);
    // Snappier reversals: sharpen peaks so less time lingers at 0%/100%
    w = Math.sign(w) * Math.pow(Math.abs(w), 0.2); // Dayset: aggressive snap
    const pct = $.WAVE_MID + $.WAVE_AMP * w;
    $.yScalePct = Math.max($.WAVE_MIN, Math.min($.WAVE_MAX, pct));
    if ($.ySlider) $.ySlider.value = $.yScalePct;
    if (Math.abs($.yScalePct - waveLastDrawn) >= 0.02) {
      waveLastDrawn = $.yScalePct;
      if ($.ySliderVal) $.ySliderVal.textContent = $.yScalePct >= 10 ? $.yScalePct.toFixed(0) + "%" : $.yScalePct.toFixed(1) + "%";
      if ($.AIM_VIEW && $.yScaleMode !== "ivi") {
        $.yScaleMode = "ivi";
        $.syncYScaleUi();
      }
      // Wave frame: moves the existing chart elements only (no table/legend rebuild).
      if ($.players.length) $.drawChart($.players, { waveFrame: true });
    }
  }

  /** Wave flicker warning while waving: names the lowest and highest public iVi
   *  players; hidden again as soon as the spread is no longer extreme. */
  function updateWaveRangeWarn(list) {
    const warnEl = document.getElementById("waveRangeWarn");
    if (!warnEl) return;
    let show = false;
    const withIvi = (list || []).filter((p) => isFiniteNum(p.ivi) && p.ivi > 0);
    if ($.waveOn && withIvi.length >= 2) {
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
    if ($.waveOn) return;
    $.waveOn = true;
    // Ghost off while wave is on (Dayset 2026-10-13)
    if ($.ghostsOn) $.setGhostsOn(false, { redraw: false });
    updateWaveRangeWarn($.players);
    // start phase from current slider so there's no jump
    const frac = ($.yScalePct - $.WAVE_MID) / $.WAVE_AMP;
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
    if (!$.waveOn) return;
    $.waveOn = false;
    cancelAnimationFrame(waveRaf);
    const warnEl = document.getElementById("waveRangeWarn");
    if (warnEl) warnEl.hidden = true;
    const wb = document.getElementById("yWaveBtn");
    if (wb) { wb.textContent = "🌊"; wb.classList.remove("active"); }
    const gb = document.querySelector("[data-ghosts]");
    if (gb) gb.disabled = false;
  }
  return { setYScaleMode, waveForm, waveFormSmooth, waveTick, updateWaveRangeWarn, startWave, stopWave, waveSwing, consistency };
}
