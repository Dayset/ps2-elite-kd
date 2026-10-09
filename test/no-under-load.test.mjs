// t284u: the "server is under load" banner and its load-flag polling were removed;
// the real Census busy/down messages must stay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("no under-load banner, styles or load-flag polling", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");
  const log = read("build-log.html");
  assert.doesNotMatch(html, /underLoad|under load/i);
  assert.doesNotMatch(app, /underLoad|load-flag|SERVER_LOAD|BroadcastChannel|beginLiveFetch/);
  assert.doesNotMatch(css, /\.under-load/);
  assert.doesNotMatch(log, /load-flag/);
  assert.equal(existsSync(new URL("../data/load-flag.json", import.meta.url)), false);
});

test("real Census busy messages are kept", () => {
  const app = read("app.js");
  assert.match(app, /Daybreak Census is busy, retrying…/);
  assert.match(app, /showing cached data for/);
  assert.match(app, /↻ Try again/);
});
