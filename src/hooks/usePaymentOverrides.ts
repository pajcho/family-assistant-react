import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PaymentOverride, PaymentOverrideAction } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { effectivePaymentDueDate, isPaymentOccurrenceCanceled, overrideKey } from "@/utils/payment";

/**
 * Per-occurrence payment overrides (cancel / reschedule of a single recurring
 * instance). The synthesizer (`computeCombinedList`) consults these to skip a
 * canceled occurrence or move a rescheduled one - the live payment row and the
 * mark-paid accounting are untouched. Keyed by `(payment_id, occurrence_date)`.
 *
 * The pure key / effective-date helpers now live in `@/utils/payment` (so the
 * agenda layer and its unit tests can use them without dragging in the Supabase
 * client); re-exported here for the existing call sites that import them from
 * this hook.
 */
export { effectivePaymentDueDate, isPaymentOccurrenceCanceled, overrideKey };

async function fetchPaymentOverrides(familyId: string): Promise<PaymentOverride[]> {
  const { data, error } = await supabase
    .from("payment_overrides")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as PaymentOverride[]) ?? [];
}

export interface UsePaymentOverridesResult {
  overrides: PaymentOverride[];
  /** `${payment_id}|${occurrence_date}` → override. Stable across renders. */
  byKey: Map<string, PaymentOverride>;
  isLoading: boolean;
}

export function usePaymentOverrides(): UsePaymentOverridesResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["payment_overrides", familyId],
    queryFn: () => fetchPaymentOverrides(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`payment-overrides-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_overrides",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["payment_overrides", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const overrides = useMemo(() => query.data ?? [], [query.data]);

  const byKey = useMemo(() => {
    const map = new Map<string, PaymentOverride>();
    for (const o of overrides) map.set(overrideKey(o.payment_id, o.occurrence_date), o);
    return map;
  }, [overrides]);

  return { overrides, byKey, isLoading: query.isLoading };
}

export type UpsertPaymentOverrideInput = {
  paymentId: string;
  occurrenceDate: string;
  action: PaymentOverrideAction;
  /** Required for `reschedule`; ignored for `cancel`. */
  overrideDate?: string | null;
  reason?: string | null;
};

/**
 * Create or replace the override for one occurrence (keyed by
 * payment_id + occurrence_date). Switching cancel↔reschedule reuses the row.
 */
export function useUpsertPaymentOverride() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertPaymentOverrideInput): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { error } = await supabase.from("payment_overrides").upsert(
        {
          payment_id: input.paymentId,
          family_id: familyId,
          occurrence_date: input.occurrenceDate,
          action: input.action,
          override_date: input.action === "reschedule" ? (input.overrideDate ?? null) : null,
          reason: input.reason ?? null,
        },
        { onConflict: "payment_id,occurrence_date" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment_overrides", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni rate");
    },
  });
}

/** Restore an occurrence to normal by removing its override. */
export function useDeletePaymentOverride() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { paymentId: string; occurrenceDate: string }): Promise<void> => {
      const { error } = await supabase
        .from("payment_overrides")
        .delete()
        .eq("payment_id", args.paymentId)
        .eq("occurrence_date", args.occurrenceDate);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment_overrides", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri vraćanju rate");
    },
  });
}
