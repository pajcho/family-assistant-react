/// <reference lib="webworker" />
import type { PrecacheEntry } from "workbox-precaching";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import type { RouteMatchCallbackOptions } from "workbox-core";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";

/**
 * Custom service worker for Porodični Asistent.
 *
 * Strategy:
 *   • Precache the built app shell (JS/CSS/HTML/icons) — `__WB_MANIFEST` is
 *     injected by vite-plugin-pwa at build time.
 *   • SPA navigation fallback: every navigation request resolves to the
 *     cached `index.html`, so TanStack Router handles the route after hydration.
 *   • Stale-while-revalidate for cross-origin fonts/images.
 *   • Supabase REST/Realtime traffic is intentionally NOT cached — RLS and
 *     auth tokens make stale responses dangerous, and TanStack Query already
 *     handles in-memory caching.
 *
 * Push handlers are stubs today. Phase 2 (notifications) fills them in.
 */

// `__WB_MANIFEST` is injected by vite-plugin-pwa at build time.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

self.skipWaiting();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback — under GH Pages this resolves to
// `/family-assistant-react/index.html`, which TanStack Router then routes
// client-side. The denylist excludes asset/static requests so the regex
// doesn't accidentally swallow them.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/_/, /\/[^/?]+\.[^/]+$/],
  }),
);

// Cross-origin fonts + images — stale-while-revalidate so cold loads are
// instant once the asset has been seen once.
registerRoute(
  ({ url, request }: RouteMatchCallbackOptions) =>
    url.origin !== self.location.origin &&
    (request.destination === "font" || request.destination === "image"),
  new StaleWhileRevalidate({ cacheName: "cross-origin-assets" }),
);

// --- Push notification stubs (filled in during phase 2) --------------------

self.addEventListener("push", (_event) => {
  // Will: parse payload JSON, call self.registration.showNotification()
});

self.addEventListener("notificationclick", (_event) => {
  // Will: focus existing client or open one at the deep-link URL
});
