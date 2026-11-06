// SG16 — service worker for the installable app (owner request 2026-10-18).
//
// Deliberately minimal: it never caches or serves site pages, so a deploy is
// always seen at once. Its only job is the installed app's offline screen:
// when a page navigation fails (no network), it shows /offline.html instead
// of the browser's error page. Everything else goes straight to the network.
const CACHE = "sg16-offline-v1";
const OFFLINE = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    // the offline screen's own emblem: network first, stored copy when offline
    if (new URL(event.request.url).pathname === "/icons/icon-192.png") {
      event.respondWith(fetch(event.request).catch(() => caches.match("/icons/icon-192.png")));
    }
    return; // everything else: browser handles it
  }
  event.respondWith(
    (async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(event.request);
      } catch {
        const cached = await caches.match("/offline.html");
        if (!cached) return Response.error();
        // rebuild it: the host may have redirected /offline.html when it was
        // cached, and a redirected response cannot answer a navigation
        return new Response(await cached.blob(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    })()
  );
});
