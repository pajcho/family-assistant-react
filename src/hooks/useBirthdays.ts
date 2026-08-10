import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Birthday } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Birthdays data hooks - direct port of `composables/useBirthdays.ts` from
 * the sibling Nuxt app, backed by TanStack Query. Live updates arrive on the
 * shared family broadcast channel (see `useFamilyChannel`), not from here.
 *
 * Surface:
 *   - `useBirthdaysList()`     - list query
 *   - `useCreateBirthday()`    - insert mutation
 *   - `useUpdateBirthday()`    - update mutation
 *   - `useDeleteBirthday()`    - delete mutation
 *
 * `familyId` comes from `useProfile()`; never accept it from callers so the
 * Supabase RLS guard always matches the authenticated user.
 *
 * The query sorts by `birth_date ASC` to match the Vue composable. The
 * "days-until-birthday" sort used on the birthdays page lives in the UI
 * (Phase 3C), not here.
 */

export type CreateBirthdayInput = {
  name: string;
  description?: string | null;
  birth_date: string;
};

export type UpdateBirthdayInput = Partial<Pick<Birthday, "name" | "description" | "birth_date">>;

async function fetchBirthdays(familyId: string): Promise<Birthday[]> {
  const { data, error } = await supabase
    .from("birthdays")
    .select("*")
    .eq("family_id", familyId)
    .order("birth_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Birthday[]) ?? [];
}

export function useBirthdaysList() {
  const { familyId } = useProfile();

  return useQuery({
    queryKey: ["birthdays", familyId],
    queryFn: () => fetchBirthdays(familyId as string),
    enabled: !!familyId,
  });
}

/**
 * Alias for the secondary surfaces (payment link picker, birthday pickers).
 *
 * This used to be a separate, deliberately subscription-free copy: the
 * birthdays channel topic had no `useId()` suffix, so a second mount while the
 * birthdays page was open collided on the same topic. RP-2 moved realtime to
 * one family-wide channel, so there is nothing left to collide with and the two
 * are now the same query.
 */
export const useBirthdaysData = useBirthdaysList;

export function useCreateBirthday() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateBirthdayInput): Promise<Birthday> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("birthdays")
        .insert({ family_id: familyId, ...payload })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Birthday;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["birthdays", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju rođendana");
    },
  });
}

export function useUpdateBirthday() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateBirthdayInput }): Promise<Birthday> => {
      const { data, error } = await supabase
        .from("birthdays")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Birthday;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["birthdays", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni rođendana");
    },
  });
}

export function useDeleteBirthday() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("birthdays").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["birthdays", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju rođendana");
    },
  });
}
