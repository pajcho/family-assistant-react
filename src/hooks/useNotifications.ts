import { useCallback, useEffect, useState } from "react";
import { vapidPublicKeyToUint8Array } from "@/lib/pwa-config";

/**
 * Wraps the Web Notifications + Push API into a hook with React-friendly
 * state. During the validation phase (no backend yet) the settings page
 * uses this to subscribe, then displays the resulting subscription JSON
 * so the user can hand it to a one-off `web-push send-notification` call
 * from the terminal. Once the Edge Function lands, the same hook will
 * POST the subscription to `subscribe-push` instead.
 *
 * iOS gotchas:
 *   • Permission can only be requested *inside an installed PWA* —
 *     calling `Notification.requestPermission()` from a regular Safari
 *     tab is a no-op (`{ default }` forever) on iPhones.
 *   • Subscription survives reinstalls so we always re-read from the SW
 *     registration rather than caching it in localStorage.
 */

export interface SerialisedPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface NotificationsState {
  /** Whether the browser even supports push (false on most non-iPad Safari and old browsers) */
  supported: boolean;
  /** Browser permission for `Notification` */
  permission: NotificationPermission;
  /** True once the current SW registration has an active push subscription */
  isSubscribed: boolean;
  /** The active subscription serialised for transport. Null when not subscribed. */
  subscription: SerialisedPushSubscription | null;
  /** True while a subscribe/unsubscribe call is in flight */
  pending: boolean;
  /** Last error from subscribe/unsubscribe — exposed so the UI can surface it */
  error: string | null;
}

export interface UseNotifications extends NotificationsState {
  /** Request permission (if needed) and subscribe to push on this device */
  subscribe: () => Promise<void>;
  /** Tear down the push subscription for this device only */
  unsubscribe: () => Promise<void>;
  /** Fire a local notification via the SW — useful to sanity-check the SW + permission */
  sendLocalTest: () => Promise<void>;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function serialiseSubscription(sub: PushSubscription): SerialisedPushSubscription {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  };
}

export function useNotifications(): UseNotifications {
  const supported = isSupported();
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : "denied",
  );
  const [subscription, setSubscription] = useState<SerialisedPushSubscription | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the existing subscription on mount so refreshing the settings
  // page reflects an already-subscribed device.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (cancelled) return;
      setSubscription(existing ? serialiseSubscription(existing) : null);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) {
      setError("Ovaj uređaj ne podržava push obaveštenja.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Dozvola za obaveštenja je odbijena.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKeyToUint8Array(),
        }));
      setSubscription(serialiseSubscription(sub));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setPending(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      setSubscription(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [supported]);

  const sendLocalTest = useCallback(async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Test obaveštenja", {
      body: "Ovo je lokalno obaveštenje — proverava SW i dozvolu.",
      tag: "local-test",
      data: { url: "/" },
    });
  }, [supported]);

  return {
    supported,
    permission,
    isSubscribed: !!subscription,
    subscription,
    pending,
    error,
    subscribe,
    unsubscribe,
    sendLocalTest,
  };
}
