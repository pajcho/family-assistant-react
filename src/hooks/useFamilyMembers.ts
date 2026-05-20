import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

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
 * `byId` map for O(1) lookup at render time. Cached for 5 min — family
 * membership doesn't change often, and a stale name resolves to the same
 * string anyway.
 *
 * RLS: the `profiles` table has two stacked SELECT policies — "own profile"
 * (id = auth.uid()) and "family profiles" (family_id = caller's family_id).
 * The second one is what makes this query return more than one row.
 */

async function fetchFamilyMembers(familyId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
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

  const members = query.data ?? [];

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
