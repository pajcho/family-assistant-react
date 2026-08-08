import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { findKidDevice, readKidAuthError, removeKidDevice } from "@/hooks/useKidLogin";
import { useKidSession } from "@/hooks/useKidSession";
import type { KidAccessRevokedReason } from "@/types/kid";

/**
 * Is this child still allowed in? Asked in the background, so that a child
 * whose access was taken away is TOLD instead of left staring at an app that
 * quietly goes stale.
 *
 * WHY A CLIENT CHECK EXISTS AT ALL. When a parent removes a device or turns
 * access off, `kid-access` ends the child's sessions server-side: no refresh
 * token survives, so the app can never renew itself. But a GoTrue access token
 * is stateless - nothing can reach out and invalidate the one already in the
 * child's browser - and it lives for an hour. Without this probe a revoked
 * child keeps browsing (with `revoke-device`, where RLS is untouched, they even
 * keep seeing real data) until supabase-js next tries to refresh and fails,
 * which can be the better part of an hour later. This closes that window to
 * "the next time they look at the app".
 *
 * WHEN IT RUNS: once on mount, then on window focus and on `visibilitychange`
 * back to visible, throttled to one call a minute so a child flipping between
 * apps does not hammer the endpoint.
 *
 * WHAT IT WILL NOT DO. It signs a child out ONLY on a definitive verdict from
 * the server - `device_unknown` or `access_disabled`. Anything else (offline,
 * timeout, 500, a body it cannot parse) is treated as "no answer" and changes
 * nothing: a child on a flaky connection being thrown out of their own app
 * would be a far worse bug than an extra few minutes of access. It also stays
 * silent in the parent-side preview and before there is a session at all.
 */

/** At most one probe a minute, however often the app is brought forward. */
const CHECK_THROTTLE_MS = 60_000;

export interface KidAccessCheck {
  /** Non-null once the server has said this child is out, and why. */
  revoked: KidAccessRevokedReason | null;
  /** Clears the verdict - the explanation screen's way onward to the login. */
  dismiss: () => void;
}

export function useKidAccessCheck(): KidAccessCheck {
  const { isKid, isPreview, kidProfileId } = useKidSession();
  const { session, signOut } = useAuth();
  const [revoked, setRevoked] = useState<KidAccessRevokedReason | null>(null);

  // Refs, not state: neither value may re-run the effect that installs the
  // listeners, or every probe would tear them down and put them back.
  const lastRunRef = useRef(0);
  const inFlightRef = useRef(false);

  const active = isKid && !isPreview && !!session;

  const runCheck = useCallback(async () => {
    if (!active || !kidProfileId) return;

    // The device token IS the credential this endpoint answers to. A signed-in
    // child with nothing in localStorage (cleared storage, private window) has
    // nothing to ask with - fail open rather than invent a verdict.
    const entry = findKidDevice(kidProfileId);
    if (!entry) return;

    if (inFlightRef.current) return;
    const now = Date.now();
    if (now - lastRunRef.current < CHECK_THROTTLE_MS) return;
    // Stamped BEFORE the await, so a React StrictMode double-mount and two
    // focus events in the same tick collapse into one request.
    lastRunRef.current = now;
    inFlightRef.current = true;

    try {
      const { error } = await supabase.functions.invoke("kid-auth", {
        body: { action: "check", deviceToken: entry.deviceToken },
      });
      if (!error) return;

      const body = await readKidAuthError(error);
      const reason: KidAccessRevokedReason | null =
        body?.code === "device_unknown" || body?.code === "access_disabled" ? body.code : null;
      // Everything else - a network failure, a 500, a body with no code - is
      // NOT an answer. Leave the child exactly where they are.
      if (!reason) return;

      // A device that the server no longer knows is gone for good: keeping its
      // token would leave a dead button on the "Ko si ti?" picker that can only
      // ever fail. Disabled access is the opposite case - the same device works
      // again the moment a parent switches it back on - so that entry stays.
      if (reason === "device_unknown") removeKidDevice(entry.profileId);

      setRevoked(reason);
      await signOut();
    } catch {
      // `invoke` throwing outright is the offline case. Fail open, same rule.
    } finally {
      inFlightRef.current = false;
    }
  }, [active, kidProfileId, signOut]);

  useEffect(() => {
    if (!active) return;

    void runCheck();

    const onFocus = () => void runCheck();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void runCheck();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, runCheck]);

  const dismiss = useCallback(() => setRevoked(null), []);

  return { revoked, dismiss };
}
