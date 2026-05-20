import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Family, Profile } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Fetches the current user's profile + their family in a single query,
 * and exposes a mutation for updating editable profile fields
 * (`first_name`, `last_name`).
 *
 * Direct port of `composables/useProfile.ts` from the Nuxt app, swapped
 * to TanStack Query so it's cached by `user.id` and survives re-renders.
 */

export interface ProfileWithFamily {
  profile: Profile;
  family: Family | null;
}

export interface ProfileUpdateInput {
  first_name: string | null;
  last_name: string | null;
}

async function fetchProfileWithFamily(userId: string): Promise<ProfileWithFamily | null> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (profileError || !profile) return null;
  const typedProfile = profile as Profile;

  if (!typedProfile.family_id) {
    return { profile: typedProfile, family: null };
  }

  const { data: family, error: familyError } = await supabase
    .from("families")
    .select("*")
    .eq("id", typedProfile.family_id)
    .single();

  return {
    profile: typedProfile,
    family: familyError ? null : (family as Family),
  };
}

export function useProfile() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => fetchProfileWithFamily(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      if (!userId) throw new Error("Niste prijavljeni");
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: input.first_name?.trim() || null,
          last_name: input.last_name?.trim() || null,
        })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      toast.success("Sačuvano");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Greška pri čuvanju");
    },
  });

  const profile = query.data?.profile ?? null;
  const family = query.data?.family ?? null;

  return {
    profile,
    family,
    familyId: profile?.family_id ?? null,
    familyName: family?.name ?? null,
    isLoading: query.isLoading,
    updateProfile: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
