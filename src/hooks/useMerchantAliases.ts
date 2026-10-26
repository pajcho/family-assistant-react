import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { MerchantAlias } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Friendly names for receipt merchants (table `merchant_aliases`).
 *
 *   - `useMerchantAliases()`   - `aliasFor(merchant)`: the family's own name for
 *                                that merchant, or null when it has none
 *   - `useSetMerchantAlias()`  - set or clear the name for one merchant
 *
 * The list is tiny (one row per renamed shop), so it is fetched whole and
 * looked up client-side; realtime keeps it fresh (see useFamilyChannel).
 */

async function fetchMerchantAliases(familyId: string): Promise<MerchantAlias[]> {
  const { data, error } = await supabase
    .from("merchant_aliases")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as MerchantAlias[]) ?? [];
}

export function useMerchantAliases() {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: ["merchant_aliases", familyId],
    queryFn: () => fetchMerchantAliases(familyId as string),
    enabled: !!familyId,
    staleTime: 5 * 60_000,
  });

  const byMerchant = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of query.data ?? []) m.set(a.merchant, a.display_name);
    return m;
  }, [query.data]);

  const aliasFor = useCallback(
    (merchant: string | null | undefined): string | null =>
      merchant ? (byMerchant.get(merchant) ?? null) : null,
    [byMerchant],
  );

  return { aliasFor };
}

/**
 * Set (`displayName`) or clear (empty, or the receipt name itself) the friendly
 * name of one merchant. Applies to every expense from it at once.
 */
export function useSetMerchantAlias() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      merchant,
      displayName,
    }: {
      merchant: string;
      displayName: string;
    }): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const name = displayName.trim();
      const { error } =
        name === "" || name === merchant
          ? await supabase
              .from("merchant_aliases")
              .delete()
              .eq("family_id", familyId)
              .eq("merchant", merchant)
          : await supabase
              .from("merchant_aliases")
              .upsert(
                { family_id: familyId, merchant, display_name: name },
                { onConflict: "family_id,merchant" },
              );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["merchant_aliases", familyId] });
      // Search matches on the friendly name too.
      void queryClient.invalidateQueries({ queryKey: ["expense-search", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri čuvanju naziva");
    },
  });
}
