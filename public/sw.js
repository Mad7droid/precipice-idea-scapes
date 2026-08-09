/**
 * Offline shell.
 *
 * Precipice keeps every scape in IndexedDB on the user's own machine, so an app that will not
 * start without a network is claiming to be local-first while being nothing of the kind. This
 * exists so that once you have opened Precipice, you can open it again on a plane.
 *
 * Two rules, and they cover everything:
 *
 *   Documents (navigations) — network first, cache as a fallback. The freshest HTML wins
 *   whenever there is a network, so a deploy is picked up on the next load. There is no
 *   "update available" prompt to build because there is never a stale shell to escape.
 *
 *   Everything else same-origin — cache first. Vite fingerprints its assets, so a cached
 *   `index-a1b2c3d4.js` is that exact file forever; a new build asks for a new name. Serving
 *   it from cache cannot go stale.
 *
 * The AI proxy is cross-origin and never touched here. Nothing about a generation is cached.
 */

const CACHE = "precipice-v1";

self.addEventListener("install", (event) => {
  // The shell is cached on first fetch rather than precached from a manifest: a hand-written
  // list of hashed filenames would be wrong the moment Vite rebuilt.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Opaque and error responses are not worth keeping; serving one back offline would show
    // a blank page rather than the app.
    if (response.ok) void put(request, response.clone());
    return response;
  } catch {
    const cached = (await caches.match(request)) ?? (await caches.match("/index.html"));
    if (cached) return cached;
    throw new Error("offline and no cached shell");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) void put(request, response.clone());
  return response;
}

async function put(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    // A full cache or a private-mode restriction is not a reason to fail the request the
    // page actually made.
  }
}
