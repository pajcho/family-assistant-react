import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, type ProfileWithFamily } from "@/hooks/useProfile";
import {
  DEFAULT_MEMBER_AVATAR_STYLE,
  normalizeMemberAvatarStyle,
  resolveMemberAvatar,
  type MemberAvatarSource,
  type MemberAvatarStyle,
} from "@/utils/memberAvatar";

/**
 * "Prikaz članova" - how THIS user sees other family members: initials on a
 * colour, or the member's emoji.
 *
 * Per user and stored on the profile, exactly like `accent`: two parents
 * sharing one family can disagree, and the choice follows each of them across
 * devices. Values are stored in English ("initials" / "emoji"); only the
 * labels are Serbian.
 *
 * No `localStorage` mirror, unlike the accent. The accent needs one because it
 * paints the whole shell before React mounts and a wrong first frame flashes;
 * member avatars cannot render before the profile query resolves anyway (the
 * roster query is gated on `familyId`, which comes off that same profile), so
 * there is no earlier moment to be right at.
 */
export interface UseMemberAvatarStyleResult {
  memberAvatarStyle: MemberAvatarStyle;
  setMemberAvatarStyle: (next: MemberAvatarStyle) => void;
  isSaving: boolean;
}

/**
 * Read-only variant for the dozens of components that only DRAW a member.
 *
 * `MemberBadges` mounts up to four avatars per agenda row, so the render path
 * deliberately stays free of the mutation the settings row needs - it is the
 * same value, just without registering a mutation observer per badge.
 */
export function useMemberAvatarStyleValue(): MemberAvatarStyle {
  const { profile } = useProfile();
  if (!profile) return DEFAULT_MEMBER_AVATAR_STYLE;
  return normalizeMemberAvatarStyle(profile.member_avatar_style);
}

/**
 * `(member) => emoji | undefined`, undefined while the viewer is on initials.
 *
 * For the surfaces that mark a person with a small glyph next to a title
 * instead of a full avatar tile - the agenda rows' `PersonDot`, the filter
 * chips' colour dot. They all take "a dot, or this emoji instead", and this
 * saves each of them from spelling out the same branch.
 */
export function useMemberEmoji(): (
  member: MemberAvatarSource | null | undefined,
  personId?: string | null,
) => string | undefined {
  const style = useMemberAvatarStyleValue();
  // Stable while the setting is, so callers can list it as a `useMemo`
  // dependency (`useMemberAppliedFilters` does) without recomputing every
  // render.
  return useCallback(
    (member, personId) => (style === "emoji" ? resolveMemberAvatar(member, personId) : undefined),
    [style],
  );
}

/** The full hook: the current value plus a setter that persists it. */
export function useMemberAvatarStyle(): UseMemberAvatarStyleResult {
  const memberAvatarStyle = useMemberAvatarStyleValue();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (next: MemberAvatarStyle): Promise<void> => {
      if (!userId) throw new Error("Niste prijavljeni");
      const { error } = await supabase
        .from("profiles")
        .update({ member_avatar_style: next })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["profile", userId] });
      const previous = queryClient.getQueryData<ProfileWithFamily | null>(["profile", userId]);
      queryClient.setQueryData<ProfileWithFamily | null>(["profile", userId], (old) =>
        old ? { ...old, profile: { ...old.profile, member_avatar_style: next } } : old,
      );
      return { previous };
    },
    onError: (e, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["profile", userId], context.previous);
      }
      toast.error(e instanceof Error ? e.message : "Greška pri čuvanju prikaza članova");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });

  return {
    memberAvatarStyle,
    setMemberAvatarStyle: (next) => mutation.mutate(next),
    isSaving: mutation.isPending,
  };
}
