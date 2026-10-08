/**
 * Player series colours shared by the main chart (app.js) and the ranks page
 * distribution markers, so a player "looks the same" everywhere.
 */
export const COLORS = Object.freeze([
  "#9fd4ee", "#ff7a7a", "#ffd166", "#8ef0b0", "#e8b0ff",
  "#ffb07a", "#7ef0e6", "#ffa0c8", "#c6f06a", "#8cbcff",
]);
/**
 * Light theme: same hues, darker/more saturated so lines and names reach
 * ≥4.5:1 contrast on the cream panel (#e8e1d4) and page (#f0ebe3).
 * Generated from COLORS by HSL lightness reduction (saturation ≥ 0.75).
 */
export const LIGHT_COLORS = Object.freeze([
  "#156b95", "#cc0000", "#855d00", "#0f7332", "#9f00e0",
  "#ab4500", "#0d7067", "#c70054", "#4e6d0b", "#005cdb",
]);
/** Colour for player i in the given theme. */
export function paletteColor(i, light = false) {
  const pal = light ? LIGHT_COLORS : COLORS;
  return pal[((i % pal.length) + pal.length) % pal.length];
}
