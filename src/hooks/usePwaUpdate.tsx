import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Registers the service worker and auto-applies new deploys.
 *
 * We use `registerType: "autoUpdate"` (+ skipWaiting/clientsClaim in
 * `src/sw.ts`): a freshly deployed SW takes control immediately and this
 * hook reloads the page once on `controllerchange` so the user always
 * runs assets that match the current database schema.
 *
 * Why auto-reload instead of the old "tap Osveži" toast: a stale client
 * running old code against a migrated DB (e.g. an activity referencing a
 * dropped column) hard-crashes on load — before any update toast can be
 * tapped. Silent auto-update removes that deadlock. The reload only fires
 * when a NEW SW replaces an EXISTING controller, so a first-ever install
 * doesn't bounce a fresh page, and a `hasReloaded` guard prevents loops.
 *
 * Mount this hook ONCE inside the app shell.
 *
 * Update detection: vite-plugin-pwa only checks for a new sw.js at
 * registration time. For a long-lived PWA (an iOS home-screen install
 * stays "open" for days), a fresh deploy is invisible until the app is
 * reopened. We widen the trigger surface by:
 *   1. polling via `registration.update()` every UPDATE_INTERVAL_MS
 *   2. forcing a check whenever the document becomes visible again.
 */
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

export function usePwaUpdate(): void {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useRegisterSW({
    onRegisterError(error) {
      console.error("[pwa] SW registration failed", error);
    },
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration ?? null;
    },
  });

  // Poll for new deploys (interval + on focus/visibility).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const reg = registrationRef.current;
      if (!reg) return;
      void reg.update().catch(() => {
        // Network blip / SW gone — nothing actionable, ignore.
      });
    };

    const interval = window.setInterval(check, UPDATE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  // Reload once when an updated SW takes control.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Skip the first-install controllerchange (no prior controller) so a
    // brand-new visitor's page doesn't reload out from under them.
    if (!navigator.serviceWorker.controller) return;
    let hasReloaded = false;
    const onControllerChange = () => {
      if (hasReloaded) return;
      hasReloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);
}
