import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { BirthdayVisibility, Profile } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useKidAccessList } from "@/hooks/useKidAccess";
import { useProfile } from "@/hooks/useProfile";

/**
 * Which child may see which birthday, and what note they see with it.
 *
 * Birthdays are the one entity in the app with no participants of their own -
 * just a name, a date and a description - so there is nothing to derive
 * visibility from. Without an explicit row here a birthday is invisible to
 * every kid session (RLS on `birthdays` only lets a kid through an
 * `EXISTS (birthday_visibility ...)`), which is the whole point: a parent's
 * colleagues and a sibling's classmates must never show up in a child's app.
 * Visibility is opt-in, per child, one birthday at a time.
 *
 * `note` is per child as well, because the same birthday means something
 * different to each of them ("pozovi baku i čestitaj joj" vs "nacrtaj
 * čestitku"). It is rendered straight to the child, so it is written TO the
 * child.
 *
 * Surface:
 *   - `useBirthdayVisibility()`         - the family's rows + a per-birthday map
 *   - `useBirthdayVisibilityChildren()` - who the picker may offer (kid mode on)
 *   - `useSaveBirthdayVisibility()`     - diffing write for one birthday
 */

export interface BirthdayVisibilityEntry {
  personId: string;
  /** What that child reads under the birthday. `null` = no note. */
  note: string | null;
}

/** Stored form of a note: trimmed, and empty collapses to NULL. */
export function normalizeVisibilityNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? "").trim();
  return trimmed || null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function fetchBirthdayVisibility(familyId: string): Promise<BirthdayVisibility[]> {
  const { data, error } = await supabase
    .from("birthday_visibility")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as BirthdayVisibility[]) ?? [];
}

export interface UseBirthdayVisibilityResult {
  rows: BirthdayVisibility[];
  /** birthday_id → the children who see it, each with their own note. */
  byBirthday: Map<string, BirthdayVisibilityEntry[]>;
  isLoading: boolean;
}

export function useBirthdayVisibility(): UseBirthdayVisibilityResult {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: ["birthday_visibility", familyId],
    queryFn: () => fetchBirthdayVisibility(familyId as string),
    enabled: !!familyId,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const byBirthday = useMemo(() => {
    const map = new Map<string, BirthdayVisibilityEntry[]>();
    for (const row of rows) {
      const entry: BirthdayVisibilityEntry = { personId: row.person_id, note: row.note };
      const list = map.get(row.birthday_id);
      if (list) list.push(entry);
      else map.set(row.birthday_id, [entry]);
    }
    return map;
  }, [rows]);

  return { rows, byBirthday, isLoading: query.isLoading };
}

// ---------------------------------------------------------------------------
// Who the picker may offer
// ---------------------------------------------------------------------------

export interface UseBirthdayVisibilityChildrenResult {
  /** Members whose kid access is enabled, in family-roster order. */
  children: Profile[];
  /**
   * False for every family that never turned kid mode on - and then the whole
   * feature renders nothing at all: no picker row, no empty section, no
   * disabled placeholder.
   */
  hasKidMode: boolean;
  isLoading: boolean;
}

export function useBirthdayVisibilityChildren(): UseBirthdayVisibilityChildrenResult {
  const { members, isLoading: membersLoading } = useFamilyMembers();
  // The family admin UI's list, shared rather than re-queried: one
  // `["kid-access", familyId]` entry serves the roster pills, the member
  // section and this picker.
  const { enabledIds, isLoading: accessLoading } = useKidAccessList();

  const children = useMemo(
    () => members.filter((member) => enabledIds.has(member.id)),
    [enabledIds, members],
  );

  return {
    children,
    hasKidMode: children.length > 0,
    isLoading: accessLoading || membersLoading,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface SaveBirthdayVisibilityInput {
  birthdayId: string;
  /** The FULL desired set - any child missing from it loses visibility. */
  entries: ReadonlyArray<BirthdayVisibilityEntry>;
}

export type SaveBirthdayVisibilityResult =
  /** Something actually changed and was written. */
  | "written"
  /** The draft matched what is stored - not a single round trip was made. */
  | "unchanged"
  /**
   * The birthday itself never landed (its create failed), so there is nothing
   * to attach the entries to. Deliberately not an error: the failed create has
   * already told the user, and a second toast would just blame the wrong thing.
   */
  | "birthday-missing";

/** Postgres `foreign_key_violation` - here: the birthday row isn't there yet. */
const FK_VIOLATION = "23503";

/**
 * Waiting out the create. On the birthdays page the form can await the create
 * mutation, but the other surfaces fire it and forget, so the visibility write
 * can reach the server a moment before the birthday row does. The only symptom
 * is the FK violation, so retry on exactly that, on a short leash.
 */
const FK_RETRY_DELAYS_MS = [150, 250, 400, 600, 900, 1200];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useSaveBirthdayVisibility() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      birthdayId,
      entries,
    }: SaveBirthdayVisibilityInput): Promise<SaveBirthdayVisibilityResult> => {
      if (!familyId) throw new Error("Nema porodice");

      // Diff against the cached family rows - the same data the picker just
      // rendered, so what we write is what the user saw themselves change.
      const stored =
        queryClient.getQueryData<BirthdayVisibility[]>(["birthday_visibility", familyId]) ?? [];
      const storedNotes = new Map(
        stored
          .filter((row) => row.birthday_id === birthdayId)
          .map((row) => [row.person_id, row.note ?? null] as const),
      );
      const nextNotes = new Map(
        entries.map((entry) => [entry.personId, normalizeVisibilityNote(entry.note)] as const),
      );

      const removed = [...storedNotes.keys()].filter((personId) => !nextNotes.has(personId));
      const changed = [...nextNotes.entries()].filter(
        ([personId, note]) => !storedNotes.has(personId) || storedNotes.get(personId) !== note,
      );

      if (removed.length === 0 && changed.length === 0) return "unchanged";

      if (changed.length > 0) {
        const rows = changed.map(([personId, note]) => ({
          birthday_id: birthdayId,
          person_id: personId,
          family_id: familyId,
          note,
        }));
        for (let attempt = 0; ; attempt++) {
          const { error } = await supabase
            .from("birthday_visibility")
            .upsert(rows, { onConflict: "birthday_id,person_id" });
          if (!error) break;
          if (error.code !== FK_VIOLATION) throw new Error(error.message);
          if (attempt >= FK_RETRY_DELAYS_MS.length) return "birthday-missing";
          await sleep(FK_RETRY_DELAYS_MS[attempt]);
        }
      }

      if (removed.length > 0) {
        const { error } = await supabase
          .from("birthday_visibility")
          .delete()
          .eq("birthday_id", birthdayId)
          .in("person_id", removed);
        if (error) throw new Error(error.message);
      }

      // Invalidated here rather than in `onSuccess`: the dialog that started
      // the write is usually closed (and sometimes unmounted) by the time it
      // resolves, and an unmounted observer never runs its callbacks.
      void queryClient.invalidateQueries({ queryKey: ["birthday_visibility", familyId] });
      return "written";
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri čuvanju vidljivosti za decu");
    },
  });
}
