import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { GoogleSyncPreferences } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { readFunctionsError } from "@/utils/functionsError";

/**
 * Per-member "what to import from Google" preferences. Read directly via RLS
 * (own row); written through `gcal-calendars { action: "set_sync_prefs" }`, which
 * also resets the sync cursor and kicks an immediate re-sync so the change takes
 * effect right away. Saved optimistically.
 *
 * Defaults (and a member with no row): Gmail travel ON, contact birthdays + work
 * markers OFF - mirror `DEFAULT_PREFS` in _shared/calendarSync.ts.
 */
export const DEFAULT_SYNC_PREFS: GoogleSyncPreferences = {
  import_from_gmail: true,
  import_birthdays: false,
  import_work_markers: false,
};

async function fetchSyncPrefs(): Promise<GoogleSyncPreferences> {
  const { data, error } = await supabase
    .from("google_sync_preferences")
    .select("import_from_gmail, import_birthdays, import_work_markers")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as GoogleSyncPreferences | null) ?? DEFAULT_SYNC_PREFS;
}

export function useGoogleSyncPrefs(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ["google_sync_preferences", userId];

  const query = useQuery({
    queryKey,
    queryFn: fetchSyncPrefs,
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
  });

  const setPrefsMutation = useMutation({
    mutationFn: async (prefs: GoogleSyncPreferences): Promise<void> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
        "gcal-calendars",
        { body: { action: "set_sync_prefs", prefs } },
      );
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
    },
    onMutate: async (prefs) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<GoogleSyncPreferences>(queryKey);
      queryClient.setQueryData<GoogleSyncPreferences>(queryKey, prefs);
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(e.message || "Greška pri čuvanju");
    },
    onSuccess: () => {
      // The background re-sync adds/removes mirrored events; nudge the agenda
      // (realtime also catches up as the re-sync lands).
      void queryClient.invalidateQueries({ queryKey: ["external_calendar_events"] });
    },
  });

  return {
    prefs: query.data ?? DEFAULT_SYNC_PREFS,
    isLoading: query.isLoading,
    setPrefs: setPrefsMutation.mutate,
    isSaving: setPrefsMutation.isPending,
  };
}
