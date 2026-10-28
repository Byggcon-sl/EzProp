/*
 * Service worker for the offline trial (phase 1, trial A).
 *
 * Goal: the app on the iPad home screen opens the trial form without network after it has been
 * closed and the iPad restarted. Nothing else: no API, no sign-in, no background sync, no push.
 * The photo queue lives in the page, not here.
 *
 * Plain JS, no bundling. Do not write the product name in this file (lint does not cover public/).
 */

const CACHE_NAME = "offline-trial-v1";

// (a) Always straight to the network, never cached
const NETWORK_ONLY_PREFIXES = ["/api/", "/logg-inn", "/dev/", "/_next/image"];

// (b) Static files: cache first, then network
const STATIC_PREFIXES = ["/_next/static/", "/fonts/", "/brand/", "/@powersync/"];
const STATIC_EXACT = ["/manifest.webmanifest"];

// (c) Pages: network first, cache as fallback
const LIST_PATH = "/prove/testskjema";
const FORM_PATH =
  /^\/prove\/testskjema\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_EXACT = [LIST_PATH, "/arbeidskoe"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function startsWithAny(path, prefixes) {
  return prefixes.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix));
}

function isPagePath(path) {
  return PAGE_EXACT.includes(path) || FORM_PATH.test(path);
}

function isRscRequest(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
}

/** Only complete, ordinary answers from our own server go into the cache. */
function isCacheable(response) {
  return (
    !!response &&
    response.status === 200 &&
    response.type === "basic" &&
    !response.redirected &&
    !response.headers.has("Set-Cookie")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // (a) non-GET: the browser goes to the network as normal
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (startsWithAny(path, NETWORK_ONLY_PREFIXES)) return; // (a)
  if (startsWithAny(path, STATIC_PREFIXES) || STATIC_EXACT.includes(path)) {
    event.respondWith(cacheFirst(request)); // (b)
    return;
  }
  if (isPagePath(path)) {
    // (c)
    if (isRscRequest(request, url)) {
      event.respondWith(rscNetworkFirst(event, request, path));
    } else if (request.mode === "navigate" || url.search === "") {
      event.respondWith(pageNetworkFirst(event, request, path));
    }
  }
  // (d) everything else: network, untouched
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

/**
 * Page HTML is stored under the bare path (no query), so it is found again however the page was
 * opened. When there is no copy of a form page, the list is shown instead (via a redirect, so the
 * address matches the page). A copy of another form page is never used: the form id comes from
 * the server props, so the wrong form would be shown and answers written to it.
 */
async function pageNetworkFirst(event, request, path) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) event.waitUntil(storePage(cache, path, response.clone()));
    return response;
  } catch (error) {
    const cached = await cache.match(path, { ignoreVary: true });
    if (cached) return cached;
    if (FORM_PATH.test(path) && (await cache.match(LIST_PATH, { ignoreVary: true }))) {
      return Response.redirect(LIST_PATH, 302);
    }
    throw error;
  }
}

/**
 * RSC payloads (client-side navigation): network first, exact copy as fallback. Without a copy the
 * request fails, and Next falls back to an ordinary page load, which is then served from the
 * cached HTML above. A successful payload also warms the HTML copy of the same page, so a page
 * reached only by client-side navigation (or prefetched from the list) still opens offline later.
 */
async function rscNetworkFirst(event, request, path) {
  const cache = await caches.open(CACHE_NAME);
  const isPrefetch = request.headers.has("Next-Router-Prefetch");
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      if (!isPrefetch) event.waitUntil(cache.put(request, response.clone()));
      event.waitUntil(warmPage(cache, path));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function storePage(cache, path, response) {
  const html = await response.clone().text();
  await cache.put(path, response);
  await warmStaticAssets(cache, html);
}

/** Fetches the HTML of a page once, if there is no copy yet. Sign-in redirects are not stored. */
async function warmPage(cache, path) {
  try {
    if (await cache.match(path, { ignoreVary: true })) return;
    const response = await fetch(path, { credentials: "same-origin", redirect: "manual" });
    if (isCacheable(response)) await storePage(cache, path, response);
  } catch {
    // No network: tried again on the next visit
  }
}

/** Stores the scripts and styles a page refers to, so the page can start without network. */
async function warmStaticAssets(cache, html) {
  const found = html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [];
  const unique = Array.from(new Set(found));
  await Promise.all(
    unique.map(async (asset) => {
      try {
        if (await cache.match(asset, { ignoreVary: true })) return;
        const response = await fetch(asset, { credentials: "same-origin" });
        if (isCacheable(response)) await cache.put(asset, response);
      } catch {
        // Ignored; the asset is cached when the page loads it
      }
    }),
  );
}
