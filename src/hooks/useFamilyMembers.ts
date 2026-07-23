import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Profile } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Fetches every profile in the caller's family.
 *
 * Used to render names alongside `owner_id` / `created_by_id` /
 * `updated_by_id` audit fields throughout the lists UI.
 *
 * Returns both the raw list (for cases where you want to iterate) and a
 * `byId` map for O(1) lookup at render time. Cached for 5 min - family
 * membership doesn't change often, and a stale name resolves to the same
 * string anyway.
 *
 * RLS: the `profiles` table has two stacked SELECT policies - "own profile"
 * (id = auth.uid()) and "family profiles" (family_id = caller's family_id).
 * The second one is what makes this query return more than one row.
 */

async function fetchFamilyMembers(familyId: string): Promise<Profile[]> {
  // Read through the `profiles_with_login` view so each row carries the
  // derived `has_login` boolean. Underlying RLS on `profiles` still
  // applies (the view uses `security_invoker = true`), so this returns
  // exactly the same rows as a direct `profiles` query would.
  const { data, error } = await supabase
    .from("profiles_with_login")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as Profile[]) ?? [];
}

export interface UseFamilyMembersResult {
  members: Profile[];
  byId: Map<string, Profile>;
  isLoading: boolean;
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const { familyId } = useProfile();

  const query = useQuery({
    queryKey: ["family-members", familyId],
    queryFn: () => fetchFamilyMembers(familyId as string),
    enabled: !!familyId,
    staleTime: 5 * 60_000,
  });

  const members = useMemo(() => query.data ?? [], [query.data]);

  // Derived map memoized on the data identity. TanStack Query returns the
  // same array reference across rerenders when the data hasn't changed, so
  // this Map is rebuilt only when the underlying list actually shifts.
  const byId = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of members) m.set(p.id, p);
    return m;
  }, [members]);

  return { members, byId, isLoading: query.isLoading };
}

/**
 * Insert a new household-member profile that has no Supabase auth user
 * behind it - used for children and other family members who never log in.
 * Requires the FK from `profiles.id` to `auth.users.id` to be dropped
 * (household_members migration) and the family-scoped INSERT policy.
 */
export type CreateFamilyMemberInput = {
  first_name: string | null;
  last_name: string | null;
  color?: string | null;
};

export function useCreateFamilyMember() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateFamilyMemberInput): Promise<Profile> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          family_id: familyId,
          first_name: payload.first_name,
          last_name: payload.last_name,
          color: payload.color ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Profile;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju člana");
    },
  });
}

/**
 * Delete a household-member profile. RLS blocks deleting your own row
 * (would orphan the auth session) - caller is expected to hide the delete
 * button for the current user.
 */
export function useDeleteFamilyMember() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profileId: string): Promise<void> => {
      const { error } = await supabase.from("profiles").delete().eq("id", profileId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
      // Activities are FK-cascade-deleted in the DB; invalidate the cached
      // query so the grid removes them without waiting for realtime.
      void queryClient.invalidateQueries({ queryKey: ["activities", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["activity_schedule", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["school_shift_anchors", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju člana");
    },
  });
}

/**
 * Update the `color` on any profile in the caller's family. Requires the
 * "Users can update own family profiles" RLS policy added in the activities
 * migration - without it the row-level guard rejects updates to other
 * members' profiles (a parent setting up colors for child profiles).
 */
export function useUpdateProfileColor() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { profileId: string; color: string | null }): Promise<void> => {
      const { error } = await supabase
        .from("profiles")
        .update({ color: args.color })
        .eq("id", args.profileId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
      // The caller's own profile is also cached under "profile" - invalidate
      // so the avatar / name display picks up the new color.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri postavljanju boje");
    },
  });
}

/**
 * Update a member's first / last name. Admin-only for *other* members (the
 * "Admins can update family profiles" RLS policy); a member editing their own
 * row goes through `useProfile().updateProfile` instead. `full_name` is
 * recomputed by a DB trigger, so we only write the two name parts.
 */
export function useUpdateMemberName() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      profileId: string;
      first_name: string | null;
      last_name: string | null;
    }): Promise<void> => {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: args.first_name?.trim() || null,
          last_name: args.last_name?.trim() || null,
        })
        .eq("id", args.profileId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri čuvanju imena");
    },
  });
}

/**
 * Grant or revoke the family-admin role on a member with a login. Admin-only
 * (RLS). The caller is responsible for never revoking the last admin - the UI
 * disables the toggle in that case so a family can't lock itself out.
 */
export function useSetMemberAdmin() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { profileId: string; is_admin: boolean }): Promise<void> => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_admin: args.is_admin })
        .eq("id", args.profileId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri promeni admin uloge");
    },
  });
}
