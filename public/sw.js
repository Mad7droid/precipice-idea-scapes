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
 *
 * Published scapes are the one same-origin thing this worker stays out of entirely. `/p/<id>`
 * and `/embed/<id>` are somebody else's document, served from a different bundle, and their
 * freshness is the publisher's decision — an unpublish that a stale cache keeps serving is the
 * whole point of `Cache-Control: no-store` on the pointer read. They go straight to network.
 */

const CACHE = "precipice-v2";

/** Public viewer paths. Never cached, never given the editor shell as a fallback. */
function isPublic(pathname) {
  return pathname === "/p" || pathname === "/embed" || /^\/(p|embed)\//.test(pathname);
}

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

  // Published content is not this app's to cache. Falling through to the network also means
  // the browser handles it exactly as it would with no service worker installed.
  if (isPublic(url.pathname)) return;

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
    const cached = await caches.match(request);
    if (cached) return cached;

    // The shell fallback is the *editor's* shell, so it is only ever right for an editor
    // navigation. An offline `/p/<id>` served `/index.html` would show a stranger the app —
    // logged into nothing, listing the reader's own scapes — in place of the document they
    // asked for. `isPublic` already returned above; this is the belt to that braces, because
    // the failure is silent and looks like a routing bug rather than a caching one.
    const path = new URL(request.url).pathname;
    if (isPublic(path)) throw new Error("offline: published scapes are not cached");

    const shell = await caches.match("/index.html");
    if (shell) return shell;
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
