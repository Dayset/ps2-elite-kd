// #74: no module reads a name it never declares or imports, other than a browser or
// Node global (or one listed with its reason in test/free-globals.json). Catches an
// app.js split that left a variable behind, and typos like `histAll = true` that only
// throw when that line runs. Parser: the acorn copy inside Node (no npm packages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const allow = JSON.parse(fs.readFileSync(new URL("test/free-globals.json", root), "utf8"));

// Browser globals the site uses or may use (window properties, not in Node's globalThis).
const BROWSER = new Set(`window document navigator location history localStorage sessionStorage
  screen innerWidth innerHeight outerWidth outerHeight devicePixelRatio scrollX scrollY pageXOffset pageYOffset
  addEventListener removeEventListener dispatchEvent getComputedStyle matchMedia getSelection
  requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  alert confirm prompt open close print scrollTo scrollBy focus blur
  IntersectionObserver MutationObserver ResizeObserver PerformanceObserver
  Element HTMLElement HTMLInputElement HTMLCanvasElement HTMLImageElement SVGElement Node NodeList DocumentFragment
  Image ImageData ImageBitmap createImageBitmap OffscreenCanvas Path2D DOMParser XMLSerializer DOMRect
  CSS CSSStyleSheet KeyboardEvent MouseEvent PointerEvent TouchEvent FocusEvent InputEvent
  WebSocket Worker SharedWorker IDBKeyRange indexedDB Notification
  SpeechSynthesisUtterance speechSynthesis AudioContext webkitAudioContext Audio
  self caches clients registration skipWaiting importScripts`.split(/\s+/).filter(Boolean));
const NODE = new Set(Object.getOwnPropertyNames(globalThis));

test("no free identifiers in the site's modules (#74)", () => {
  const out = execFileSync(process.execPath, ["--expose-internals", "--no-warnings", new URL("scripts/free-globals.mjs", root).pathname], { encoding: "utf8" });
  const found = JSON.parse(out);
  assert.ok(Object.keys(found).length > 40, "scanned the modules");
  const bad = [];
  for (const [file, names] of Object.entries(found)) {
    for (const [name, line] of Object.entries(names)) {
      if (!BROWSER.has(name) && !NODE.has(name) && !(name in allow)) bad.push(`${file}:${line} ${name}`);
    }
  }
  assert.deepEqual(bad, [], "undeclared names (declare/import them, or add to test/free-globals.json with a reason)");
});

test("free-globals.json: every entry has a reason", () => {
  for (const [k, v] of Object.entries(allow)) assert.ok(typeof v === "string" && v.length > 10, k);
});
