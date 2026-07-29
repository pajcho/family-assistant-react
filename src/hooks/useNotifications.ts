import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { vapidPublicKeyToUint8Array } from "@/lib/pwa-config";
import { usePushSubscriptionRows } from "@/hooks/usePushSubscriptions";

/**
 * Wraps the Web Notifications + Push API into a hook with React-friendly
 * state. On subscribe we (1) request permission, (2) ask the browser's
 * PushManager for a subscription against our VAPID public key, then
 * (3) POST that subscription to the `subscribe-push` Edge Function which
 * upserts it into `push_subscriptions` keyed by endpoint.
 *
 * If the server upsert fails we tear the browser subscription back down
 * - better to leave the device unsubscribed than to have the browser
 * think we're subscribed while the server has no record.
 *
 * **`isSubscribed` needs BOTH halves.** A `PushSubscription` belongs to the
 * service worker + origin, not to an account: it survives sign-out, so after
 * user B signs in on a browser where user A switched notifications on, the
 * browser still hands back A's subscription. Reading only that reported
 * "enabled" to B while every push still went to A - B got nothing of their
 * own, and A's family's reminders landed on a device B was using. So a device
 * counts as subscribed only when the browser has a subscription AND the
 * `push_subscriptions` row for that endpoint belongs to the signed-in user.
 *
 * iOS gotchas:
 *   • Permission can only be requested *inside an installed PWA* -
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
  /**
   * True when this browser has a push subscription AND its server row belongs
   * to the signed-in user. False for a subscription left behind by whoever was
   * signed in before, or one revoked from another device's session list.
   */
  isSubscribed: boolean;
  /**
   * This browser's subscription, whoever it belongs to. Serialised for
   * transport; null when the browser has none. Use `isSubscribed` to decide
   * what to show - this one only identifies the device.
   */
  subscription: SerialisedPushSubscription | null;
  /** True until both halves of `isSubscribed` have been read at least once. */
  checking: boolean;
  /** True while a subscribe/unsubscribe call is in flight */
  pending: boolean;
  /** Last error from subscribe/unsubscribe - exposed so the UI can surface it */
  error: string | null;
}

export interface UseNotifications extends NotificationsState {
  /** Request permission (if needed) and subscribe to push on this device */
  subscribe: () => Promise<void>;
  /** Tear down the push subscription for this device only */
  unsubscribe: () => Promise<void>;
  /** Fire a local notification via the SW - useful to sanity-check the SW + permission */
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
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server half: every row that belongs to the signed-in user.
  const { subscriptions: myRows, isLoading: rowsLoading, refresh } = usePushSubscriptionRows();

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
      setDeviceChecked(true);
    })().catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setDeviceChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const isMine = useCallback(
    (endpoint: string): boolean => myRows.some((row) => row.endpoint === endpoint),
    [myRows],
  );
  const isSubscribed = subscription !== null && isMine(subscription.endpoint);
  // Rendering the toggle before both halves are in would flash the wrong
  // label - and the wrong label here is the whole bug.
  const checking = supported && (!deviceChecked || rowsLoading);

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
      let sub = await reg.pushManager.getSubscription();

      // A subscription left behind by another account can't be re-pointed at
      // this one: `subscribe-push` upserts on `endpoint`, and the UPDATE arm
      // of that upsert is rejected by RLS because the existing row isn't ours
      // ("new row violates row-level security policy (USING expression)").
      // Recycle it into a fresh endpoint instead - the old one starts
      // answering 410, and send-due-pushes sweeps the stale row away.
      if (sub && !isMine(sub.endpoint)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKeyToUint8Array(),
      });
      const serialised = serialiseSubscription(sub);

      // Persist the subscription to Supabase. If this fails we tear down
      // the browser-side subscription so the two sides stay consistent.
      const { error: invokeError } = await supabase.functions.invoke("subscribe-push", {
        body: {
          endpoint: serialised.endpoint,
          keys: serialised.keys,
          userAgent: navigator.userAgent,
        },
      });
      if (invokeError) {
        await sub.unsubscribe().catch(() => {});
        setError(`Server greška: ${invokeError.message}`);
        return;
      }
      setSubscription(serialised);
      // The row this just created is what "Aktivne sesije" lists, and nothing
      // else would refetch it - push_subscriptions is user-scoped, so it has
      // no family_id and never rides the family broadcast channel.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [supported, isMine, refresh]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setPending(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        // Delete the server row before tearing down the browser
        // subscription. RLS on `push_subscriptions` lets users delete
        // only their own rows. We tolerate a delete failure (e.g.
        // offline) - the cron will eventually drop the row when it
        // sees 410 Gone.
        await supabase.from("push_subscriptions").delete().eq("endpoint", existing.endpoint);
        await existing.unsubscribe();
      }
      setSubscription(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [supported, refresh]);

  const sendLocalTest = useCallback(async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Test obaveštenja", {
      body: "Ovo je lokalno obaveštenje - proverava SW i dozvolu.",
      tag: "local-test",
      data: { url: "/" },
    });
  }, [supported]);

  return {
    supported,
    permission,
    isSubscribed,
    subscription,
    checking,
    pending,
    error,
    subscribe,
    unsubscribe,
    sendLocalTest,
  };
}
