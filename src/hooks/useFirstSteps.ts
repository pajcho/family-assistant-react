import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useActivities } from "@/hooks/useActivities";
import { useAuth } from "@/hooks/useAuth";
import { useEventsList } from "@/hooks/useEvents";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { usePaymentsList } from "@/hooks/usePayments";
import { useProfile } from "@/hooks/useProfile";

/**
 * The "Prvi koraci" onboarding checklist on Danas.
 *
 * Every step's status is DERIVED from data the app already caches - there is
 * no per-step storage, so work done anywhere (another device, another family
 * member) checks steps off automatically. The only persisted bit is the
 * per-user dismissal (`profiles.onboarding_hidden_at`, "Sakrij").
 *
 * The card retires on its own once every step is done; until then it renders
 * only after all four source queries have settled (no flicker of a half-done
 * list during initial load).
 */

export type FirstStepId = "account" | "profile" | "members" | "calendar" | "payment";

export type FirstStep = {
  id: FirstStepId;
  label: string;
  done: boolean;
};

export type UseFirstStepsResult = {
  /** Render the card? False while loading, after "Sakrij" and when all done. */
  visible: boolean;
  /**
   * Dismissed via "Sakrij" while steps remain - the header shows the small
   * 👋 re-open affordance so the checklist is never permanently lost.
   */
  dismissed: boolean;
  steps: FirstStep[];
  doneCount: number;
  hide: () => void;
  unhide: () => void;
  hiding: boolean;
};

export function useFirstSteps(): UseFirstStepsResult {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { members, isLoading: membersLoading } = useFamilyMembers();
  const eventsQuery = useEventsList();
  const activitiesQuery = useActivities();
  const paymentsQuery = usePaymentsList({ hidePaid: false });
  const queryClient = useQueryClient();

  const hideMutation = useMutation({
    mutationFn: async (hidden: boolean) => {
      if (!user) throw new Error("Niste prijavljeni");
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_hidden_at: hidden ? new Date().toISOString() : null })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: () => {
      toast.error("Greška pri čuvanju - probaj ponovo.");
    },
  });

  const loading =
    !profile ||
    membersLoading ||
    eventsQuery.isLoading ||
    activitiesQuery.isLoading ||
    paymentsQuery.isLoading;

  const steps: FirstStep[] = [
    // A "free" checked step - the account exists by definition. Starting the
    // list at 1+/5 shows how the checklist works and gives momentum.
    { id: "account", label: "Napravi nalog", done: true },
    { id: "profile", label: "Dopuni svoj profil", done: !!profile?.first_name?.trim() },
    { id: "members", label: "Dodaj članove porodice", done: members.length > 1 },
    {
      id: "calendar",
      label: "Zakaži prvi događaj ili aktivnost",
      done: (eventsQuery.data?.length ?? 0) > 0 || (activitiesQuery.data?.length ?? 0) > 0,
    },
    {
      id: "payment",
      label: "Unesi prvo plaćanje",
      done: (paymentsQuery.data?.length ?? 0) > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const allDone = doneCount === steps.length;
  const visible = !loading && !profile.onboarding_hidden_at && !allDone;
  const dismissed = !loading && !!profile.onboarding_hidden_at && !allDone;

  return {
    visible,
    dismissed,
    steps,
    doneCount,
    hide: () => hideMutation.mutate(true),
    unhide: () => hideMutation.mutate(false),
    hiding: hideMutation.isPending,
  };
}
