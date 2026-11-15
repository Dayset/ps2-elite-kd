// Players sub-nav (owner 2026-11-15): a second row under the main nav, Players
// pages only — Players · Live feed · Columns · Online now · Archetypes · Fresh.
// Top-level nav keeps sections only; these are subsections of Players.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = {
  "index.html": "index.html",
  "live.html": "live.html",
  "columns.html": "columns.html",
  "online.html": "online.html",
  "archetypes.html": "archetypes.html",
  "fresh.html": "fresh.html",
};
const LINKS = ["index.html", "live.html", "columns.html", "online.html", "archetypes.html", "fresh.html"];

for (const [file, self] of Object.entries(PAGES)) {
  test(`${file}: Players sub-nav with all six links, self marked`, () => {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const m = html.match(/<nav class="sub-nav" aria-label="Players">([\s\S]*?)<\/nav>/);
    assert.ok(m, "sub-nav row present");
    for (const href of LINKS) assert.ok(m[1].includes(`href="${href}"`), `links ${href}`);
    assert.match(m[1], new RegExp(`href="${self}" class="sn-active"`), "current page active");
    assert.equal((m[1].match(/class="sn-active"/g) || []).length, 1, "exactly one active link");
    // styles.css pin: index/live/columns moved to 20261115-srv1 with the server switch;
    // the other Players pages keep the sub-nav pin.
    const pin = ["index.html", "live.html", "columns.html"].includes(file) ? "20261115-srv1" : "20261115-subnav1";
    assert.ok(html.includes(`styles.css?v=${pin}`), "styles.css pin bumped");
    assert.doesNotMatch(html, /<div class="pg-meta">/, "old pg-meta links removed");
  });
}

test("styles.css: sub-nav rules exist and stay visible on phones", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.sub-nav \{[^}]*display: flex/);
  assert.match(css, /\.sub-nav a\.sn-active \{[^}]*border-bottom-color: var\(--accent\)/);
  assert.doesNotMatch(css, /\.sub-nav[^{]*\.sn-hide-m/, "no link hidden on mobile");
});
