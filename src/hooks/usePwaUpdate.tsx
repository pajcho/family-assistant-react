import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

/**
 * Listens for service-worker updates from vite-plugin-pwa.
 *
 * When a new SW activates (because a fresh deploy went live), this surfaces
 * a persistent sonner toast with a "Osveži" action. We deliberately don't
 * silently reload — users may have unsaved input in a dialog. The toast
 * stays until they dismiss or refresh.
 *
 * Mount this hook ONCE inside the authenticated app shell.
 *
 * Update detection: vite-plugin-pwa only checks for a new sw.js at
 * registration time. For a long-lived PWA (iOS home-screen install
 * stays "open" for days at a time), that means a freshly deployed
 * version is invisible until the user closes and reopens the app. We
 * widen the trigger surface by:
 *   1. polling via `registration.update()` every UPDATE_INTERVAL_MS
 *   2. forcing a check whenever the document becomes visible again —
 *      iOS suspends background tabs / PWAs, so coming back into focus
 *      is the natural moment to look for a new deploy.
 */
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

export function usePwaUpdate(): void {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("[pwa] SW registration failed", error);
    },
    onRegisteredSW(_swUrl, registration) {
      // Hold onto the registration so the polling + focus effect below
      // can call `.update()` on it.
      registrationRef.current = registration ?? null;
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // In dev the SW is rebuilt on every change, so `reg.update()` here would
    // perpetually re-detect a "new" version and re-fire the toast below. The
    // real update flow only matters for a production build — exercise it with
    // `vite preview`, not `vite dev`.
    if (!import.meta.env.PROD) return;
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

  useEffect(() => {
    // Scope the prompt to production: see the polling effect above — in dev
    // `needRefresh` flips on every rebuild, so the toast would never stop
    // reappearing.
    if (!import.meta.env.PROD) return;
    if (!needRefresh) return;
    const id = toast("Nova verzija dostupna", {
      description: "Osveži aplikaciju da preuzmeš najnovije izmene.",
      duration: Infinity,
      action: {
        label: "Osveži",
        onClick: () => {
          void updateServiceWorker(true);
        },
      },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
}
