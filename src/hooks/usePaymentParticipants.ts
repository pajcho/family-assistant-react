import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentParticipant } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Junction-table rows linking payments to the family members they're for.
 * Mirrors `useEventParticipants`: a payment may have ZERO participants, and
 * the write isn't its own mutation hook - `useCreatePayment` /
 * `useUpdatePayment` call `replacePaymentParticipants` so one submit persists
 * the payment and its assignees together.
 */
async function fetchPaymentParticipants(familyId: string): Promise<PaymentParticipant[]> {
  const { data, error } = await supabase
    .from("payment_participants")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as PaymentParticipant[]) ?? [];
}

export interface UsePaymentParticipantsResult {
  participants: PaymentParticipant[];
  /** payment_id → person_ids, in insertion order. Stable across renders. */
  byPayment: Map<string, string[]>;
  isLoading: boolean;
}

export function usePaymentParticipants(): UsePaymentParticipantsResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["payment_participants", familyId],
    queryFn: () => fetchPaymentParticipants(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`payment-participants-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_participants",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["payment_participants", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const participants = useMemo(() => query.data ?? [], [query.data]);

  const byPayment = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of participants) {
      const list = map.get(row.payment_id);
      if (list) list.push(row.person_id);
      else map.set(row.payment_id, [row.person_id]);
    }
    return map;
  }, [participants]);

  return { participants, byPayment, isLoading: query.isLoading };
}

/**
 * Replace the full set of assignees for one payment: delete existing rows,
 * then insert the new ones in a single round-trip. Empty `personIds` clears
 * the assignment. Not a hook - called from the payment mutations.
 */
export async function replacePaymentParticipants(
  familyId: string,
  paymentId: string,
  personIds: ReadonlyArray<string>,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("payment_participants")
    .delete()
    .eq("payment_id", paymentId);
  if (deleteError) throw new Error(deleteError.message);

  if (personIds.length === 0) return;

  const rows = personIds.map((personId) => ({
    payment_id: paymentId,
    family_id: familyId,
    person_id: personId,
  }));
  const { error: insertError } = await supabase.from("payment_participants").insert(rows);
  if (insertError) throw new Error(insertError.message);
}
