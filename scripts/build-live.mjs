/**
 * live.html = index.html with the live-mode switches (🎥, t-live).
 * Same app.js, stripped down by CSS (body.live-mode) and driven by live.mjs.
 * Run after editing index.html:  node scripts/build-live.mjs
 * (test/live-page.test.mjs fails when live.html is out of date).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIVE_JS = "live.mjs?v=20261019-vcut1";

export function buildLive(index) {
  const swaps = [
    [/<title>[^<]*<\/title>/, "<title>🎥 Live feed — PS2 Elite K/D</title>"],
    [/<link rel="canonical"[^>]*\/>/, '<meta name="robots" content="noindex" />'],
    ['<body class="main-page">', '<body class="main-page live-mode">'],
    ['id="liveBtn" type="button" class="live-btn" aria-pressed="false" title="🎥 Live: follow the first name\'s kills and deaths as they happen"',
      'id="liveBtn" type="button" class="live-btn" aria-pressed="true" title="🎥 Live is on: click to turn it off and edit names"'],
    ['<div id="status"></div>', '<div id="status"></div>\n\n  <section id="liveFeed" class="live-feed" aria-label="Live kills and deaths" aria-live="polite">\n    <div id="liveState" class="live-state">Connecting…</div>\n    <table id="liveList" class="live-table"></table>\n  </section>'],
  ];
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
