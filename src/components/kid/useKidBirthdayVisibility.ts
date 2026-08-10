import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/**
 * Which birthdays a child may see, and the note their parent wrote with each.
 *
 * Both halves come out of the same `birthday_visibility` rows, and the kid
 * shell needs BOTH:
 *
 *   - `visibleIds` is the gate. `birthdays` has no participants of its own, so
 *     nothing downstream can derive who a birthday belongs to - without this
 *     set, every screen showing birthdays falls back to whatever the session is
 *     allowed to read. Under a kid session RLS narrows that to the ticked rows;
 *     under a PARENT session (the preview) it is the whole family. Filtering in
 *     code here makes the two identical, and gives a real child defence in
 *     depth over the policy rather than sole reliance on it.
 *   - `notes` is the per-child message ("pozovi baku i čestitaj joj").
 *
 * They are deliberately separate: a row with a NULL or blank note still grants
 * visibility, so the note map can never stand in for the visible set.
 *
 * Deliberately a small hook of its own rather than a branch inside the shared
 * birthday hooks: the grown-up app reads this table by birthday, the child
 * reads it by person, and the two want different cache keys.
 */

export interface KidBirthdayVisibility {
  /** Every birthday id this child may see - with or without a note. */
  visibleIds: Set<string>;
  /** birthday_id → the parent's note for THIS child. Non-empty notes only. */
  notes: Map<string, string>;
  isLoading: boolean;
}

interface VisibilityRow {
  birthday_id: string;
  note: string | null;
}

export function useKidBirthdayVisibility(kidProfileId: string | null): KidBirthdayVisibility {
  const query = useQuery({
    queryKey: ["kid-birthday-visibility", kidProfileId],
    queryFn: async (): Promise<VisibilityRow[]> => {
      const { data, error } = await supabase
        .from("birthday_visibility")
        .select("birthday_id, note")
        .eq("person_id", kidProfileId as string);
      // A missing table (migration not applied yet) or an RLS refusal still
      // fails CLOSED: throwing leaves `query.data` undefined, the memo below
      // reads `?? []`, and an empty set means "no birthday is visible" - the
      // safe answer for a gate. The screens still show their empty state; the
      // throw only adds the retry and the one global toast.
      if (error) throw new Error(error.message);
      return (data as VisibilityRow[]) ?? [];
    },
    enabled: !!kidProfileId,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const visibleIds = new Set<string>();
    const notes = new Map<string, string>();
    for (const row of query.data ?? []) {
      visibleIds.add(row.birthday_id);
      const note = row.note?.trim();
      if (note) notes.set(row.birthday_id, note);
    }
    // No child selected yet (the query is idle): nothing is visible, rather
    // than "everything", for the same fail-closed reason.
    return { visibleIds, notes, isLoading: !kidProfileId || query.isLoading };
  }, [kidProfileId, query.data, query.isLoading]);
}
