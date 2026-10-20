// Installed-app service worker (PWA). Started as Muse's pass-through wrapper;
// 2026-10-19 (t450u): it now keeps a copy of the app shell so an installed app
// opens while the phone's launch splash is still showing.
//
//  • Pages (HTML): network first (≤2.5 s), saved copy only when the network
//    is slow or offline, so site updates always show up.
//  • Versioned files (?v=… JS/CSS) and the app icons: saved copy first, then
//    refreshed in the background; a new ?v= is a new URL, fetched fresh.
//  • First-screen data (names, ranks-lite, review lists): a saved copy younger
//    than 10 min is used at once and refreshed in the background; anything
//    older waits for the network (≤3 s) and only falls back to the saved copy
//    offline. Stats are never stale for more than one refresh.
//  • Everything else (player cache files, ranks.json, Census/Honu calls) is
//    not touched: it goes straight to the network as before.
const VERSION = "20261019-pwa6";
const SHELL = "ps2-shell-" + VERSION;
const DATA = "ps2-data-v1";
const SCOPE = new URL("./", self.location).href;

// Start pages; their scripts, styles and module imports are found by reading them.
const PAGES = ["./", "oracle/"];
const STATIC = [
  "favicon-512x512.png", "favicon-192x192.png", "icon-maskable-512.png",
  "apple-touch-icon.png", "favicon.ico",
];
const DATA_FILES = [
  "data/reviewed.json", "data/not-farm.json", "data/farm.json",
  "data/names.json", "data/ranks-lite.json",
];
const DATA_SET = new Set(DATA_FILES.map((p) => new URL(p, SCOPE).pathname));
const STATIC_SET = new Set(STATIC.map((p) => new URL(p, SCOPE).pathname));
const FRESH_MS = 10 * 60 * 1000;
const STAMP = "x-sw-fetched-at";

function local(u) {
  try { const x = new URL(u); return x.origin === self.location.origin && x.href.startsWith(SCOPE); } catch (e) { return false; }
}

// Same-site files a page / module / stylesheet needs (src, href, import, @import).
function refs(text, base, type) {
  const out = new Set();
  const add = (p) => {
    if (!p || /^(data:|blob:|mailto:|#|javascript:)/.test(p)) return;
    const u = new URL(p, base);
    if (!local(u.href)) return;
    if (/\/data\/cache\//.test(u.pathname) || /\.json$/.test(u.pathname)) return; // data handled separately
    out.add(u.href);
  };
  if (type === "html") {
    for (const m of text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"[^>]*>/gi)) {
      const tag = m[0];
      if (/^<link/i.test(tag) && !/rel\s*=\s*"(?:stylesheet|modulepreload|preload|icon|apple-touch-icon|manifest)"/i.test(tag)) continue;
      add(m[1]);
    }
    for (const m of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*"([^"]+)"/gi)) add(m[1]);
  } else if (type === "js") {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+\.m?js[^"']*)["']/g)) add(m[1]);
  } else if (type === "css") {
    for (const m of text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) add(m[1]);
  }
  return out;
}

async function precacheShell() {
  const cache = await caches.open(SHELL);
  const seen = new Set();
  const queue = PAGES.map((p) => new URL(p, SCOPE).href).concat(STATIC.map((p) => new URL(p, SCOPE).href));
  while (queue.length && seen.size < 200) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      await cache.put(url, res.clone());
      const path = new URL(url).pathname;
      const type = /\/$|\.html$/.test(path) ? "html" : /\.m?js$/.test(path) ? "js" : /\.css$/.test(path) ? "css" : "";
      if (type) for (const r of refs(await res.text(), url, type)) if (!seen.has(r)) queue.push(r);
    } catch (e) { /* offline during install: the rest is saved on first use */ }
  }
}

async function stamp(res) {
  const h = new Headers(res.headers);
  h.set(STAMP, String(Date.now()));
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: h });
}

async function precacheData() {
  const cache = await caches.open(DATA);
  await Promise.all(DATA_FILES.map(async (p) => {
    try {
      const res = await fetch(new URL(p, SCOPE).href, { cache: "no-cache" });
      if (res.ok) await cache.put(new URL(p, SCOPE).href, await stamp(res));
    } catch (e) {}
  }));
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.all([precacheShell(), precacheData()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("ps2-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

const offline = () => new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });

async function page(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const u = new URL(req.url); u.search = ""; u.hash = "";
      cache.put(u.href, res.clone());
    }
    return res;
  });
  try {
    return await Promise.race([net, timeout(2500)]);
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) { net.catch(() => {}); return hit; }
    try { return await net; } catch (e2) { return offline(); }
  }
}

// Saved copy at once, refreshed in the background (so even an edit that
// forgot to bump ?v= shows up on the next launch).
async function asset(event, req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok && res.type === "basic") return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; } catch (e) { return offline(); }
}

async function data(event, req) {
  const cache = await caches.open(DATA);
  const key = new URL(req.url).origin + new URL(req.url).pathname;
  const refresh = fetch(req.url, { cache: "no-cache" }).then(async (res) => {
    if (res.ok) await cache.put(key, await stamp(res.clone()));
    return res;
  });
  const hit = await cache.match(key);
  const age = hit ? Date.now() - Number(hit.headers.get(STAMP) || 0) : Infinity;
  const forced = req.cache === "reload" || req.cache === "no-store";
  if (hit && age < FRESH_MS && !forced) {
    event.waitUntil(refresh.catch(() => {})); // stale-while-revalidate
    return hit;
  }
  try {
    return await Promise.race([refresh, timeout(3000)]);
  } catch (e) {
    if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
    try { return await refresh; } catch (e2) { return offline(); }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !local(req.url)) return; // Census, Honu, imgur…: browser default
  const url = new URL(req.url);
  if (req.mode === "navigate") return event.respondWith(page(req));
  if (DATA_SET.has(url.pathname)) return event.respondWith(data(event, req));
  if (url.search.includes("v=") || STATIC_SET.has(url.pathname)) return event.respondWith(asset(event, req));
  // anything else: browser default (network + normal HTTP cache)
});
