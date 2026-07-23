import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { currencyOptions, normalizeEnabledCurrencies } from "@/utils/currency";

/**
 * The family's enabled-currencies setting (Valute section on Settings).
 * Reads from the family row `useProfile` already caches - no extra query.
 * Updating is admin-only at the DB level (the "Admins can update own family"
 * RLS policy), mirrored in the UI by disabling the toggles for non-admins.
 */
export function useEnabledCurrencies() {
  const { family, familyId, isAdmin } = useProfile();
  const queryClient = useQueryClient();

  const enabled = normalizeEnabledCurrencies(family?.enabled_currencies);

  const update = useMutation({
    mutationFn: async (next: string[]): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { error } = await supabase
        .from("families")
        .update({ enabled_currencies: normalizeEnabledCurrencies(next) })
        .eq("id", familyId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // The family row lives inside the profile query - refresh it everywhere.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri čuvanju valuta");
    },
  });

  return { enabled, isAdmin, update };
}

/**
 * Options for a currency toggle in an entry form: enabled currencies PLUS the
 * edited entity's current one, so rows in a since-disabled currency still edit
 * cleanly (see `currencyOptions` for the disable semantics).
 */
export function useCurrencyOptions(current?: string | null): string[] {
  const { enabled } = useEnabledCurrencies();
  return currencyOptions(enabled, current);
}
