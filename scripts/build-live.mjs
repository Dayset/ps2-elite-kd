/**
 * live.html = index.html with the live-mode switches (🎥, t-live).
 * Same app.js, stripped down by CSS (body.live-mode) and driven by live.mjs.
 * Run after editing index.html:  node scripts/build-live.mjs
 * (test/live-page.test.mjs fails when live.html is out of date).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIVE_JS = "live.mjs?v=20261025-col1";
/** #66: the live page's own CSS (moved out of styles.css), loaded right after styles.css. */
export const LIVE_CSS = "live.css?v=20261025-col1";

export function buildLive(index) {
  const swaps = [
    [/<title>[^<]*<\/title>/, "<title>🎥 Live feed — PS2 Elite</title>"],
    [/<link rel="canonical"[^>]*\/>/, '<meta name="robots" content="noindex" />'],
    ['<body class="main-page">', '<body class="main-page live-mode">'],
    ['id="liveBtn" type="button" class="live-btn" aria-pressed="false" title="🎥 Live: follow the first name\'s kills and deaths as they happen" data-i18n-title="live.title"',
      'id="liveBtn" type="button" class="live-btn" aria-pressed="true" title="🎥 Live is on: click to turn it off and edit names" data-i18n-title="live.titleOn"'],
    ['<div id="status"></div>', '<div id="status"></div>\n\n  <section id="liveFeed" class="live-feed" aria-label="Live kills and deaths" aria-live="polite">\n    <div id="liveTrends" class="live-trends" hidden>\n      <div id="liveTrendTitle" class="live-trend-title"></div>\n      <canvas id="liveTrendCanvas" class="live-trend-canvas"></canvas>\n      <div id="liveTrendLegend" class="live-trend-legend"></div>\n    </div>\n    <div id="liveState" class="live-state">Connecting…</div>\n    <table id="liveList" class="live-table"></table>\n  </section>'],
  ];
  swaps.push([/(<link rel="stylesheet" href="styles\.css\?v=[^"]*" \/>)/, `$1\n  <link rel="stylesheet" href="${LIVE_CSS}" />`]);
  let out = index;
  for (const [a, b] of swaps) {
    const next = out.replace(a, b);
    if (next === out) throw new Error(`build-live: anchor not found: ${a}`);
    out = next;
  }
  const tail = out.lastIndexOf("</body>");
  if (tail < 0) throw new Error("build-live: no </body>");
  return out.slice(0, tail) + `  <script type="module" src="${LIVE_JS}"></script>\n` + out.slice(tail);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  writeFileSync(new URL("live.html", root), buildLive(readFileSync(new URL("index.html", root), "utf8")));
  console.log("live.html written");
}
