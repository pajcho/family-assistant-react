import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { GoogleConnectionSafe } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { readFunctionsError } from "@/utils/functionsError";

/**
 * Manages the current member's Google Calendar connections (Phase A).
 *
 * Reads connection STATUS from the token-free `google_connections_safe` view —
 * the OAuth tokens never reach the client; they live on a service-role-only
 * base table touched solely by the Edge Functions.
 *
 * `connect()` asks `gcal-oauth-start` for a consent URL and full-page redirects
 * the browser to Google; after the `gcal-oauth-callback` stores the tokens we
 * land back on /settings?tab=calendar&gcal=connected. `disconnect()` revokes +
 * deletes the connection via `gcal-disconnect`.
 */

async function fetchConnections(): Promise<GoogleConnectionSafe[]> {
  // The view already filters to auth.uid(); no client-side user filter needed.
  const { data, error } = await supabase
    .from("google_connections_safe")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as GoogleConnectionSafe[]) ?? [];
}

export function useGoogleCalendar() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["google_connections", userId],
    queryFn: fetchConnections,
    enabled: !!userId,
    staleTime: 30_000,
  });

  const connectMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
        "gcal-oauth-start",
        { body: {} },
      );
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
      if (!data?.url) throw new Error("Greška pri povezivanju.");
      // Full-page redirect to Google's consent screen. We return to
      // /settings?tab=calendar&gcal=... once the callback stores the tokens.
      window.location.assign(data.url);
    },
    onError: (e: Error) => toast.error(e.message || "Greška pri povezivanju"),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
        "gcal-disconnect",
        { body: { id } },
      );
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["google_connections", userId] });
      toast.success("Google nalog je isključen.");
    },
    onError: (e: Error) => toast.error(e.message || "Greška pri isključivanju"),
  });

  return {
    connections: query.data ?? [],
    isLoading: query.isLoading,
    connect: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,
    disconnect: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}
