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
 *   • Precache the built app shell (JS/CSS/HTML/icons) - `__WB_MANIFEST` is
 *     injected by vite-plugin-pwa at build time.
 *   • SPA navigation fallback: every navigation request resolves to the
 *     cached `index.html`, so TanStack Router handles the route after hydration.
 *   • Stale-while-revalidate for cross-origin fonts/images.
 *   • Supabase REST/Realtime traffic is intentionally NOT cached - RLS and
 *     auth tokens make stale responses dangerous, and TanStack Query already
 *     handles in-memory caching.
 *   • Push: the `push` handler shows a notification for payloads sent by the
 *     Edge Functions (`send-due-pushes` digests/reminders, `notify-on-create`
 *     instant pushes); `notificationclick` focuses/opens the app on the
 *     payload's deep-link. See the "Push notifications" section below.
 */

// `__WB_MANIFEST` is injected by vite-plugin-pwa at build time.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Don't skip waiting on install - that would make every new deploy take
// over silently and the `useRegisterSW` "needRefresh" state would never
// flip true. Instead, wait for the explicit `SKIP_WAITING` message that
// `updateServiceWorker(true)` posts when the user taps the "Osveži" toast.
//
// NOTE: with this prompt flow, a destructive DB migration (e.g. dropping
// a column) can crash a stale client that hasn't refreshed yet. Treat
// column drops / breaking schema changes with expand-contract care
// (keep the column nullable for a release, drop it later) so the old
// cached bundle keeps working until the user taps refresh.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback - under GH Pages this resolves to
// `/family-assistant-react/index.html`, which TanStack Router then routes
// client-side. The denylist excludes asset/static requests so the regex
// doesn't accidentally swallow them.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/_/, /\/[^/?]+\.[^/]+$/],
  }),
);

// Cross-origin fonts + images - stale-while-revalidate so cold loads are
// instant once the asset has been seen once.
registerRoute(
  ({ url, request }: RouteMatchCallbackOptions) =>
    url.origin !== self.location.origin &&
    (request.destination === "font" || request.destination === "image"),
  new StaleWhileRevalidate({ cacheName: "cross-origin-assets" }),
);

// --- Push notifications ----------------------------------------------------
//
// Expected payload shape (sent by the Edge Functions and by the
// `web-push` CLI used to validate this end-to-end on a real iPhone):
//
//   { "title": "Morning summary",
//     "body":  "3 events today, 2 payments due",
//     "url":   "/" ,
//     "tag":   "morning-digest-2026-05-18" }
//
// `tag` collapses repeats so the same digest doesn't pile up if the SW
// receives the same message twice. `url` is the deep-link the app opens
// when the user taps the notification.

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

const ICON_URL = new URL("pwa-192x192.png", self.registration.scope).href;
const BADGE_URL = new URL("pwa-64x64.png", self.registration.scope).href;

self.addEventListener("push", (event) => {
  let payload: PushPayload;
  try {
    payload = event.data ? (event.data.json() as PushPayload) : { title: "Porodični Asistent" };
  } catch {
    // Fallback when the push has no JSON body - still surface *something*
    // so the user knows a notification arrived, then we can debug.
    payload = { title: "Porodični Asistent", body: event.data?.text() ?? "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? "",
      icon: ICON_URL,
      badge: BADGE_URL,
      tag: payload.tag,
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  // Strip leading slashes so paths resolve *relative to the SW scope*
  // (e.g. `/family-assistant-react/`) rather than the origin root. Without
  // this, `"url": "/"` from a payload navigates to `pajcho.github.io/`
  // - a 404 on GH Pages.
  const targetPath = (data?.url ?? "").replace(/^\/+/, "");
  const targetUrl = new URL(targetPath, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open window over opening a new one,
      // and navigate it to the deep link if it isn't already there.
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope)) {
          await client.focus();
          if (client.url !== targetUrl && "navigate" in client) {
            await client.navigate(targetUrl).catch(() => {});
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
