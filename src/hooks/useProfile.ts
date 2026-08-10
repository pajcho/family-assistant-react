import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Family, Profile } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { readKidClaims } from "@/types/kid";

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

  /**
   * Kid mode: a kid's auth user is synthetic and has NO row in `profiles`
   * (that is the whole security model - see `types/kid.ts`). The link to the
   * child's real profile lives in `kid_access` and is mirrored into the JWT
   * claims, so resolve through those. Without this, `familyId` is null for a
   * kid session and EVERY family-scoped hook downstream - all of which gate on
   * `enabled: !!familyId` - stays switched off and the kid shell renders empty.
   *
   * Grown-up sessions are unaffected: `kid_profile_id` is absent, so this is
   * exactly `user.id`.
   */
  const profileId = readKidClaims(user?.app_metadata)?.kid_profile_id ?? userId;

  const query = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => fetchProfileWithFamily(profileId as string),
    enabled: !!profileId,
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      if (!userId) throw new Error("Niste prijavljeni");
      // Deliberately `userId`, not the kid-resolved `profileId` above: only the
      // person who owns the login may rename themselves. A kid session has no
      // `profiles` row of its own, so this matches nothing - and RLS would
      // reject it anyway (kids get SELECT policies only). The kid shell never
      // renders this, so the asymmetry is unreachable, not a silent no-op.
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
      void queryClient.invalidateQueries({ queryKey: ["profile", profileId] });
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
    /** Whether the current user may manage the family roster / logins. */
    isAdmin: profile?.is_admin ?? false,
    isLoading: query.isLoading,
    updateProfile: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Persist the personalized bottom-nav slots (see `navSections.ts`) on the
 * current user's profile. Applied live from the "Uredi traku" editor, so the
 * cache is updated optimistically and there is no success toast - the bar
 * itself is the feedback. Errors roll back and toast.
 */
export function useUpdateNavSlots() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slots: string[]): Promise<void> => {
      if (!userId) throw new Error("Niste prijavljeni");
      const { error } = await supabase
        .from("profiles")
        .update({ nav_slots: slots })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    },
    onMutate: async (slots) => {
      await queryClient.cancelQueries({ queryKey: ["profile", userId] });
      const previous = queryClient.getQueryData<ProfileWithFamily | null>(["profile", userId]);
      queryClient.setQueryData<ProfileWithFamily | null>(["profile", userId], (old) =>
        old ? { ...old, profile: { ...old.profile, nav_slots: slots } } : old,
      );
      return { previous };
    },
    onError: (e, _slots, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["profile", userId], context.previous);
      }
      toast.error(e instanceof Error ? e.message : "Greška pri čuvanju rasporeda");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });
}

/**
 * Rename the current user's family. Admin-only at the DB level (the
 * "Admins can update own family" RLS policy) - the UI only exposes it on the
 * Porodica tab, which is itself admin-gated. Invalidates the profile cache so
 * `familyName` refreshes everywhere it's read.
 */
export function useRenameFamily() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Naziv porodice je obavezan");
      const { error } = await supabase
        .from("families")
        .update({ name: trimmed })
        .eq("id", familyId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Greška pri preimenovanju porodice");
    },
  });
}
