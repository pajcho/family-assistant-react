import { useState } from "react";
import { FaceSmileIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { PickerRow } from "@/components/common/PickerRow";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useUpdateMemberAvatarEmoji } from "@/hooks/useFamilyMembers";
import { cn } from "@/lib/cn";
import type { Profile } from "@/types/database";
import { MEMBER_AVATAR_GROUPS, avatarForProfile, resolveMemberAvatar } from "@/utils/memberAvatar";

/**
 * The member's emoji - who this person IS, alongside their colour.
 *
 * A row that opens a modal rather than a grid sitting in the card: the
 * vocabulary is ~90 tiles, and inline it shoved the login and kid-access
 * sections a screen and a half down every time you opened a member. The row
 * wears the member's CURRENT avatar, so the common case (look, don't change)
 * costs no taps at all.
 *
 * `ResponsiveDialog` is a bottom drawer under 640px and a centred dialog above,
 * so the phone gets a real modal and the desktop stays a dialog. The grid keeps
 * its own scroll area instead of letting the sheet grow: a sheet is as tall as
 * its content, and THIS content would happily be taller than the screen.
 *
 * Nothing here is derived from the name. The app never guesses gender - see
 * `utils/memberAvatar.ts` for why that guess is unsafe in Serbian - so this
 * picker is the only thing that decides.
 */
export function MemberAvatarPicker({
  member,
  memberName,
}: {
  member: Profile;
  memberName: string;
}) {
  const [open, setOpen] = useState(false);
  const updateEmoji = useUpdateMemberAvatarEmoji();
  const picked = member.avatar_emoji;
  const auto = avatarForProfile(member.id);

  const choose = (emoji: string | null) => {
    updateEmoji.mutate({ profileId: member.id, avatar_emoji: emoji });
    setOpen(false);
  };

  /**
   * Open on the tile that is already picked. With ~90 of them the current
   * choice is usually three screens down, and a picker that opens somewhere
   * else makes you hunt for what you already chose. A callback ref rather than
   * an effect: it fires exactly when the selected tile mounts, which is the
   * moment the sheet has laid out.
   */
  const revealSelected = (node: HTMLButtonElement | null) => {
    node?.scrollIntoView({ block: "center" });
  };

  return (
    <>
      <PickerRow
        title="Emoji"
        icon={<FaceSmileIcon className="size-[17px]" />}
        onClick={() => setOpen(true)}
        summary={
          <>
            <span aria-hidden="true" className="text-[22px] leading-none">
              {resolveMemberAvatar(member)}
            </span>
            <span>{picked ? "izabrano" : "automatski"}</span>
          </>
        }
      />

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            {/* Serbian declension: the name stays in the nominative inside a
                sentence built around it, instead of a "Emoji za {ime}" title
                that would need the accusative and get it wrong half the time. */}
            <ResponsiveDialogTitle>Emoji</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Ovako se {memberName} prikazuje u dečijoj aplikaciji. Bira se ručno - aplikacija ne
              pogađa po imenu.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div role="radiogroup" aria-label="Emoji člana">
            {/* "Automatski" is a choice, not a reset link - and it wears the
                animal it would fall back to, so you can see which one that is
                without clearing the pick to find out. */}
            <button
              type="button"
              role="radio"
              aria-checked={picked == null}
              onClick={() => choose(null)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border px-2 py-1.5 pr-4 text-[13px] font-semibold transition-colors",
                picked == null
                  ? "border-transparent bg-accent-soft text-accent-deep ring-2 ring-accent"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <span aria-hidden="true" className="text-[26px] leading-none">
                {auto}
              </span>
              Automatski
            </button>

            {/* Six columns is the answer to 360px: inside the drawer's px-6 that
                leaves ~48px per fractional column, which clears the 44px tap
                floor - and because the columns are fractional the grid cannot
                overflow sideways at any width. */}
            <div className="mt-3 max-h-[46vh] overflow-y-auto overscroll-contain pr-1">
              {MEMBER_AVATAR_GROUPS.map((group) => (
                <div key={group.key} className="mb-1 last:mb-0">
                  <p className="sticky top-0 z-10 bg-background py-1.5 text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="radio"
                        ref={picked === emoji ? revealSelected : undefined}
                        aria-checked={picked === emoji}
                        onClick={() => choose(emoji)}
                        className={cn(
                          "grid aspect-square min-h-11 w-full place-items-center rounded-xl text-[30px] leading-none transition-colors",
                          // `ring-inset` on both rings, deliberately: a Tailwind
                          // ring paints OUTSIDE the box, and the group headings
                          // are `sticky` with an opaque background and z-10. The
                          // first tile of a group sits flush under its heading,
                          // so an outset ring loses its top 2px behind it - the
                          // selection reads as clipped. Inset keeps the whole
                          // indicator inside the tile, which also survives the
                          // scroller's edges and the 4px row gap.
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
                          picked === emoji
                            ? "bg-accent-soft ring-2 ring-accent ring-inset"
                            : "hover:bg-muted active:bg-muted",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Zatvori
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
