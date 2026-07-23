import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { readFunctionsError } from "@/utils/functionsError";

/**
 * Create / disable a Supabase login for a family member.
 *
 * A pure client (anon key) can't touch the auth admin API, so both actions go
 * through the `manage-family-login` Edge Function, which runs with the service
 * role and re-checks that the caller is an admin in the target's family.
 *
 * `create` re-keys the member's `profiles.id` to the new auth user's id so all
 * their history (activities, timetable, shifts) carries over - see the Edge
 * Function and the `ON UPDATE CASCADE` FKs in the family_admin migration.
 * `disable` deletes the auth user; the profile row survives as a login-less
 * member (the FK to auth.users was dropped long ago).
 */

type FnResult = { ok?: boolean; error?: string; id?: string };

async function invokeManageLogin(body: Record<string, unknown>): Promise<FnResult> {
  const { data, error } = await supabase.functions.invoke<FnResult>("manage-family-login", {
    body,
  });
  // `error` is the supabase-js wrapper for non-2xx; unwrap the real server
  // message. `data.error` covers a 2xx response that still reports a problem.
  const message = error
    ? ((await readFunctionsError(error)) ?? error.message)
    : (data?.error ?? null);
  if (message) throw new Error(message);
  return data ?? {};
}

export type CreateMemberLoginInput = {
  profileId: string;
  email: string;
  password: string;
};

export function useCreateMemberLogin() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    // Resolves to the member's NEW profile id (== the new auth user id after
    // the re-key) so callers can reselect the row, whose id just changed.
    mutationFn: async (input: CreateMemberLoginInput): Promise<string | null> => {
      const result = await invokeManageLogin({
        action: "create",
        profileId: input.profileId,
        email: input.email.trim(),
        password: input.password,
      });
      return result.id ?? null;
    },
    onSuccess: () => {
      // The member's profile id changed (re-key) and has_login flipped - refetch
      // the roster. Activities reference the new id via the cascade, so their
      // caches stay valid, but bounce them too in case a stale name lingered.
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri kreiranju naloga");
    },
  });
}

export function useDisableMemberLogin() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profileId: string): Promise<void> => {
      await invokeManageLogin({ action: "disable", profileId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri gašenju naloga");
    },
  });
}
