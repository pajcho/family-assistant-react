import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PushSubscriptionRow } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Lists every push subscription belonging to the current user - i.e.
 * every device on which they've enabled notifications - and lets them
 * revoke a row by id.
 *
 * Revoking a row removes it from `push_subscriptions`. That stops the
 * cron job from sending pushes to that endpoint, but it does NOT tear
 * down the SW subscription on the remote device - we can't reach across
 * devices. That device's `useNotifications` reports "not subscribed" the
 * next time the app opens there (this list is half of how it decides), so
 * the user just switches notifications back on to re-create the row.
 *
 * For the row representing THE CURRENT device (matched by endpoint),
 * the caller should route the revoke through `useNotifications.unsubscribe`
 * instead so the local SW subscription is torn down too.
 */

async function fetchSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("last_used_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PushSubscriptionRow[]) ?? [];
}

/**
 * Just the list, without the revoke mutation.
 *
 * `useNotifications` needs these rows to tell "this browser has a push
 * subscription" (a device-level fact) from "…and it belongs to the account
 * that is signed in right now" (a server-side fact). Splitting the query out
 * keeps that read free of the mutation + toast machinery below, and both hooks
 * share one cache entry.
 */
export function usePushSubscriptionRows() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["push_subscriptions", userId],
    queryFn: () => fetchSubscriptions(userId as string),
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Stable identity so callers can list it in a useCallback dependency array
  // without rebuilding their handlers on every render.
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["push_subscriptions", userId] }),
    [queryClient, userId],
  );

  return {
    subscriptions: query.data ?? [],
    isLoading: query.isLoading,
    refresh,
  };
}

export function usePushSubscriptions() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const rows = usePushSubscriptionRows();

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["push_subscriptions", userId] });
      toast.success("Sesija isključena");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Greška pri isključivanju sesije");
    },
  });

  return {
    ...rows,
    remove: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
  };
}

/**
 * Bumps `last_used_at` on the row matching `endpoint` so the session
 * list reflects "this device was active just now" whenever the app is
 * opened with an existing push subscription. Fires at most once per
 * mount per endpoint - RLS scopes the UPDATE to the user's own rows.
 *
 * Lives in this file (rather than inside `useNotifications`) so the
 * write only happens on screens that care about the session list - no
 * point heating the row on every screen mount.
 */
export function useTouchCurrentSubscription(endpoint: string | null | undefined): void {
  useEffect(() => {
    if (!endpoint) return;
    void supabase
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("endpoint", endpoint);
  }, [endpoint]);
}
