/**
 * Theme (dark / creamy light), the PC background image switch and the chart's theme colours (#66: moved out of app.js
 * unchanged).
 */
import { t as tr } from "./i18n.mjs";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: LS_THEME, drawChart, els, players.
 */
export function createTheme($) {
  /** 🖼️ PC page background image: "0" = off (hidden); anything else = on (default). */
  const LS_BG_IMAGE = "ps2-elite-kd-bg-image";

  function getStoredTheme() {
    try {
      const t = localStorage.getItem($.LS_THEME);
      return t === "light" || t === "dark" ? t : "dark";
    } catch {
      return "dark";
    }
  }

  function applyTheme(theme, { redraw = true } = {}) {
    const mode = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", mode);
    try {
      localStorage.setItem($.LS_THEME, mode);
    } catch {
      /* private mode */
    }
    if ($.els.themeToggle) {
      if (mode === "light") {
        $.els.themeToggle.textContent = "🌙";
        $.els.themeToggle.title = tr("theme.toDark", "Switch to dark theme");
        $.els.themeToggle.setAttribute("aria-label", tr("theme.toDark", "Switch to dark theme"));
      } else {
        $.els.themeToggle.textContent = "☀️";
        $.els.themeToggle.title = tr("theme.toLight", "Switch to light theme");
        $.els.themeToggle.setAttribute("aria-label", tr("theme.toLight", "Switch to light theme"));
      }
    }
    if (redraw && $.players.length) $.drawChart($.players);
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
    if ($.els.bgToggleBtn) {
      $.els.bgToggleBtn.classList.toggle("off", !on);
      const label = on ? tr("bg.on", "Background image on — click to hide") : tr("bg.off", "Background image off — click to show");
      $.els.bgToggleBtn.title = label;
      $.els.bgToggleBtn.setAttribute("aria-label", label);
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
  return { getStoredTheme, applyTheme, toggleTheme, getStoredBgImage, applyBgImage, toggleBgImage, chartTheme };
}
