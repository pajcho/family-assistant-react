import { useQuery } from "@tanstack/react-query";
import type { Family, Profile } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Fetches the current user's profile + their family in a single query.
 *
 * Direct port of `composables/useProfile.ts` from the Nuxt app, swapped to
 * TanStack Query so it's cached by `user.id` and survives re-renders.
 *
 * Returns the same surface as the Vue version:
 *   `{ profile, family, familyId, familyName, isLoading }`.
 */

export interface ProfileWithFamily {
  profile: Profile;
  family: Family | null;
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

  const query = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => fetchProfileWithFamily(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  const profile = query.data?.profile ?? null;
  const family = query.data?.family ?? null;

  return {
    profile,
    family,
    familyId: profile?.family_id ?? null,
    familyName: family?.name ?? null,
    isLoading: query.isLoading,
  };
}
