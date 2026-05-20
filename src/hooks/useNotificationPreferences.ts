import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationPreferences } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Reads + writes the user's notification preferences row (digest
 * opt-ins, times, timezone). A missing row is treated as "all opted
 * out" rather than an error — the row is lazily upserted on first
 * save. RLS scopes everything to `auth.uid()`.
 *
 * Default timezone comes from `Intl` so it reflects the device's
 * actual setting, not a hard-coded fallback.
 */

export interface NotificationPreferencesInput {
  morning_enabled: boolean;
  /** HH:mm in 24-hour. */
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  /** IANA timezone, e.g. "Europe/Belgrade". */
  timezone: string;
  /** Push when another family member adds a new list / event / payment / birthday. */
  notify_on_list_create: boolean;
  notify_on_event_create: boolean;
  notify_on_payment_create: boolean;
  notify_on_birthday_create: boolean;
}

const FALLBACK_TIMEZONE = "Europe/Belgrade";

function detectTimezone(): string {
  if (typeof Intl === "undefined") return FALLBACK_TIMEZONE;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function defaultPrefs(): NotificationPreferencesInput {
  return {
    morning_enabled: false,
    morning_time: "08:00",
    evening_enabled: false,
    evening_time: "20:00",
    timezone: detectTimezone(),
    // Match the column defaults — opted in for all four. A user who's
    // enabled push notifications at all probably wants to know when
    // their partner adds something. Easy to turn off in settings.
    notify_on_list_create: true,
    notify_on_event_create: true,
    notify_on_payment_create: true,
    notify_on_birthday_create: true,
  };
}

/** Postgres TIME returns "HH:mm:ss"; <input type="time"> wants "HH:mm". */
function trimSeconds(t: string): string {
  return t.length === 8 ? t.slice(0, 5) : t;
}

async function fetchPreferences(userId: string): Promise<NotificationPreferences | null> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data as NotificationPreferences | null) ?? null;
}

export function useNotificationPreferences() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notification_preferences", userId],
    queryFn: () => fetchPreferences(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (input: NotificationPreferencesInput) => {
      if (!userId) throw new Error("Niste prijavljeni");
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: userId, ...input }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification_preferences", userId] });
      toast.success("Sačuvano");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Greška pri čuvanju");
    },
  });

  // Memoise so consumers can safely use `prefs` as a useEffect dependency.
  // Without this, every parent render produces a new object reference
  // and any effect keyed on `prefs` re-runs on every render — which in
  // the settings page would keep stomping on the local form state.
  const fetched = query.data;
  const prefs = useMemo<NotificationPreferencesInput>(
    () =>
      fetched
        ? {
            morning_enabled: fetched.morning_enabled,
            morning_time: trimSeconds(fetched.morning_time),
            evening_enabled: fetched.evening_enabled,
            evening_time: trimSeconds(fetched.evening_time),
            timezone: fetched.timezone,
            notify_on_list_create: fetched.notify_on_list_create,
            notify_on_event_create: fetched.notify_on_event_create,
            notify_on_payment_create: fetched.notify_on_payment_create,
            notify_on_birthday_create: fetched.notify_on_birthday_create,
          }
        : defaultPrefs(),
    [fetched],
  );

  return {
    prefs,
    isLoading: query.isLoading,
    save: mutation.mutate,
    saving: mutation.isPending,
  };
}
