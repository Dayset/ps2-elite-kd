// Desktop-only sizing (t299u): on big monitors (2560×1440) the stats text looked
// tiny while the graph filled the whole screen. styles.css raises the root
// font-size from DESK_MIN_VW up and caps the graph height; these helpers keep
// SVG text in step with that HTML text. Below DESK_MIN_VW everything returns 1,
// so phones / small laptops render exactly as before.
export const DESK_MIN_VW = 1400;
const BASE_ROOT_PX = 16;

/** Root font growth on desktop (1 on mobile), e.g. 2560px → ~1.34. */
export function deskUiScale(vw, rootPx) {
  if (!(vw >= DESK_MIN_VW) || !(rootPx > 0)) return 1;
  return Math.min(1.5, Math.max(1, rootPx / BASE_ROOT_PX));
}

/**
 * Main chart (viewBox 1000 wide, ticks at font-size 11): factor that brings the
 * rendered tick text up to ~0.8rem (the stats-table size) when the capped graph
 * would otherwise draw it smaller. Never shrinks, max 1.45 so labels still fit
 * the fixed margins. 1 below DESK_MIN_VW.
 */
export function chartFontScale(vw, rootPx, chartPx, vbW = 1000) {
  if (!(vw >= DESK_MIN_VW) || !(rootPx > 0) || !(chartPx > 0)) return 1;
  const tickPx = (11 * chartPx) / vbW;
  const want = rootPx * 0.8;
  return Math.round(Math.min(1.45, Math.max(1, want / tickPx)) * 100) / 100;
}
