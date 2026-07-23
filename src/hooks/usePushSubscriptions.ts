import { useEffect } from "react";
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
 * down the SW subscription on the remote device - that device's
 * `useNotifications` will still report `isSubscribed = true` until the
 * user re-opens the app there (at which point the server row is missing
 * and re-subscribing will re-create it). That's intentional: we can't
 * reach across devices, and the worst case is "device thinks it's
 * subscribed but gets no pushes" which the user can fix by toggling
 * notifications on that device.
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

export function usePushSubscriptions() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["push_subscriptions", userId],
    queryFn: () => fetchSubscriptions(userId as string),
    enabled: !!userId,
    staleTime: 30_000,
  });

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
    subscriptions: query.data ?? [],
    isLoading: query.isLoading,
    remove: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["push_subscriptions", userId] }),
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
