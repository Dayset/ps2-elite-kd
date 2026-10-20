// Minimal wrapper service worker: makes the site installable (PWA) and
// passes every request straight to the network — stats are never cached,
// so an installed app always shows fresh data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(
      () => new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
    )
  );
});
