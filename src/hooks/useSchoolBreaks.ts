import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { SchoolBreak, SchoolBreakMember } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Raspusti - the periods in which the timetable must not produce classes.
 *
 * The whole family's breaks load as one set (like the timetable itself), and
 * their member rows as a second: there are a handful of breaks a year, so this
 * is two small queries instead of a per-break fan-out.
 *
 * A break's member list may be EMPTY, which is the default and means "every
 * child with a timetable" - see `breakCoversPerson` in utils/schoolTimetable.
 */

export interface SchoolBreakInput {
  name: string;
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  /** Empty = every child. */
  personIds: ReadonlyArray<string>;
}

async function fetchBreaks(familyId: string): Promise<SchoolBreak[]> {
  const { data, error } = await supabase
    .from("school_breaks")
    .select("*")
    .eq("family_id", familyId)
    .order("start_month", { ascending: true })
    .order("start_day", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as SchoolBreak[]) ?? [];
}

async function fetchBreakMembers(familyId: string): Promise<SchoolBreakMember[]> {
  const { data, error } = await supabase
    .from("school_break_members")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as SchoolBreakMember[]) ?? [];
}

export interface UseSchoolBreaksResult {
  breaks: SchoolBreak[];
  /** break id → the children it applies to. Missing/empty = every child. */
  memberIdsByBreak: Map<string, Set<string>>;
  isLoading: boolean;
}

export function useSchoolBreaks(): UseSchoolBreaksResult {
  const { familyId } = useProfile();

  const breaksQuery = useQuery({
    queryKey: ["school_breaks", familyId],
    queryFn: () => fetchBreaks(familyId as string),
    enabled: !!familyId,
  });
  const membersQuery = useQuery({
    queryKey: ["school_break_members", familyId],
    queryFn: () => fetchBreakMembers(familyId as string),
    enabled: !!familyId,
  });

  const breaks = useMemo(() => breaksQuery.data ?? [], [breaksQuery.data]);

  const memberIdsByBreak = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of membersQuery.data ?? []) {
      const set = map.get(row.break_id);
      if (set) set.add(row.person_id);
      else map.set(row.break_id, new Set([row.person_id]));
    }
    return map;
  }, [membersQuery.data]);

  return {
    breaks,
    memberIdsByBreak,
    isLoading: breaksQuery.isLoading || membersQuery.isLoading,
  };
}

/** Delete-then-insert the member rows for one break; empty clears them. */
async function replaceBreakMembers(
  familyId: string,
  breakId: string,
  personIds: ReadonlyArray<string>,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("school_break_members")
    .delete()
    .eq("break_id", breakId);
  if (deleteError) throw new Error(deleteError.message);

  if (personIds.length === 0) return;

  const { error: insertError } = await supabase.from("school_break_members").insert(
    personIds.map((personId) => ({
      break_id: breakId,
      family_id: familyId,
      person_id: personId,
    })),
  );
  if (insertError) throw new Error(insertError.message);
}

function useInvalidateBreaks() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["school_breaks", familyId] });
    void queryClient.invalidateQueries({ queryKey: ["school_break_members", familyId] });
  };
}

export function useCreateSchoolBreak() {
  const { familyId } = useProfile();
  const invalidate = useInvalidateBreaks();

  return useMutation({
    mutationFn: async (input: SchoolBreakInput): Promise<SchoolBreak> => {
      if (!familyId) throw new Error("Nema porodice");
      const { personIds, ...fields } = input;
      const { data, error } = await supabase
        .from("school_breaks")
        .insert({ ...fields, name: fields.name.trim(), family_id: familyId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const created = data as SchoolBreak;
      await replaceBreakMembers(familyId, created.id, personIds);
      return created;
    },
    onSuccess: invalidate,
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju raspusta");
    },
  });
}

export function useUpdateSchoolBreak() {
  const { familyId } = useProfile();
  const invalidate = useInvalidateBreaks();

  return useMutation({
    mutationFn: async ({ id, ...input }: SchoolBreakInput & { id: string }): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { personIds, ...fields } = input;
      const { error } = await supabase
        .from("school_breaks")
        .update({ ...fields, name: fields.name.trim() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await replaceBreakMembers(familyId, id, personIds);
    },
    onSuccess: invalidate,
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni raspusta");
    },
  });
}

export function useDeleteSchoolBreak() {
  const invalidate = useInvalidateBreaks();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      // The member rows go with it (ON DELETE CASCADE).
      const { error } = await supabase.from("school_breaks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju raspusta");
    },
  });
}
